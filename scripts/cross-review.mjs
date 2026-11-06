// Codex 교차 리뷰: Claude가 만든 문서·코드를 다른 회사 AI(Codex)가 읽기 전용으로 검토한다.
// 사용:
//   node scripts/cross-review.mjs prd docs/PRD.md          문서 검토 (prd·screens·architecture·adr)
//   node scripts/cross-review.mjs code                     아직 저장(커밋) 안 한 변경 검토
//   node scripts/cross-review.mjs code HEAD~1              마지막 커밋 이후 변경 검토
// 결과: reviews/<종류>-<날짜시각>.md  (Codex는 파일을 고치지 않는다)
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const focusMap = JSON.parse(readFileSync(join(root, 'scripts', 'review-focus.json'), 'utf8'));
const [type, target] = process.argv.slice(2);

if (!type || !focusMap[type]) {
  console.error(`종류를 골라 주세요: ${Object.keys(focusMap).join(', ')}`);
  console.error('예) node scripts/cross-review.mjs prd docs/PRD.md   /   node scripts/cross-review.mjs code');
  process.exit(1);
}

// Windows 에서는 Codex 읽기 전용 모드가 파일 열기도 막으므로, 규칙과 검토 대상을 프롬프트에 직접 넣는다.
const numbered = (text) => text.split(/\r?\n/).map((l, i) => `${String(i + 1).padStart(4)}| ${l}`).join('\n');
const rules = existsSync(join(root, 'AGENTS.md')) ? readFileSync(join(root, 'AGENTS.md'), 'utf8') : '(AGENTS.md 없음)';

let subject;
if (type === 'code') {
  const base = target || 'HEAD';
  const diff = execFileSync('git', ['diff', base], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (!diff.trim()) {
    console.error(`검토할 변경이 없습니다 (git diff ${base} 가 비어 있음).`);
    process.exit(1);
  }
  subject = `아래 변경(git diff ${base})을 검토하라.\n\n<diff>\n${diff}\n</diff>`;
} else {
  if (!target || !existsSync(join(root, target))) {
    console.error(`검토할 파일이 없습니다: ${target || '(파일 경로를 적어 주세요)'}`);
    process.exit(1);
  }
  subject = `아래 ${target} 을 검토하라(앞의 숫자는 줄 번호).\n\n<file path="${target}">\n${numbered(readFileSync(join(root, target), 'utf8'))}\n</file>`;
}

const prompt = [
  '너는 이 프로젝트의 외부 검토자다. 아래 프로젝트 규칙(AGENTS.md)을 기준으로 삼아라.',
  `<AGENTS.md>\n${rules}\n</AGENTS.md>`,
  subject,
  `검토 관점: ${focusMap[type]}`,
  '규칙: 명령을 실행하거나 파일을 열지 말고, 위에 주어진 내용만으로 판단하라. 근거가 있는 지적만, 파일:줄 과 함께. 주어진 내용만으로 확인할 수 없는 것은 "확인 불가"로 따로 적어라.',
  '형식: 한국어로, 심각도 순(높음/중간/낮음) 목록. 지적이 없으면 "지적 없음". 마지막 줄은 정확히 approve 또는 needs_changes 중 하나.',
].join('\n\n');

const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
const outRel = `reviews/${type}-${stamp}.md`;
mkdirSync(join(root, 'reviews'), { recursive: true });

// npm 으로 깐 codex 는 Windows 에서 .cmd 라서, 가능하면 node 로 codex.js 를 직접 부른다(셸 없이).
const codexJs = join(process.env.APPDATA || '', 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
const [cmd, pre, shell] = existsSync(codexJs)
  ? [process.execPath, [codexJs], false]
  : ['codex', [], process.platform === 'win32'];

console.log(`Codex 검토 중... (종류: ${type}, 결과: ${outRel}) — 몇 분 걸릴 수 있어요`);
const r = spawnSync(cmd, [...pre, 'exec', '-s', 'read-only', '--color', 'never', '-o', outRel, '-'], {
  cwd: root,
  input: prompt,
  stdio: ['pipe', 'ignore', 'pipe'],
  shell,
  encoding: 'utf8',
  timeout: 15 * 60 * 1000,
  maxBuffer: 64 * 1024 * 1024,
});
if (r.status !== 0 || !existsSync(join(root, outRel))) {
  console.error((r.stderr || '').split(/\r?\n/).slice(-15).join('\n'));
  console.error(`Codex 검토 실패 (종료 코드 ${r.status}). codex login status 로 로그인을 확인하세요.`);
  process.exit(1);
}
const last = readFileSync(join(root, outRel), 'utf8').trim().split(/\r?\n/).pop().trim();
console.log(`완료: ${outRel}  →  판정: ${last}`);
console.log('다음: Claude에게 "이 리뷰 지적을 반영 / 보류 / 무시로 나누고 이유를 한 줄씩 써줘"라고 하세요.');
