import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, PhoneOff, RotateCcw, Volume2 } from "lucide-react";
import { callVoiceInfo, checkMic, hasVoiceFor, listenOnce, playUrl, speak, voiceSupport, type CallLang } from "../lib/voice";
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
  const looping = useRef(false);
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

  /** On a call, read only the first part of a long text menu and ask a short question instead — like a real salesman. */
  function forCall(text: string): string {
    const cut = text.search(/\n\n(میں ان کاموں میں|I can help you with)/);
    if (cut > 0) return text.slice(0, cut).trim() + (isRtl(text) ? " بتائیے، آپ کیا لینا چاہیں گے؟" : " What would you like to buy?");
    return text;
  }

  // Barge-in: while the bot talks we keep listening, and if the customer starts speaking the bot stops — like a real phone call.
  // Phones play a beep every time listening restarts, so barge-in is used on computers only.
  const canBargeIn = typeof navigator !== "undefined" && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const plain = (t: string) => t.toLowerCase().replace(/[\u064B-\u0652\u0670]/g, "").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 1);

  /** Speak a reply. Returns what the customer said if they interrupted, otherwise "". */
  async function say(text: string, url?: string | null): Promise<string> {
    text = forCall(text);
    setActivity("speaking"); setCaption(text);
    // One voice for the whole call: the call's language decides it (the Urdu voice also reads English names and prices).
    const voiceLang: CallLang = langRef.current;
    if (!url && premiumSpeak) url = await premiumSpeak(text).catch(() => null);
    if (!active.current) return "";
    let speech: { promise: Promise<void>; stop: () => void };
    if (url) speech = playUrl(url);
    else if (hasVoiceFor(voiceLang)) speech = speak(text, voiceLang, rate, pitch);
    else speech = { promise: sleep(Math.min(8000, 1200 + text.length * 45)).then(() => undefined), stop: () => {} }; // no voice installed: time to read the caption
    stopper.current = speech.stop;
    if (!canBargeIn || mutedRef.current) { await speech.promise; return ""; }

    // Listen at the same time. Words the bot itself is saying (echo from the speakers) are ignored.
    const own = new Set(plain(text));
    const isEcho = (heard: string) => { const fresh = plain(heard).filter((w) => !own.has(w)); return fresh.length < 2; };
    let speaking = true, interrupted = false, lastHeard = "", stopListen = () => {};
    const started = Date.now();
    const done = speech.promise.then(() => { speaking = false; if (!interrupted) stopListen(); });
    const heard = (async () => {
      while (speaking && active.current && !interrupted) {
        const l = listenOnce(voiceLang, (partial) => {
          lastHeard = partial;
          if (!interrupted && Date.now() - started > 700 && !isEcho(partial)) {
            interrupted = true; speech.stop(); setActivity("listening"); setCaption(partial);
          } else if (interrupted) setCaption(partial);
        });
        stopListen = l.stop;
        const t = await l.promise.catch(() => "");
        if (interrupted) return (t || lastHeard).trim();
      }
      return "";
    })();
    await done;
    const result = await Promise.race([heard, sleep(interrupted ? 15000 : 300).then(() => "")]);
    return interrupted ? result || lastHeard : "";
  }

  function finish() {
    if (ended.current) return;
    ended.current = true; active.current = false; stopper.current();
    hangUpTone();
    setPhase("ended");
    setTimeout(onClose, 1800);
  }

  // Clear, Urdu + English help for the usual microphone problems. The call stays open so the customer can fix it and retry.
  function micProblem(code: string): string {
    if (code === "not-allowed") return "مائیک کی اجازت بند ہے۔ اوپر ایڈریس بار میں تالے 🔒 کے نشان پر کلک کر کے Microphone کو Allow کریں، پھر \"دوبارہ کوشش\" دبائیں۔\nMicrophone permission is blocked — allow it from the lock icon in the address bar, then tap Try again.";
    if (code === "audio-capture") return "اس کمپیوٹر پر مائیک نہیں ملا۔ مائیک والا ہیڈفون لگائیں یا موبائل سے کال کریں، پھر \"دوبارہ کوشش\" دبائیں۔\nNo microphone found — plug in a headset with a mic or call from your phone.";
    if (code === "network") return "آواز پہچاننے کی سروس تک انٹرنیٹ نہیں پہنچ رہا۔ انٹرنیٹ چیک کر کے دوبارہ کوشش کریں۔\nVoice recognition needs internet — check your connection and try again.";
    return "مائیک شروع نہیں ہو سکا۔ Google Chrome یا Microsoft Edge میں کھول کر دوبارہ کوشش کریں۔\nThe microphone could not start — please use Chrome or Edge and try again.";
  }

  async function conversation(first = "") {
    if (looping.current) return;
    looping.current = true;
    try {
      let pending = first;
      while (active.current) {
        if (mutedRef.current) { setActivity("muted"); await sleep(400); continue; }
        let text = pending; pending = "";
        if (!text) { setActivity("listening"); setCaption(""); }
        if (!text) try {
          const l = listenOnce(langRef.current, (t) => setCaption(t)); stopper.current = l.stop;
          text = await l.promise;
        } catch (e) {
          setProblem(micProblem(e instanceof Error ? e.message : ""));
          setActivity("muted");
          return; // keep the call open; the customer can press "Try again"
        }
        if (!active.current) return;
        if (!text) continue; // silence — keep listening, like a person waiting
        setActivity("thinking");
        const [reply] = await Promise.all([sendRef.current(text), sleep(400 + Math.random() * 400)]); // a natural pause before answering
        if (!active.current) return;
        if (!reply) { pending = await say(langRef.current === "ur-PK" ? "معاف کیجیے، آواز صاف نہیں آئی، دوبارہ بتائیں؟" : "Sorry, I didn't catch that. Could you say it again?"); continue; }
        pending = await say(reply.text, reply.voiceUrl);
        if (reply.human) { finish(); return; }
      }
    } finally { looping.current = false; }
  }

  async function retry() {
    setProblem(null);
    const err = await checkMic();
    if (err) { setProblem(micProblem(err)); return; }
    void conversation();
  }

  useEffect(() => {
    active.current = true; ended.current = false;
    try { navigator.vibrate?.([200, 100, 200]); } catch { /* not supported */ }
    (async () => {
      const micErr = checkMic(); // shows the browser's permission prompt while it rings
      await ringBack();
      const err = await micErr;
      if (!active.current) return;
      setPhase("connected");
      await sleep(300);
      // A phone greeting is short and warm, like a real shop salesman (the long chat greeting is for reading).
      const spokenGreeting = greetingUrl ? greeting : langRef.current === "ur-PK"
        ? `السلام علیکم! ${businessName} میں خوش آمدید۔ آپ کیسے ہیں؟ بتائیے، میں آپ کی کیا خدمت کر سکتا ہوں؟`
        : `Hello, and welcome to ${businessName}! How are you? How can I help you today?`;
      const early = await say(spokenGreeting, greetingUrl);
      if (!active.current) return;
      if (err) { setProblem(micProblem(err)); setActivity("muted"); return; }
      await conversation(early);
    })();
    return () => { active.current = false; stopper.current(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const voice = callVoiceInfo(lang);
  const initials = businessName.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const activityText = problem ? "" : { speaking: "Speaking", listening: "Listening…", thinking: "…", muted: "You are muted" }[activity];

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
        {phase === "connected" && !problem && lang === "ur-PK" && voice && !voice.male && (
          <div className="mt-3 max-w-xs text-center text-[11px] text-white/45">مردانہ اردو آواز کے لیے یہ صفحہ Microsoft Edge میں کھولیں</div>
        )}
        {problem && (
          <div className="mt-3 flex max-w-sm flex-col items-center gap-3">
            <div className="urdu-aware whitespace-pre-line rounded-lg bg-red-500/25 px-3 py-2 text-center text-sm">{problem}</div>
            <button onClick={() => void retry()} className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-900">
              <RotateCcw className="h-4 w-4" /> دوبارہ کوشش · Try again
            </button>
          </div>
        )}
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
