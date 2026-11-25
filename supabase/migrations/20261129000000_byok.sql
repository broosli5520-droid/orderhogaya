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
