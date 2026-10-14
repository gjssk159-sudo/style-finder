// 새 문의 알림을 텔레그램으로 받도록 한 번에 설정한다.
//
// 준비(한 번만):
//   1) 텔레그램에서 @BotFather 에게 /newbot 으로 봇을 만들고 토큰을 받는다.
//   2) 이 프로젝트의 .env 파일에 한 줄 추가:   TELEGRAM_BOT_TOKEN=받은토큰
//   3) 텔레그램에서 방금 만든 봇을 열어 아무 메시지나 한 번 보낸다(예: 안녕).
//   4) 아래 명령 실행:   node src/telegram-setup.js
//
// 하는 일: 봇이 받은 메시지에서 내 chat id를 찾고 → 연결 확인 메시지를 보내고 →
// Supabase 함수 시크릿(TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)을 등록한다.
// 토큰은 화면에 출력하지 않는다.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

const token = process.env.TELEGRAM_BOT_TOKEN;
const PROJECT_REF = 'fipjvgglzlvksepdjxjv';
if (!token) {
  console.error('.env에 TELEGRAM_BOT_TOKEN=... 한 줄이 없어요. 위 안내의 2번을 먼저 해주세요.');
  process.exit(1);
}

const api = async (method, body) => {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
};

const me = await api('getMe');
if (!me.ok) {
  console.error('토큰이 올바르지 않아요. BotFather에서 받은 토큰을 다시 확인해주세요.');
  process.exit(1);
}
console.log(`봇 확인: @${me.result.username}`);

const updates = await api('getUpdates');
const msgs = (updates.result || []).map((u) => u.message || u.channel_post || u.my_chat_member?.chat && { chat: u.my_chat_member.chat }).filter(Boolean);
const chat = msgs.length ? msgs[msgs.length - 1].chat : null;
if (!chat) {
  console.error(`봇이 받은 메시지가 없어요. 텔레그램에서 @${me.result.username} 를 열어 아무 메시지나 보낸 뒤 다시 실행해주세요.`);
  process.exit(1);
}
const chatId = String(chat.id);
console.log(`대화 상대 확인: ${chat.first_name || chat.title || chat.username || chatId}`);

const sent = await api('sendMessage', { chat_id: chatId, text: '[MY SELECT SHOP] 문의 알림이 연결됐어요. 새 문의가 등록되면 이 대화로 알려드릴게요.' });
if (!sent.ok) {
  console.error('테스트 메시지를 보내지 못했어요:', sent.description);
  process.exit(1);
}

const r = spawnSync('npx', ['--yes', 'supabase@2.118.0', 'secrets', 'set', `TELEGRAM_BOT_TOKEN=${token}`, `TELEGRAM_CHAT_ID=${chatId}`, '--project-ref', PROJECT_REF], { cwd: root, encoding: 'utf8', shell: true });
if (r.status !== 0) {
  console.error('Supabase 시크릿 등록에 실패했어요:', (r.stderr || r.stdout || '').slice(0, 300));
  process.exit(1);
}
console.log('설정 완료! 이제 새 문의가 등록되면 텔레그램으로 알림이 와요.');
