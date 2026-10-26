-- 최신순 정렬이 계속 같은 브랜드(xlim)로 고정되던 문제 수정.
-- 원인: 정렬 기준이던 updated_at을 수집 때마다 전 상품에 새로 찍어서(같은 수집의 상품끼리 거의 같은 시각)
--       "마지막으로 적재된 브랜드"가 항상 맨 위였다.
-- 해결: 우리 사이트가 이 상품을 처음 발견한 시각 first_seen_at을 따로 두고(처음 한 번만 찍힘, 재수집으로 안 바뀜) 그걸로 정렬.
-- 기존 상품은 발견 시각을 모르므로, 브랜드 안에서 쇼핑몰 상품번호(클수록 최근)로 순서를 매겨 최근 90일에 고르게 흩뿌려 둔다.
alter table product_group add column if not exists first_seen_at timestamptz;

with ranked as (
  select pg.id,
         percent_rank() over (partition by pg.brand_id order by coalesce(mx.n, 0) desc, pg.id desc) as pr
  from product_group pg
  left join lateral (
    select max(case when o.external_id ~ '^[0-9]{1,18}$' then o.external_id::numeric end) as n
    from offer o where o.group_id = pg.id
  ) mx on true
)
update product_group pg
   set first_seen_at = now() - (r.pr * interval '90 days')
  from ranked r
 where r.id = pg.id and pg.first_seen_at is null;

alter table product_group alter column first_seen_at set default now();
alter table product_group alter column first_seen_at set not null;
create index if not exists idx_pg_first_seen on product_group (first_seen_at desc, id desc);
