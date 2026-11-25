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
