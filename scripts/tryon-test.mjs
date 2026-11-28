// 가상 피팅 품질 시험(Gemini 이미지 모델): 전신사진 1장 + 모자·상의·하의·신발 상품 사진을 한 번에 입혀 본다.
// 키: .env 의 GEMINI_API_KEY (화면에 출력하지 않음). 모델: GEMINI_IMAGE_MODEL(없으면 gemini-3.1-flash-image).
// 실행 예:
//   node scripts/tryon-test.mjs --person=사람.jpg(또는 URL) --hat=URL --top=URL --bottom=URL --shoes=URL --out=결과.png
// 모델 이름이 틀리면 쓸 수 있는 이미지 모델 목록을 보여 준다. 유료 API — 한 번 실행에 결과 1장(약 0.04달러).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';

if (existsSync('.env')) process.loadEnvFile('.env');
const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error('.env 에 GEMINI_API_KEY 가 없습니다.'); process.exit(1); }
const MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image';
// 돈 새는 것 막기(사용자 요청 2026-11-27: 예산 500원): 이 시험 프로그램은 성공한 생성 기준 최대 8장(약 0.32달러 ≈ 450원)까지만.
// 횟수는 data/tryon-count.json 에 남는다(커밋 안 됨). 더 쓰려면 사용자 승인 후 파일을 지우거나 숫자를 바꾼다.
const COUNT_FILE = 'data/tryon-count.json';
const MAX_CALLS = 8;
const used = existsSync(COUNT_FILE) ? JSON.parse(readFileSync(COUNT_FILE, 'utf8')).used || 0 : 0;
if (used >= MAX_CALLS) { console.error(`시험 한도(${MAX_CALLS}장)를 다 썼습니다. 더 쓰려면 사용자 승인이 필요합니다.`); process.exit(1); }
console.log(`시험 ${used + 1}/${MAX_CALLS}번째`);
const API = 'https://generativelanguage.googleapis.com/v1beta';
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || null;

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
async function load(src) {
  if (/^https?:/i.test(src)) {
    const r = await fetch(src, { headers: { 'User-Agent': 'Mozilla/5.0 style-finder-tryon-test' } });
    if (!r.ok) throw new Error(`사진을 못 받음(${r.status}): ${src}`);
    const type = (r.headers.get('content-type') || 'image/jpeg').split(';')[0];
    return { mime: type, data: Buffer.from(await r.arrayBuffer()).toString('base64') };
  }
  return { mime: MIME[extname(src).toLowerCase()] || 'image/jpeg', data: readFileSync(src).toString('base64') };
}

const person = arg('person');
const slots = [['hat', '모자'], ['top', '상의'], ['bottom', '하의'], ['shoes', '신발']].filter(([k]) => arg(k));
if (!person || !slots.length) { console.error('--person 과 --hat/--top/--bottom/--shoes 중 하나 이상이 필요합니다.'); process.exit(1); }

const parts = [];
const lines = [];
parts.push({ text: 'Image 1 is a full-body photo of a person.' });
const p = await load(person);
parts.push({ inline_data: { mime_type: p.mime, data: p.data } });
let n = 2;
for (const [k, ko] of slots) {
  const img = await load(arg(k));
  parts.push({ text: `Image ${n} is a product photo of a ${k === 'shoes' ? 'pair of shoes' : k}.` });
  parts.push({ inline_data: { mime_type: img.mime, data: img.data } });
  lines.push(`- the ${k} from image ${n}`);
  console.log(`${ko}: 사진 ${n}`);
  n++;
}
parts.push({ text: `Virtual try-on. Edit image 1 so the same person is wearing ALL of these items at once:\n${lines.join('\n')}\n` +
  'Replace only the corresponding clothing/accessories. Keep the person\'s face, hair, skin tone, body shape, pose, and the background exactly the same. ' +
  'Reproduce each item faithfully (color, pattern, fabric texture, logos, length and fit). Natural folds, shadows and lighting. Photorealistic, full body, same framing as image 1.' });

const t0 = Date.now();
const res = await fetch(`${API}/models/${MODEL}:generateContent`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
  body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'] } }),
});
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`요청 실패(${res.status}): ${body.error?.message || ''}`.slice(0, 400));
  if (res.status === 404) {
    const list = await (await fetch(`${API}/models?pageSize=200`, { headers: { 'x-goog-api-key': KEY } })).json();
    console.error('쓸 수 있는 이미지 모델:', (list.models || []).map((m) => m.name.replace('models/', '')).filter((x) => /image/.test(x)).join(', '));
  }
  process.exit(1);
}
const out = arg('out') || 'tryon-result.png';
const imgPart = (body.candidates?.[0]?.content?.parts || []).find((x) => x.inline_data || x.inlineData);
if (!imgPart) { console.error('결과 사진이 없습니다:', JSON.stringify(body).slice(0, 400)); process.exit(1); }
const d = imgPart.inline_data || imgPart.inlineData;
writeFileSync(out, Buffer.from(d.data, 'base64'));
writeFileSync(COUNT_FILE, JSON.stringify({ used: used + 1, last: new Date().toISOString() }));
console.log(`완료: ${out} (${((Date.now() - t0) / 1000).toFixed(1)}초, 모델 ${MODEL})`);
