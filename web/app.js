// style-finder 프론트엔드. 백엔드 서버 없음 — 브라우저에서 Supabase에 직접 쿼리.
// 보안은 RLS(supabase/schema.sql)가 담당: 내 폴더(user_brands)는 로그인한 나만 보고 고치고,
// brands/product_group/offer는 다 같이 읽지만 쓰기는 서비스 롤(수집 파이프라인)만 가능.

// 상품 클릭 후 뒤로가기(bfcache 복원)하면 iOS가 자체적으로 스크롤을 0으로 리셋해버리는 게
// 진짜 원인이었음(실측 확인됨). pageshow에서 우리가 다시 옮겨도 iOS가 그 뒤에 또 0으로
// 되돌리는 경쟁이 계속 있었는데, 'manual'로 바꾸면 브라우저가 스크롤 복원 자체를 안 건드리고
// 전적으로 우리(pageshow 핸들러)에게 맡긴다 — 애초에 싸울 상대가 없어짐.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

// "로그인 상태 유지" 체크박스 값에 따라 세션 토큰을 localStorage(껐다 켜도 유지)
// 또는 sessionStorage(탭 닫으면 삭제)에 쓴다. 체크 여부 자체는 항상 localStorage에 기억.
const REMEMBER_KEY = 'auth_remember';
function setRememberLogin(remember) {
  try { localStorage.setItem(REMEMBER_KEY, remember ? '1' : '0'); } catch {}
}
function shouldRemember() {
  try { return localStorage.getItem(REMEMBER_KEY) !== '0'; } catch { return true; }
}
const hybridStorage = {
  getItem: (key) => localStorage.getItem(key) ?? sessionStorage.getItem(key),
  setItem: (key, value) => {
    (shouldRemember() ? localStorage : sessionStorage).setItem(key, value);
    (shouldRemember() ? sessionStorage : localStorage).removeItem(key);
  },
  removeItem: (key) => { localStorage.removeItem(key); sessionStorage.removeItem(key); },
};

const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,    // 세션을 저장 → 앱 다시 열어도 로그인 유지
    autoRefreshToken: true,  // 토큰 만료 전에 자동 갱신
    storage: hybridStorage,
    detectSessionInUrl: false,
  },
});
let currentUser = null;
let myFolderIds = []; // 현재 보고 있는 폴더(내 폴더 또는 공유받은 폴더)에 있는 brand_id 목록
let allBrands = [];   // "내 폴더" 다이얼로그용 전체 브랜드 목록
let catSel = ''; // 상위(TOP/OUTER...) 또는 하위 카테고리 칩 선택 — 그룹 id 또는 카테고리 id
let myFolders = [];        // 로그인한 사람의 폴더 목록 [{id,name,share_id}] (최대 3개)
let currentFolderId = null; // 지금 검색에 쓰이는 폴더 id
let sharedView = null;      // 공유 링크로 남의 폴더를 보는 중이면 {id,name,share_id,user_id}
let bootComplete = false;   // 부팅 흐름이 스크롤 복원 여부를 판단하기 전까지, 초기 세션 감지 이벤트가 go()로 화면을 덮어쓰지 않게 막는 플래그
const PAGE_SIZE = 60;
let currentPage = 1; // 1부터 시작
let lastTotal = 0;

// "müdule"/"jabbérwocky"처럼 발음기호 들어간 브랜드명을 "mudule"/"jabberwocky"로 쳐도 찾게.
const foldAccents = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// 브랜드명 abc 순 정렬, 숫자로 시작하는 브랜드는 맨 아래로.
function compareBrandNames(a, b) {
  const ad = /^[0-9]/.test(a);
  const bd = /^[0-9]/.test(b);
  if (ad !== bd) return ad ? 1 : -1;
  return a.localeCompare(b, 'en', { sensitivity: 'base' });
}

// 카테고리 태그마다 같은 이름은 항상 같은 색이 나오도록(리로드해도 안 바뀌게) 해시로 고정 배정.
const TAG_PALETTE = [
  { bg: '#fdece3', fg: '#a8532f' },
  { bg: '#eaf0fb', fg: '#3b5998' },
  { bg: '#eef7ee', fg: '#3a7d3a' },
  { bg: '#f7eefb', fg: '#7c4a9e' },
  { bg: '#fdf6e0', fg: '#93720f' },
  { bg: '#fdeef1', fg: '#a83a5c' },
];
function tagColor(label) {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return TAG_PALETTE[h % TAG_PALETTE.length];
}

// window.prompt()/confirm()은 카카오톡·네이버 인앱 브라우저 등 일부 환경에서 아예 안 뜨는 경우가 있어서,
// 폴더 생성/이름변경/삭제처럼 실제 입력이 필요한 곳은 직접 만든 dialog 기반 헬퍼로 대체.
function askText(title, defaultValue) {
  return new Promise((resolve) => {
    const dlg = document.getElementById('promptDialog');
    document.getElementById('promptTitle').textContent = title;
    const input = document.getElementById('promptInput');
    input.value = defaultValue || '';
    const okBtn = document.getElementById('promptOkBtn');
    const cancelBtn = document.getElementById('promptCancelBtn');
    const finish = (value) => {
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKeydown);
      dlg.removeEventListener('cancel', onCancel);
      dlg.close();
      resolve(value);
    };
    const onOk = () => finish(input.value.trim());
    const onCancel = () => finish(null);
    const onKeydown = (e) => { if (e.key === 'Enter') onOk(); };
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKeydown);
    dlg.addEventListener('cancel', onCancel);
    dlg.showModal();
    input.focus();
    input.select();
  });
}

function askConfirm(message) {
  return new Promise((resolve) => {
    const dlg = document.getElementById('confirmDialog');
    document.getElementById('confirmMessage').textContent = message;
    const okBtn = document.getElementById('confirmOkBtn');
    const cancelBtn = document.getElementById('confirmCancelBtn');
    const finish = (value) => {
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      dlg.removeEventListener('cancel', onCancel);
      dlg.close();
      resolve(value);
    };
    const onOk = () => finish(true);
    const onCancel = () => finish(false);
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    dlg.addEventListener('cancel', onCancel);
    dlg.showModal();
  });
}

function askAlert(message) {
  return new Promise((resolve) => {
    const dlg = document.getElementById('confirmDialog');
    document.getElementById('confirmMessage').textContent = message;
    const okBtn = document.getElementById('confirmOkBtn');
    const cancelBtn = document.getElementById('confirmCancelBtn');
    cancelBtn.style.display = 'none';
    const finish = () => {
      okBtn.removeEventListener('click', onOk);
      dlg.removeEventListener('cancel', onOk);
      cancelBtn.style.display = '';
      dlg.close();
      resolve();
    };
    const onOk = () => finish();
    okBtn.addEventListener('click', onOk);
    dlg.addEventListener('cancel', onOk);
    dlg.showModal();
  });
}

const won = (n) => (n == null ? '' : '₩' + n.toLocaleString('ko-KR'));

// ---------------- 인증 (이메일 + 비밀번호) ----------------
function renderAuthArea() {
  const el = document.getElementById('authArea');
  if (currentUser) {
    const initial = (currentUser.email || '?')[0].toUpperCase();
    el.innerHTML = `
      <span class="avatar" title="${currentUser.email}">${initial}</span>
      <button class="linklike" onclick="signOut()">로그아웃</button>`;
  } else {
    el.innerHTML = '<button onclick="openAuthDialog()">로그인</button>';
  }
}

let authMode = 'signin'; // 'signin' | 'signup'

function resetAuthMsg() {
  const msg = document.getElementById('authMsg');
  msg.className = '';
  msg.style.display = 'none';
  msg.textContent = '';
}

function openAuthDialog() {
  authMode = 'signin';
  updateAuthDialogMode();
  document.getElementById('authEmail').value = '';
  document.getElementById('authPassword').value = '';
  document.getElementById('authRemember').checked = shouldRemember();
  resetAuthMsg();
  authDialog.showModal();
}

function toggleAuthMode() {
  authMode = authMode === 'signin' ? 'signup' : 'signin';
  resetAuthMsg();
  updateAuthDialogMode();
}

function updateAuthDialogMode() {
  document.getElementById('authDialogTitle').textContent = authMode === 'signin' ? '로그인' : '회원가입';
  document.getElementById('authSubmitBtn').textContent = authMode === 'signin' ? '로그인' : '회원가입';
  document.getElementById('authForgotLink').style.display = authMode === 'signin' ? '' : 'none';
  document.getElementById('authToggleText').innerHTML = authMode === 'signin'
    ? '계정이 없으신가요? <button class="linklike" onclick="toggleAuthMode()">회원가입</button>'
    : '이미 계정이 있으신가요? <button class="linklike" onclick="toggleAuthMode()">로그인</button>';
}

async function requestPasswordReset() {
  const email = document.getElementById('authEmail').value.trim();
  const msg = document.getElementById('authMsg');
  if (!email) { msg.className = 'warn'; msg.style.display = 'block'; msg.textContent = '이메일을 먼저 입력해주세요.'; return; }
  msg.className = '';
  msg.style.display = 'block';
  msg.textContent = '전송 중…';
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  if (error) { msg.className = 'warn'; msg.textContent = error.message; return; }
  msg.className = 'ok';
  msg.textContent = '비밀번호 재설정 메일을 보냈어요. 메일함을 확인해주세요.';
}

function authErrorMessage(error, mode) {
  const m = error.message || '';
  if (/invalid login credentials/i.test(m)) return '이메일 또는 비밀번호가 올바르지 않아요.';
  if (/email not confirmed/i.test(m)) return '이메일 인증이 필요해요. 메일함을 확인해주세요.';
  if (mode === 'signup' && /already registered|already been registered|user already exists/i.test(m)) return '이미 가입된 이메일이에요. 로그인해주세요.';
  if (/password should be at least/i.test(m)) return '비밀번호는 6자 이상이어야 해요.';
  return m;
}

async function submitAuth() {
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const msg = document.getElementById('authMsg');
  if (!email || !password) { msg.className = 'warn'; msg.textContent = '이메일과 비밀번호를 입력해주세요.'; return; }

  msg.className = '';
  msg.style.display = 'block';
  msg.textContent = '처리 중…';
  setRememberLogin(document.getElementById('authRemember').checked);
  if (authMode === 'signin') {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) { msg.className = 'warn'; msg.textContent = authErrorMessage(error, 'signin'); return; }
    authDialog.close();
  } else {
    const { data, error } = await sb.auth.signUp({ email, password });
    if (error) { msg.className = 'warn'; msg.textContent = authErrorMessage(error, 'signup'); return; }
    if (data.session) {
      authDialog.close();
    } else {
      msg.className = 'ok';
      msg.textContent = '가입 확인 메일을 보냈어요. 메일함에서 확인 후 로그인해주세요.';
    }
  }
}

async function signOut() {
  await sb.auth.signOut();
}

sb.auth.onAuthStateChange(async (event, session) => {
  if (event === 'PASSWORD_RECOVERY') {
    const newPassword = prompt('새 비밀번호를 입력해주세요 (6자 이상)');
    if (newPassword) {
      const { error } = await sb.auth.updateUser({ password: newPassword });
      alert(error ? '오류: ' + error.message : '비밀번호가 변경됐어요.');
    }
  }
  currentUser = session?.user || null;
  renderAuthArea();
  if (!sharedView) {
    if (currentUser) {
      await loadMyFolders();
      await loadAllBrands();
    } else {
      myFolders = [];
      currentFolderId = null;
      myFolderIds = [];
    }
    renderFolderTabs();
    updateFolderNavLabel();
    // 부팅 중 처음 감지되는 세션 이벤트는 부팅 흐름(스크롤 복원 or go())이 알아서 처리하므로 건너뜀 —
    // 안 그러면 뒤로가기로 돌아왔을 때 복원한 화면을 이 go()가 바로 덮어써버림.
    if (bootComplete) go();
  }
});

// ---------------- 폴더 (사람마다 최대 3개, 공유 가능) ----------------
async function loadMyFolders() {
  const { data, error } = await sb.from('folders').select('id,name,share_id').eq('user_id', currentUser.id).order('created_at');
  if (error) { console.error(error); return; }
  myFolders = data;
  if (myFolders.length === 0) { await createFolder(true); return; }
  if (!currentFolderId || !myFolders.some((f) => f.id === currentFolderId)) currentFolderId = myFolders[0].id;
  await loadFolderBrandIds();
}

async function loadFolderBrandIds() {
  const { data, error } = await sb.from('user_brands').select('brand_id').eq('folder_id', currentFolderId);
  if (error) { console.error(error); return; }
  myFolderIds = data.map((r) => r.brand_id);
}

async function createFolder(silent) {
  if (myFolders.length >= 3) { await askAlert('폴더는 최대 3개까지 만들 수 있어요.'); return; }
  let name = '내 폴더';
  if (!silent) {
    name = await askText('새 폴더 이름', `폴더 ${myFolders.length + 1}`);
    if (!name) return;
  }
  const { data, error } = await sb.from('folders').insert({ user_id: currentUser.id, name }).select('id,name,share_id').single();
  if (error) { await askAlert(error.message); return; }
  myFolders.push(data);
  currentFolderId = data.id;
  await loadFolderBrandIds();
  renderFolderTabs();
  renderFolderList();
  updateFolderNavLabel();
  renderBrandFilter();
  go();
}

async function renameFolder() {
  const f = myFolders.find((x) => x.id === currentFolderId);
  if (!f) return;
  const name = await askText('폴더 이름 변경', f.name);
  if (!name || name === f.name) return;
  const { error } = await sb.from('folders').update({ name }).eq('id', currentFolderId);
  if (error) { await askAlert(error.message); return; }
  f.name = name;
  renderFolderTabs();
  updateFolderNavLabel();
}

async function deleteFolder() {
  if (myFolders.length <= 1) { await askAlert('마지막 폴더는 삭제할 수 없어요.'); return; }
  const f = myFolders.find((x) => x.id === currentFolderId);
  if (!f || !(await askConfirm(`"${f.name}" 폴더를 삭제할까요? 안에 담긴 브랜드 목록도 함께 사라져요.`))) return;
  const { error } = await sb.from('folders').delete().eq('id', currentFolderId);
  if (error) { await askAlert(error.message); return; }
  myFolders = myFolders.filter((x) => x.id !== currentFolderId);
  currentFolderId = myFolders[0].id;
  await loadFolderBrandIds();
  renderFolderTabs();
  renderFolderList();
  updateFolderNavLabel();
  renderBrandFilter();
  go();
}

async function switchFolder(id) {
  if (sharedView || id === currentFolderId) return;
  currentFolderId = id;
  await loadFolderBrandIds();
  renderFolderTabs();
  renderFolderList();
  updateFolderNavLabel();
  renderBrandFilter();
  go();
}

async function copyShareLink() {
  const f = myFolders.find((x) => x.id === currentFolderId);
  if (!f) return;
  const url = `${location.origin}${location.pathname}?share=${f.share_id}`;
  const msg = document.getElementById('folderMsg');
  try {
    await navigator.clipboard.writeText(url);
    msg.className = 'ok';
    msg.textContent = '공유 링크가 복사됐어요!';
  } catch {
    prompt('링크를 복사해서 공유하세요', url);
  }
}

async function loadSharedFolder(shareId) {
  const { data: folder, error } = await sb.from('folders').select('id,name,share_id,user_id').eq('share_id', shareId).single();
  if (error || !folder) { alert('존재하지 않거나 삭제된 공유 링크예요.'); return; }
  sharedView = folder;
  currentFolderId = folder.id;
  await loadFolderBrandIds();
  renderSharedBanner();
  renderBrandFilter();
}

async function exitSharedView() {
  sharedView = null;
  const url = new URL(location.href);
  url.searchParams.delete('share');
  history.replaceState(0, '', url.pathname + (url.search || ''));
  if (currentUser) {
    await loadMyFolders();
  } else {
    myFolders = [];
    currentFolderId = null;
    myFolderIds = [];
  }
  renderFolderTabs();
  updateFolderNavLabel();
  renderSharedBanner();
  renderBrandFilter();
  go();
}

function renderSharedBanner() {
  const el = document.getElementById('sharedBanner');
  const addBtn = document.getElementById('addBrandBtn');
  if (!el) return;
  if (sharedView) {
    el.style.display = 'flex';
    el.innerHTML = `<span>📁 <b>${sharedView.name}</b> 폴더를 보는 중이에요 (다른 사람과 공유됨)</span>
      <button class="linklike" onclick="exitSharedView()">내 폴더로 돌아가기</button>`;
    if (addBtn) addBtn.style.display = 'none';
  } else {
    el.style.display = 'none';
    el.innerHTML = '';
    if (addBtn) addBtn.style.display = '';
  }
}

function updateFolderNavLabel() {
  const btn = document.getElementById('folderNavBtn');
  if (!btn) return;
  if (sharedView) { btn.textContent = `📁 ${sharedView.name}`; return; }
  const f = myFolders.find((x) => x.id === currentFolderId);
  btn.textContent = f ? `📁 ${f.name}` : '내 폴더';
}

function renderFolderTabs() {
  const wrap = document.getElementById('folderTabs');
  const manage = document.getElementById('folderManageRow');
  if (!wrap) return;
  if (sharedView) {
    wrap.innerHTML = '<div class="shared-note">다른 사람의 폴더예요 — 보기만 가능해요.</div>';
    if (manage) manage.style.display = 'none';
    return;
  }
  if (!currentUser) {
    wrap.innerHTML = '';
    if (manage) manage.style.display = 'none';
    return;
  }
  wrap.innerHTML = myFolders
    .map((f) => `<button class="ftab ${f.id === currentFolderId ? 'active' : ''}" onclick="switchFolder(${f.id})">${f.name}</button>`)
    .join('') + (myFolders.length < 3 ? '<button class="ftab ftab-add" onclick="createFolder()">+ 새 폴더</button>' : '');
  if (manage) manage.style.display = 'flex';
  const delBtn = document.getElementById('deleteFolderBtn');
  if (delBtn) delBtn.style.display = myFolders.length <= 1 ? 'none' : '';
}

async function loadAllBrands() {
  // 'excluded'만 빼고 다 가져옴 — pending/needs_review도 내 폴더 목록엔 보여야
  // 방금 등록한 브랜드가 "등록은 됐는데 목록엔 안 보임" 처럼 느껴지지 않음.
  const { data, error } = await sb
    .from('brands')
    .select('id,name,type,status,added_by')
    .neq('status', 'excluded');
  if (error) { console.error(error); return; }
  allBrands = data.sort((a, b) => compareBrandNames(a.name, b.name));
  renderBrandFilter();
}

let folderListFilter = 'all'; // 'all' | 'mine' — 폴더 다이얼로그 브랜드 목록 필터
function setFolderListFilter(f) {
  folderListFilter = f;
  for (const btn of document.querySelectorAll('#folderFilterRow .fchip')) {
    btn.classList.toggle('active', btn.dataset.filter === f);
  }
  renderFolderList();
}

let brandComboOptions = []; // 브랜드 검색창 자동완성용 이름 목록(정렬됨)

function renderBrandFilter() {
  const sel = document.getElementById('brand');
  const current = sel.value;
  sel.innerHTML = '<option value="">브랜드 전체</option>';
  // 검색 필터용 드롭다운은 실제 상품이 있는 ready 브랜드만
  const mine = allBrands.filter((b) => b.status === 'ready' && myFolderIds.includes(b.id)).sort((a, b) => compareBrandNames(a.name, b.name));
  for (const b of mine) sel.insertAdjacentHTML('beforeend', `<option value="${b.name}">${b.name}</option>`);
  sel.value = current;
  brandComboOptions = mine.map((b) => b.name);
  const brandInput = document.getElementById('brandInput');
  if (brandInput && document.activeElement !== brandInput) brandInput.value = current || '';
  loadSizeOptions();
}

// ---------------- 브랜드 검색 콤보(select는 값 저장용으로 숨겨서 그대로 두고, 위에 검색 가능한 입력을 얹음) ----------------
function openBrandCombo() {
  filterBrandCombo();
  document.getElementById('brandComboList').classList.add('open');
}

function closeBrandCombo() {
  document.getElementById('brandComboList').classList.remove('open');
}

function filterBrandCombo() {
  const list = document.getElementById('brandComboList');
  const q = foldAccents(document.getElementById('brandInput').value || '');
  const matches = brandComboOptions.filter((n) => foldAccents(n).includes(q));
  const allOpt = '<div class="brand-combo-item" data-value="">브랜드 전체</div>';
  list.innerHTML =
    allOpt +
    (matches.length
      ? matches.map((n) => `<div class="brand-combo-item" data-value="${n}">${n}</div>`).join('')
      : '<div class="brand-combo-empty">일치하는 브랜드 없음</div>');
  list.classList.add('open');
}

function pickBrand(name) {
  document.getElementById('brand').value = name;
  document.getElementById('brandInput').value = name || '';
  closeBrandCombo();
  go();
}

document.addEventListener('click', (e) => {
  const item = e.target.closest('.brand-combo-item');
  if (item) { pickBrand(item.dataset.value); return; }
  if (!e.target.closest('.brand-combo')) closeBrandCombo();
});

// ---------------- 사이즈 필터: 사이트마다 표기가 다 달라서(SMALL/S, 1/2/3, 신발 220~290 등)
// 고정 목록 대신 지금 폴더 안 상품에 실제로 있는 값만 보여주고, 흔한 동의어는 하나로 묶음.
const SIZE_ALIASES = {
  XS: ['XS', 'X-SMALL', 'XSMALL'],
  S: ['S', 'SMALL'],
  M: ['M', 'MEDIUM'],
  L: ['L', 'LARGE'],
  XL: ['XL', 'X-LARGE', 'XLARGE'],
  XXL: ['XXL', 'XX-LARGE', '2XL'],
  OS: ['OS', 'ONE SIZE', 'FREE', 'FREE SIZE'],
};
const SIZE_ALIAS_LOOKUP = {};
for (const [label, variants] of Object.entries(SIZE_ALIASES)) {
  for (const v of variants) SIZE_ALIAS_LOOKUP[v] = label;
}
function sizeVariants(label) {
  return SIZE_ALIASES[label] || [label];
}

let sizeOptions = []; // 지금 폴더에 실제로 존재하는 사이즈 표시 라벨(정렬됨)

// 부팅 중 renderBrandFilter()가 여러 번 불리는데 그때마다 전 상품 사이즈를 처음부터 다시 받아서
// (수천 행 × 수십 번 요청) 사진 로딩과 네트워크를 다퉜음 → 같은 폴더면 한 번만, 결과는 localStorage에도 캐시.
let sizeLoadKey = '';
let sizeLoadPromise = null;
const SIZE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
function sizeCacheKey() { return 'sf_sizes:' + [...myFolderIds].sort().join(','); }
async function loadSizeOptions() {
  if ((!currentUser && !sharedView) || !myFolderIds.length) {
    sizeOptions = [];
    renderSizeFilter();
    return;
  }
  const key = sizeCacheKey();
  if (key === sizeLoadKey && sizeLoadPromise) return sizeLoadPromise;
  sizeLoadKey = key;
  sizeLoadPromise = loadSizeOptionsUncached(key);
  return sizeLoadPromise;
}
async function loadSizeOptionsUncached(key) {
  try {
    const c = JSON.parse(localStorage.getItem(key) || 'null');
    if (c && Date.now() - c.at < SIZE_CACHE_TTL_MS && Array.isArray(c.options)) {
      sizeOptions = c.options;
      renderSizeFilter();
      return;
    }
  } catch {}
  // select는 기본 1000행 제한이 있어서, 폴더 상품이 그보다 많으면 뒤쪽 사이즈를 놓치므로 끝까지 페이지네이션.
  // 첫 페이지에서 총 개수를 알아내고, 나머지 페이지는 동시에 받는다(예전엔 7~13번을 줄줄이 기다렸음).
  const fetchPage = (from) => sb.from('product_group').select('sizes', { count: from === 0 ? 'exact' : undefined }).in('brand_id', myFolderIds).range(from, from + 999);
  const first = await fetchPage(0);
  if (first.error) { console.error(first.error); sizeLoadKey = ''; return; } // 실패하면 다음에 다시 시도
  const rows = [...first.data];
  const total = first.count || first.data.length;
  const pending = [];
  for (let from = 1000; from < total; from += 1000) pending.push(fetchPage(from));
  for (const r of await Promise.all(pending)) {
    if (r.error) { console.error(r.error); sizeLoadKey = ''; return; }
    rows.push(...r.data);
  }
  const normalized = new Set();
  const others = new Set();
  for (const row of rows) {
    for (const raw of row.sizes || []) {
      const cleaned = String(raw).replace(/\s*\([^)]*\)\s*/g, '').trim(); // "1 (LAST ONE)" -> "1"
      const label = SIZE_ALIAS_LOOKUP[cleaned.toUpperCase()];
      if (label) normalized.add(label);
      else if (cleaned) others.add(cleaned);
    }
  }
  const clothingOrder = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'OS'];
  const clothing = clothingOrder.filter((l) => normalized.has(l));
  const rest = [...others].sort((a, b) => {
    const an = parseFloat(a);
    const bn = parseFloat(b);
    if (!isNaN(an) && !isNaN(bn)) return an - bn;
    if (!isNaN(an)) return -1;
    if (!isNaN(bn)) return 1;
    return a.localeCompare(b);
  });
  sizeOptions = [...clothing, ...rest];
  try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), options: sizeOptions })); } catch {}
  renderSizeFilter();
}

function renderSizeFilter() {
  const sel = document.getElementById('size');
  const current = sel.value;
  sel.innerHTML = '<option value="">사이즈 전체</option>';
  for (const s of sizeOptions) sel.insertAdjacentHTML('beforeend', `<option value="${s}">${s}</option>`);
  sel.value = sizeOptions.includes(current) ? current : '';
}

function currentFilteredBrands() {
  const q = foldAccents(document.getElementById('folderSearch').value || '');
  const base = folderListFilter === 'mine' ? allBrands.filter((b) => b.added_by === currentUser.id) : allBrands;
  return base.filter((b) => foldAccents(b.name).includes(q));
}

function renderFolderList() {
  const q = foldAccents(document.getElementById('folderSearch').value || '');
  const list = document.getElementById('folderList');
  const filterRow = document.getElementById('folderFilterRow');
  const selectAllRow = document.getElementById('folderSelectAllRow');
  if (sharedView) {
    if (filterRow) filterRow.style.display = 'none';
    if (selectAllRow) selectAllRow.style.display = 'none';
    const brands = allBrands.filter((b) => myFolderIds.includes(b.id) && foldAccents(b.name).includes(q));
    list.innerHTML = brands.length
      ? brands.map((b) => `<div class="folderRow"><span class="fname">${b.name}</span></div>`).join('')
      : '<div style="padding:12px;color:#a1a1aa">브랜드 없음</div>';
    return;
  }
  if (!currentUser) {
    if (filterRow) filterRow.style.display = 'none';
    if (selectAllRow) selectAllRow.style.display = 'none';
    list.innerHTML = '<div style="padding:12px;color:#a1a1aa">로그인하면 폴더를 만들 수 있어요.</div>';
    return;
  }
  if (filterRow) filterRow.style.display = 'flex';
  const filtered = currentFilteredBrands();
  if (selectAllRow) {
    if (filtered.length) {
      selectAllRow.style.display = 'flex';
      const selectedCount = filtered.filter((b) => myFolderIds.includes(b.id)).length;
      const cb = document.getElementById('folderSelectAllCheckbox');
      cb.checked = selectedCount === filtered.length;
      cb.indeterminate = selectedCount > 0 && selectedCount < filtered.length;
      document.getElementById('folderSelectAllLabel').textContent =
        selectedCount === filtered.length ? `전체 해제 (${filtered.length})` : `전체 선택 (${filtered.length})`;
    } else {
      selectAllRow.style.display = 'none';
    }
  }
  list.innerHTML = filtered
    .map((b) => {
      const checked = myFolderIds.includes(b.id) ? 'checked' : '';
      const typeLabel = b.type === 'select_shop' ? '<span class="fbrand">편집샵</span>' : '';
      const statusLabel = b.status !== 'ready'
        ? `<span class="fbrand">${b.status === 'pending' ? '처리 중' : '수집 준비 중'}</span>`
        : '';
      return `<label class="folderRow">
        <input type="checkbox" data-brand="${b.id}" ${checked} onchange="toggleFolder('${b.id}', this.checked)">
        <span class="fname">${b.name}</span> ${typeLabel} ${statusLabel}
      </label>`;
    })
    .join('') || (folderListFilter === 'mine'
      ? '<div style="padding:12px;color:#a1a1aa">아직 등록한 브랜드가 없어요.</div>'
      : '<div style="padding:12px;color:#a1a1aa">결과 없음</div>');
}

async function toggleAllVisible() {
  if (!currentUser || sharedView) return;
  const visible = currentFilteredBrands();
  if (!visible.length) return;
  const msg = document.getElementById('folderMsg');
  const selectedCount = visible.filter((b) => myFolderIds.includes(b.id)).length;
  const shouldSelectAll = selectedCount < visible.length;

  if (shouldSelectAll) {
    const toAdd = visible.filter((b) => !myFolderIds.includes(b.id));
    if (toAdd.length) {
      const { error } = await sb
        .from('user_brands')
        .insert(toAdd.map((b) => ({ user_id: currentUser.id, folder_id: currentFolderId, brand_id: b.id })));
      if (error) { msg.className = 'warn'; msg.style.display = 'block'; msg.textContent = error.message; return; }
      myFolderIds.push(...toAdd.map((b) => b.id));
    }
  } else {
    const ids = visible.map((b) => b.id);
    const { error } = await sb.from('user_brands').delete().eq('folder_id', currentFolderId).in('brand_id', ids);
    if (error) { msg.className = 'warn'; msg.style.display = 'block'; msg.textContent = error.message; return; }
    myFolderIds = myFolderIds.filter((id) => !ids.includes(id));
  }

  const folderName = (myFolders.find((f) => f.id === currentFolderId) || {}).name || '내 폴더';
  msg.className = 'ok';
  msg.style.display = 'block';
  msg.textContent = `${folderName}: ${myFolderIds.length}개 브랜드`;
  renderFolderList();
  renderBrandFilter();
  updateFolderNavLabel();
}

async function toggleFolder(brandId, add) {
  const msg = document.getElementById('folderMsg');
  if (add) {
    const { error } = await sb.from('user_brands').insert({ user_id: currentUser.id, folder_id: currentFolderId, brand_id: brandId });
    if (error) { msg.className = 'warn'; msg.textContent = error.message; return; }
    myFolderIds.push(brandId);
  } else {
    const { error } = await sb.from('user_brands').delete().eq('folder_id', currentFolderId).eq('brand_id', brandId);
    if (error) { msg.className = 'warn'; msg.textContent = error.message; return; }
    myFolderIds = myFolderIds.filter((id) => id !== brandId);
  }
  const folderName = (myFolders.find((f) => f.id === currentFolderId) || {}).name || '내 폴더';
  msg.className = 'ok';
  msg.textContent = `${folderName}: ${myFolderIds.length}개 브랜드`;
  renderBrandFilter();
  updateFolderNavLabel();
}

// ---------------- 브랜드 등록 ----------------
// Edge Function(register-brand)이 배포되면 즉시 판별 + 1~2분 안에 자동 수집까지 되지만,
// 아직 배포 전이거나 일시적으로 호출이 실패하는 경우에도 등록 자체는 항상 되어야 하므로
// (예전 방식: pending으로 접수만 해두면 매일 새벽 정기 수집이 판별+수집을 처리) 그쪽으로
// 자동 폴백한다. 그래서 이 함수 배포를 당장 안 해도 사이트는 정상 동작한다.
function slugify(hostname) {
  return hostname.replace(/^www\./, '').replace(/\.(com|co\.kr|kr|link|net|store|shop)$/i, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}

async function submitAddFallback(urlInput, addToFolder, out) {
  let shopUrl;
  try { shopUrl = new URL(/^https?:\/\//i.test(urlInput) ? urlInput : `https://${urlInput}`).origin; }
  catch { out.className = 'warn'; out.textContent = 'URL 형식이 이상해요.'; return; }

  // 브랜드 표시 이름은 사용자가 직접 입력하지 않고 URL에서 자동으로 뽑아서 붙인다 —
  // 자유 입력 필드로 두면 장난스럽거나 부적절한 이름을 등록할 수 있어서.
  const id = slugify(new URL(shopUrl).hostname);
  const { error: e1 } = await sb.from('brands').upsert(
    { id, name: id.replace(/-/g, ' ').toUpperCase(), name_en: id.replace(/-/g, ' ').toUpperCase(), type: 'brand', shop_url: shopUrl, platform: 'unknown', status: 'pending', added_by: currentUser.id },
    { onConflict: 'id', ignoreDuplicates: true }
  );
  if (e1) { out.className = 'warn'; out.textContent = e1.message; return; }
  await sb.rpc('claim_brand', { target_id: id });

  if (addToFolder) {
    const { error: e2 } = await sb.from('user_brands').insert({ user_id: currentUser.id, folder_id: currentFolderId, brand_id: id });
    if (e2 && !String(e2.message).includes('duplicate')) { out.className = 'warn'; out.textContent = e2.message; return; }
    myFolderIds.push(id);
  }

  out.className = 'ok';
  out.textContent = `등록 요청 접수! 자동 판별 후 다음 정기 수집(매일 새벽) 때 반영돼요.${addToFolder ? ' (이미 있던 브랜드면 내 폴더에 바로 추가됨)' : ''}`;
  await loadAllBrands();
}

async function submitAdd() {
  const out = document.getElementById('addResult');
  if (!currentUser) { out.className = 'warn'; out.textContent = '로그인 먼저 해주세요.'; out.style.display = 'block'; return; }
  if (sharedView) { out.className = 'warn'; out.textContent = '공유된 폴더에는 추가할 수 없어요. 내 폴더로 돌아가서 추가해주세요.'; out.style.display = 'block'; return; }
  const urlInput = document.getElementById('addUrl').value.trim();
  const addToFolder = document.getElementById('addToMyFolder').checked;
  if (!urlInput) {
    out.className = 'warn'; out.textContent = '쇼핑몰 URL을 입력해주세요.'; out.style.display = 'block';
    return;
  }

  out.style.display = 'block';
  out.className = '';
  out.textContent = '등록 중…';

  let data, error;
  try {
    ({ data, error } = await sb.functions.invoke('register-brand', {
      body: { url: urlInput },
    }));
  } catch (err) {
    error = err;
  }
  // register-brand가 아직 배포 전이거나 호출 자체(네트워크/인증 등)가 실패하면 예전 방식으로 폴백.
  // 함수 호출은 성공했는데 서버가 ok:false로 응답한 경우(예: URL 형식 오류)는 폴백하지 않고
  // 서버가 만든 정확한 이유를 그대로 보여준다 — 폴백의 뭉뚱그린 메시지로 덮어써버리면
  // 실제 원인을 알 수 없게 된다.
  if (error) {
    return submitAddFallback(urlInput, addToFolder, out);
  }
  if (!data.ok) {
    out.className = 'warn';
    out.textContent = data.message || '등록에 실패했어요. 다시 시도해주세요.';
    return;
  }

  if (addToFolder) {
    const { error: e2 } = await sb.from('user_brands').insert({ user_id: currentUser.id, folder_id: currentFolderId, brand_id: data.id });
    if (e2 && !String(e2.message).includes('duplicate')) { out.className = 'warn'; out.textContent = e2.message; return; }
    myFolderIds.push(data.id);
  }

  out.className = 'ok';
  const folderNote = addToFolder ? '' : ' (내 폴더에는 추가 안 함)';
  if (data.alreadyExisted) {
    out.textContent = `이미 등록된 브랜드였어요.${addToFolder ? ' 내 폴더에 바로 추가했어요.' : ''}`;
  } else if (data.status === 'ready' && data.dispatched) {
    out.textContent = `등록 완료! 지금 수집 중이에요, 1~2분 후 검색에 나와요.${folderNote}`;
  } else if (data.status === 'pending' && data.dispatched) {
    out.textContent = `등록 완료! 쇼핑몰 종류를 확인하면서 상품을 수집 중이에요, 2~3분 후 검색에 나와요.${folderNote}`;
  } else if (data.status === 'ready') {
    out.textContent = `등록 완료! 판별은 됐는데 자동 수집 트리거는 실패해서, 다음 정기 수집(매일 새벽) 때 반영돼요.${folderNote}`;
  } else {
    out.textContent = `등록은 됐지만 자동 판별이 안 돼서 사람이 확인해야 해요. 조금 걸릴 수 있어요.${folderNote}`;
  }
  await loadAllBrands();
}

// ---------------- 검색 ----------------
function qs() {
  const p = new URLSearchParams();
  const q = document.getElementById('q').value.trim();
  const color = document.getElementById('color').value;
  const size = document.getElementById('size').value;
  const brand = document.getElementById('brand').value;
  const sort = document.getElementById('sort').value;
  const priceMin = document.getElementById('priceMin').value;
  const priceMax = document.getElementById('priceMax').value;
  const inStock = document.getElementById('inStock').checked;
  if (q) p.set('q', q);
  if (color) p.set('color', color);
  if (size) p.set('size', size);
  if (brand) p.set('brand', brand);
  if (sort !== 'brand') p.set('sort', sort);
  if (priceMin) p.set('priceMin', priceMin);
  if (priceMax) p.set('priceMax', priceMax);
  if (inStock) p.set('inStock', '1');
  if (catSel) p.set('cat', catSel);
  if (sharedView) p.set('share', sharedView.share_id);
  if (currentPage > 1) p.set('p', currentPage);
  return p;
}

function buildQuery(offset, count = PAGE_SIZE) {
  const raw = document.getElementById('q').value;
  const { categories: queryCategories, colors: colorsFromQuery, keywords } = window.StyleFinderTaxonomy.parseQuery(raw);
  // 칩으로 고른 카테고리가 있으면 그걸 우선(검색창에 카테고리 단어를 직접 치면 go()에서 칩 선택이 풀림)
  const chipCategories = window.StyleFinderTaxonomy.expandSelection(catSel);
  const categories = chipCategories.length ? chipCategories : queryCategories;
  const color = document.getElementById('color').value;
  const colors = [...new Set([...(color ? [color] : []), ...colorsFromQuery])];
  const size = document.getElementById('size').value;
  const brand = document.getElementById('brand').value;
  const sort = document.getElementById('sort').value;
  const priceMin = document.getElementById('priceMin').value;
  const priceMax = document.getElementById('priceMax').value;
  const inStock = document.getElementById('inStock').checked;

  let query = sb
    .from('product_group')
    // offer!inner: 판매 링크(offer)가 하나도 없는 유령 상품은 아예 결과에서 제외 (클릭해도 갈 곳 없는 카드 방지)
    .select('id,brand,title,title_norm,categories,colors,sizes,min_price,max_price,image,in_stock,offer_count,offer!inner(source_id,url,price,in_stock)', { count: 'exact' })
    .in('brand_id', myFolderIds);

  // 가격 없는 상품이 낮은순/높은순에서 맨 위로 튀지 않게 null은 항상 뒤로.
  if (sort === 'recent') query = query.order('updated_at', { ascending: false });
  else if (sort === 'price_asc') query = query.order('min_price', { ascending: true, nullsFirst: false });
  else if (sort === 'price_desc') query = query.order('max_price', { ascending: false, nullsFirst: false });
  else query = query.order('brand').order('title');
  query = query.order('id').range(offset, offset + count - 1); // 페이지네이션 안정성용 동률 구분 키

  if (categories.length) query = query.overlaps('categories', categories);
  if (colors.length) query = query.overlaps('colors', colors);
  if (size) query = query.overlaps('sizes', sizeVariants(size));
  if (brand) query = query.eq('brand', brand);
  if (priceMin) query = query.gte('max_price', Number(priceMin));
  if (priceMax) query = query.lte('min_price', Number(priceMax));
  if (inStock) query = query.eq('in_stock', true);
  for (const kw of keywords) {
    // "mudule"로 쳐도 발음기호 붙은 "müdule"이 나오게 — DB의 ilike는 발음기호를 못 무시하므로
    // 내 폴더 브랜드 목록에서 발음기호 무시하고 먼저 매칭한 다음 정확한 이름으로 in 필터 추가.
    const foldedKw = foldAccents(kw);
    const accentMatches = allBrands.filter((b) => foldAccents(b.name).includes(foldedKw)).map((b) => b.name);
    const brandInClause = accentMatches.length
      ? `,brand.in.(${accentMatches.map((n) => `"${n.replace(/"/g, '\\"')}"`).join(',')})`
      : '';
    query = query.or(`brand.ilike.%${kw}%,title.ilike.%${kw}%,title_norm.ilike.%${kw}%${brandInClause}`);
  }
  return { query, categories, colors, keywords };
}

// 어떤 이미지는 로딩이 성공도 실패도 아닌 채로 계속 멈춰있는 경우가 있어서(브라우저/네트워크 이슈),
// 일정 시간 안에 안 끝나면 그냥 빈 박스로 넘어가게 강제 타임아웃을 건다. 모바일에서 느린
// 경우가 많아서(실측 제보) 8초는 너무 짧아 15초로 늘림.
const IMAGE_TIMEOUT_MS = 15000;
function armOneImage(img) {
  img.dataset.armed = '1'; // 실제로 카운트다운이 시작된 이미지만 표시 (rearmUnfinishedImages 판단용)
  const t = setTimeout(() => {
    if (img.complete) return;
    // 15초 안에 안 끝나면 바로 지우던 걸, 한 번은 재시도하도록 바꿈 — 뒤로가기를 반복할
    // 때마다 "그 순간 하필 느렸던" 이미지가 하나씩 영구히 사라져서, 계속 둘러볼수록
    // 흰 박스가 점점 늘어나는 문제였음(실측 제보). src는 그대로 두고 속성만 지웠다
    // 붙여서 재시도 — URL 자체를 바꾸면 외부 쇼핑몰 CDN이 쿼리스트링에 민감할 수 있어서 피함.
    if (!img.dataset.retried) {
      img.dataset.retried = '1';
      const src = img.src;
      img.removeAttribute('src');
      img.src = src;
      armOneImage(img);
      return;
    }
    img.remove();
  }, IMAGE_TIMEOUT_MS);
  img.__timeoutId = t;
  const clear = () => { clearTimeout(t); img.__timeoutId = null; };
  img.addEventListener('load', clear, { once: true });
  img.addEventListener('error', clear, { once: true });
}
// loading="lazy" 때문에 화면 밖 이미지는 실제로는 로딩을 시작도 안 했는데, 타이머를
// 렌더링 즉시 걸어버리면 스크롤해서 그 이미지에 도달하기 전에 "멈췄다"고 오판해서
// 지워버릴 수 있다. IntersectionObserver로 실제 뷰포트 근처에 들어온(=브라우저가 lazy
// 로딩을 시작할 즈음) 이미지만 그때부터 타이머를 걸도록 분리.
const imageViewportObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      imageViewportObserver.unobserve(entry.target);
      if (!entry.target.complete) armOneImage(entry.target);
    }
  },
  { rootMargin: '200px' },
);
function armImageTimeouts(container) {
  // 페이지를 넘기면 이전 그리드의 이미지들은 DOM에서 사라지는데, 아직 뷰포트에 도달 못 해서
  // observe 중이던 것들이 unobserve 없이 계속 쌓이면 페이지를 넘길수록 감시 대상이 늘어나며
  // 점점 느려질 수 있어서, 매번 그리드를 새로 채우기 전에 관찰을 전부 리셋한다.
  imageViewportObserver.disconnect();
  for (const img of container.querySelectorAll('img:not([data-watched])')) {
    img.dataset.watched = '1';
    if (img.complete) continue;
    imageViewportObserver.observe(img);
  }
}
// 뒤로가기(bfcache)로 나갔다 오면 걸어둔 타이머가 "실제 경과 시간" 기준으로 판정되는데,
// 얼려있는 동안 8초(지금은 15초)가 지나버리면 멀쩡히 로딩 중이던 이미지까지 지워졌음
// (실측: 뒤로가기 후 사진 빠짐/느림). 나가기 직전에 아직 안 끝난 타이머는 미리 꺼두고,
// 돌아왔을 때 그 이미지들만 새로 다시 타이머를 건다 — src는 안 건드려서 이미 진행 중이던
// 네트워크 요청을 안 끊는다(예전엔 src를 강제로 리셋해서 오히려 로딩을 처음부터 다시
// 시작시켜버렸는데, 그게 느려지거나 계속 안 끝나는 원인이었을 수 있음).
addEventListener('pagehide', () => {
  for (const img of document.querySelectorAll('#grid img')) {
    if (img.__timeoutId) { clearTimeout(img.__timeoutId); img.__timeoutId = null; }
  }
});
function rearmUnfinishedImages() {
  // dataset.armed가 없는 이미지는 아직 뷰포트에 도달 못 해서 observe만 되고 있는
  // 상태라 실제로 로딩을 시작도 안 했을 수 있다 — 그런 건 건드리지 않고 그대로
  // IntersectionObserver에 맡겨서, 스크롤해서 도달할 때 자연스럽게 타이머가 걸리게 둔다.
  for (const img of document.querySelectorAll('#grid img')) {
    if (!img.complete && img.dataset.armed && !img.__timeoutId) armOneImage(img);
  }
}

// 모바일/PWA에서는 target="_blank"가 새 탭이 아니라 새 웹뷰를 새로 띄우는 식으로 동작해서
// 열리는 데 오래 걸리고, 뒤로가기도 애매해짐(실측: 상품 클릭 후 뒤로가기하면 스크롤/더보기
// 상태가 날아감). 데스크톱은 새 탭이 편하니 그대로 두고, 모바일/설치된 PWA에서만 같은
// 화면에서 바로 이동하게 해서 빠르고 뒤로가기도 평범하게 동작하도록 함.
const OPEN_IN_PLACE = matchMedia('(display-mode: standalone)').matches || matchMedia('(max-width: 820px)').matches;

// 상품 사진 원본은 장당 500KB~2MB(한 페이지에 수십 MB)라 모바일에서 20초씩 걸렸음 → 이미지 CDN(Photon,
// WordPress.com)으로 폭 480 리사이즈본을 받는다(장당 평균 ~26KB). 같은 이미지는 항상 같은 호스트(i0~i2)로
// 가서 브라우저 캐시가 맞고, 호스트를 나눠 동시 다운로드도 늘림. CDN이 못 가져오는 이미지는 onerror에서 원본으로 폴백.
const THUMB_W = 480;
function thumbUrl(u) {
  try {
    const x = new URL(u);
    if (!/^https?:$/.test(x.protocol)) return u;
    let h = 0;
    for (let i = 0; i < u.length; i++) h = (h * 31 + u.charCodeAt(i)) >>> 0;
    return `https://i${h % 3}.wp.com/${x.host}${x.pathname}${x.search}${x.search ? '&' : '?'}w=${THUMB_W}&quality=75&strip=all`;
  } catch { return u; }
}
function imgFallback(img) {
  if (!img.dataset.fb && img.dataset.orig) { img.dataset.fb = '1'; img.src = img.dataset.orig; }
  else img.remove();
}

// 카드를 누르면 해당 쇼핑몰로 바로 이동하니, 렌더한 카드들의 쇼핑몰 주소는 DNS/TLS 연결을 미리 해둔다
// (처음 몇 장은 preconnect, 나머지는 dns-prefetch). 쇼핑몰 페이지 자체 속도는 우리가 못 바꾸지만 연결 지연은 줄일 수 있음.
function hintShopOrigins(data) {
  const seen = new Set();
  data.forEach((g, i) => {
    const u = g.offer && g.offer[0] && g.offer[0].url;
    if (!u) return;
    let origin;
    try { origin = new URL(u).origin; } catch { return; }
    if (origin === location.origin || seen.has(origin)) return;
    seen.add(origin);
    if (seen.size > 24) return;
    const id = 'hint-' + origin;
    if (document.getElementById(id)) return;
    const l = document.createElement('link');
    l.id = id;
    l.rel = i < 8 ? 'preconnect' : 'dns-prefetch';
    l.href = origin;
    document.head.appendChild(l);
  });
}

function cardsHtml(data) {
  return data
    .map((g, idx) => {
      const price = g.min_price === g.max_price ? won(g.min_price) : won(g.min_price) + ' ~ ' + won(g.max_price);
      const url = (g.offer && g.offer[0] && g.offer[0].url) || '#';
      const tags = (g.categories || [])
        .map((c) => {
          const { bg, fg } = tagColor(c);
          return `<span class="tag" style="background:${bg};color:${fg}">${window.StyleFinderTaxonomy.labelOf(c)}</span>`;
        })
        .join('');
      const linkAttrs = OPEN_IN_PLACE ? '' : 'target="_blank" rel="noopener"';
      return `<a class="card" href="${url}" ${linkAttrs}>
        <div class="imgwrap ${g.in_stock ? '' : 'sold'}">
          ${g.image ? `<img src="${thumbUrl(g.image)}" data-orig="${g.image}" alt="" loading="${idx < 6 ? 'eager' : 'lazy'}"${idx < 4 ? ' fetchpriority="high"' : ''} decoding="async" onerror="imgFallback(this)" onload="if(this.naturalWidth<200)this.remove()">` : ''}
          ${g.in_stock ? '' : '<span class="badge">품절</span>'}
        </div>
        <div class="body">
          <span class="brand">${g.brand}</span>
          <span class="title">${g.title}</span>
          <span class="price">${price}</span>
          ${tags ? `<div class="tags">${tags}</div>` : ''}
          ${g.offer_count > 1 ? `<span class="multi">${g.offer_count}개 색상/판매처</span>` : ''}
        </div></a>`;
    })
    .join('');
}

// 예전엔 "더보기"로 계속 쌓아서 보여줬는데, 모바일에서 상품 클릭 후 뒤로가기하면 스크롤이
// 맨 위로 리셋되는 iOS 버그(뒤에서 설명) 때문에 쌓아둔 게 많을수록 "맨 처음까지 되돌아간
// 것처럼" 크게 티가 났음. 페이지 단위로 나누면 리셋돼도 "그 페이지 맨 위"까지만 밀리니까
// 훨씬 덜 거슬리고, 몇 페이지째인지 URL에도 남아서(qs()의 p) 새로고침해도 그 페이지 그대로 뜬다.
function updatePager() {
  const wrap = document.getElementById('moreWrap');
  const totalPages = Math.max(1, Math.ceil(lastTotal / PAGE_SIZE));
  if (totalPages <= 1) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'flex';
  wrap.style.alignItems = 'center';
  wrap.style.justifyContent = 'center';
  document.getElementById('prevPageBtn').disabled = currentPage <= 1;
  document.getElementById('nextPageBtn').disabled = currentPage >= totalPages;
  // 페이지 수(1/6페이지)와 상품 범위(61-120/319개) 둘 다 단위를 붙여서 명확하게 표시.
  const start = (currentPage - 1) * PAGE_SIZE + 1;
  const end = Math.min(currentPage * PAGE_SIZE, lastTotal);
  document.getElementById('pageLabel').textContent = `${currentPage}/${totalPages}페이지 · ${start}-${end}/${lastTotal}개`;
}

async function renderCurrentPage() {
  const grid = document.getElementById('grid');
  const meta = document.getElementById('meta');
  const p = qs();
  history.replaceState(0, '', p.toString() ? '?' + p.toString() : location.pathname);

  if (!currentUser && !sharedView) {
    meta.textContent = '';
    grid.innerHTML = '<div class="empty"><span class="empty-icon">✨</span>로그인하면 내 폴더에 등록한 브랜드에서 검색할 수 있어요.<br>위에서 이메일로 로그인해보세요.</div>';
    document.getElementById('moreWrap').style.display = 'none';
    return;
  }
  if (myFolderIds.length === 0) {
    meta.textContent = '';
    grid.innerHTML = sharedView
      ? '<div class="empty"><span class="empty-icon">📭</span>이 폴더는 비어있어요.</div>'
      : '<div class="empty"><span class="empty-icon">📂</span>내 폴더가 비어있어요.<br>"내 폴더"에서 브랜드를 추가하거나 "+ 브랜드 등록"으로 새 브랜드를 등록해보세요.</div>';
    document.getElementById('moreWrap').style.display = 'none';
    return;
  }

  const offset = (currentPage - 1) * PAGE_SIZE;
  const { query, categories, colors, keywords } = buildQuery(offset, PAGE_SIZE);
  const { data, error, count } = await query;
  if (error) { meta.textContent = '오류: ' + error.message; grid.innerHTML = ''; return; }

  lastTotal = count || 0;
  const parts = [`${lastTotal}개`];
  if (categories.length) {
    const T = window.StyleFinderTaxonomy;
    const g = T.GROUPS.find((x) => x.id === catSel);
    parts.push('카테고리: ' + (g ? g.label : categories.map((c) => T.labelOf(c)).join(', ')));
  }
  if (colors.length) parts.push('색상: ' + colors.join(', '));
  if (keywords.length) parts.push('검색어: ' + keywords.join(' '));
  meta.textContent = parts.join('  ·  ');

  if (!data.length) { grid.innerHTML = '<div class="empty"><span class="empty-icon">🔎</span>결과 없음</div>'; document.getElementById('moreWrap').style.display = 'none'; return; }
  grid.innerHTML = cardsHtml(data);
  hintShopOrigins(data);
  armImageTimeouts(grid);
  updatePager();
  saveScrollState(); // 렌더 직후에도 저장 — 스크롤 이벤트가 한 번도 안 걸린 채로 바로 상품을 눌러도 최신 상태가 남게
}

// 검색창에 카테고리 단어(예: "후드티", "바지")를 직접 치면 칩 선택은 풀고 검색창 쪽을 따른다.
function syncCatWithQuery() {
  if (catSel && window.StyleFinderTaxonomy.parseQuery(document.getElementById('q').value).categories.length) catSel = '';
}

async function go() {
  syncCatWithQuery();
  renderChips();
  currentPage = 1;
  await renderCurrentPage();
}

async function goToPage(page) {
  const totalPages = Math.max(1, Math.ceil(lastTotal / PAGE_SIZE));
  if (page < 1 || page > totalPages || page === currentPage) return;
  currentPage = page;
  await renderCurrentPage();
  window.scrollTo(0, 0); // 새 페이지로 넘어간 거니 평범한 페이지네이션처럼 맨 위에서 시작
}

// ---------------- 스크롤/더보기 상태 복원 ----------------
// 모바일(특히 홈화면 추가한 PWA)에서는 상품 카드의 target="_blank"가 새 탭으로 안 열리고
// 같은 화면에서 이동해버리는 경우가 많아서, 뒤로가기하면 완전히 새로고침되며 스크롤 위치와
// "더보기"로 불러온 목록이 전부 날아가는 문제가 있었음. 떠나기 직전에 지금 상태(검색 조건,
// 로드된 개수, 스크롤 위치)를 남겨뒀다가, 돌아왔을 때 같은 검색이면 복원한다.
// sessionStorage 대신 localStorage를 쓰는 이유: iOS PWA(홈 화면에 추가)에서는 외부 사이트로
// 나갔다 돌아올 때 sessionStorage가 안 살아있는 경우가 있었음(실측: 로그인 유지는 localStorage라
// 항상 잘 되는데 sessionStorage 기반 스크롤 복원만 계속 실패). 너무 오래된 상태까지 복원되는 걸
// 막기 위해 타임스탬프를 같이 저장하고 30분 넘으면 무시한다.
const SCROLL_STATE_KEY = 'sf_scroll_state';
const SCROLL_STATE_MAX_AGE_MS = 30 * 60 * 1000;

// 페이지 단위로 바뀌면서 "몇 개를 불러왔었는지"는 이제 URL의 p로 충분히 복원되니, 여기선
// 그 페이지 안에서 스크롤로 어디까지 내려가 있었는지만 기억하면 된다(상품을 눌러서 나갔다가
// 뒤로가기했을 때 정확히 그 지점으로). 페이지를 실제로 넘기는 것(goToPage)과는 다른 얘기라
// 그때는 평범하게 맨 위에서 시작한다.
function saveScrollState() {
  if (!document.querySelector('#grid .card')) return;
  try {
    localStorage.setItem(SCROLL_STATE_KEY, JSON.stringify({
      params: qs().toString(),
      scrollY: window.scrollY,
      savedAt: Date.now(),
    }));
  } catch {}
}
addEventListener('pagehide', saveScrollState);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveScrollState(); });
// "떠나는 순간" 이벤트만 믿으면 모바일 브라우저마다 타이밍이 달라서 못 미더우므로,
// 스크롤하는 동안에도 계속 저장해서 언제 떠나든 최신 상태가 이미 저장돼 있게 한다.
let scrollSaveTimer = null;
addEventListener('scroll', () => {
  clearTimeout(scrollSaveTimer);
  scrollSaveTimer = setTimeout(saveScrollState, 200);
}, { passive: true });

// 지금 조건(qs())과 저장해둔 조건이 같을 때만, 저장해둔 스크롤 위치로 옮긴다.
function restoreScrollIfMatching() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(SCROLL_STATE_KEY) || 'null'); } catch { saved = null; }
  if (!saved || saved.params !== qs().toString()) return;
  if (Date.now() - (saved.savedAt || 0) > SCROLL_STATE_MAX_AGE_MS) return;
  const target = saved.scrollY;
  // pageshow 외에 visibilitychange/focus에도 걸어놨는데, 정상적으로 쓰다가 우연히 이 이벤트들이
  // 발생한 경우까지 건드리면 안 되니 "지금 이미 맨 위 근처인데 원래는 내려가 있었어야 하는"
  // 경우(=리셋된 상황)에만 작동한다.
  if (!target || target < 30 || window.scrollY > 30) return;
  // 실측 확인됨: 상품 클릭 후 뒤로가기하면 iOS가 페이지를 다시 실행하지 않고 그대로
  // 얼렸다가 복원하는데(bfcache), 이때 스크롤 위치를 0으로 리셋해버리는 iOS/WebKit
  // 버그가 있음. 정해진 시점에만 되돌리는 걸로는 iOS가 그보다 늦게 다시 0으로 되돌리는
  // 경우를 못 이겨서 몇 초 동안 "0으로 튀면 즉시 다시 원위치"하는 감시를 걸어두는데,
  // 그 몇 초 사이에 사용자가 직접 스크롤하려고 하면(=화면을 터치) 그것까지 도로
  // 끌어올려버렸었음(실측). 사용자가 터치하는 순간 감시를 바로 멈춘다.
  let stop = false;
  const onTouch = () => { stop = true; };
  addEventListener('touchstart', onTouch, { passive: true, once: true });
  let attempts = 0;
  const maxAttempts = 40; // 최대 4초(100ms 간격)
  const enforce = () => {
    attempts++;
    if (!stop && Math.round(window.scrollY) < 30) window.scrollTo(0, target);
    if (attempts < maxAttempts && !stop) setTimeout(enforce, 100);
    else removeEventListener('touchstart', onTouch);
  };
  enforce();
}
// persisted pageshow만 믿으면 이 기기에서 실제로 그 값이 기대와 다르게 나올 수도 있어서,
// 화면이 다시 보이거나 포커스를 받는 다른 계기에도 같은 감시를 걸어 놓친 경우를 커버한다.
addEventListener('pageshow', (e) => { if (e.persisted) rearmUnfinishedImages(); restoreScrollIfMatching(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') restoreScrollIfMatching(); });
addEventListener('focus', () => restoreScrollIfMatching());

function activeGroup() {
  const T = window.StyleFinderTaxonomy;
  return T.GROUPS.find((g) => g.id === catSel || g.children.includes(catSel)) || null;
}

// 상위 카테고리(TOP/OUTER/BOTTOM...) 칩 + 하나를 누르면 그 아래 하위 카테고리 칩이 쭉 펼쳐짐
function renderChips() {
  const T = window.StyleFinderTaxonomy;
  const ag = activeGroup();
  document.getElementById('chips').innerHTML = T.GROUPS
    .map((g) => `<span class="chip ${ag && ag.id === g.id ? 'on' : ''}" onclick="pickCategory('${g.id}')">${g.label}</span>`)
    .join('');
  const sub = document.getElementById('subChips');
  if (!ag || ag.children.length <= 1) { sub.innerHTML = ''; sub.style.display = 'none'; return; }
  sub.style.display = 'flex';
  sub.innerHTML =
    `<span class="chip sub ${catSel === ag.id ? 'on' : ''}" onclick="pickCategory('${ag.id}', true)">전체</span>` +
    ag.children.map((id) => `<span class="chip sub ${catSel === id ? 'on' : ''}" onclick="pickCategory('${id}', true)">${T.labelOf(id)}</span>`).join('');
}

function pickCategory(sel, fromSub) {
  // 이미 선택된 상위 칩을 다시 누르면 해제
  catSel = !fromSub && catSel === sel ? '' : sel;
  const q = document.getElementById('q');
  q.value = window.StyleFinderTaxonomy.stripCategoryTokens(q.value);
  renderChips();
  go();
}

async function loadFacetSelectors() {
  const colorSel = document.getElementById('color');
  for (const [id, label] of Object.entries(window.StyleFinderTaxonomy.COLOR_LABELS)) {
    colorSel.insertAdjacentHTML('beforeend', `<option value="${id}">${label}</option>`);
  }
  // 사이즈 옵션은 고정 목록이 아니라 로그인/폴더 전환 시 loadSizeOptions()가 실제 데이터로 채움
  // (브랜드마다 S/M/L, 1/2/3, 신발 사이즈 등 표기가 달라서 고정 목록으론 다 못 잡음).
}

// ---------------- 초기화 ----------------
document.getElementById('q').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
document.getElementById('authPassword').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitAuth(); });
for (const id of ['color', 'size', 'brand', 'sort', 'inStock']) document.getElementById(id).addEventListener('change', go);
for (const id of ['priceMin', 'priceMax']) document.getElementById(id).addEventListener('change', go);

(async () => {
  const initial = new URLSearchParams(location.search);
  if (initial.get('q')) document.getElementById('q').value = initial.get('q');
  if (initial.get('color')) document.getElementById('color').value = initial.get('color');
  if (initial.get('size')) document.getElementById('size').value = initial.get('size');
  // 이 시점엔 #brand select에 아직 <option>이 하나도 없어서(브랜드 목록은 뒤에서
  // loadAllBrands()/renderBrandFilter()가 채움) sel.value 대입이 조용히 무시된다.
  // renderBrandFilter()는 그 비어버린 값을 "현재 선택값"으로 보고 그대로 유지해버리므로,
  // URL의 brand가 옵션이 채워진 뒤에 다시 한번 적용돼야 한다 (아래 initialBrand 참고).
  const initialBrand = initial.get('brand');
  if (initialBrand) {
    document.getElementById('brand').value = initialBrand;
    document.getElementById('brandInput').value = initialBrand;
  }
  if (initial.get('sort')) document.getElementById('sort').value = initial.get('sort');
  if (initial.get('priceMin')) document.getElementById('priceMin').value = initial.get('priceMin');
  if (initial.get('priceMax')) document.getElementById('priceMax').value = initial.get('priceMax');
  if (initial.get('inStock')) document.getElementById('inStock').checked = true;
  catSel = initial.get('cat') || '';
  if (initial.get('p')) currentPage = Math.max(1, parseInt(initial.get('p'), 10) || 1);

  // 서로 독립적인 초기 요청들(사전 로드, 브랜드 목록, 로그인 세션)을 동시에 보내서
  // 줄줄이 기다리며 부팅마다 1~2초씩 걸리던 걸 줄임.
  const [, , sessionResult] = await Promise.all([
    window.StyleFinderTaxonomy.loadTaxonomy().then(() => { renderChips(); return loadFacetSelectors(); }),
    loadAllBrands(), // brands는 누구나 읽기 가능 — 로그인 전에도 공유 폴더 열람/검색 매칭에 필요
    sb.auth.getSession(),
  ]);
  currentUser = sessionResult.data.session?.user || null;
  renderAuthArea();

  const shareParam = initial.get('share');
  if (shareParam) {
    await loadSharedFolder(shareParam);
  } else if (currentUser) {
    await loadMyFolders();
    renderBrandFilter(); // loadAllBrands() 시점엔 아직 myFolderIds가 비어있어서 옵션이 없었으므로 다시 채움
  }
  // 위 두 분기 모두 renderBrandFilter()를 거친 뒤라 이제 #brand에 실제 <option>들이 채워져
  // 있으므로, 맨 위에서 실패했던 URL의 brand 값을 여기서 다시 적용해야 제대로 선택된다.
  if (initialBrand) {
    document.getElementById('brand').value = initialBrand;
    document.getElementById('brandInput').value = initialBrand;
  }
  renderFolderTabs();
  updateFolderNavLabel();
  renderSharedBanner();
  // currentPage는 위에서 URL의 p로 이미 정해놨으니 go()(항상 1페이지로 리셋)가 아니라
  // renderCurrentPage()로 바로 그 페이지를 그린다. 스크롤 위치는 pageshow(bfcache 복원)에서
  // 따로 처리하지만, 이건 일반 로드(새로고침 등)에도 적용되게 여기서도 한 번 시도한다.
  await renderCurrentPage();
  restoreScrollIfMatching();
  bootComplete = true;
})();
