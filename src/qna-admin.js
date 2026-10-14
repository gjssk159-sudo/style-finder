// 운영진용: 사용자가 마이페이지 > 문의에 남긴 질문을 보고 답변을 단다.
//   node src/qna-admin.js                      답변 대기 중인 문의 목록
//   node src/qna-admin.js --all                전체 문의 목록
//   node src/qna-admin.js answer <id> "답변"   해당 문의에 답변 등록(수정도 같은 명령)
// service_role 키로 동작하므로 .env의 SUPABASE_SERVICE_KEY가 필요하다(사용자는 자기 질문에 답변을 쓸 수 없음).

import { getSupabaseAdmin } from './lib/supabase.js';

const sb = getSupabaseAdmin();
const [cmd, ...rest] = process.argv.slice(2);

if (cmd === 'answer') {
  const id = Number(rest[0]);
  const answer = rest.slice(1).join(' ').trim();
  if (!id || !answer) {
    console.error('사용법: node src/qna-admin.js answer <id> "답변 내용"');
    process.exit(1);
  }
  const { data, error } = await sb
    .from('qna_posts')
    .update({ answer, answered_at: new Date().toISOString() })
    .eq('id', id)
    .select('id,title')
    .single();
  if (error) { console.error('실패:', error.message); process.exit(1); }
  console.log(`답변 등록 완료: #${data.id} ${data.title}`);
} else {
  const all = cmd === '--all';
  let q = sb.from('qna_posts').select('id,title,body,answer,created_at,user_id').order('created_at', { ascending: true });
  if (!all) q = q.is('answer', null);
  const { data, error } = await q;
  if (error) { console.error('실패:', error.message); process.exit(1); }
  if (!data.length) console.log(all ? '문의가 없어요.' : '답변 대기 중인 문의가 없어요.');
  for (const r of data) {
    console.log(`\n#${r.id} [${r.answer ? '답변 완료' : '대기'}] ${new Date(r.created_at).toLocaleString('ko-KR')}  user ${r.user_id.slice(0, 8)}`);
    console.log(`  제목: ${r.title}`);
    console.log(`  내용: ${r.body.replace(/\n/g, '\n        ')}`);
    if (r.answer) console.log(`  답변: ${r.answer.replace(/\n/g, '\n        ')}`);
  }
}
