// 새 문의 알림용 Edge Function.
// 사용자가 마이페이지 > 문의에 질문을 등록하면 DB 트리거(notify_qna)가 이 함수를 호출하고,
// 이 함수는 운영진이 미리 설정해 둔 채널로 알림을 보낸다. 설정된 채널만 사용한다:
//   - QNA_WEBHOOK_URL            Discord 또는 Slack의 Incoming Webhook 주소
//   - TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID   텔레그램 봇
// 아무것도 설정돼 있지 않으면 조용히 건너뛴다(문의 등록 자체에는 영향 없음).
//
// 호출자는 DB 트리거뿐이라 JWT 검증은 끄고(--no-verify-jwt), 대신 공유 비밀(NOTIFY_SECRET)을
// x-notify-secret 헤더로 확인한다.

Deno.serve(async (req) => {
  const secret = Deno.env.get('NOTIFY_SECRET');
  if (!secret || req.headers.get('x-notify-secret') !== secret) {
    return new Response('forbidden', { status: 403 });
  }

  let q: { id?: number; title?: string; body?: string };
  try {
    q = await req.json();
  } catch {
    return new Response('bad request', { status: 400 });
  }

  const preview = String(q.body ?? '').slice(0, 300);
  const msg =
    `[MY SELECT SHOP] 새 문의 #${q.id}\n` +
    `제목: ${q.title}\n` +
    `내용: ${preview}${String(q.body ?? '').length > 300 ? '…' : ''}\n\n` +
    `답변: node src/qna-admin.js answer ${q.id} "답변 내용"`;

  const sent: string[] = [];

  const webhook = Deno.env.get('QNA_WEBHOOK_URL');
  if (webhook) {
    try {
      // Discord는 content, Slack은 text 필드를 읽는다 — 둘 다 넣어 보내면 어느 쪽이든 동작.
      const r = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: msg, text: msg }),
        signal: AbortSignal.timeout(8000),
      });
      sent.push(`webhook:${r.status}`);
    } catch (e) {
      sent.push(`webhook:error:${(e as Error).message}`);
    }
  }

  const tgToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
  const tgChat = Deno.env.get('TELEGRAM_CHAT_ID');
  if (tgToken && tgChat) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: tgChat, text: msg }),
        signal: AbortSignal.timeout(8000),
      });
      sent.push(`telegram:${r.status}`);
    } catch (e) {
      sent.push(`telegram:error:${(e as Error).message}`);
    }
  }

  return Response.json({ ok: true, sent });
});
