-- Cameron Strawberry – backup carriers (known drivers bringing stock down from the farm).
-- Run in Supabase → SQL Editor after 002_farm.sql. Safe to run more than once.
-- Drivers have no login: each opens a private link (carry.html?k=...).

create table if not exists public.carriers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null default '',
  vehicle text not null default '',          -- e.g. "Perodua Myvi, ABC 1234"
  note text not null default '',
  token text not null unique default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.shipments (       -- one trip: a driver brings boxes from the farm to a drop-off point
  id uuid primary key default gen_random_uuid(),
  delivery_date date not null,
  carrier_id uuid not null references public.carriers (id) on delete cascade,
  mixed_box int not null default 0, mixed_pack int not null default 0,
  big_box int not null default 0, big_pack int not null default 0, white_pack int not null default 0,
  fee numeric not null default 0,
  dropoff text not null default 'Terminal Bersepadu Selatan, Kuala Lumpur',
  meet_time text not null default '',          -- e.g. "Rabu 3 petang"
  status text not null default 'assigned' check (status in ('assigned', 'accepted', 'declined', 'picked_up', 'delivered', 'received', 'cancelled')),
  accepted_at timestamptz, picked_at timestamptz, delivered_at timestamptz, received_at timestamptz,
  carrier_note text not null default '',
  admin_note text not null default '',
  paid boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists shipments_date_idx on public.shipments (delivery_date);

alter table public.carriers enable row level security;
alter table public.shipments enable row level security;
drop policy if exists carriers_admin on public.carriers;
create policy carriers_admin on public.carriers for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists shipments_admin on public.shipments;
create policy shipments_admin on public.shipments for all using (public.is_admin()) with check (public.is_admin());

-- What a driver's link shows: their trips from yesterday onwards, and the farm to collect from.
create or replace function public.carrier_view(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as
$$
declare c carriers%rowtype; today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
begin
  select * into c from carriers where token = p_token and active;
  if c.id is null then raise exception 'Pautan tidak sah'; end if;
  return jsonb_build_object(
    'carrier', jsonb_build_object('name', c.name),
    'today', today,
    'farm', (select jsonb_build_object('name', f.name, 'phone', f.phone) from farms f where f.active order by f.created_at limit 1),
    'trips', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'delivery_date', s.delivery_date, 'mixed_box', s.mixed_box, 'mixed_pack', s.mixed_pack, 'big_box', s.big_box, 'big_pack', s.big_pack,
        'white_pack', s.white_pack, 'fee', s.fee, 'dropoff', s.dropoff, 'meet_time', s.meet_time, 'status', s.status, 'paid', s.paid,
        'carrier_note', s.carrier_note, 'admin_note', s.admin_note, 'picked_at', s.picked_at, 'delivered_at', s.delivered_at) order by s.delivery_date)
      from shipments s where s.carrier_id = c.id and s.delivery_date >= today - 1 and s.status <> 'cancelled'), '[]'::jsonb)
  );
end $$;

-- Driver steps: accept or decline a new trip, then picked up at the farm, then handed over at the drop-off.
create or replace function public.carrier_update(p_token text, p_id uuid, p_action text, p_note text default '')
returns void language plpgsql security definer set search_path = public as
$$
declare c carriers%rowtype; s shipments%rowtype;
begin
  select * into c from carriers where token = p_token and active;
  if c.id is null then raise exception 'Pautan tidak sah'; end if;
  select * into s from shipments where id = p_id and carrier_id = c.id for update;
  if s.id is null then raise exception 'Trip tidak dijumpai'; end if;
  if p_action = 'accept' and s.status in ('assigned', 'declined') then
    update shipments set status = 'accepted', accepted_at = now() where id = s.id;
  elsif p_action = 'decline' and s.status in ('assigned', 'accepted') then
    update shipments set status = 'declined' where id = s.id;
  elsif p_action = 'picked_up' and s.status in ('assigned', 'accepted') then
    update shipments set status = 'picked_up', picked_at = now() where id = s.id;
  elsif p_action = 'delivered' and s.status = 'picked_up' then
    update shipments set status = 'delivered', delivered_at = now() where id = s.id;
  else
    raise exception 'Langkah ini tidak boleh dibuat sekarang';
  end if;
  if coalesce(p_note, '') <> '' then update shipments set carrier_note = left(p_note, 500) where id = s.id; end if;
end $$;

grant execute on function public.carrier_view(text) to anon, authenticated;
grant execute on function public.carrier_update(text, uuid, text, text) to anon, authenticated;

-- The farm page now also shows who is coming to collect.
create or replace function public.farm_pickups(p_token text, p_date date) returns jsonb
language plpgsql stable security definer set search_path = public as
$$
declare f farms%rowtype;
begin
  select * into f from farms where token = p_token and active;
  if f.id is null then raise exception 'Pautan tidak sah'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('name', c.name, 'phone', c.phone, 'vehicle', c.vehicle, 'status', s.status, 'meet_time', s.meet_time,
      'mixed_box', s.mixed_box, 'mixed_pack', s.mixed_pack, 'big_box', s.big_box, 'big_pack', s.big_pack, 'white_pack', s.white_pack) order by s.created_at)
    from shipments s join carriers c on c.id = s.carrier_id
    where s.delivery_date = p_date and s.status not in ('cancelled', 'declined')), '[]'::jsonb);
end $$;
grant execute on function public.farm_pickups(text, date) to anon, authenticated;
