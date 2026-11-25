-- #20 홈 "나에게 어울리는 브랜드" 추천용 요약: 브랜드마다 상품 종류별 개수와 가격 중간값.
-- 새 표가 아니라 기존 product_group을 읽어 보여 주는 읽기 전용 view다(데이터를 바꾸거나 지우지 않음).
-- security_invoker: 읽는 사람의 권한(RLS)을 그대로 따른다 — product_group은 원래 누구나 읽기 가능.
-- 여러 번 실행해도 안전하다.
create or replace view brand_profile with (security_invoker = true) as
select g.brand_id,
       c.cat,
       count(*)::int as n,
       (percentile_cont(0.5) within group (order by g.min_price))::int as med_price
from product_group g
cross join lateral unnest(g.categories) as c(cat)
where g.min_price > 0 and g.image is not null and g.image <> ''
group by g.brand_id, c.cat;

grant select on brand_profile to anon, authenticated;
