-- ============================= Q&A (마이페이지 > 문의) =============================
-- 질문은 작성자 본인만 읽고, 답변은 운영진(service_role)이 같은 행의 answer 컬럼에 적는다.
-- 사용자는 answer / answered_at 을 쓸 수 없고(insert 정책에서 null 강제, update 정책 없음), 자기 질문을 삭제할 수 있다.
create table if not exists qna_posts (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 100),
  body         text not null check (char_length(body) between 1 and 2000),
  answer       text,
  answered_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists qna_posts_user_idx on qna_posts (user_id, created_at desc);

alter table qna_posts enable row level security;

create policy qna_select on qna_posts for select to authenticated using (user_id = auth.uid());
-- 하루 10개까지(도배 방지), 답변 칸은 비워서만 작성 가능
create policy qna_insert on qna_posts for insert to authenticated with check (
  user_id = auth.uid()
  and answer is null
  and answered_at is null
  and (select count(*) from qna_posts p where p.user_id = auth.uid() and p.created_at > now() - interval '1 day') < 10
);
create policy qna_delete on qna_posts for delete to authenticated using (user_id = auth.uid());
-- update 정책 없음 = 답변 작성/수정은 service_role만 가능
