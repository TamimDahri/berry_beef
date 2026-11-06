-- Cameron Strawberry – database setup for Supabase.
-- Paste this whole file into Supabase → SQL Editor → New query, then click Run. Safe to run once on a new project.

create extension if not exists pgcrypto;

-- ---------- settings (one row) ----------
create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  price_mixed numeric not null default 40,      -- RM per kg
  price_big numeric not null default 50,        -- RM per kg
  price_white numeric not null default 35,      -- RM per 500g
  fee numeric not null default 5,               -- delivery fee below free_from_kg
  free_from_kg numeric not null default 2,
  runner_per_kg numeric not null default 1,
  bus_per_kg numeric not null default 1,
  rider_per_drop numeric not null default 10,
  delivery_days int[] not null default '{3}',   -- 0=Sun … 3=Wed
  cutoff_days_before int not null default 2,    -- Monday for a Wednesday delivery
  cutoff_hour int not null default 22,          -- 10pm Malaysia time
  start_point text not null default 'Terminal Bersepadu Selatan, Kuala Lumpur',
  stops_per_link int not null default 9,
  zones jsonb not null default '[{"name":"West","areas":"Damansara, Mont Kiara, Hartamas, Desa ParkCity"},{"name":"Central","areas":"Bangsar, KL city, KLCC, Seputeh"},{"name":"East","areas":"Ampang"},{"name":"Other","areas":"Outside the usual area"}]',
  updated_at timestamptz not null default now()
);
insert into public.settings (id) values (1) on conflict do nothing;

-- ---------- people ----------
create table if not exists public.profiles (           -- one row per login
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'customer' check (role in ('customer', 'rider', 'admin')),
  name text not null default '',
  phone text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.customers (          -- delivery details; may exist before the person signs up
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users (id) on delete set null,
  name text not null default '',
  phone text not null default '',
  address text not null default '',
  unit text not null default '',
  zone text not null default '',
  note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists customers_phone_idx on public.customers (regexp_replace(phone, '\D', '', 'g'));

-- ---------- orders ----------
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers (id) on delete set null,
  delivery_date date not null,
  name text not null default '',
  phone text not null default '',
  address text not null default '',
  unit text not null default '',
  zone text not null default '',
  note text not null default '',
  mixed numeric not null default 0,
  big numeric not null default 0,
  white numeric not null default 0,
  total_kg numeric not null default 0,
  subtotal numeric not null default 0,
  fee numeric not null default 0,
  total numeric not null default 0,
  pay text not null default 'cash' check (pay in ('online', 'qr', 'cash')),
  paid boolean not null default false,
  status text not null default 'new' check (status in ('new', 'out', 'delivered', 'nothome', 'cancelled')),
  rider_id uuid references public.profiles (id) on delete set null,
  seq int,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists orders_date_idx on public.orders (delivery_date);
create index if not exists orders_rider_idx on public.orders (rider_id, delivery_date);
create index if not exists orders_customer_idx on public.orders (customer_id);

-- farm cost and trip details per delivery day (admin only)
create table if not exists public.weeks (
  delivery_date date primary key,
  cost_mixed numeric not null default 20,    -- RM per kg
  cost_big numeric not null default 32,      -- RM per kg
  cost_white numeric not null default 20,    -- RM per 500g
  trip boolean not null default false,       -- owner drove to Cameron Highlands
  trip_cost numeric not null default 0,
  collector text not null default '',
  extra_mixed int not null default 0, extra_big int not null default 0, extra_white int not null default 0
);

-- ---------- helpers ----------
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as
$$ select coalesce((select role from profiles where id = auth.uid()), 'anon') $$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select public.my_role() = 'admin' $$;

create or replace function public.my_customer_id() returns uuid
language sql stable security definer set search_path = public as
$$ select id from customers where user_id = auth.uid() $$;

create or replace function public.digits(p text) returns text
language sql immutable as
$$ select regexp_replace(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '^60', '0') $$;

-- When is ordering closed for a delivery date? (Malaysia time)
create or replace function public.order_cutoff(d date) returns timestamptz
language sql stable set search_path = public as
$$ select ((d - s.cutoff_days_before) + make_interval(hours => s.cutoff_hour)) at time zone 'Asia/Kuala_Lumpur' from settings s where id = 1 $$;

-- The next delivery date customers can still order for.
create or replace function public.next_delivery_date() returns date
language sql stable set search_path = public as
$$
  select d::date from generate_series((now() at time zone 'Asia/Kuala_Lumpur')::date, (now() at time zone 'Asia/Kuala_Lumpur')::date + 21, interval '1 day') d, settings s
  where s.id = 1 and extract(dow from d)::int = any (s.delivery_days) and now() < public.order_cutoff(d::date)
  order by d limit 1
$$;

-- ---------- new login → profile + customer (links to an existing customer with the same phone) ----------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as
$$
declare
  v_name text := coalesce(new.raw_user_meta_data ->> 'name', '');
  v_phone text := coalesce(new.raw_user_meta_data ->> 'phone', '');
  v_cust uuid;
begin
  insert into profiles (id, name, phone) values (new.id, v_name, v_phone) on conflict (id) do nothing;
  if public.digits(v_phone) <> '' then
    select id into v_cust from customers where user_id is null and public.digits(phone) = public.digits(v_phone) order by created_at limit 1;
  end if;
  if v_cust is not null then
    update customers set user_id = new.id where id = v_cust;
  else
    insert into customers (user_id, name, phone) values (new.id, v_name, v_phone);
  end if;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- customers may edit their own details but not who the record belongs to
create or replace function public.guard_customer() returns trigger
language plpgsql set search_path = public as
$$
begin
  if not public.is_admin() and new.user_id is distinct from old.user_id then
    raise exception 'Not allowed to change the account link';
  end if;
  return new;
end $$;
drop trigger if exists guard_customer on public.customers;
create trigger guard_customer before update on public.customers for each row execute function public.guard_customer();

-- ---------- orders: prices are always worked out here, never trusted from the browser ----------
create or replace function public.price_order() returns trigger
language plpgsql security definer set search_path = public as
$$
declare
  s settings%rowtype;
  c customers%rowtype;
  admin boolean := public.is_admin();
begin
  select * into s from settings where id = 1;
  new.mixed := coalesce(new.mixed, 0); new.big := coalesce(new.big, 0); new.white := coalesce(new.white, 0);
  if new.mixed < 0 or new.big < 0 or new.white < 0
     or new.mixed * 2 <> trunc(new.mixed * 2) or new.big * 2 <> trunc(new.big * 2) or new.white * 2 <> trunc(new.white * 2) then
    raise exception 'Order in 500g steps';
  end if;
  if (new.mixed > 0 and new.mixed < 1) or (new.big > 0 and new.big < 1) then
    raise exception 'Mixed and big start at 1kg';
  end if;
  new.total_kg := new.mixed + new.big + new.white;
  if new.total_kg = 0 then raise exception 'Add at least one product'; end if;
  -- on edits, keep the price the customer was quoted unless the quantities changed
  if tg_op = 'UPDATE' and new.mixed = old.mixed and new.big = old.big and new.white = old.white then
    new.subtotal := old.subtotal; new.fee := old.fee; new.total := old.total;
    return new;
  end if;
  new.subtotal := new.mixed * s.price_mixed + new.big * s.price_big + new.white * 2 * s.price_white;
  new.fee := case when new.total_kg < s.free_from_kg then s.fee else 0 end;
  new.total := new.subtotal + new.fee;

  if tg_op = 'INSERT' and not admin then
    -- customers: only for themselves, only before the cutoff, nothing pre-set
    select * into c from customers where user_id = auth.uid();
    if c.id is null or new.customer_id is distinct from c.id then raise exception 'Order for your own account only'; end if;
    if not (extract(dow from new.delivery_date)::int = any (s.delivery_days)) then raise exception 'We do not deliver on that day'; end if;
    if now() >= public.order_cutoff(new.delivery_date) then raise exception 'Orders for this day are closed'; end if;
    new.name := c.name; new.phone := c.phone; new.address := c.address; new.unit := c.unit; new.zone := c.zone;
    if coalesce(new.note, '') = '' then new.note := c.note; end if;
    new.status := 'new'; new.paid := false; new.rider_id := null; new.seq := null;
    if new.pay = 'online' then new.pay := 'qr'; end if;
    new.created_by := auth.uid();
  end if;
  return new;
end $$;
drop trigger if exists price_order on public.orders;
create trigger price_order before insert or update on public.orders for each row execute function public.price_order();

-- customer: cancel own order before the cutoff
create or replace function public.cancel_my_order(p_id uuid) returns void
language plpgsql security definer set search_path = public as
$$
begin
  update orders set status = 'cancelled'
  where id = p_id and customer_id = public.my_customer_id() and status = 'new' and now() < public.order_cutoff(delivery_date);
  if not found then raise exception 'This order can no longer be cancelled'; end if;
end $$;

-- rider: update status / payment on own stops only
create or replace function public.rider_update(p_id uuid, p_status text, p_paid boolean) returns void
language plpgsql security definer set search_path = public as
$$
begin
  if p_status not in ('out', 'delivered', 'nothome') then raise exception 'Invalid status'; end if;
  update orders set status = p_status, paid = coalesce(p_paid, paid)
  where id = p_id and rider_id = auth.uid() and status <> 'cancelled';
  if not found then raise exception 'Not your stop'; end if;
end $$;

-- ---------- row level security ----------
alter table public.settings enable row level security;
alter table public.profiles enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.weeks enable row level security;

drop policy if exists settings_read on public.settings;
create policy settings_read on public.settings for select using (true);
drop policy if exists settings_admin on public.settings;
create policy settings_admin on public.settings for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_admin on public.profiles;
create policy profiles_admin on public.profiles for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists customers_read on public.customers;
create policy customers_read on public.customers for select using (
  user_id = auth.uid() or public.is_admin()
  or exists (select 1 from public.orders o where o.customer_id = customers.id and o.rider_id = auth.uid())
);
drop policy if exists customers_insert on public.customers;
create policy customers_insert on public.customers for insert with check (public.is_admin());
drop policy if exists customers_update on public.customers;
create policy customers_update on public.customers for update using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());
drop policy if exists customers_delete on public.customers;
create policy customers_delete on public.customers for delete using (public.is_admin());

drop policy if exists orders_read on public.orders;
create policy orders_read on public.orders for select using (
  public.is_admin() or customer_id = public.my_customer_id() or rider_id = auth.uid()
);
drop policy if exists orders_insert on public.orders;
create policy orders_insert on public.orders for insert with check (public.is_admin() or customer_id = public.my_customer_id());
drop policy if exists orders_admin_update on public.orders;
create policy orders_admin_update on public.orders for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists orders_admin_delete on public.orders;
create policy orders_admin_delete on public.orders for delete using (public.is_admin());

drop policy if exists weeks_admin on public.weeks;
create policy weeks_admin on public.weeks for all using (public.is_admin()) with check (public.is_admin());

-- riders see their own name only through profiles; admins see everyone.
-- Make yourself admin after you sign up (replace the email):
-- update public.profiles set role = 'admin' where id = (select id from auth.users where email = 'you@example.com');
