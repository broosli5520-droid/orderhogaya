// OrderHogaya — premium voice for calls (Supabase Edge Function, Deno).
// Speaks a bot reply with the business's OWN ElevenLabs account and voice (BYOK).
// The platform pays nothing: usage is billed by ElevenLabs to the business.
// Deploy with: supabase functions deploy tts --no-verify-jwt   (website visitors are anonymous)

import { createClient } from "jsr:@supabase/supabase-js@2";

// Works with both the legacy keys and the new API keys (sb_secret_… / sb_publishable_…).
function envKey(legacy: string, json: string): string {
  const v = Deno.env.get(legacy);
  if (v) return v;
  try { const d = JSON.parse(Deno.env.get(json) ?? "{}"); return String(Object.values(d)[0] ?? ""); } catch { return ""; }
}


const db = createClient(Deno.env.get("SUPABASE_URL")!, envKey("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEYS"), { auth: { persistSession: false } });
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const fail = (error: string, status: number) => new Response(JSON.stringify({ error }), { status, headers: { ...cors, "Content-Type": "application/json" } });
const isUuid = (s: unknown) => typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("Method not allowed", 405);
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const slug = String(body.slug ?? "").toLowerCase().slice(0, 60);
  const visitorId = String(body.visitorId ?? "").slice(0, 64);
  const text = String(body.text ?? "").trim().slice(0, 1200);
  if (!slug || !text || !isUuid(body.conversationId)) return fail("Bad request", 400);

  const { data: biz } = await db.from("businesses").select("id").eq("slug", slug).maybeSingle();
  if (!biz) return fail("Not found", 404);
  // Only for a real conversation of this visitor — stops strangers from spending the shop's ElevenLabs credits.
  const { data: conv } = await db.from("conversations").select("id, message_count")
    .eq("id", body.conversationId).eq("business_id", biz.id).eq("visitor_id", visitorId).maybeSingle();
  if (!conv) return fail("Not found", 404);
  const { data: plan } = await db.rpc("effective_plan", { p_business: biz.id });
  if (!(plan as { byok?: boolean } | null)?.byok) return fail("Premium voice needs a paid plan", 402);
  const { data: s } = await db.from("business_secrets").select("elevenlabs_api_key, elevenlabs_voice_id, elevenlabs_model").eq("business_id", biz.id).maybeSingle();
  if (!s?.elevenlabs_api_key || !s.elevenlabs_voice_id) return fail("Premium voice not set up", 404);

  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(s.elevenlabs_voice_id)}?output_format=mp3_44100_64`, {
    method: "POST",
    headers: { "xi-api-key": s.elevenlabs_api_key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: s.elevenlabs_model || "eleven_v3" }),
  });
  if (!r.ok || !r.body) {
    console.error("ElevenLabs TTS failed", r.status, (await r.text().catch(() => "")).slice(0, 300));
    return fail("Voice service unavailable", 502); // the call screen falls back to the free device voice
  }
  return new Response(r.body, { headers: { ...cors, "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
});
