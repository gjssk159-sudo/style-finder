-- 새 문의가 등록되면 notify-qna Edge Function을 호출하는 트리거.
-- 아래 __NOTIFY_SECRET__ 은 함수 시크릿(NOTIFY_SECRET)과 같은 값으로, 적용할 때 실제 값으로 바꿔서 실행한다
-- (저장소에는 실제 값을 올리지 않는다).
create extension if not exists pg_net;

create or replace function public.notify_qna() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform net.http_post(
    url := 'https://fipjvgglzlvksepdjxjv.supabase.co/functions/v1/notify-qna',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', '__NOTIFY_SECRET__'),
    body := jsonb_build_object('id', new.id, 'title', new.title, 'body', new.body, 'created_at', new.created_at)
  );
  return new;
exception when others then
  -- 알림 실패가 문의 등록을 막으면 안 된다
  return new;
end;
$$;

drop trigger if exists qna_notify_trg on public.qna_posts;
create trigger qna_notify_trg after insert on public.qna_posts
for each row execute function public.notify_qna();
