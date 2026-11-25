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
