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
