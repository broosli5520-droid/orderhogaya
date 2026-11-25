import { useRef, useState } from "react";
import { Check, Circle, Mic, Play, Square, Trash2, Volume2 } from "lucide-react";
import { supabase, errorMessage } from "../../lib/supabase";
import { useAsync, must } from "../../lib/useAsync";
import { can } from "../../lib/permissions";
import { hasVoiceFor, playUrl, speak, voiceSupport, warmUpVoices } from "../../lib/voice";
import type { KnowledgeEntry } from "../../lib/types";
import { useBusiness } from "../../contexts/BusinessContext";
import PremiumVoice from "../../components/PremiumVoice";
import { Badge, Button, Card, ErrorBox, PageHeader, Spinner, confirmAction, useToast } from "../../components/ui";

interface Clip { id: string; clip_key: string; storage_path: string; seconds: number }

const FIXED: { key: string; title: string; script: string }[] = [
  { key: "greeting", title: "Greeting (call starts)", script: "السلام علیکم! [دکان کا نام] میں خوش آمدید۔ میں آپ کی کیا مدد کر سکتا ہوں؟" },
  { key: "ask_name", title: "Asking the customer's name", script: "بہت اچھا! آرڈر کے لیے آپ کا نام بتا دیں۔" },
  { key: "ask_phone", title: "Asking for phone number", script: "شکریہ۔ اب اپنا فون نمبر بتا دیں۔" },
  { key: "ask_address", title: "Asking for delivery address", script: "ڈلیوری کا پتہ بتا دیں۔ اگر خود لینے آئیں گے تو پک اپ کہہ دیں۔" },
  { key: "lead_thanks", title: "After saving a call-back request", script: "بہت شکریہ! ہماری ٹیم جلد آپ کو کال کرے گی۔" },
  { key: "not_understood", title: "When the bot did not understand", script: "معذرت، میں سمجھ نہیں سکا۔ آپ چیزوں کی لسٹ، قیمت یا آرڈر کے بارے میں پوچھ سکتے ہیں۔" },
];
const MAX_SECONDS = 40;

function pickMime(): { mime: string; ext: string } {
  const MR = window.MediaRecorder;
  if (MR?.isTypeSupported?.("audio/webm;codecs=opus")) return { mime: "audio/webm;codecs=opus", ext: "webm" };
  if (MR?.isTypeSupported?.("audio/mp4")) return { mime: "audio/mp4", ext: "m4a" };
  return { mime: "", ext: "webm" };
}

export default function Voice() {
  const { business, role, refresh } = useBusiness();
  const toast = useToast();
  const admin = can(role, "manageSettings");
  const [enabled, setEnabled] = useState(business.voice_enabled ?? true);
  const [rate, setRate] = useState(Number(business.voice_rate ?? 1));
  const [pitch, setPitch] = useState(Number(business.voice_pitch ?? 1));
  const [saving, setSaving] = useState(false);

  const { data, loading, error, reload } = useAsync(async () => {
    const [clips, kb] = await Promise.all([
      supabase.from("voice_clips").select("id, clip_key, storage_path, seconds").eq("business_id", business.id),
      supabase.from("knowledge_entries").select("id, question, answer").eq("business_id", business.id).order("created_at"),
    ]);
    return { clips: must(clips) as Clip[], kb: must(kb) as KnowledgeEntry[] };
  }, [business.id]);

  async function saveSettings() {
    setSaving(true);
    const { error } = await supabase.from("businesses").update({ voice_enabled: enabled, voice_rate: rate, voice_pitch: pitch }).eq("id", business.id);
    setSaving(false);
    if (error) toast("error", errorMessage(error)); else { toast("success", "Voice settings saved"); await refresh(); }
  }

  const rows = [
    ...FIXED,
    ...(data?.kb ?? []).map((k) => ({ key: `kb:${k.id}`, title: `FAQ: ${k.question}`, script: k.answer })),
  ];
  const recorded = (key: string) => data?.clips.find((c) => c.clip_key === key);

  return (
    <>
      <PageHeader title="Voice & Calls" subtitle="Customers can tap “Call” in the chat and talk. Free — it runs in the customer's browser." />

      <Card className="p-5">
        <h2 className="mb-3 font-semibold">Voice call settings</h2>
        <fieldset disabled={!admin} className="space-y-4">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Show the “Call” button in the chat</label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm">Speaking speed: <b>{rate.toFixed(2)}×</b>
              <input type="range" min="0.6" max="1.4" step="0.05" value={rate} onChange={(e) => setRate(Number(e.target.value))} className="w-full" /></label>
            <label className="text-sm">Voice pitch: <b>{pitch.toFixed(2)}</b>
              <input type="range" min="0.6" max="1.4" step="0.05" value={pitch} onChange={(e) => setPitch(Number(e.target.value))} className="w-full" /></label>
          </div>
        </fieldset>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => { warmUpVoices(); void speak("السلام علیکم! آپ کا آرڈر ہو گیا ہے۔ شکریہ۔", "ur-PK", rate, pitch).promise; }}><Volume2 className="h-4 w-4" />Test Urdu voice</Button>
          <Button variant="secondary" onClick={() => { warmUpVoices(); void speak("Hello! Your order has been placed. Thank you.", "en-US", rate, pitch).promise; }}><Volume2 className="h-4 w-4" />Test English voice</Button>
          {admin && <Button onClick={saveSettings} loading={saving}>Save</Button>}
        </div>
        <p className="mt-3 text-xs text-slate-500">
          On this device: Urdu voice {hasVoiceFor("ur-PK") ? "available" : "not installed"} · English voice {hasVoiceFor("en-US") ? "available" : "not installed"}.
          Customers without an Urdu voice will see the reply as text — your own recordings below always play.
        </p>
      </Card>

      <PremiumVoice />

      <Card className="mt-6 p-5">
        <h2 className="font-semibold">Answer in your own voice</h2>
        <p className="mt-1 text-sm text-slate-600">
          Record the greeting, the bot's questions and your FAQ answers once. During calls the customer hears <b>your real voice</b> for these —
          100% human, no AI voice service, no cost. Anything not recorded is read by the device voice.
        </p>
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Record only your own voice, or someone's voice with their clear permission.</p>
        {!voiceSupport.record && <p className="mt-3 text-sm text-red-600">This browser cannot record audio. Use Chrome, Edge or a recent Safari.</p>}
        {loading ? <Spinner /> : error ? <div className="mt-4"><ErrorBox message={error} onRetry={reload} /></div> : (
          <div className="mt-4 divide-y divide-slate-100">
            {rows.map((r) => (
              <ClipRow key={r.key} clipKey={r.key} title={r.title} script={r.script} existing={recorded(r.key)}
                businessId={business.id} canEdit={admin && voiceSupport.record} onChanged={reload} />
            ))}
            {!data?.kb.length && <p className="py-3 text-sm text-slate-500">Add FAQ entries under Chatbot Knowledge to record answers for them too.</p>}
          </div>
        )}
      </Card>
    </>
  );
}

function ClipRow({ clipKey, title, script, existing, businessId, canEdit, onChanged }: {
  clipKey: string; title: string; script: string; existing?: Clip; businessId: string; canEdit: boolean; onChanged: () => void;
}) {
  const toast = useToast();
  const [rec, setRec] = useState<{ blob: Blob; url: string; seconds: number; mime: string; ext: string } | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const mr = useRef<MediaRecorder | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const publicUrl = existing ? supabase.storage.from("voice").getPublicUrl(existing.storage_path).data.publicUrl : null;

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const { mime, ext } = pickMime();
      const r = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
      const chunks: Blob[] = [];
      const began = Date.now();
      r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        window.clearInterval(timer.current);
        const type = (r.mimeType || mime || "audio/webm").split(";")[0];
        const blob = new Blob(chunks, { type });
        setRec({ blob, url: URL.createObjectURL(blob), seconds: Math.round((Date.now() - began) / 100) / 10, mime: type, ext: type.includes("mp4") ? "m4a" : ext });
        setRecording(false);
      };
      mr.current = r;
      r.start();
      setRecording(true); setElapsed(0);
      timer.current = window.setInterval(() => setElapsed((s) => {
        if (s + 1 >= MAX_SECONDS) r.stop();
        return s + 1;
      }), 1000);
    } catch {
      toast("error", "Microphone permission is needed to record.");
    }
  }

  async function save() {
    if (!rec) return;
    setBusy(true);
    try {
      const path = `${businessId}/${clipKey.replace(":", "-")}-${Date.now()}.${rec.ext}`;
      const up = await supabase.storage.from("voice").upload(path, rec.blob, { contentType: rec.mime, upsert: false });
      if (up.error) throw up.error;
      const { error } = await supabase.from("voice_clips").upsert(
        { business_id: businessId, clip_key: clipKey, storage_path: path, seconds: rec.seconds }, { onConflict: "business_id,clip_key" });
      if (error) { await supabase.storage.from("voice").remove([path]); throw error; }
      if (existing) await supabase.storage.from("voice").remove([existing.storage_path]);
      setRec(null); toast("success", "Recording saved"); onChanged();
    } catch (e) { toast("error", errorMessage(e)); } finally { setBusy(false); }
  }

  async function remove() {
    if (!existing || !confirmAction("Delete this recording? The device voice will be used instead.")) return;
    setBusy(true);
    const { error } = await supabase.from("voice_clips").delete().eq("id", existing.id);
    if (!error) await supabase.storage.from("voice").remove([existing.storage_path]);
    setBusy(false);
    if (error) toast("error", errorMessage(error)); else onChanged();
  }

  return (
    <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 font-medium">
          {existing ? <Check className="h-4 w-4 text-emerald-600" /> : <Circle className="h-4 w-4 text-slate-300" />}{title}
          {existing && <Badge color="green">{existing.seconds}s</Badge>}
        </div>
        <p className="urdu-aware mt-1 text-sm text-slate-500" dir="auto">Say something like: “{script}”</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {existing && !rec && <Button variant="secondary" onClick={() => publicUrl && void playUrl(publicUrl).promise}><Play className="h-4 w-4" />Play</Button>}
        {canEdit && !recording && !rec && <Button variant="secondary" onClick={start}><Mic className="h-4 w-4" />{existing ? "Re-record" : "Record"}</Button>}
        {recording && <Button variant="danger" onClick={() => mr.current?.stop()}><Square className="h-4 w-4" />Stop ({elapsed}s / {MAX_SECONDS}s)</Button>}
        {rec && <>
          <audio src={rec.url} controls className="h-9" />
          <Button onClick={save} loading={busy}>Save</Button>
          <Button variant="ghost" onClick={() => setRec(null)}>Discard</Button>
        </>}
        {canEdit && existing && !rec && !recording && <button onClick={remove} disabled={busy} className="rounded p-1.5 text-red-500 hover:bg-red-50" title="Delete"><Trash2 className="h-4 w-4" /></button>}
      </div>
    </div>
  );
}
