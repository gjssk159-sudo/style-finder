-- style-finder Supabase 스키마
-- 구조: RSS 리더형 — brands/product_group/offer는 공용(수집 파이프라인이 한 번만 채움),
--       user_brands만 사람마다 다름(내 폴더 = 내가 구독한 브랜드 목록).
-- 검색은 브라우저에서 Supabase JS로 직접 쿼리 (RLS가 보안 담당, 별도 백엔드 서버 불필요).

-- ============ brands: 브랜드/편집샵 레지스트리 (기존 brands.json을 DB로 이전) ============
create table if not exists brands (
  id            text primary key,            -- slug, 예: 'sansangear'
  name          text not null,
  name_en       text,
  type          text not null default 'brand' check (type in ('brand', 'select_shop')),
  instagram     text,
  shop_url      text not null,
  platform      text not null default 'unknown',  -- cafe24 | shopify | imweb | sixshop | unknown | custom
  discovery     jsonb not null default '{}',
  status        text not null default 'needs_review',  -- ready | needs_review | needs_work | excluded | deferred
  notes         text,
  added_by      uuid references auth.users(id),  -- null이면 초기 시딩(나=상헌)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ============ product_group: 중복 제거된 상품(색상별 분리 상품을 하나로 묶음) ============
create table if not exists product_group (
  id            bigserial primary key,
  brand_id      text references brands(id) on delete cascade,
  brand         text not null,               -- 화면표시용 브랜드명(비정규화, resolveBrand 결과)
  title_norm    text not null,
  title         text not null,
  categories    text[] not null default '{}',  -- 네이티브 배열 -> supabase-js .overlaps()/.contains() 바로 사용
  colors        text[] not null default '{}',
  sizes         text[] not null default '{}',
  gender        text check (gender in ('men', 'women', 'unisex')),  -- null = 원본에 성별 표기 없음(미상)
  min_price     integer,
  max_price     integer,
  image         text,
  in_stock      boolean not null default false,
  offer_count   integer not null default 0,
  updated_at    timestamptz not null default now(),
  unique (brand_id, title_norm)
);
create index if not exists idx_pg_brand on product_group(brand_id);
create index if not exists idx_pg_categories on product_group using gin (categories);
create index if not exists idx_pg_colors on product_group using gin (colors);
create index if not exists idx_pg_sizes on product_group using gin (sizes);

-- ============ offer: 실제 판매처별 링크/가격 (product_group 하나에 여러 개) ============
create table if not exists offer (
  id            bigserial primary key,
  group_id      bigint not null references product_group(id) on delete cascade,
  source_id     text not null references brands(id) on delete cascade,
  source_type   text,
  external_id   text not null,
  url           text not null,
  title         text not null,
  price         integer,
  image         text,
  in_stock      boolean not null default false,
  colors        text[] not null default '{}',
  sizes         text[] not null default '{}',
  updated_at    timestamptz not null default now(),
  unique (source_id, external_id)
);
create index if not exists idx_offer_group on offer(group_id);

-- ============ user_brands: 내 폴더 (사람마다 다른 유일한 테이블) ============
create table if not exists user_brands (
  user_id       uuid not null references auth.users(id) on delete cascade,
  brand_id      text not null references brands(id) on delete cascade,
  added_at      timestamptz not null default now(),
  primary key (user_id, brand_id)
);

-- ============================= RLS =============================
alter table brands enable row level security;
alter table product_group enable row level security;
alter table offer enable row level security;
alter table user_brands enable row level security;

-- brands: 누구나 읽기, 로그인 사용자는 새 브랜드 등록(추가)만 가능, 수정/삭제는 서비스 롤만
create policy brands_select on brands for select using (true);
create policy brands_insert on brands for insert to authenticated with check (true);
-- update/delete 정책 없음 = service_role(수집 파이프라인)만 가능

-- product_group / offer: 누구나 읽기, 쓰기는 서비스 롤만(수집 파이프라인)
create policy pg_select on product_group for select using (true);
create policy offer_select on offer for select using (true);

-- user_brands: 자기 것만 보고 추가/삭제
create policy ub_select on user_brands for select to authenticated using (user_id = auth.uid());
create policy ub_insert on user_brands for insert to authenticated with check (user_id = auth.uid());
create policy ub_delete on user_brands for delete to authenticated using (user_id = auth.uid());
