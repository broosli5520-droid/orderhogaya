import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, PhoneOff, Volume2 } from "lucide-react";
import { hasVoiceFor, listenOnce, playUrl, speak, voiceSupport, type CallLang } from "../lib/voice";
import { isRtl } from "../lib/format";
import { BRAND } from "../lib/brand";

export interface CallReply { text: string; voiceUrl?: string | null; human?: boolean }
type Phase = "ringing" | "connected" | "ended";
type Activity = "speaking" | "listening" | "thinking" | "muted";

// ---------------------------------------------------------------- phone sounds (Web Audio, no files)
function tone(ctx: AudioContext, freqs: number[], start: number, dur: number, vol = 0.08) {
  freqs.forEach((f) => {
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0, ctx.currentTime + start);
    g.gain.linearRampToValueAtTime(vol, ctx.currentTime + start + 0.03);
    g.gain.setValueAtTime(vol, ctx.currentTime + start + dur - 0.05);
    g.gain.linearRampToValueAtTime(0, ctx.currentTime + start + dur);
    o.start(ctx.currentTime + start); o.stop(ctx.currentTime + start + dur);
  });
}
/** Classic ring-back tone: two rings, then a "connected" click. */
function ringBack(): Promise<void> {
  try {
    const ctx = new AudioContext();
    tone(ctx, [440, 480], 0, 1.0); tone(ctx, [440, 480], 1.6, 1.0);
    tone(ctx, [880], 2.9, 0.08, 0.05);
    return new Promise((r) => setTimeout(() => { void ctx.close(); r(); }, 3100));
  } catch { return new Promise((r) => setTimeout(r, 1500)); }
}
function hangUpTone() {
  try { const ctx = new AudioContext(); tone(ctx, [480, 620], 0, 0.25, 0.06); tone(ctx, [480, 620], 0.35, 0.25, 0.06); setTimeout(() => void ctx.close(), 900); } catch { /* ignore */ }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

/**
 * Full-screen phone-call experience with the sales bot, entirely in the browser (free):
 * ringing → connected (timer) → greeting → listen → reply in the owner's recorded voice or the device voice → …
 */
export default function VoiceCall({ color, botName, businessName, greeting, greetingUrl, rate, pitch, onSend, onClose, premiumSpeak }: {
  color: string; botName: string; businessName: string; greeting: string; greetingUrl?: string | null; rate: number; pitch: number;
  onSend: (text: string) => Promise<CallReply | null>; onClose: () => void;
  /** Optional ElevenLabs voice (business's own account). Returns an audio URL, or null to use the free device voice. */
  premiumSpeak?: (text: string) => Promise<string | null>;
}) {
  const [phase, setPhase] = useState<Phase>("ringing");
  const [activity, setActivity] = useState<Activity>("speaking");
  const [lang, setLang] = useState<CallLang>("ur-PK");
  const [seconds, setSeconds] = useState(0);
  const [caption, setCaption] = useState("");
  const [muted, setMuted] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const active = useRef(true);
  const ended = useRef(false);
  const stopper = useRef<() => void>(() => {});
  const langRef = useRef(lang); langRef.current = lang;
  const mutedRef = useRef(muted); mutedRef.current = muted;
  const sendRef = useRef(onSend); sendRef.current = onSend; // latest send knows the current conversation

  useEffect(() => {
    if (phase !== "connected") return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  async function say(text: string, url?: string | null) {
    setActivity("speaking"); setCaption(text);
    const replyLang: CallLang = isRtl(text) ? "ur-PK" : "en-US";
    if (!url && premiumSpeak) url = await premiumSpeak(text).catch(() => null);
    if (!active.current) return;
    if (url) { const p = playUrl(url); stopper.current = p.stop; await p.promise; }
    else if (hasVoiceFor(replyLang)) { const s = speak(text, replyLang, rate, pitch); stopper.current = s.stop; await s.promise; }
    else await sleep(Math.min(8000, 1200 + text.length * 45)); // no voice installed: time to read the caption
  }

  function finish() {
    if (ended.current) return;
    ended.current = true; active.current = false; stopper.current();
    hangUpTone();
    setPhase("ended");
    setTimeout(onClose, 1800);
  }

  async function conversation() {
    while (active.current) {
      if (mutedRef.current) { setActivity("muted"); await sleep(400); continue; }
      setActivity("listening"); setCaption("");
      let text = "";
      try {
        const l = listenOnce(langRef.current, (t) => setCaption(t)); stopper.current = l.stop;
        text = await l.promise;
      } catch (e) {
        setProblem(e instanceof Error && e.message === "not-allowed"
          ? "Microphone permission is blocked. Allow the microphone for this site and call again."
          : "The call lost voice recognition. Check your internet connection and call again.");
        finish(); return;
      }
      if (!active.current) return;
      if (!text) continue; // silence — keep listening, like a person waiting
      setActivity("thinking");
      const [reply] = await Promise.all([sendRef.current(text), sleep(400 + Math.random() * 400)]); // a natural pause before answering
      if (!active.current) return;
      if (!reply) { await say(langRef.current === "ur-PK" ? "معاف کیجیے، آواز صاف نہیں آئی، دوبارہ بتائیں؟" : "Sorry, I didn't catch that. Could you say it again?"); continue; }
      await say(reply.text, reply.voiceUrl);
      if (reply.human) { finish(); return; }
    }
  }

  useEffect(() => {
    active.current = true; ended.current = false;
    try { navigator.vibrate?.([200, 100, 200]); } catch { /* not supported */ }
    (async () => {
      await ringBack();
      if (!active.current) return;
      setPhase("connected");
      await sleep(300);
      await say(greeting, greetingUrl);
      if (active.current) await conversation();
    })();
    return () => { active.current = false; stopper.current(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initials = businessName.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const activityText = { speaking: "Speaking", listening: "Listening…", thinking: "…", muted: "You are muted" }[activity];

  if (!voiceSupport.listen) {
    return (
      <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-slate-900 p-6 text-center text-white">
        <p>Voice calls work in Google Chrome or Microsoft Edge. Please open this chat there, or keep typing.</p>
        <button onClick={onClose} className="rounded-full px-6 py-2" style={{ background: color }}>OK</button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-between overflow-hidden bg-gradient-to-b from-slate-900 via-slate-900 to-black px-6 py-10 text-white">
      <div className="flex w-full flex-col items-center">
        <div className="text-[11px] uppercase tracking-widest text-white/40">{BRAND.name} · voice call</div>
        <div className="mt-6 text-2xl font-semibold">{businessName}</div>
        <div className="mt-1 text-sm text-white/60">{botName}</div>
        <div className="mt-2 font-mono text-sm text-white/80">
          {phase === "ringing" ? "Calling…" : phase === "ended" ? `Call ended · ${mmss(seconds)}` : mmss(seconds)}
        </div>
      </div>

      <div className="flex flex-col items-center">
        <div className="relative flex h-40 w-40 items-center justify-center">
          {phase !== "ended" && (phase === "ringing" || activity === "speaking") && <>
            <span className="absolute inset-0 animate-ping rounded-full opacity-20" style={{ background: color }} />
            <span className="absolute -inset-4 animate-pulse rounded-full opacity-10" style={{ background: color }} />
          </>}
          <div className="relative flex h-32 w-32 items-center justify-center rounded-full text-4xl font-bold shadow-2xl" style={{ background: color }}>{initials || "AI"}</div>
        </div>
        <div className="mt-6 flex h-8 items-end gap-1">
          {phase === "connected" && (activity === "speaking" || activity === "listening") && Array.from({ length: 5 }).map((_, i) => (
            <span key={i} className="w-1.5 animate-bounce rounded-full bg-white/80" style={{ height: `${12 + ((i * 7) % 18)}px`, animationDelay: `${i * 0.12}s` }} />
          ))}
        </div>
        <div className="mt-1 text-sm text-white/70">{phase === "connected" ? activityText : ""}</div>
        <div className="urdu-aware mt-4 max-h-32 max-w-sm overflow-y-auto text-center text-base text-white/90" dir={isRtl(caption) ? "rtl" : "ltr"}>{caption}</div>
        {problem && <div className="mt-3 max-w-xs rounded-lg bg-red-500/25 px-3 py-2 text-center text-sm">{problem}</div>}
      </div>

      <div className="flex w-full flex-col items-center gap-6">
        {phase !== "ended" && (
          <div className="flex gap-2 text-xs">
            {(["ur-PK", "en-US"] as CallLang[]).map((l) => (
              <button key={l} onClick={() => setLang(l)} className={`rounded-full px-3 py-1 ${lang === l ? "bg-white text-slate-900" : "bg-white/10"}`}>
                {l === "ur-PK" ? "اردو میں بات" : "Speak English"}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-10">
          <button disabled={phase !== "connected"} onClick={() => setMuted(!muted)} aria-label={muted ? "Unmute" : "Mute"}
            className={`flex h-16 w-16 items-center justify-center rounded-full disabled:opacity-30 ${muted ? "bg-white text-slate-900" : "bg-white/15"}`}>
            {muted ? <MicOff className="h-7 w-7" /> : <Mic className="h-7 w-7" />}
          </button>
          <button onClick={finish} disabled={phase === "ended"} aria-label="End call"
            className="flex h-20 w-20 items-center justify-center rounded-full bg-red-600 shadow-lg shadow-red-900/50 active:scale-95 disabled:opacity-50">
            <PhoneOff className="h-9 w-9" />
          </button>
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/15 opacity-60" title="Use your phone's volume buttons"><Volume2 className="h-7 w-7" /></div>
        </div>
      </div>
    </div>
  );
}
