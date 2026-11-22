-- #15 장바구니(D-10): 결제 없이 마음에 든 상품을 내 계정에 담아 두는 목록.
-- 상품이 쇼핑몰에서 사라지면 수집 때 product_group 행이 지워지므로(group_id는 null이 됨),
-- 담을 때의 이름·사진·가격·링크를 같이 저장해 "판매 끝남"으로 보여 준다.
-- 기존 표(상품·폴더 등)는 건드리지 않는다. 여러 번 실행해도 안전하다.
create table if not exists cart_items (
  id         bigserial primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  group_id   bigint references product_group(id) on delete set null,
  brand      text not null default '',
  title      text not null default '',
  image      text,
  price      integer,
  url        text,
  added_at   timestamptz not null default now()
);
-- 같은 상품을 두 번 담지 않게(사라진 상품 null은 겹쳐도 됨)
create unique index if not exists cart_items_user_group on cart_items(user_id, group_id);
create index if not exists idx_cart_user_added on cart_items(user_id, added_at desc);

-- RLS: 본인 것만 보고, 담고(최대 300개), 뺀다. 수정은 없다.
alter table cart_items enable row level security;
drop policy if exists cart_select on cart_items;
drop policy if exists cart_insert on cart_items;
drop policy if exists cart_delete on cart_items;
create policy cart_select on cart_items for select to authenticated using (user_id = auth.uid());
create policy cart_insert on cart_items for insert to authenticated with check (
  user_id = auth.uid() and (select count(*) from cart_items where user_id = auth.uid()) < 300
);
create policy cart_delete on cart_items for delete to authenticated using (user_id = auth.uid());
