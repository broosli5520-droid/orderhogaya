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
