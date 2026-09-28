// style-finder 프론트엔드. 백엔드 서버 없음 — 브라우저에서 Supabase에 직접 쿼리.
// 보안은 RLS(supabase/schema.sql)가 담당: 내 폴더(user_brands)는 로그인한 나만 보고 고치고,
// brands/product_group/offer는 다 같이 읽지만 쓰기는 서비스 롤(수집 파이프라인)만 가능.

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
let currentGender = ''; // '' | 'women' | 'men' | 'unisex' — 원본에 성별 표기가 있는 상품만 걸러짐(대부분은 미상)
let myFolders = [];        // 로그인한 사람의 폴더 목록 [{id,name,share_id}] (최대 3개)
let currentFolderId = null; // 지금 검색에 쓰이는 폴더 id
let sharedView = null;      // 공유 링크로 남의 폴더를 보는 중이면 {id,name,share_id,user_id}
let bootComplete = false;   // 부팅 흐름이 스크롤 복원 여부를 판단하기 전까지, 초기 세션 감지 이벤트가 go()로 화면을 덮어쓰지 않게 막는 플래그
const PAGE_SIZE = 60;
let pageOffset = 0;
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

function setGender(g) {
  currentGender = g;
  for (const btn of document.querySelectorAll('#genderTabs .gtab')) {
    btn.classList.toggle('active', btn.dataset.gender === g);
  }
  go();
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

async function loadSizeOptions() {
  if ((!currentUser && !sharedView) || !myFolderIds.length) {
    sizeOptions = [];
    renderSizeFilter();
    return;
  }
  // select는 기본 1000행 제한이 있어서, 폴더 상품이 그보다 많으면 뒤쪽 사이즈를 놓치므로 끝까지 페이지네이션.
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('product_group').select('sizes').in('brand_id', myFolderIds).range(from, from + 999);
    if (error) { console.error(error); return; }
    rows.push(...data);
    if (data.length < 1000) break;
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

// ---------------- 브랜드 등록 (실시간 판별 없이 "등록 요청"만 접수 — 처리는 백엔드에서) ----------------
function slugify(hostname) {
  return hostname.replace(/^www\./, '').replace(/\.(com|co\.kr|kr|link|net|store|shop)$/i, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}

async function submitAdd() {
  const out = document.getElementById('addResult');
  if (!currentUser) { out.className = 'warn'; out.textContent = '로그인 먼저 해주세요.'; out.style.display = 'block'; return; }
  if (sharedView) { out.className = 'warn'; out.textContent = '공유된 폴더에는 추가할 수 없어요. 내 폴더로 돌아가서 추가해주세요.'; out.style.display = 'block'; return; }
  const urlInput = document.getElementById('addUrl').value.trim();
  const name = document.getElementById('addName').value.trim();
  const instagram = document.getElementById('addInstagram').value.trim();
  if (!urlInput) return;

  let shopUrl;
  try { shopUrl = new URL(/^https?:\/\//i.test(urlInput) ? urlInput : `https://${urlInput}`).origin; }
  catch { out.className = 'warn'; out.textContent = 'URL 형식이 이상해요.'; out.style.display = 'block'; return; }

  const id = slugify(new URL(shopUrl).hostname);
  out.style.display = 'block';
  out.className = '';
  out.textContent = '등록 중…';

  const { error: e1 } = await sb.from('brands').upsert(
    { id, name: name || id, name_en: name || id, type: 'brand', instagram: instagram || null, shop_url: shopUrl, platform: 'unknown', status: 'pending', added_by: currentUser.id },
    { onConflict: 'id', ignoreDuplicates: true }
  );
  if (e1) { out.className = 'warn'; out.textContent = e1.message; return; }
  // ignoreDuplicates라서 이미 있던 브랜드면 위 upsert가 added_by를 못 채움 —
  // 아직 등록자가 없는 브랜드면 이번 등록으로 내가 등록자로 기록되게 별도로 시도.
  await sb.rpc('claim_brand', { target_id: id });

  const { error: e2 } = await sb.from('user_brands').insert({ user_id: currentUser.id, folder_id: currentFolderId, brand_id: id });
  if (e2 && !String(e2.message).includes('duplicate')) { out.className = 'warn'; out.textContent = e2.message; return; }

  myFolderIds.push(id);
  out.className = 'ok';
  out.textContent = '등록 요청 접수! 자동 판별 후 곧 검색에 반영돼요. (이미 있던 브랜드면 내 폴더에 바로 추가됨)';
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
  if (currentGender) p.set('gender', currentGender);
  if (sharedView) p.set('share', sharedView.share_id);
  return p;
}

function buildQuery(offset, count = PAGE_SIZE) {
  const raw = document.getElementById('q').value;
  const { categories, colors: colorsFromQuery, keywords } = window.StyleFinderTaxonomy.parseQuery(raw);
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
  if (currentGender) query = query.eq('gender', currentGender);
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
// 일정 시간 안에 안 끝나면 그냥 빈 박스로 넘어가게 강제 타임아웃을 건다.
function armImageTimeouts(container) {
  for (const img of container.querySelectorAll('img:not([data-armed])')) {
    img.dataset.armed = '1';
    const t = setTimeout(() => { if (!img.complete) img.remove(); }, 8000);
    img.addEventListener('load', () => clearTimeout(t), { once: true });
    img.addEventListener('error', () => clearTimeout(t), { once: true });
  }
}

// 모바일/PWA에서는 target="_blank"가 새 탭이 아니라 새 웹뷰를 새로 띄우는 식으로 동작해서
// 열리는 데 오래 걸리고, 뒤로가기도 애매해짐(실측: 상품 클릭 후 뒤로가기하면 스크롤/더보기
// 상태가 날아감). 데스크톱은 새 탭이 편하니 그대로 두고, 모바일/설치된 PWA에서만 같은
// 화면에서 바로 이동하게 해서 빠르고 뒤로가기도 평범하게 동작하도록 함.
const OPEN_IN_PLACE = matchMedia('(display-mode: standalone)').matches || matchMedia('(max-width: 820px)').matches;

function cardsHtml(data) {
  return data
    .map((g) => {
      const price = g.min_price === g.max_price ? won(g.min_price) : won(g.min_price) + ' ~ ' + won(g.max_price);
      const url = (g.offer && g.offer[0] && g.offer[0].url) || '#';
      const tags = (g.categories || [])
        .map((c) => {
          const { bg, fg } = tagColor(c);
          return `<span class="tag" style="background:${bg};color:${fg}">${c}</span>`;
        })
        .join('');
      const linkAttrs = OPEN_IN_PLACE ? '' : 'target="_blank" rel="noopener"';
      return `<a class="card" href="${url}" ${linkAttrs}>
        <div class="imgwrap ${g.in_stock ? '' : 'sold'}">
          ${g.image ? `<img src="${g.image}" alt="" onerror="this.remove()" onload="if(this.naturalWidth<200)this.remove()">` : ''}
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

function updateMoreButton(shownCount) {
  const wrap = document.getElementById('moreWrap');
  const btn = document.getElementById('moreBtn');
  if (lastTotal > shownCount) {
    wrap.style.display = 'block';
    btn.textContent = `더 보기 (${shownCount}/${lastTotal})`;
  } else {
    wrap.style.display = 'none';
  }
}

async function go() {
  const grid = document.getElementById('grid');
  const meta = document.getElementById('meta');
  const p = qs();
  history.replaceState(0, '', p.toString() ? '?' + p.toString() : location.pathname);
  pageOffset = 0;

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

  const { query, categories, colors, keywords } = buildQuery(pageOffset);
  const { data, error, count } = await query;
  if (error) { meta.textContent = '오류: ' + error.message; grid.innerHTML = ''; return; }

  lastTotal = count || 0;
  const parts = [`${lastTotal}개`];
  if (categories.length) parts.push('카테고리: ' + categories.join(', '));
  if (colors.length) parts.push('색상: ' + colors.join(', '));
  if (keywords.length) parts.push('검색어: ' + keywords.join(' '));
  meta.textContent = parts.join('  ·  ');

  if (!data.length) { grid.innerHTML = '<div class="empty"><span class="empty-icon">🔎</span>결과 없음</div>'; document.getElementById('moreWrap').style.display = 'none'; return; }
  grid.innerHTML = cardsHtml(data);
  armImageTimeouts(grid);
  updateMoreButton(data.length);
  saveScrollState(); // 렌더 직후에도 저장 — 스크롤 이벤트가 한 번도 안 걸린 채로 바로 상품을 눌러도 최신 상태가 남게
}

async function loadMore() {
  pageOffset += PAGE_SIZE;
  const { query } = buildQuery(pageOffset);
  const { data, error } = await query;
  if (error) return;
  const grid = document.getElementById('grid');
  grid.insertAdjacentHTML('beforeend', cardsHtml(data));
  armImageTimeouts(grid);
  updateMoreButton(pageOffset + data.length);
  saveScrollState();
}

// ---------------- 스크롤/더보기 상태 복원 ----------------
// 모바일(특히 홈화면 추가한 PWA)에서는 상품 카드의 target="_blank"가 새 탭으로 안 열리고
// 같은 화면에서 이동해버리는 경우가 많아서, 뒤로가기하면 완전히 새로고침되며 스크롤 위치와
// "더보기"로 불러온 목록이 전부 날아가는 문제가 있었음. 떠나기 직전에 지금 상태(검색 조건,
// 로드된 개수, 스크롤 위치)를 sessionStorage에 남겨뒀다가, 돌아왔을 때 같은 검색이면 복원한다.
const SCROLL_STATE_KEY = 'sf_scroll_state';

function saveScrollState() {
  const shown = document.querySelectorAll('#grid .card').length;
  if (!shown) return;
  try {
    sessionStorage.setItem(SCROLL_STATE_KEY, JSON.stringify({
      params: qs().toString(),
      shown,
      scrollY: window.scrollY,
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

// go()와 같은 조건(현재 검색어/필터)으로 돌아온 경우에만 복원. 맞으면 true를 돌려주고,
// 아니면(다른 검색, 저장된 게 없음, 로그인 전이라 아직 폴더가 안 잡힘 등) false를 돌려줘서
// 호출한 쪽이 평범하게 go()를 부르게 한다.
async function restoreIfReturning() {
  let saved;
  try { saved = JSON.parse(sessionStorage.getItem(SCROLL_STATE_KEY) || 'null'); } catch { saved = null; }
  if (!saved || !saved.shown || saved.params !== qs().toString()) return false;
  if ((!currentUser && !sharedView) || myFolderIds.length === 0) return false;
  sessionStorage.removeItem(SCROLL_STATE_KEY);

  const grid = document.getElementById('grid');
  const meta = document.getElementById('meta');
  history.replaceState(0, '', saved.params ? '?' + saved.params : location.pathname);

  const { query, categories, colors, keywords } = buildQuery(0, saved.shown);
  const { data, error, count } = await query;
  if (error || !data.length) return false;

  lastTotal = count || 0;
  pageOffset = Math.max(0, Math.ceil(data.length / PAGE_SIZE) - 1) * PAGE_SIZE;
  const parts = [`${lastTotal}개`];
  if (categories.length) parts.push('카테고리: ' + categories.join(', '));
  if (colors.length) parts.push('색상: ' + colors.join(', '));
  if (keywords.length) parts.push('검색어: ' + keywords.join(' '));
  meta.textContent = parts.join('  ·  ');
  grid.innerHTML = cardsHtml(data);
  armImageTimeouts(grid);
  updateMoreButton(data.length);
  setTimeout(() => window.scrollTo(0, saved.scrollY), 50);
  return true;
}

function renderChips() {
  document.getElementById('chips').innerHTML = window.StyleFinderTaxonomy.CATEGORIES
    .map((c) => `<span class="chip" onclick="document.getElementById('q').value='${c.label}';go()">${c.label}</span>`)
    .join('');
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
  if (initial.get('sort')) document.getElementById('sort').value = initial.get('sort');
  if (initial.get('priceMin')) document.getElementById('priceMin').value = initial.get('priceMin');
  if (initial.get('priceMax')) document.getElementById('priceMax').value = initial.get('priceMax');
  if (initial.get('inStock')) document.getElementById('inStock').checked = true;
  if (initial.get('gender')) {
    currentGender = initial.get('gender');
    for (const btn of document.querySelectorAll('#genderTabs .gtab')) {
      btn.classList.toggle('active', btn.dataset.gender === currentGender);
    }
  }

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
    if (initial.get('brand')) pickBrand(initial.get('brand'));
  }
  renderFolderTabs();
  updateFolderNavLabel();
  renderSharedBanner();
  if (!(await restoreIfReturning())) go();
  bootComplete = true;
})();
