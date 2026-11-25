import { useRef, useState } from "react";
import { Mic, Sparkles, Square, Upload } from "lucide-react";
import { supabase } from "../lib/supabase";
import { can } from "../lib/permissions";
import { useBusiness } from "../contexts/BusinessContext";
import { fnError, useByok } from "./ConnectedAccounts";
import { Badge, Button, Card, Field, Input, Select, Spinner, useToast } from "./ui";

/** ElevenLabs voice for calls using the business's own account: pick a voice or clone your own (with consent). */
export default function PremiumVoice() {
  const { business, role } = useBusiness();
  const toast = useToast();
  const admin = can(role, "manageSettings");
  const { data: st, loading, reload } = useByok();
  const [voices, setVoices] = useState<{ id: string; name: string; category: string }[] | null>(null);
  const [pick, setPick] = useState("");
  const [model, setModel] = useState("eleven_v3");
  const [name, setName] = useState(`${business.name} voice`);
  const [files, setFiles] = useState<File[]>([]);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [secs, setSecs] = useState(0);
  const mr = useRef<MediaRecorder | null>(null);
  const timer = useRef<number | undefined>(undefined);

  async function call(body: Record<string, unknown> | FormData, key: string) {
    setBusy(key);
    const { data, error } = await supabase.functions.invoke("byok", { body });
    setBusy(null);
    if (error || data?.error) { toast("error", await fnError(error, data)); return null; }
    return data;
  }
  async function loadVoices() {
    const d = await call({ action: "voices", businessId: business.id }, "voices");
    if (d) { setVoices(d.voices); setPick(st?.voice_id || d.voices[0]?.id || ""); setModel(st?.model || "eleven_v3"); }
  }
  async function useVoice() {
    const v = voices?.find((x) => x.id === pick);
    if (await call({ action: "set_voice", businessId: business.id, voiceId: pick, voiceName: v?.name ?? "", model }, "set")) { toast("success", "Call voice updated"); void reload(); }
  }
  async function record() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const r = new MediaRecorder(stream); const chunks: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop()); window.clearInterval(timer.current); setRecording(false);
        const type = (r.mimeType || "audio/webm").split(";")[0];
        setFiles((f) => [...f, new File([new Blob(chunks, { type })], `sample-${f.length + 1}.${type.includes("mp4") ? "m4a" : "webm"}`, { type })]);
      };
      mr.current = r; r.start(); setRecording(true); setSecs(0);
      timer.current = window.setInterval(() => setSecs((s) => { if (s + 1 >= 180) r.stop(); return s + 1; }), 1000);
    } catch { toast("error", "Microphone permission is needed."); }
  }
  async function clone() {
    const fd = new FormData();
    fd.append("action", "clone"); fd.append("businessId", business.id); fd.append("name", name); fd.append("consent", String(consent));
    files.forEach((f) => fd.append("files", f, f.name));
    if (await call(fd, "clone")) { toast("success", "Your voice is ready for calls"); setFiles([]); setConsent(false); void reload(); }
  }

  if (loading) return <Spinner />;
  if (!st?.allowed || !st.elevenlabs) {
    return (
      <Card className="mt-6 p-5">
        <h2 className="flex items-center gap-2 font-semibold"><Sparkles className="h-4 w-4 text-amber-500" />Premium human voice (optional)</h2>
        <p className="mt-1 text-sm text-slate-600">On paid plans, connect your own ElevenLabs account in <b>Settings → Connect your own AI accounts</b>. The bot can then speak every reply — prices, order numbers, everything — in a natural voice or a clone of your voice. ElevenLabs bills you directly.</p>
      </Card>
    );
  }
  return (
    <Card className="mt-6 p-5">
      <h2 className="flex items-center gap-2 font-semibold"><Sparkles className="h-4 w-4 text-amber-500" />Premium human voice (ElevenLabs)</h2>
      <p className="mt-1 text-sm text-slate-600">Current call voice: {st.voice_id ? <Badge color="green">{st.voice_name || st.voice_id} · {st.model}</Badge> : <Badge color="amber">none selected</Badge>}. Your own recordings still play first; everything else uses this voice. Urdu needs the <b>eleven_v3</b> model.</p>
      {admin && (
        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 p-4">
            <h3 className="font-medium">Use a voice from your ElevenLabs library</h3>
            {!voices ? <Button variant="secondary" className="mt-3" loading={busy === "voices"} onClick={loadVoices}>Load my voices</Button> : (
              <div className="mt-3 space-y-3">
                <Field label="Voice"><Select value={pick} onChange={(e) => setPick(e.target.value)}>{voices.map((v) => <option key={v.id} value={v.id}>{v.name}{v.category ? ` (${v.category})` : ""}</option>)}</Select></Field>
                <Field label="Model"><Select value={model} onChange={(e) => setModel(e.target.value)}>
                  <option value="eleven_v3">eleven_v3 — best, supports Urdu</option>
                  <option value="eleven_multilingual_v2">eleven_multilingual_v2 — English & 28 others</option>
                  <option value="eleven_flash_v2_5">eleven_flash_v2_5 — fastest, cheaper</option>
                </Select></Field>
                <Button disabled={!pick} loading={busy === "set"} onClick={useVoice}>Use this voice</Button>
              </div>
            )}
          </div>
          <div className="rounded-xl border border-slate-200 p-4">
            <h3 className="font-medium">Clone your own voice</h3>
            <p className="mt-1 text-xs text-slate-500">Record or upload 1–3 minutes of clear speech in a quiet room. Your ElevenLabs plan must include voice cloning.</p>
            <Field label="Voice name" className="mt-3"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <div className="mt-3 flex flex-wrap gap-2">
              {recording ? <Button variant="danger" onClick={() => mr.current?.stop()}><Square className="h-4 w-4" />Stop ({secs}s)</Button>
                : <Button variant="secondary" onClick={record}><Mic className="h-4 w-4" />Record sample</Button>}
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm"><Upload className="h-4 w-4" />Upload audio
                <input type="file" accept="audio/*" multiple className="hidden" onChange={(e) => setFiles((f) => [...f, ...Array.from((e.target.files ?? []) as ArrayLike<File>)])} /></label>
            </div>
            {files.length > 0 && <p className="mt-2 text-xs text-slate-600">{files.length} sample(s): {files.map((f) => f.name).join(", ")} <button className="text-red-600" onClick={() => setFiles([])}>clear</button></p>}
            <label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              This is my own voice, or I have the speaker's clear permission to clone it.</label>
            <Button className="mt-3" disabled={!files.length || !consent} loading={busy === "clone"} onClick={clone}>Clone voice</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
