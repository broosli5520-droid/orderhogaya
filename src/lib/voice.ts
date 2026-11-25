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
    .replace(/\bPKR\b|\bRs\.?/g, "rupay")
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


// ---------------------------------------------------------------- Urdu speech without an Urdu voice
// Most computers (Chrome on Windows) have no Urdu voice, but almost all have a Hindi one.
// Spoken Urdu and Hindi are nearly the same, so Urdu text is rewritten in Devanagari letters
// and read by the Hindi voice — free, offline, and understandable to any Urdu speaker.
const ASPIRATED: Record<string, string> = { "ب": "भ", "پ": "फ", "ت": "थ", "ٹ": "ठ", "ج": "झ", "چ": "छ", "د": "ध", "ڈ": "ढ", "ک": "ख", "گ": "घ", "ر": "र्ह", "ل": "ल्ह", "م": "म्ह", "ن": "न्ह" };
const CONS: Record<string, string> = {
  "ب": "ब", "پ": "प", "ت": "त", "ٹ": "ट", "ث": "स", "ج": "ज", "چ": "च", "ح": "ह", "خ": "ख़", "د": "द", "ڈ": "ड", "ذ": "ज़",
  "ر": "र", "ڑ": "ड़", "ز": "ज़", "ژ": "झ", "س": "स", "ش": "श", "ص": "स", "ض": "ज़", "ط": "त", "ظ": "ज़", "غ": "ग़",
  "ف": "फ़", "ق": "क़", "ک": "क", "ك": "क", "گ": "ग", "ل": "ल", "م": "म", "ن": "न", "ہ": "ह", "ۃ": "त", "ة": "त",
};
const SIGNS: Record<string, string> = { "ا": "ा", "آ": "ा", "و": "ो", "ی": "ी", "ي": "ी", "ے": "े", "ئ": "ए" };
const INDEP: Record<string, string> = { "ا": "अ", "آ": "आ", "و": "व", "ی": "य", "ي": "य", "ے": "ए", "ئ": "इ", "ع": "अ" };
const URDU_WORDS: Record<string, string> = { "میں": "में", "ہیں": "हैं", "ہے": "है", "کیسے": "कैसे", "کیسی": "कैसी", "کیا": "क्या", "کی": "की", "خوش": "ख़ुश", "خدمت": "ख़िदमत", "ہوں": "हूँ", "شکریہ": "शुक्रिया", "نمبر": "नंबर", "پتہ": "पता", "دستیاب": "दस्तियाब", "ڈلیوری": "डिलीवरी", "ہوئی": "हुई", "اور": "और", "کون": "कौन", "کتنی": "कितनी", "کتنے": "कितने", "کتنا": "कितना", "چاہیے": "चाहिए", "چاہئے": "चाहिए", "اچھا": "अच्छा", "السلام": "अस्सलाम", "علیکم": "अलैकुम", "وعلیکم": "व-अलैकुम", "آمدید": "आमदीद", "بتائیے": "बताइए", "قیمت": "क़ीमत", "قیمتیں": "क़ीमतें", "بہترین": "बेहतरीन", "سیل": "सेल", "یہ": "यह", "وہ": "वह", "ٹھیک": "ठीक", "ہاں": "हाँ", "نہیں": "नहीं", "آرڈر": "ऑर्डर", "لسٹ": "लिस्ट", "کال": "कॉल", "معذرت": "माज़रत", "گیا": "गया", "دیا": "दिया", "لکھیں": "लिखें", "چیز": "चीज़", "چیزیں": "चीज़ें", "سوٹ": "सूट", "لان": "लॉन", "کنفرم": "कन्फ़र्म", "ٹیم": "टीम", "رابطہ": "राबता", "کرے": "करे", "رقم": "रक़म", "کل": "कुल", "فون": "फ़ोन", "شامل": "शामिल", "براہ": "बराए", "کرم": "करम", "اپنا": "अपना", "اپنی": "अपनी", "لینا": "लेना", "چاہیں": "चाहें", "مدد": "मदद", "سکتا": "सकता", "سکتی": "सकती", "سکتے": "सकते", "ہمیں": "हमें", "مزید": "मज़ीद", "پک": "पिक", "اپ": "अप", "ختم": "ख़त्म", "والی": "वाली", "والا": "वाला", "لگی": "लगी", "ابھی": "अभी", "ملی": "मिली", "کیجیے": "कीजिए", "معاف": "माफ़", "آواز": "आवाज़", "صاف": "साफ़", "آئی": "आई", "دوبارہ": "दोबारा", "بتائیں": "बताएँ", "کہاں": "कहाँ", "اسٹیٹس": "स्टेटस", "ہول": "होल", "مقدار": "मिक़दार", "زیادہ": "ज़्यादा", "بات": "बात", "حال": "हाल", "پوچھنے": "पूछने", "آپ": "आप", "ہم": "हम", "ہماری": "हमारी", "ہمارا": "हमारा", "کو": "को", "سے": "से", "پر": "पर", "تو": "तो", "جی": "जी", "ہو": "हो", "کر": "कर", "گی": "गी", "گا": "गा", "گے": "गे", "کے": "के", "کا": "का", "نام": "नाम", "پہلے": "पहले", "صورتحال": "सूरत-ए-हाल", "مجھے": "मुझे", "تھا": "था", "تھی": "थी", "رہا": "रहा", "رہی": "रही", "کریں": "करें", "کرو": "करो", "دیں": "दें", "لیے": "लिए", "لئے": "लिए", "بھی": "भी", "صرف": "सिर्फ़", "تعداد": "तादाद", "کم": "कम", "کیونکہ": "क्योंकि", "سامان": "सामान", "دن": "दिन", "روپے": "रुपये", "ہزار": "हज़ार", "سو": "सौ", "خرید": "ख़रीद", "خریدنے": "ख़रीदने", "منگوانا": "मंगवाना", "گاہک": "गाहक", "دکان": "दुकान", "ملے": "मिले", "جلد": "जल्द", "آپکا": "आपका", "پاس": "पास", "بس": "बस" };
function urduWordToDeva(word: string): string {
  const w = word.replace(/[\u064B-\u0652\u0670]/g, "");
  if (URDU_WORDS[w]) return URDU_WORDS[w];
  const ch = [...w];
  let out = "", prevCons = false;
  for (let i = 0; i < ch.length; i++) {
    const c = ch[i], n = ch[i + 1];
    if (n === "ھ" && ASPIRATED[c]) { out += ASPIRATED[c]; prevCons = true; i++; continue; }
    if (c === "ھ") { out += "ह"; prevCons = true; continue; }
    if (c === "ں") { out += "ं"; prevCons = false; continue; }
    if (c === "ع") { if (!prevCons) out += "अ"; prevCons = false; continue; }
    if (c === "ء") { continue; }
    if (c === "ہ" && i === ch.length - 1 && prevCons) { out += "ा"; prevCons = false; continue; } // final ہ = "a" (کہ، یہ)
    if (CONS[c]) {
      // و / ی between a consonant and a vowel are consonants (و = va, ی = ya)
      out += CONS[c]; prevCons = true; continue;
    }
    if (SIGNS[c]) {
      if (prevCons && !(c === "و" && n && SIGNS[n]) && !(c === "ی" && n && (n === "ا" || n === "و"))) { out += SIGNS[c]; prevCons = false; }
      else if (i === 0 && c === "ا" && n === "و") { out += "ओ"; i++; prevCons = false; }
      else if (i === 0 && c === "ا" && (n === "ی" || n === "ي")) { out += "ई"; i++; prevCons = false; }
      else if (i === 0 && c === "ا" && n === "ے") { out += "ऐ"; i++; prevCons = false; }
      else { out += INDEP[c] ?? ""; prevCons = c === "و" || c === "ی" || c === "ي"; }
      continue;
    }
    out += c; prevCons = false;
  }
  return out;
}
export function urduToDevanagari(text: string): string {
  return text.replace(/[\u0621-\u0652\u0670-\u06D3\u06D5\u06F0-\u06F9]+/g, (w) => urduWordToDeva(w)).replace(/۔/g, "।").replace(/؟/g, "?").replace(/،/g, ",")
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
}
function pickUrduVoice(): { voice: SpeechSynthesisVoice | null; viaHindi: boolean } {
  const ur = pickVoice("ur-PK");
  if (ur) return { voice: ur, viaHindi: false };
  const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("hi"));
  const natural = (v: SpeechSynthesisVoice) => /natural|online|neural/i.test(v.name);
  const hi = voices.find((v) => MALE.test(v.name) && natural(v)) ?? voices.find((v) => MALE.test(v.name)) ?? voices.find(natural) ?? voices[0] ?? null;
  return { voice: hi, viaHindi: !!hi };
}

/** True when the device has a voice for that language (Urdu voices are missing on some devices). */
export function hasVoiceFor(lang: CallLang): boolean {
  return voiceSupport.speak && !!(lang === "ur-PK" ? pickUrduVoice().voice : pickVoice(lang));
}

/** Speak text sentence by sentence (short pieces sound more human and avoid browser cut-offs). */
export function speak(text: string, lang: CallLang, rate = 1, pitch = 1): { promise: Promise<void>; stop: () => void } {
  if (!voiceSupport.speak) return { promise: Promise.resolve(), stop: () => {} };
  const synth = window.speechSynthesis;
  const urdu = lang === "ur-PK" ? pickUrduVoice() : null;
  const voice = urdu ? urdu.voice : pickVoice(lang);
  const spoken = urdu?.viaHindi ? urduToDevanagari(speakable(text)).replace(/\brupay\b/g, "रुपये") : speakable(text);
  const parts = spoken.split(/(?<=[.!?۔؟।])\s+/).filter(Boolean);
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
