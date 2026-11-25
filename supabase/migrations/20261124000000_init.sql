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
