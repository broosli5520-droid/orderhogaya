// OrderHogaya — "Bring your own key" management (Supabase Edge Function, Deno).
// Owners/admins on a paid plan connect THEIR OWN Gemini / ElevenLabs accounts.
// Keys are validated against the provider, stored server-side, and never returned.
//
// Called by signed-in users only (JWT verified by Supabase). Actions:
//   status | save { gemini?, elevenlabs? } | voices | set_voice { voiceId, voiceName, model } | clone (multipart)

import { createClient } from "jsr:@supabase/supabase-js@2";

// Works with both the legacy keys and the new API keys (sb_secret_… / sb_publishable_…).
function envKey(legacy: string, json: string): string {
  const v = Deno.env.get(legacy);
  if (v) return v;
  try { const d = JSON.parse(Deno.env.get(json) ?? "{}"); return String(Object.values(d)[0] ?? ""); } catch { return ""; }
}


const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = envKey("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEYS");
const ANON_KEY = envKey("SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEYS");
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const EL = "https://api.elevenlabs.io";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function checkGemini(key: string): Promise<boolean> {
  const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", { headers: { "x-goog-api-key": key } });
  return r.ok;
}
async function checkEleven(key: string): Promise<boolean> {
  const r = await fetch(`${EL}/v1/voices`, { headers: { "xi-api-key": key } });
  return r.ok;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Who is calling?
  const authed = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: { user } } = await authed.auth.getUser();
  if (!user) return json({ error: "Please sign in again." }, 401);

  const isForm = (req.headers.get("content-type") ?? "").includes("multipart/form-data");
  const form = isForm ? await req.formData() : null;
  const body: Record<string, unknown> = form ? Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")) : await req.json().catch(() => ({}));
  const businessId = String(body.businessId ?? "");
  const action = String(body.action ?? (isForm ? "clone" : "status"));

  const { data: member } = await db.from("business_members").select("role").eq("business_id", businessId).eq("user_id", user.id).maybeSingle();
  if (!member || !["owner", "admin"].includes(member.role)) return json({ error: "Only the owner or an admin can manage connected accounts." }, 403);
  const { data: plan } = await db.rpc("effective_plan", { p_business: businessId });
  if (!(plan as { byok?: boolean } | null)?.byok) return json({ error: "Connecting your own accounts is available on paid plans. Upgrade in Plan & Billing." }, 402);

  const { data: existing } = await db.from("business_secrets").select("*").eq("business_id", businessId).maybeSingle();
  const secrets = existing ?? { business_id: businessId, gemini_api_key: "", elevenlabs_api_key: "", elevenlabs_voice_id: "", elevenlabs_voice_name: "", elevenlabs_model: "eleven_v3" };
  const save = async (patch: Record<string, string>) => {
    const { error } = await db.from("business_secrets").upsert({ ...secrets, ...patch, updated_at: new Date().toISOString() });
    if (error) throw error;
  };

  try {
    if (action === "save") {
      const patch: Record<string, string> = {};
      if (typeof body.gemini === "string") {
        const k = body.gemini.trim();
        if (k && !(await checkGemini(k))) return json({ error: "Google rejected this Gemini key. Copy it again from aistudio.google.com/apikey." }, 400);
        patch.gemini_api_key = k;
      }
      if (typeof body.elevenlabs === "string") {
        const k = body.elevenlabs.trim();
        if (k && !(await checkEleven(k))) return json({ error: "ElevenLabs rejected this key (it needs Voices read/write and Text-to-Speech permission)." }, 400);
        patch.elevenlabs_api_key = k;
        if (!k) { patch.elevenlabs_voice_id = ""; patch.elevenlabs_voice_name = ""; }
      }
      await save(patch);
      return json({ ok: true });
    }

    if (!secrets.elevenlabs_api_key) return json({ error: "Connect your ElevenLabs key first." }, 400);
    const xi = { "xi-api-key": secrets.elevenlabs_api_key };

    if (action === "voices") {
      const r = await fetch(`${EL}/v1/voices`, { headers: xi });
      if (!r.ok) return json({ error: "Could not load voices from ElevenLabs." }, 502);
      const d = await r.json();
      return json({ voices: (d.voices ?? []).map((v: { voice_id: string; name: string; category?: string }) => ({ id: v.voice_id, name: v.name, category: v.category ?? "" })) });
    }

    if (action === "set_voice") {
      const model = ["eleven_v3", "eleven_multilingual_v2", "eleven_flash_v2_5"].includes(String(body.model)) ? String(body.model) : "eleven_v3";
      await save({ elevenlabs_voice_id: String(body.voiceId ?? "").slice(0, 64), elevenlabs_voice_name: String(body.voiceName ?? "").slice(0, 100), elevenlabs_model: model });
      return json({ ok: true });
    }

    if (action === "clone" && form) {
      if (String(form.get("consent")) !== "true") return json({ error: "Please confirm this is your own voice or that you have the speaker's permission." }, 400);
      const files = form.getAll("files").filter((f): f is File => f instanceof File);
      if (!files.length) return json({ error: "Add at least one recording (1–3 minutes of clear speech works best)." }, 400);
      const out = new FormData();
      out.append("name", String(form.get("name") || "My shop voice").slice(0, 80));
      out.append("description", "Cloned with the speaker's consent via OrderHogaya");
      out.append("remove_background_noise", "true");
      files.slice(0, 5).forEach((f, i) => out.append("files", f, f.name || `sample-${i}.webm`));
      const r = await fetch(`${EL}/v1/voices/add`, { method: "POST", headers: xi, body: out });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = (d?.detail?.message ?? d?.detail ?? "ElevenLabs could not clone this voice.") as string;
        return json({ error: typeof msg === "string" ? msg : "ElevenLabs could not clone this voice (your ElevenLabs plan may not include voice cloning)." }, 400);
      }
      await save({ elevenlabs_voice_id: d.voice_id, elevenlabs_voice_name: String(form.get("name") || "My shop voice"), elevenlabs_model: "eleven_v3" });
      return json({ ok: true, voiceId: d.voice_id });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("byok failed", e);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
