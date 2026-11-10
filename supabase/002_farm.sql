-- Cameron Strawberry – farm prices and order confirmation.
-- Run in Supabase → SQL Editor after schema.sql. Safe to run more than once.
-- The farmer has no login: she opens a private link (farm.html?k=...) that only works with her farm's secret key.

create table if not exists public.farms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null default '',
  token text not null unique default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.farm_prices (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms (id) on delete cascade,
  price_date date not null default (now() at time zone 'Asia/Kuala_Lumpur')::date,
  mixed numeric not null,       -- RM per kg
  big numeric not null,         -- RM per kg
  white numeric not null,       -- RM per 500g
  stock_mixed numeric, stock_big numeric, stock_white numeric,   -- kg available (optional)
  note text not null default '',
  updated_at timestamptz not null default now(),
  unique (farm_id, price_date)
);

create table if not exists public.farm_orders (       -- the farmer's confirmation of our order for a delivery day
  farm_id uuid not null references public.farms (id) on delete cascade,
  delivery_date date not null,
  confirmed_at timestamptz not null default now(),
  snapshot jsonb not null,      -- boxes and packs she confirmed
  price_mixed numeric, price_big numeric, price_white numeric,
  note text not null default '',
  primary key (farm_id, delivery_date)
);

alter table public.farms enable row level security;
alter table public.farm_prices enable row level security;
alter table public.farm_orders enable row level security;
drop policy if exists farms_admin on public.farms;
create policy farms_admin on public.farms for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists farm_prices_admin on public.farm_prices;
create policy farm_prices_admin on public.farm_prices for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists farm_orders_admin on public.farm_orders;
create policy farm_orders_admin on public.farm_orders for all using (public.is_admin()) with check (public.is_admin());

-- Boxes and packs for a delivery day (no customer details), including the extra packs set in admin.
create or replace function public.farm_totals(d date) returns jsonb
language sql stable security definer set search_path = public as
$$
  with o as (
    select floor(mixed / 2) mb, (mixed - floor(mixed / 2) * 2) * 2 mp,
           floor(big / 2) bb, (big - floor(big / 2) * 2) * 2 bp, white * 2 wp, mixed, big, white
    from orders where delivery_date = d and status <> 'cancelled'
  ), w as (select * from weeks where delivery_date = d)
  select jsonb_build_object(
    'orders', (select count(*) from o),
    'mixed_kg', coalesce((select sum(mixed) from o), 0), 'big_kg', coalesce((select sum(big) from o), 0), 'white_kg', coalesce((select sum(white) from o), 0),
    'mixed_box', coalesce((select sum(mb) from o), 0)::int, 'mixed_pack', (coalesce((select sum(mp) from o), 0) + coalesce((select extra_mixed from w), 0))::int,
    'big_box', coalesce((select sum(bb) from o), 0)::int, 'big_pack', (coalesce((select sum(bp) from o), 0) + coalesce((select extra_big from w), 0))::int,
    'white_pack', (coalesce((select sum(wp) from o), 0) + coalesce((select extra_white from w), 0))::int)
$$;
revoke execute on function public.farm_totals(date) from public, anon, authenticated;

-- Everything the farm page shows.
create or replace function public.farm_view(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as
$$
declare
  f farms%rowtype;
  today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  d date;
  conf farm_orders%rowtype;
begin
  select * into f from farms where token = p_token and active;
  if f.id is null then raise exception 'Pautan tidak sah'; end if;
  -- the next delivery day that is today or later, among days that have orders or are open for orders
  select min(x) into d from (
    select delivery_date x from orders where delivery_date >= today and status <> 'cancelled'
    union all select public.next_delivery_date()) t where x is not null;
  select * into conf from farm_orders where farm_id = f.id and delivery_date = d;
  return jsonb_build_object(
    'farm', jsonb_build_object('name', f.name),
    'today', today,
    'prices', coalesce((select jsonb_agg(to_jsonb(p) - 'farm_id' - 'id' order by p.price_date desc)
                        from (select * from farm_prices where farm_id = f.id order by price_date desc limit 14) p), '[]'::jsonb),
    'delivery_date', d,
    'order_day', d - 1,
    'cutoff', case when d is null then null else public.order_cutoff(d) end,
    'closed', d is not null and now() >= public.order_cutoff(d),
    'totals', case when d is null then null else public.farm_totals(d) end,
    'confirmed', case when conf.farm_id is null then null else jsonb_build_object('at', conf.confirmed_at, 'snapshot', conf.snapshot, 'note', conf.note) end
  );
end $$;

create or replace function public.farm_save_price(p_token text, p_mixed numeric, p_big numeric, p_white numeric,
  p_stock_mixed numeric default null, p_stock_big numeric default null, p_stock_white numeric default null, p_note text default '')
returns void language plpgsql security definer set search_path = public as
$$
declare f farms%rowtype;
begin
  select * into f from farms where token = p_token and active;
  if f.id is null then raise exception 'Pautan tidak sah'; end if;
  if p_mixed is null or p_big is null or p_white is null or p_mixed < 0 or p_big < 0 or p_white < 0 or greatest(p_mixed, p_big, p_white) > 500 then
    raise exception 'Semak harga semula';
  end if;
  insert into farm_prices (farm_id, mixed, big, white, stock_mixed, stock_big, stock_white, note)
  values (f.id, p_mixed, p_big, p_white, p_stock_mixed, p_stock_big, p_stock_white, left(coalesce(p_note, ''), 500))
  on conflict (farm_id, price_date) do update set mixed = excluded.mixed, big = excluded.big, white = excluded.white,
    stock_mixed = excluded.stock_mixed, stock_big = excluded.stock_big, stock_white = excluded.stock_white, note = excluded.note, updated_at = now();
end $$;

-- The farmer confirms the order; her latest price becomes that week's cost in admin.
create or replace function public.farm_confirm(p_token text, p_date date, p_note text default '')
returns void language plpgsql security definer set search_path = public as
$$
declare f farms%rowtype; p farm_prices%rowtype;
begin
  select * into f from farms where token = p_token and active;
  if f.id is null then raise exception 'Pautan tidak sah'; end if;
  if p_date is null or p_date < (now() at time zone 'Asia/Kuala_Lumpur')::date then raise exception 'Tarikh tidak sah'; end if;
  select * into p from farm_prices where farm_id = f.id and price_date <= p_date order by price_date desc limit 1;
  if p.id is null then raise exception 'Masukkan harga dahulu'; end if;
  insert into farm_orders (farm_id, delivery_date, snapshot, price_mixed, price_big, price_white, note)
  values (f.id, p_date, public.farm_totals(p_date), p.mixed, p.big, p.white, left(coalesce(p_note, ''), 500))
  on conflict (farm_id, delivery_date) do update set confirmed_at = now(), snapshot = excluded.snapshot,
    price_mixed = excluded.price_mixed, price_big = excluded.price_big, price_white = excluded.price_white, note = excluded.note;
  insert into weeks (delivery_date, cost_mixed, cost_big, cost_white) values (p_date, p.mixed, p.big, p.white)
  on conflict (delivery_date) do update set cost_mixed = excluded.cost_mixed, cost_big = excluded.cost_big, cost_white = excluded.cost_white;
end $$;

grant execute on function public.farm_view(text) to anon, authenticated;
grant execute on function public.farm_save_price(text, numeric, numeric, numeric, numeric, numeric, numeric, text) to anon, authenticated;
grant execute on function public.farm_confirm(text, date, text) to anon, authenticated;

-- Admin helper: boxes and packs for any day.
create or replace function public.admin_farm_totals(d date) returns jsonb
language plpgsql stable security definer set search_path = public as
$$ begin if not public.is_admin() then raise exception 'Admins only'; end if; return public.farm_totals(d); end $$;
