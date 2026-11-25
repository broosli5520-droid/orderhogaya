// Free, browser-only voice helpers (Web Speech API + HTML audio). No servers, no quota.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Recognition = {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  onresult: ((e: any) => void) | null; onerror: ((e: any) => void) | null; onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
};
const RecognitionCtor: (new () => Recognition) | undefined =
  typeof window !== "undefined" ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : undefined;

export const voiceSupport = {
  listen: Boolean(RecognitionCtor),
  speak: typeof window !== "undefined" && "speechSynthesis" in window,
  record: typeof window !== "undefined" && typeof (window as any).MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia,
};

export type CallLang = "ur-PK" | "en-US";

/** Listen for one utterance. Calls onInterim with partial text; resolves with the final text ("" if nothing heard). */
export function listenOnce(lang: CallLang, onInterim?: (t: string) => void): { promise: Promise<string>; stop: () => void } {
  if (!RecognitionCtor) return { promise: Promise.reject(new Error("not-supported")), stop: () => {} };
  const rec = new RecognitionCtor();
  rec.lang = lang; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
  let finalText = "";
  const promise = new Promise<string>((resolve, reject) => {
    rec.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
      }
      onInterim?.((finalText + " " + interim).trim());
    };
    rec.onerror = (e: any) => {
      if (e.error === "no-speech" || e.error === "aborted") resolve("");
      // "audio-capture" = no microphone, "not-allowed" = permission blocked, "network" = speech service unreachable
      else reject(new Error(e.error || "speech-error"));
    };
    rec.onend = () => resolve(finalText.trim());
  });
  try { rec.start(); } catch { /* already started */ }
  return { promise, stop: () => { try { rec.stop(); } catch { /* ignore */ } } };
}

/** Make text sound natural when read aloud: drop bullets, symbols and emoji; expand "Rs". */
export function speakable(text: string): string {
  return text
    .replace(/[•*_#>`]/g, " ")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\bPKR\b|\bRs\.?/g, "rupees")
    .replace(/(\d)\s*×\s*/g, "$1 ")
    .replace(/\s*=\s*/g, ", ")
    .replace(/([.!?۔؟])\s*\n+\s*/g, "$1 ")
    .replace(/\s*\n+\s*/g, ". ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const MALE = /\b(male|asad|salman|madhur|prabhat|guy|ryan|christopher|eric|andrew|brian|roger|steffan|david|mark|george|daniel|james|thomas|alex|fred|rishi|aaron|arthur|davis|tony|jason)\b/i;
const FEMALE = /\b(female|uzma|zira|aria|jenny|sonia|libby|samantha|karen|susan|hazel|heera|swara|neerja|victoria|moira|tessa|fiona|catherine|emma|ava|michelle|natasha|clara)\b/i;

/** Picks a natural-sounding MALE voice when the device has one (a shop salesman's voice). */
function pickVoice(lang: CallLang): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  const base = lang.slice(0, 2);
  const same = voices.filter((v) => v.lang.toLowerCase().startsWith(base));
  const natural = (v: SpeechSynthesisVoice) => /natural|online|neural/i.test(v.name);
  return same.find((v) => MALE.test(v.name) && natural(v))
    ?? same.find((v) => MALE.test(v.name))
    ?? same.find((v) => !FEMALE.test(v.name) && natural(v))
    ?? same.find((v) => !FEMALE.test(v.name))
    ?? same.find(natural) ?? same[0] ?? null;
}
/** True when only a female voice exists, so the pitch is lowered to sound closer to a man. */
function isFemale(v: SpeechSynthesisVoice) { return FEMALE.test(v.name) || (/google/i.test(v.name) && !MALE.test(v.name)); }

/** True when the device has a voice for that language (Urdu voices are missing on some devices). */
export function hasVoiceFor(lang: CallLang): boolean {
  return voiceSupport.speak && !!pickVoice(lang);
}

/** Speak text sentence by sentence (short pieces sound more human and avoid browser cut-offs). */
export function speak(text: string, lang: CallLang, rate = 1, pitch = 1): { promise: Promise<void>; stop: () => void } {
  if (!voiceSupport.speak) return { promise: Promise.resolve(), stop: () => {} };
  const synth = window.speechSynthesis;
  const voice = pickVoice(lang);
  const parts = speakable(text).split(/(?<=[.!?۔؟])\s+/).filter(Boolean);
  let cancelled = false;
  const promise = new Promise<void>((resolve) => {
    if (!voice || !parts.length) { resolve(); return; }
    let i = 0;
    const next = () => {
      if (cancelled || i >= parts.length) { resolve(); return; }
      const u = new SpeechSynthesisUtterance(parts[i++]);
      u.voice = voice; u.lang = voice.lang; u.rate = rate; u.pitch = isFemale(voice) ? Math.max(0.1, pitch * 0.75) : pitch;
      u.onend = () => setTimeout(next, 120); // a small breath between sentences
      u.onerror = () => next();
      synth.speak(u);
    };
    synth.cancel();
    next();
  });
  return { promise, stop: () => { cancelled = true; synth.cancel(); } };
}

/** Play a recorded clip. */
export function playUrl(url: string): { promise: Promise<void>; stop: () => void } {
  const audio = new Audio(url);
  const promise = new Promise<void>((resolve) => {
    audio.onended = () => resolve();
    audio.onerror = () => resolve();
    audio.play().catch(() => resolve());
  });
  return { promise, stop: () => { audio.pause(); audio.currentTime = 0; } };
}

/** Voices load asynchronously in Chrome; call once early. */
export function warmUpVoices(): void {
  if (voiceSupport.speak) {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
  }
}

/** Ask for the microphone up front so the browser shows its permission prompt. Returns an error code or null. */
export async function checkMic(): Promise<string | null> {
  try {
    if (!navigator.mediaDevices?.getUserMedia) return "not-supported";
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
    return null;
  } catch (e) {
    const n = (e as { name?: string })?.name ?? "";
    return n === "NotAllowedError" || n === "SecurityError" ? "not-allowed" : n === "NotFoundError" || n === "OverconstrainedError" ? "audio-capture" : "audio-capture";
  }
}
