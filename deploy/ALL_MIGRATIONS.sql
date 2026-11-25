-- =====================================================================
-- OrderHogaya — initial schema
-- Multi-tenant (one database, many businesses) secured by Row Level Security.
-- Every business-owned row carries business_id; access is decided by the
-- caller's role in business_members.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
create type public.member_role  as enum ('owner', 'admin', 'agent', 'viewer');
create type public.lead_status  as enum ('new', 'contacted', 'qualified', 'won', 'lost');
create type public.order_status as enum ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled');
create type public.item_kind    as enum ('product', 'service');

-- ---------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Profiles (one per auth user)
-- ---------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null default '',
  full_name   text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, lower(coalesce(new.email, '')), coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Businesses (tenants) and membership
-- ---------------------------------------------------------------------
create table public.businesses (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (char_length(name) between 2 and 120),
  slug             text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])$'),
  description      text not null default '',
  industry         text not null default '',
  currency         text not null default 'PKR' check (char_length(currency) between 1 and 5),
  phone            text not null default '',
  email            text not null default '',
  address          text not null default '',
  website          text not null default '',
  bot_name         text not null default 'Sales Assistant',
  bot_greeting     text not null default 'Hi! How can I help you today?',
  bot_instructions text not null default '' check (char_length(bot_instructions) <= 8000),
  bot_language     text not null default 'auto',
  brand_color      text not null default '#4f46e5' check (brand_color ~ '^#[0-9a-fA-F]{6}$'),
  chat_enabled     boolean not null default true,
  order_seq        integer not null default 0,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger businesses_updated before update on public.businesses
  for each row execute function public.set_updated_at();

create table public.business_members (
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        public.member_role not null default 'agent',
  created_at  timestamptz not null default now(),
  primary key (business_id, user_id)
);
create index business_members_user_idx on public.business_members (user_id);

create table public.invitations (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  email       text not null check (email = lower(email) and email like '%@%'),
  role        public.member_role not null default 'agent' check (role <> 'owner'),
  invited_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (business_id, email)
);

-- Role helpers (SECURITY DEFINER so policies can read membership without recursion)
create or replace function public.is_member(bid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.business_members
                 where business_id = bid and user_id = auth.uid());
$$;

create or replace function public.has_role(bid uuid, roles public.member_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.business_members
                 where business_id = bid and user_id = auth.uid() and role = any (roles));
$$;

-- ---------------------------------------------------------------------
-- Catalogue and chatbot knowledge
-- ---------------------------------------------------------------------
create table public.products (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  kind        public.item_kind not null default 'product',
  name        text not null check (char_length(name) between 1 and 200),
  description text not null default '',
  category    text not null default '',
  price       numeric(12,2) not null check (price >= 0),
  sale_price  numeric(12,2) check (sale_price is null or sale_price >= 0),
  stock       integer check (stock is null or stock >= 0),
  sku         text not null default '',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index products_business_idx on public.products (business_id, is_active);
create trigger products_updated before update on public.products
  for each row execute function public.set_updated_at();

create table public.knowledge_entries (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  question    text not null check (char_length(question) between 1 and 500),
  answer      text not null check (char_length(answer) between 1 and 5000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index knowledge_business_idx on public.knowledge_entries (business_id);
create trigger knowledge_updated before update on public.knowledge_entries
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Customers, conversations, leads, orders
-- ---------------------------------------------------------------------
create table public.customers (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name        text not null default '',
  phone       text not null default '',
  email       text not null default '',
  address     text not null default '',
  notes       text not null default '',
  source      text not null default 'manual' check (source in ('manual', 'chat')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index customers_business_idx on public.customers (business_id, created_at desc);
create unique index customers_business_phone_uidx on public.customers (business_id, phone) where phone <> '';
create trigger customers_updated before update on public.customers
  for each row execute function public.set_updated_at();

create table public.conversations (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses (id) on delete cascade,
  customer_id     uuid references public.customers (id) on delete set null,
  visitor_id      text not null check (char_length(visitor_id) between 8 and 64),
  message_count   integer not null default 0,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create index conversations_business_idx on public.conversations (business_id, last_message_at desc);

create table public.messages (
  id              bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  business_id     uuid not null references public.businesses (id) on delete cascade,
  role            text not null check (role in ('user', 'assistant')),
  content         text not null,
  created_at      timestamptz not null default now()
);
create index messages_conversation_idx on public.messages (conversation_id, id);

create table public.leads (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses (id) on delete cascade,
  customer_id     uuid not null references public.customers (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  interest        text not null default '',
  status          public.lead_status not null default 'new',
  notes           text not null default '',
  source          text not null default 'manual' check (source in ('manual', 'chat')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index leads_business_idx on public.leads (business_id, created_at desc);
create trigger leads_updated before update on public.leads
  for each row execute function public.set_updated_at();

create table public.orders (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references public.businesses (id) on delete cascade,
  order_number     integer not null,
  customer_id      uuid references public.customers (id) on delete set null,
  conversation_id  uuid references public.conversations (id) on delete set null,
  status           public.order_status not null default 'pending',
  total            numeric(12,2) not null default 0,
  delivery_address text not null default '',
  notes            text not null default '',
  source           text not null default 'manual' check (source in ('manual', 'chat')),
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (business_id, order_number)
);
create index orders_business_idx on public.orders (business_id, created_at desc);
create trigger orders_updated before update on public.orders
  for each row execute function public.set_updated_at();

create table public.order_items (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  product_id  uuid references public.products (id) on delete set null,
  name        text not null,
  unit_price  numeric(12,2) not null check (unit_price >= 0),
  quantity    integer not null check (quantity > 0 and quantity <= 100000),
  line_total  numeric(14,2) generated always as (unit_price * quantity) stored
);
create index order_items_order_idx on public.order_items (order_id);

-- Per-business sequential order numbers (#1, #2, …) without races.
create or replace function public.assign_order_number()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.businesses set order_seq = order_seq + 1
   where id = new.business_id
  returning order_seq into new.order_number;
  return new;
end $$;
create trigger orders_number before insert on public.orders
  for each row execute function public.assign_order_number();

-- Order items must belong to the same business as their order.
create or replace function public.check_order_item_business()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.orders where id = new.order_id and business_id = new.business_id) then
    raise exception 'order item business mismatch';
  end if;
  if new.product_id is not null and not exists
     (select 1 from public.products where id = new.product_id and business_id = new.business_id) then
    raise exception 'product does not belong to this business';
  end if;
  return new;
end $$;
create trigger order_items_check before insert or update on public.order_items
  for each row execute function public.check_order_item_business();

-- Keep orders.total equal to the sum of its items.
create or replace function public.recalc_order_total()
returns trigger language plpgsql security definer set search_path = public as $$
declare oid uuid := coalesce(new.order_id, old.order_id);
begin
  update public.orders
     set total = coalesce((select sum(line_total) from public.order_items where order_id = oid), 0)
   where id = oid;
  return null;
end $$;
create trigger order_items_total after insert or update or delete on public.order_items
  for each row execute function public.recalc_order_total();

-- Rows that reference a customer / conversation must stay inside one business.
create or replace function public.check_same_business()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.customer_id is not null and not exists
     (select 1 from public.customers where id = new.customer_id and business_id = new.business_id) then
    raise exception 'customer does not belong to this business';
  end if;
  if new.conversation_id is not null and not exists
     (select 1 from public.conversations where id = new.conversation_id and business_id = new.business_id) then
    raise exception 'conversation does not belong to this business';
  end if;
  return new;
end $$;
create trigger leads_same_business before insert or update on public.leads
  for each row execute function public.check_same_business();
create trigger orders_same_business before insert or update on public.orders
  for each row execute function public.check_same_business();

-- ---------------------------------------------------------------------
-- RPCs used by the dashboard
-- ---------------------------------------------------------------------

-- Create a business and make the caller its owner (atomic).
create or replace function public.create_business(p_name text, p_slug text, p_industry text default '', p_currency text default 'PKR')
returns uuid language plpgsql security definer set search_path = public as $$
declare bid uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if (select count(*) from public.business_members where user_id = auth.uid() and role = 'owner') >= 10 then
    raise exception 'business limit reached';
  end if;
  insert into public.businesses (name, slug, industry, currency, created_by)
  values (trim(p_name), lower(trim(p_slug)), coalesce(p_industry, ''), coalesce(nullif(trim(p_currency), ''), 'PKR'), auth.uid())
  returning id into bid;
  insert into public.business_members (business_id, user_id, role) values (bid, auth.uid(), 'owner');
  return bid;
end $$;

-- Join every business that invited the caller's email.
create or replace function public.accept_invitations()
returns integer language plpgsql security definer set search_path = public as $$
declare em text := lower(coalesce(auth.jwt() ->> 'email', '')); n integer := 0;
begin
  if auth.uid() is null or em = '' then return 0; end if;
  insert into public.business_members (business_id, user_id, role)
  select business_id, auth.uid(), role from public.invitations where email = em
  on conflict (business_id, user_id) do nothing;
  get diagnostics n = row_count;
  delete from public.invitations where email = em;
  return n;
end $$;

-- Change a member's role. Owners may set any non-owner role; admins may only
-- manage agents/viewers. Ownership cannot be changed here.
create or replace function public.set_member_role(p_business uuid, p_user uuid, p_role public.member_role)
returns void language plpgsql security definer set search_path = public as $$
declare target public.member_role;
begin
  select role into target from public.business_members where business_id = p_business and user_id = p_user;
  if target is null then raise exception 'member not found'; end if;
  if target = 'owner' or p_role = 'owner' then raise exception 'ownership cannot be changed here'; end if;
  if public.has_role(p_business, array['owner']::public.member_role[]) then
    null;
  elsif public.has_role(p_business, array['admin']::public.member_role[]) then
    if target = 'admin' or p_role = 'admin' then raise exception 'admins can only manage agents and viewers'; end if;
  else
    raise exception 'permission denied';
  end if;
  update public.business_members set role = p_role where business_id = p_business and user_id = p_user;
end $$;

-- Remove a member (or leave a business when p_user = caller).
create or replace function public.remove_member(p_business uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare target public.member_role;
begin
  select role into target from public.business_members where business_id = p_business and user_id = p_user;
  if target is null then raise exception 'member not found'; end if;
  if target = 'owner' then raise exception 'the owner cannot be removed'; end if;
  if p_user <> auth.uid() then
    if not (public.has_role(p_business, array['owner']::public.member_role[])
            or (public.has_role(p_business, array['admin']::public.member_role[]) and target in ('agent', 'viewer'))) then
      raise exception 'permission denied';
    end if;
  end if;
  delete from public.business_members where business_id = p_business and user_id = p_user;
end $$;

-- Create an order with items in one transaction (prices come from the catalogue
-- unless an explicit unit price is given for a custom line).
-- p_items: [{ "product_id": uuid|null, "name": text, "unit_price": number, "quantity": int }]
create or replace function public.create_order(p_business uuid, p_customer uuid, p_items jsonb,
                                               p_address text default '', p_notes text default '',
                                               p_status public.order_status default 'pending')
returns uuid language plpgsql security invoker set search_path = public as $$
declare oid uuid; it jsonb; pr record; qty integer;
begin
  if not public.has_role(p_business, array['owner','admin','agent']::public.member_role[]) then
    raise exception 'permission denied';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'order needs at least one item';
  end if;
  insert into public.orders (business_id, customer_id, delivery_address, notes, status, source, created_by)
  values (p_business, p_customer, coalesce(p_address, ''), coalesce(p_notes, ''), p_status, 'manual', auth.uid())
  returning id into oid;
  for it in select * from jsonb_array_elements(p_items) loop
    qty := greatest(1, coalesce((it ->> 'quantity')::int, 1));
    if nullif(it ->> 'product_id', '') is not null then
      select id, name, coalesce(sale_price, price) as p into pr
        from public.products where id = (it ->> 'product_id')::uuid and business_id = p_business;
      if pr.id is null then raise exception 'product not found'; end if;
      insert into public.order_items (order_id, business_id, product_id, name, unit_price, quantity)
      values (oid, p_business, pr.id, pr.name, coalesce((it ->> 'unit_price')::numeric, pr.p), qty);
    else
      insert into public.order_items (order_id, business_id, product_id, name, unit_price, quantity)
      values (oid, p_business, null, coalesce(nullif(trim(it ->> 'name'), ''), 'Item'),
              greatest(0, coalesce((it ->> 'unit_price')::numeric, 0)), qty);
    end if;
  end loop;
  return oid;
end $$;

-- Sales report for a date range (inclusive), in the business's view.
create or replace function public.sales_report(p_business uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare result jsonb;
begin
  if not public.is_member(p_business) then raise exception 'permission denied'; end if;
  with o as (
    select * from public.orders
     where business_id = p_business and created_at >= p_from and created_at < p_to + 1
  ), valid as (select * from o where status <> 'cancelled')
  select jsonb_build_object(
    'orders',         (select count(*) from valid),
    'revenue',        (select coalesce(sum(total), 0) from valid),
    'avg_order',      (select coalesce(round(avg(total), 2), 0) from valid),
    'cancelled',      (select count(*) from o where status = 'cancelled'),
    'chat_orders',    (select count(*) from valid where source = 'chat'),
    'new_customers',  (select count(*) from public.customers where business_id = p_business and created_at >= p_from and created_at < p_to + 1),
    'new_leads',      (select count(*) from public.leads where business_id = p_business and created_at >= p_from and created_at < p_to + 1),
    'won_leads',      (select count(*) from public.leads where business_id = p_business and status = 'won' and created_at >= p_from and created_at < p_to + 1),
    'conversations',  (select count(*) from public.conversations where business_id = p_business and created_at >= p_from and created_at < p_to + 1),
    'by_day', (select coalesce(jsonb_agg(jsonb_build_object('day', d::date, 'orders', coalesce(x.n, 0), 'revenue', coalesce(x.r, 0)) order by d), '[]'::jsonb)
                 from generate_series(p_from, p_to, interval '1 day') d
                 left join (select created_at::date as day, count(*) n, sum(total) r from valid group by 1) x on x.day = d::date),
    'by_status', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*) n from o group by status) s),
    'lead_funnel', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
                      from (select status, count(*) n from public.leads where business_id = p_business
                             and created_at >= p_from and created_at < p_to + 1 group by status) s),
    'top_products', (select coalesce(jsonb_agg(t order by t.revenue desc), '[]'::jsonb) from (
                       select oi.name, sum(oi.quantity)::int as quantity, sum(oi.line_total) as revenue
                         from public.order_items oi join valid v on v.id = oi.order_id
                        group by oi.name order by revenue desc limit 10) t)
  ) into result;
  return result;
end $$;

-- Public, minimal business info for the chat widget (no secrets).
create or replace function public.get_public_business(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('name', name, 'slug', slug, 'bot_name', bot_name, 'bot_greeting', bot_greeting,
                            'brand_color', brand_color, 'chat_enabled', chat_enabled)
    from public.businesses where slug = lower(p_slug);
$$;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.businesses        enable row level security;
alter table public.business_members  enable row level security;
alter table public.invitations       enable row level security;
alter table public.products          enable row level security;
alter table public.knowledge_entries enable row level security;
alter table public.customers         enable row level security;
alter table public.conversations     enable row level security;
alter table public.messages          enable row level security;
alter table public.leads             enable row level security;
alter table public.orders            enable row level security;
alter table public.order_items       enable row level security;

-- profiles: yourself, and people you share a business with
create policy profiles_select on public.profiles for select to authenticated using (
  id = auth.uid() or exists (
    select 1 from public.business_members me
    join public.business_members them on them.business_id = me.business_id
    where me.user_id = auth.uid() and them.user_id = profiles.id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- businesses (insert only through create_business)
create policy businesses_select on public.businesses for select to authenticated using (public.is_member(id));
create policy businesses_update on public.businesses for update to authenticated
  using (public.has_role(id, array['owner','admin']::public.member_role[]))
  with check (public.has_role(id, array['owner','admin']::public.member_role[]));
create policy businesses_delete on public.businesses for delete to authenticated
  using (public.has_role(id, array['owner']::public.member_role[]));

-- membership (writes only through RPCs)
create policy members_select on public.business_members for select to authenticated using (public.is_member(business_id));

-- invitations
create policy invitations_select on public.invitations for select to authenticated
  using (public.has_role(business_id, array['owner','admin']::public.member_role[]));
create policy invitations_insert on public.invitations for insert to authenticated
  with check (public.has_role(business_id, array['owner','admin']::public.member_role[])
              and (role in ('agent','viewer') or public.has_role(business_id, array['owner']::public.member_role[])));
create policy invitations_delete on public.invitations for delete to authenticated
  using (public.has_role(business_id, array['owner','admin']::public.member_role[]));

-- catalogue + knowledge: everyone reads, owner/admin write
create policy products_select on public.products for select to authenticated using (public.is_member(business_id));
create policy products_write on public.products for all to authenticated
  using (public.has_role(business_id, array['owner','admin']::public.member_role[]))
  with check (public.has_role(business_id, array['owner','admin']::public.member_role[]));
create policy knowledge_select on public.knowledge_entries for select to authenticated using (public.is_member(business_id));
create policy knowledge_write on public.knowledge_entries for all to authenticated
  using (public.has_role(business_id, array['owner','admin']::public.member_role[]))
  with check (public.has_role(business_id, array['owner','admin']::public.member_role[]));

-- customers, leads, orders, order items: everyone reads, owner/admin/agent create+edit, owner/admin delete
do $$
declare t text;
begin
  foreach t in array array['customers','leads','orders','order_items'] loop
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (public.is_member(business_id))', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_role(business_id, array[''owner'',''admin'',''agent'']::public.member_role[]))', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (public.has_role(business_id, array[''owner'',''admin'',''agent'']::public.member_role[])) with check (public.has_role(business_id, array[''owner'',''admin'',''agent'']::public.member_role[]))', t);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_role(business_id, array[''owner'',''admin'']::public.member_role[]))', t);
  end loop;
end $$;

-- conversations + messages: written only by the chat Edge Function (service role)
create policy conversations_select on public.conversations for select to authenticated using (public.is_member(business_id));
create policy conversations_delete on public.conversations for delete to authenticated
  using (public.has_role(business_id, array['owner','admin']::public.member_role[]));
create policy messages_select on public.messages for select to authenticated using (public.is_member(business_id));

-- ---------------------------------------------------------------------
-- Privileges: anonymous visitors get no table access at all; they talk to
-- the chat Edge Function and may call get_public_business only.
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from public, anon;
grant execute on function public.get_public_business(text) to anon, authenticated;
grant execute on function public.is_member(uuid), public.has_role(uuid, public.member_role[]),
  public.create_business(text, text, text, text), public.accept_invitations(),
  public.set_member_role(uuid, uuid, public.member_role), public.remove_member(uuid, uuid),
  public.create_order(uuid, uuid, jsonb, text, text, public.order_status),
  public.sales_report(uuid, date, date) to authenticated;
grant execute on all functions in schema public to service_role;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Members may edit a business's profile, but never its id, slug, owner or order counter.
revoke update on public.businesses from authenticated;
grant update (name, description, industry, currency, phone, email, address, website, bot_name, bot_greeting,
              bot_instructions, bot_language, brand_color, chat_enabled) on public.businesses to authenticated;
-- Order numbers and totals are maintained by triggers only.
revoke update on public.orders from authenticated;
grant update (customer_id, status, delivery_address, notes) on public.orders to authenticated;

-- Live updates for the dashboard (Supabase Realtime), when the publication exists.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages, public.orders, public.leads;
  end if;
end $$;
-- =====================================================================
-- OrderHogaya — v2
--  • ai_mode: 'auto' (use AI, fall back to the built-in bot) or 'basic'
--    (built-in bot only: no AI service, no quota, free forever)
--  • human takeover: staff can pause the AI on a conversation and reply
--  • conversation state for the built-in bot's order / callback flows
--  • quick-reply suggestions shown in the chat
-- =====================================================================

alter table public.businesses
  add column ai_mode text not null default 'auto' check (ai_mode in ('auto', 'basic')),
  add column quick_replies text[] not null default '{}'::text[] check (cardinality(quick_replies) <= 8);

grant update (ai_mode, quick_replies) on public.businesses to authenticated;

alter table public.conversations
  add column ai_paused boolean not null default false,
  add column state jsonb not null default '{}'::jsonb,
  add column unread boolean not null default true;

revoke update on public.conversations from authenticated;
grant update (ai_paused, unread) on public.conversations to authenticated;
create policy conversations_update on public.conversations for update to authenticated
  using (public.has_role(business_id, array['owner','admin','agent']::public.member_role[]))
  with check (public.has_role(business_id, array['owner','admin','agent']::public.member_role[]));

-- Staff replies are stored as role 'agent'.
alter table public.messages drop constraint messages_role_check;
alter table public.messages add constraint messages_role_check check (role in ('user', 'assistant', 'agent'));

create policy messages_insert_agent on public.messages for insert to authenticated
  with check (role = 'agent'
              and public.has_role(business_id, array['owner','admin','agent']::public.member_role[])
              and exists (select 1 from public.conversations c where c.id = conversation_id and c.business_id = messages.business_id));

-- Keep conversation counters in one place.
create or replace function public.touch_conversation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.conversations
     set last_message_at = new.created_at,
         message_count = message_count + 1,
         unread = case when new.role = 'user' then true when new.role = 'agent' then false else unread end
   where id = new.conversation_id;
  return null;
end $$;
create trigger messages_touch after insert on public.messages
  for each row execute function public.touch_conversation();

-- Public info for the chat page now includes quick replies.
create or replace function public.get_public_business(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('name', name, 'slug', slug, 'bot_name', bot_name, 'bot_greeting', bot_greeting,
                            'brand_color', brand_color, 'chat_enabled', chat_enabled, 'phone', phone,
                            'quick_replies', quick_replies)
    from public.businesses where slug = lower(p_slug);
$$;
revoke execute on function public.get_public_business(text) from public;
grant execute on function public.get_public_business(text) to anon, authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.conversations;
  end if;
end $$;
-- =====================================================================
-- OrderHogaya — v3: keep the database small so the free plan never fills up
--  • per-business chat retention (old chats auto-deleted; orders, customers
--    and leads are always kept)
--  • abandoned one-message chats removed after 7 days
--  • daily automatic clean-up with pg_cron (built into Supabase)
--  • storage usage report for the dashboard
-- =====================================================================

alter table public.businesses
  add column chat_retention_days integer not null default 180
    check (chat_retention_days = 0 or chat_retention_days between 7 and 3650); -- 0 = keep forever
grant update (chat_retention_days) on public.businesses to authenticated;

-- Deletes old chats. Called daily by pg_cron for all businesses (p_business = null),
-- or by an owner/admin for one business from Settings.
create or replace function public.cleanup_old_data(p_business uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare old_chats integer := 0; abandoned integer := 0;
begin
  if p_business is null then
    if auth.uid() is not null then raise exception 'permission denied'; end if;   -- only the scheduler
  elsif auth.uid() is not null and not public.has_role(p_business, array['owner','admin']::public.member_role[]) then
    raise exception 'permission denied';
  end if;

  -- 1. chats older than the business's retention period
  delete from public.conversations c
   using public.businesses b
   where c.business_id = b.id
     and (p_business is null or b.id = p_business)
     and b.chat_retention_days > 0
     and c.last_message_at < now() - make_interval(days => b.chat_retention_days);
  get diagnostics old_chats = row_count;

  -- 2. abandoned chats: one exchange, no customer details, no order or lead, older than 7 days
  delete from public.conversations c
   where (p_business is null or c.business_id = p_business)
     and c.customer_id is null
     and c.message_count <= 2
     and c.last_message_at < now() - interval '7 days'
     and not exists (select 1 from public.orders o where o.conversation_id = c.id)
     and not exists (select 1 from public.leads l where l.conversation_id = c.id);
  get diagnostics abandoned = row_count;

  return jsonb_build_object('old_chats_deleted', old_chats, 'abandoned_chats_deleted', abandoned);
end $$;

-- How much space a business uses, plus the whole database size.
create or replace function public.storage_usage(p_business uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_member(p_business) then raise exception 'permission denied'; end if;
  return jsonb_build_object(
    'database_bytes', pg_database_size(current_database()),
    'business_bytes',
        coalesce((select sum(pg_column_size(m.*)) from public.messages m where m.business_id = p_business), 0)
      + coalesce((select sum(pg_column_size(c.*)) from public.conversations c where c.business_id = p_business), 0)
      + coalesce((select sum(pg_column_size(x.*)) from public.customers x where x.business_id = p_business), 0)
      + coalesce((select sum(pg_column_size(o.*)) from public.orders o where o.business_id = p_business), 0)
      + coalesce((select sum(pg_column_size(i.*)) from public.order_items i where i.business_id = p_business), 0)
      + coalesce((select sum(pg_column_size(p.*)) from public.products p where p.business_id = p_business), 0)
      + coalesce((select sum(pg_column_size(k.*)) from public.knowledge_entries k where k.business_id = p_business), 0)
      + coalesce((select sum(pg_column_size(l.*)) from public.leads l where l.business_id = p_business), 0),
    'messages_bytes', coalesce((select sum(pg_column_size(m.*)) from public.messages m where m.business_id = p_business), 0),
    'conversations', (select count(*) from public.conversations where business_id = p_business),
    'messages', (select count(*) from public.messages where business_id = p_business),
    'customers', (select count(*) from public.customers where business_id = p_business),
    'orders', (select count(*) from public.orders where business_id = p_business),
    'products', (select count(*) from public.products where business_id = p_business),
    'oldest_chat', (select min(last_message_at) from public.conversations where business_id = p_business)
  );
end $$;

revoke execute on function public.cleanup_old_data(uuid), public.storage_usage(uuid) from public, anon;
grant execute on function public.cleanup_old_data(uuid), public.storage_usage(uuid) to authenticated, service_role;

-- Daily clean-up at 03:15 UTC (pg_cron is available on every Supabase project).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname = 'orderhogaya-cleanup';
    perform cron.schedule('orderhogaya-cleanup', '15 3 * * *', 'select public.cleanup_old_data()');
  else
    raise notice 'pg_cron not available: run "select public.cleanup_old_data();" periodically, or use the Clean now button.';
  end if;
end $$;
-- =====================================================================
-- OrderHogaya — v4: voice calls in the chat
--  • voice settings per business (speed, pitch, on/off)
--  • the owner's OWN recorded voice for the greeting, FAQ answers and the
--    bot's fixed questions — played instead of the robot voice
--  • audio files live in a public Supabase Storage bucket "voice",
--    in a folder named after the business id; only owner/admin can upload
-- =====================================================================

alter table public.businesses
  add column voice_enabled boolean not null default true,
  add column voice_rate numeric(3,2) not null default 1.00 check (voice_rate between 0.5 and 2),
  add column voice_pitch numeric(3,2) not null default 1.00 check (voice_pitch between 0.5 and 2);
grant update (voice_enabled, voice_rate, voice_pitch) on public.businesses to authenticated;

create table public.voice_clips (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  -- 'greeting' | 'ask_name' | 'ask_phone' | 'ask_address' | 'lead_thanks' | 'not_understood' | 'kb:<knowledge id>'
  clip_key     text not null check (clip_key ~ '^(greeting|ask_name|ask_phone|ask_address|lead_thanks|not_understood|kb:[0-9a-f-]{36})$'),
  storage_path text not null,
  seconds      numeric(6,1) not null default 0,
  created_at   timestamptz not null default now(),
  unique (business_id, clip_key)
);
alter table public.voice_clips enable row level security;
create policy voice_select on public.voice_clips for select to authenticated using (public.is_member(business_id));
create policy voice_write on public.voice_clips for all to authenticated
  using (public.has_role(business_id, array['owner','admin']::public.member_role[]))
  with check (public.has_role(business_id, array['owner','admin']::public.member_role[])
              and storage_path like business_id::text || '/%');
grant select, insert, update, delete on public.voice_clips to authenticated;
grant all on public.voice_clips to service_role;

-- A deleted FAQ entry should not leave its recording behind in the table.
create or replace function public.delete_kb_voice()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.voice_clips where business_id = old.business_id and clip_key = 'kb:' || old.id::text;
  return old;
end $$;
create trigger knowledge_delete_voice after delete on public.knowledge_entries
  for each row execute function public.delete_kb_voice();

-- Public chat info now carries voice settings and the recorded clips.
create or replace function public.get_public_business(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('name', b.name, 'slug', b.slug, 'bot_name', b.bot_name, 'bot_greeting', b.bot_greeting,
                            'brand_color', b.brand_color, 'chat_enabled', b.chat_enabled, 'phone', b.phone,
                            'quick_replies', b.quick_replies,
                            'voice', jsonb_build_object('enabled', b.voice_enabled, 'rate', b.voice_rate, 'pitch', b.voice_pitch,
                                        'clips', coalesce((select jsonb_object_agg(v.clip_key, v.storage_path)
                                                             from public.voice_clips v where v.business_id = b.id), '{}'::jsonb)))
    from public.businesses b where b.slug = lower(p_slug);
$$;
revoke execute on function public.get_public_business(text) from public;
grant execute on function public.get_public_business(text) to anon, authenticated;

-- Storage bucket + policies (Supabase only; skipped on plain Postgres).
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('voice', 'voice', true, 2097152, array['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav'])
    on conflict (id) do nothing;

    execute $p$create policy "voice list by owner/admin" on storage.objects for select to authenticated
      using (bucket_id = 'voice' and public.has_role(((storage.foldername(name))[1])::uuid, array['owner','admin']::public.member_role[]))$p$;
    execute $p$create policy "voice upload by owner/admin" on storage.objects for insert to authenticated
      with check (bucket_id = 'voice' and public.has_role(((storage.foldername(name))[1])::uuid, array['owner','admin']::public.member_role[]))$p$;
    execute $p$create policy "voice update by owner/admin" on storage.objects for update to authenticated
      using (bucket_id = 'voice' and public.has_role(((storage.foldername(name))[1])::uuid, array['owner','admin']::public.member_role[]))$p$;
    execute $p$create policy "voice delete by owner/admin" on storage.objects for delete to authenticated
      using (bucket_id = 'voice' and public.has_role(((storage.foldername(name))[1])::uuid, array['owner','admin']::public.member_role[]))$p$;
  end if;
end $$;
-- =====================================================================
-- OrderHogaya — v5: plans, usage limits and payments
--  • plans (Free / Starter / Pro / Business) editable by the platform admin
--  • each business has a plan with an expiry date; expired → Free
--  • monthly usage counters (AI replies, chats)
--  • limits enforced in the database (products, team, voice recordings)
--    and in the chat function (AI replies → built-in bot when used up)
--  • manual payments (JazzCash / Easypaisa / bank) with transaction id +
--    screenshot, approved by the platform admin
-- =====================================================================

-- ---------------------------------------------------------------- platform admins
create table public.platform_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;
create policy platform_admins_self on public.platform_admins for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------- plans
create table public.plans (
  id                     text primary key check (id ~ '^[a-z0-9_-]{2,30}$'),
  name                   text not null,
  description            text not null default '',
  currency               text not null default 'PKR',
  price_monthly          numeric(12,2) not null default 0 check (price_monthly >= 0),
  price_yearly           numeric(12,2) not null default 0 check (price_yearly >= 0),
  ai_replies_per_month   integer check (ai_replies_per_month is null or ai_replies_per_month >= 0), -- null = unlimited
  max_products           integer check (max_products is null or max_products >= 0),
  max_members            integer check (max_members is null or max_members >= 1),
  max_voice_clips        integer check (max_voice_clips is null or max_voice_clips >= 0),
  voice_calls            boolean not null default true,
  remove_branding        boolean not null default false,
  features               text[] not null default '{}',
  sort_order             integer not null default 0,
  is_active              boolean not null default true,
  created_at             timestamptz not null default now()
);
alter table public.plans enable row level security;
create policy plans_read_public on public.plans for select to anon using (is_active);
create policy plans_read on public.plans for select to authenticated using (is_active or public.is_platform_admin());
create policy plans_admin on public.plans for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());

insert into public.plans (id, name, description, price_monthly, price_yearly, ai_replies_per_month, max_products, max_members, max_voice_clips, voice_calls, remove_branding, features, sort_order) values
 ('free',     'Free',     'Get started — unlimited chats with the built-in bot.', 0,    0,     100,  50,   2,    6,    true, false,
   array['Unlimited chats (built-in bot)', '100 AI replies / month', '50 products', '2 team members', 'Voice calls + 6 own-voice recordings'], 0),
 ('starter',  'Starter',  'For a single shop that wants smart AI answers.',    1500, 15000, 1500, 500,  5,    40,   true, true,
   array['Unlimited chats', '1,500 AI replies / month', '500 products', '5 team members', '40 own-voice recordings', 'No “Powered by” branding'], 1),
 ('pro',      'Pro',      'For busy shops and online stores.',                  4000, 40000, 6000, 5000, 15,   200,  true, true,
   array['Unlimited chats', '6,000 AI replies / month', '5,000 products', '15 team members', '200 own-voice recordings', 'No branding'], 2),
 ('business', 'Business', 'For large businesses and chains.',                  9000, 90000, null, null, null, null, true, true,
   array['Unlimited chats', 'Unlimited AI replies (fair use)', 'Unlimited products and team', 'Unlimited recordings', 'No branding', 'Priority support'], 3);

alter table public.businesses
  add column plan_id text not null default 'free' references public.plans (id),
  add column plan_expires_at timestamptz;
-- (members cannot update these columns: only the column-level grants given earlier apply)

-- Effective plan: a paid plan counts only until it expires.
create or replace function public.effective_plan(p_business uuid)
returns public.plans language sql stable security definer set search_path = public as $$
  select p.* from public.plans p
   where p.id = (select case when b.plan_expires_at is null and b.plan_id <> 'free' then b.plan_id   -- no expiry = granted forever
                             when b.plan_expires_at > now() then b.plan_id
                             else 'free' end
                   from public.businesses b where b.id = p_business);
$$;

-- ---------------------------------------------------------------- usage
create table public.usage_monthly (
  business_id uuid not null references public.businesses (id) on delete cascade,
  month       date not null,
  ai_replies  integer not null default 0,
  chats       integer not null default 0,
  primary key (business_id, month)
);
alter table public.usage_monthly enable row level security;
create policy usage_read on public.usage_monthly for select to authenticated using (public.is_member(business_id) or public.is_platform_admin());

-- Called by the chat function (service role) to count usage.
create or replace function public.bump_usage(p_business uuid, p_ai integer, p_chats integer)
returns void language sql security definer set search_path = public as $$
  insert into public.usage_monthly (business_id, month, ai_replies, chats)
  values (p_business, date_trunc('month', now())::date, p_ai, p_chats)
  on conflict (business_id, month) do update
    set ai_replies = usage_monthly.ai_replies + excluded.ai_replies,
        chats = usage_monthly.chats + excluded.chats;
$$;

-- Plan + usage summary for the Billing page and the chat function.
create or replace function public.plan_usage(p_business uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p public.plans; b public.businesses; u public.usage_monthly;
begin
  if auth.uid() is not null and not (public.is_member(p_business) or public.is_platform_admin()) then
    raise exception 'permission denied';
  end if;
  select * into b from public.businesses where id = p_business;
  p := public.effective_plan(p_business);
  select * into u from public.usage_monthly where business_id = p_business and month = date_trunc('month', now())::date;
  return jsonb_build_object(
    'plan', to_jsonb(p), 'subscribed_plan', b.plan_id, 'expires_at', b.plan_expires_at,
    'ai_replies', coalesce(u.ai_replies, 0), 'chats', coalesce(u.chats, 0),
    'products', (select count(*) from public.products where business_id = p_business),
    'members', (select count(*) from public.business_members where business_id = p_business)
             + (select count(*) from public.invitations where business_id = p_business),
    'voice_clips', (select count(*) from public.voice_clips where business_id = p_business));
end $$;

-- ---------------------------------------------------------------- limit enforcement
create or replace function public.enforce_plan_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare p public.plans; n integer;
begin
  p := public.effective_plan(new.business_id);
  if tg_table_name = 'products' and p.max_products is not null then
    select count(*) into n from public.products where business_id = new.business_id;
    if n >= p.max_products then raise exception 'plan limit: your % plan allows % products. Upgrade in Plan & Billing.', p.name, p.max_products; end if;
  elsif tg_table_name = 'invitations' and p.max_members is not null then
    select (select count(*) from public.business_members where business_id = new.business_id)
         + (select count(*) from public.invitations where business_id = new.business_id) into n;
    if n >= p.max_members then raise exception 'plan limit: your % plan allows % team members. Upgrade in Plan & Billing.', p.name, p.max_members; end if;
  elsif tg_table_name = 'voice_clips' and p.max_voice_clips is not null then
    select count(*) into n from public.voice_clips where business_id = new.business_id and clip_key <> new.clip_key;
    if n >= p.max_voice_clips then raise exception 'plan limit: your % plan allows % voice recordings. Upgrade in Plan & Billing.', p.name, p.max_voice_clips; end if;
  end if;
  return new;
end $$;
create trigger products_plan_limit before insert on public.products for each row execute function public.enforce_plan_limit();
create trigger invitations_plan_limit before insert on public.invitations for each row execute function public.enforce_plan_limit();
create trigger voice_plan_limit before insert on public.voice_clips for each row execute function public.enforce_plan_limit();

-- ---------------------------------------------------------------- payments
create table public.payment_settings (
  id            integer primary key default 1 check (id = 1),
  jazzcash      text not null default '',
  easypaisa     text not null default '',
  bank_name     text not null default '',
  account_title text not null default '',
  account_iban  text not null default '',
  instructions  text not null default 'Send the amount, then enter the transaction ID and upload a screenshot. Your plan is activated after we verify the payment (usually within a few hours).',
  updated_at    timestamptz not null default now()
);
insert into public.payment_settings (id) values (1);
alter table public.payment_settings enable row level security;
create policy payment_settings_read on public.payment_settings for select to authenticated using (true);
create policy payment_settings_admin on public.payment_settings for update to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());

create table public.payment_requests (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses (id) on delete cascade,
  plan_id         text not null references public.plans (id),
  period          text not null check (period in ('monthly', 'yearly')),
  amount          numeric(12,2) not null default 0,
  currency        text not null default 'PKR',
  method          text not null check (method in ('jazzcash', 'easypaisa', 'bank', 'other')),
  transaction_ref text not null check (char_length(transaction_ref) between 3 and 100),
  proof_path      text,
  status          text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  admin_note      text not null default '',
  created_by      uuid references auth.users (id) on delete set null default auth.uid(),
  reviewed_by     uuid references auth.users (id) on delete set null,
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now()
);
create index payment_requests_status_idx on public.payment_requests (status, created_at desc);
alter table public.payment_requests enable row level security;
create policy payments_read on public.payment_requests for select to authenticated
  using (public.has_role(business_id, array['owner','admin']::public.member_role[]) or public.is_platform_admin());
create policy payments_insert on public.payment_requests for insert to authenticated
  with check (public.has_role(business_id, array['owner','admin']::public.member_role[]));

-- The amount always comes from the plan price, never from the browser; status starts as pending.
create or replace function public.prepare_payment_request()
returns trigger language plpgsql security definer set search_path = public as $$
declare p public.plans;
begin
  select * into p from public.plans where id = new.plan_id and is_active;
  if p.id is null or p.id = 'free' then raise exception 'choose a paid plan'; end if;
  new.amount := case when new.period = 'yearly' then p.price_yearly else p.price_monthly end;
  new.currency := p.currency;
  new.status := 'pending'; new.reviewed_by := null; new.reviewed_at := null; new.admin_note := '';
  new.created_by := auth.uid();
  if new.proof_path is not null and new.proof_path not like new.business_id::text || '/%' then
    raise exception 'invalid proof file';
  end if;
  if (select count(*) from public.payment_requests where business_id = new.business_id and status = 'pending') >= 3 then
    raise exception 'you already have payments waiting for approval';
  end if;
  return new;
end $$;
create trigger payment_requests_prepare before insert on public.payment_requests
  for each row execute function public.prepare_payment_request();

-- Platform admin approves / rejects. Approval extends the plan from the later of now or the current expiry.
create or replace function public.review_payment(p_id uuid, p_approve boolean, p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
declare r public.payment_requests; b public.businesses; base timestamptz;
begin
  if not public.is_platform_admin() then raise exception 'permission denied'; end if;
  select * into r from public.payment_requests where id = p_id for update;
  if r.id is null then raise exception 'payment not found'; end if;
  if r.status <> 'pending' then raise exception 'already reviewed'; end if;
  update public.payment_requests set status = case when p_approve then 'approved' else 'rejected' end,
         admin_note = coalesce(p_note, ''), reviewed_by = auth.uid(), reviewed_at = now() where id = p_id;
  if p_approve then
    select * into b from public.businesses where id = r.business_id;
    base := case when b.plan_id = r.plan_id and b.plan_expires_at > now() then b.plan_expires_at else now() end;
    update public.businesses
       set plan_id = r.plan_id,
           plan_expires_at = base + case when r.period = 'yearly' then interval '1 year' else interval '1 month' end
     where id = r.business_id;
  end if;
end $$;

-- Platform admin can also set a plan by hand (gift, correction). p_expires null = no expiry.
create or replace function public.admin_set_plan(p_business uuid, p_plan text, p_expires timestamptz)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'permission denied'; end if;
  update public.businesses set plan_id = p_plan, plan_expires_at = case when p_plan = 'free' then null else p_expires end where id = p_business;
end $$;

-- All businesses for the platform admin panel.
create or replace function public.admin_businesses()
returns table (id uuid, name text, slug text, owner_email text, plan_id text, plan_expires_at timestamptz,
               ai_replies integer, chats integer, orders bigint, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'permission denied'; end if;
  return query
    select b.id, b.name, b.slug,
           (select pr.email from public.business_members m join public.profiles pr on pr.id = m.user_id
             where m.business_id = b.id and m.role = 'owner' limit 1),
           b.plan_id, b.plan_expires_at,
           coalesce(u.ai_replies, 0), coalesce(u.chats, 0),
           (select count(*) from public.orders o where o.business_id = b.id), b.created_at
      from public.businesses b
      left join public.usage_monthly u on u.business_id = b.id and u.month = date_trunc('month', now())::date
     order by b.created_at desc;
end $$;

-- Public chat info: voice only if the plan allows it; branding flag.
create or replace function public.get_public_business(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('name', b.name, 'slug', b.slug, 'bot_name', b.bot_name, 'bot_greeting', b.bot_greeting,
                            'brand_color', b.brand_color, 'chat_enabled', b.chat_enabled, 'phone', b.phone,
                            'quick_replies', b.quick_replies,
                            'show_branding', not (public.effective_plan(b.id)).remove_branding,
                            'voice', jsonb_build_object('enabled', b.voice_enabled and (public.effective_plan(b.id)).voice_calls,
                                        'rate', b.voice_rate, 'pitch', b.voice_pitch,
                                        'clips', coalesce((select jsonb_object_agg(v.clip_key, v.storage_path)
                                                             from public.voice_clips v where v.business_id = b.id), '{}'::jsonb)))
    from public.businesses b where b.slug = lower(p_slug);
$$;

-- ---------------------------------------------------------------- grants
revoke all on public.plans, public.platform_admins, public.usage_monthly, public.payment_settings, public.payment_requests from anon;
grant select on public.plans to anon;
grant select, insert, update, delete on public.plans, public.platform_admins, public.usage_monthly,
  public.payment_settings, public.payment_requests to authenticated;
revoke update, delete on public.payment_requests from authenticated;   -- changes only via review_payment
revoke insert, update, delete on public.usage_monthly from authenticated;
revoke insert, update, delete on public.platform_admins from authenticated;
grant all on public.plans, public.platform_admins, public.usage_monthly, public.payment_settings, public.payment_requests to service_role;

revoke execute on function public.effective_plan(uuid), public.bump_usage(uuid, integer, integer),
  public.plan_usage(uuid), public.review_payment(uuid, boolean, text), public.admin_set_plan(uuid, text, timestamptz),
  public.admin_businesses(), public.is_platform_admin(), public.get_public_business(text) from public, anon;
grant execute on function public.is_platform_admin(), public.plan_usage(uuid), public.review_payment(uuid, boolean, text),
  public.admin_set_plan(uuid, text, timestamptz), public.admin_businesses() to authenticated;
grant execute on function public.effective_plan(uuid), public.bump_usage(uuid, integer, integer), public.plan_usage(uuid) to service_role;
grant execute on function public.get_public_business(text) to anon, authenticated;
-- policies and triggers call effective_plan as their owner, so members don't need EXECUTE on it

-- ---------------------------------------------------------------- payment screenshots (private bucket)
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('payment-proofs', 'payment-proofs', false, 3145728, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
    on conflict (id) do nothing;
    execute $p$create policy "proof upload by owner/admin" on storage.objects for insert to authenticated
      with check (bucket_id = 'payment-proofs' and public.has_role(((storage.foldername(name))[1])::uuid, array['owner','admin']::public.member_role[]))$p$;
    execute $p$create policy "proof read by owner/admin or platform admin" on storage.objects for select to authenticated
      using (bucket_id = 'payment-proofs' and (public.is_platform_admin()
             or public.has_role(((storage.foldername(name))[1])::uuid, array['owner','admin']::public.member_role[])))$p$;
  end if;
end $$;
-- =====================================================================
-- OrderHogaya — v6: "Bring your own key" (BYOK)
-- Businesses on a paid plan can connect THEIR OWN Gemini and ElevenLabs
-- accounts. They pay those companies directly; the platform pays nothing.
--  • keys are write-only: no browser can ever read them back
--    (only the Edge Functions, using the service role, can)
--  • with their own Gemini key the monthly AI-reply limit does not apply
--  • with their own ElevenLabs key + voice, calls use that human-like voice
-- =====================================================================

alter table public.plans add column byok boolean not null default false;
update public.plans set byok = (id <> 'free');
update public.plans set features = features || array['Connect your own Gemini & ElevenLabs (unlimited AI, cloned voice)']
 where id <> 'free' and not ('Connect your own Gemini & ElevenLabs (unlimited AI, cloned voice)' = any (features));

create table public.business_secrets (
  business_id        uuid primary key references public.businesses (id) on delete cascade,
  gemini_api_key     text not null default '',
  elevenlabs_api_key text not null default '',
  elevenlabs_voice_id   text not null default '',
  elevenlabs_voice_name text not null default '',
  elevenlabs_model   text not null default 'eleven_v3',
  updated_at         timestamptz not null default now()
);
alter table public.business_secrets enable row level security;
-- No policies and no privileges for browser roles: write-only through the "byok" Edge Function.
revoke all on public.business_secrets from anon, authenticated;
grant all on public.business_secrets to service_role;

-- Safe status for the dashboard (never returns the keys themselves).
create or replace function public.byok_status(p_business uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.business_secrets;
begin
  if not public.is_member(p_business) then raise exception 'permission denied'; end if;
  select * into s from public.business_secrets where business_id = p_business;
  return jsonb_build_object(
    'allowed', (public.effective_plan(p_business)).byok,
    'gemini', coalesce(s.gemini_api_key, '') <> '',
    'gemini_hint', case when coalesce(s.gemini_api_key, '') <> '' then '…' || right(s.gemini_api_key, 4) else '' end,
    'elevenlabs', coalesce(s.elevenlabs_api_key, '') <> '',
    'elevenlabs_hint', case when coalesce(s.elevenlabs_api_key, '') <> '' then '…' || right(s.elevenlabs_api_key, 4) else '' end,
    'voice_id', coalesce(s.elevenlabs_voice_id, ''), 'voice_name', coalesce(s.elevenlabs_voice_name, ''),
    'model', coalesce(s.elevenlabs_model, 'eleven_v3'));
end $$;
revoke execute on function public.byok_status(uuid) from public, anon;
grant execute on function public.byok_status(uuid) to authenticated;

-- Public chat info: tell the call screen whether a premium (ElevenLabs) voice is ready.
create or replace function public.get_public_business(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('name', b.name, 'slug', b.slug, 'bot_name', b.bot_name, 'bot_greeting', b.bot_greeting,
                            'brand_color', b.brand_color, 'chat_enabled', b.chat_enabled, 'phone', b.phone,
                            'quick_replies', b.quick_replies,
                            'show_branding', not (public.effective_plan(b.id)).remove_branding,
                            'voice', jsonb_build_object('enabled', b.voice_enabled and (public.effective_plan(b.id)).voice_calls,
                                        'rate', b.voice_rate, 'pitch', b.voice_pitch,
                                        'premium', (public.effective_plan(b.id)).byok and exists (
                                            select 1 from public.business_secrets s where s.business_id = b.id
                                              and s.elevenlabs_api_key <> '' and s.elevenlabs_voice_id <> ''),
                                        'clips', coalesce((select jsonb_object_agg(v.clip_key, v.storage_path)
                                                             from public.voice_clips v where v.business_id = b.id), '{}'::jsonb)))
    from public.businesses b where b.slug = lower(p_slug);
$$;
revoke execute on function public.get_public_business(text) from public;
grant execute on function public.get_public_business(text) to anon, authenticated;
