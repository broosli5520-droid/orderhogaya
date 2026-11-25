import { BRAND } from "../lib/brand";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Bot, MessageCircle, Phone, RotateCcw, Send, UserRound } from "lucide-react";
import VoiceCall, { type CallReply } from "../components/VoiceCall";
import { warmUpVoices } from "../lib/voice";
import { waLink } from "../lib/whatsapp";
import { supabase, errorMessage } from "../lib/supabase";
import { isRtl } from "../lib/format";
import { Spinner, cx } from "../components/ui";

interface PublicBusiness { name: string; slug: string; bot_name: string; bot_greeting: string; brand_color: string; chat_enabled: boolean; phone: string; quick_replies: string[]; show_branding?: boolean;
  voice?: { enabled: boolean; rate: number; pitch: number; premium?: boolean; clips: Record<string, string> }; }
interface ChatMsg { role: "user" | "assistant" | "agent"; content: string; }
interface PlacedOrder { order_number: number; total: string; items: string[]; }
const DEFAULT_QUICK = ["لسٹ دکھائیں", "آرڈر دینا ہے", "میرا آرڈر کہاں ہے؟", "بات کرنی ہے"];

function store(key: string, value?: string | null): string | null {
  try {
    if (value === undefined) return localStorage.getItem(key);
    if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
  } catch { /* storage blocked (private mode / iframe) — chat still works for this page view */ }
  return value ?? null;
}

function visitorId(): string {
  let id = store("sp.visitor");
  if (!id) { id = crypto.randomUUID(); store("sp.visitor", id); }
  return id;
}

export default function PublicChat() {
  const { slug = "" } = useParams();
  const [params] = useSearchParams();
  const embed = params.get("embed") === "1";
  const [biz, setBiz] = useState<PublicBusiness | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [human, setHuman] = useState(false);
  const [lastActive, setLastActive] = useState(0);
  const [placed, setPlaced] = useState<PlacedOrder | null>(null);
  const [calling, setCalling] = useState(false);
  const vid = useRef(visitorId());
  const bottom = useRef<HTMLDivElement>(null);
  const convKey = `sp.conv.${slug}`;

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase.rpc("get_public_business", { p_slug: slug });
      if (!alive) return;
      if (error || !data) { setNotFound(true); return; }
      setBiz(data as PublicBusiness);
      document.title = `${(data as PublicBusiness).name} — Chat`;
      const saved = store(convKey);
      if (saved) {
        const { data: hist } = await supabase.functions.invoke("chat", { body: { action: "history", slug, visitorId: vid.current, conversationId: saved } });
        if (!alive) return;
        if (hist?.conversationId) {
          setConversationId(hist.conversationId);
          setHuman(!!hist.human);
          setMessages((hist.messages as ChatMsg[]).map((m) => ({ role: m.role, content: m.content })));
        } else store(convKey, null);
      }
    })();
    return () => { alive = false; };
  }, [slug, convKey]);

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, sending]);

  // While a team member is handling the chat, check for their replies (stops after 15 minutes of silence).
  useEffect(() => {
    if (!human || !conversationId) return;
    const timer = setInterval(async () => {
      if (document.hidden || Date.now() - lastActive > 15 * 60_000) return;
      const { data } = await supabase.functions.invoke("chat", { body: { action: "history", slug, visitorId: vid.current, conversationId } });
      if (data?.messages) {
        setMessages((old) => (data.messages.length !== old.length ? (data.messages as ChatMsg[]).map((m) => ({ role: m.role, content: m.content })) : old));
        setHuman(!!data.human);
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [human, conversationId, lastActive, slug]);

  // Premium voice: the business's own ElevenLabs account (paid plans). Falls back to the free device voice.
  const convRef = useRef<string | null>(null);
  convRef.current = conversationId;
  async function premiumSpeak(textToSay: string): Promise<string | null> {
    if (!biz?.voice?.premium || !convRef.current) return null;
    const anon = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? "");
    const res = await fetch(`${String(import.meta.env.VITE_SUPABASE_URL ?? "")}/functions/v1/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: anon, Authorization: `Bearer ${anon}` },
      body: JSON.stringify({ slug, visitorId: vid.current, conversationId: convRef.current, text: textToSay }),
    });
    if (!res.ok) return null;
    return URL.createObjectURL(await res.blob());
  }

  const clipUrl = (key?: string | null) => {
    const path = key ? biz?.voice?.clips?.[key] : undefined;
    return path ? supabase.storage.from("voice").getPublicUrl(path).data.publicUrl : null;
  };

  async function send(e?: FormEvent, preset?: string): Promise<CallReply | null> {
    e?.preventDefault();
    const msg = (preset ?? text).trim();
    if (!msg || sending) return null;
    if (!preset) setText("");
    setError(null);
    setMessages((m) => [...m, { role: "user", content: msg }]);
    setSending(true);
    setLastActive(Date.now());
    const { data, error } = await supabase.functions.invoke("chat", {
      body: { slug, visitorId: vid.current, conversationId, message: msg },
    });
    setSending(false);
    if (error || !data?.conversationId) {
      let detail = data?.error as string | undefined;
      if (!detail && error && "context" in error) {
        try { detail = (await (error as { context: Response }).context.json()).error; } catch { /* ignore */ }
      }
      setError(detail ?? errorMessage(error));
      return null;
    }
    setConversationId(data.conversationId); store(convKey, data.conversationId);
    setHuman(!!data.human);
    if (data.order) setPlaced(data.order as PlacedOrder);
    if (data.reply) setMessages((m) => [...m, { role: "assistant", content: data.reply }]);
    if (data.human) return { text: "A team member will reply to you here shortly.", human: true };
    return data.reply ? { text: data.reply as string, voiceUrl: clipUrl(data.voice) } : null;
  }

  function restart() {
    store(convKey, null); setConversationId(null); setMessages([]); setError(null); setHuman(false); setPlaced(null);
  }

  if (notFound) return <div className="flex h-full items-center justify-center p-6 text-center text-slate-500">This chat link is not valid.</div>;
  if (!biz) return <Spinner />;
  const color = biz.brand_color;

  return (
    <div className={cx("relative flex h-full flex-col bg-white", !embed && "sm:mx-auto sm:my-6 sm:h-[calc(100%-3rem)] sm:max-w-lg sm:rounded-2xl sm:border sm:border-slate-200 sm:shadow-lg")}>
      {calling && (
        <VoiceCall color={color} botName={biz.bot_name} businessName={biz.name} greeting={biz.bot_greeting} greetingUrl={clipUrl("greeting")}
          rate={Number(biz.voice?.rate ?? 1)} pitch={Number(biz.voice?.pitch ?? 1)}
          onSend={(t) => send(undefined, t)} onClose={() => setCalling(false)}
          premiumSpeak={biz.voice?.premium ? premiumSpeak : undefined} />
      )}
      <div className="flex items-center gap-3 px-4 py-3 text-white sm:rounded-t-2xl" style={{ background: color }}>
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20"><Bot className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{biz.bot_name}</div>
          <div className="truncate text-xs opacity-90">{biz.name}</div>
        </div>
        {biz.voice?.enabled !== false && biz.chat_enabled && (
          <button onClick={() => { warmUpVoices(); setCalling(true); }} title="Voice call" className="flex items-center gap-1 rounded-lg bg-white/20 px-2.5 py-1.5 text-xs font-medium hover:bg-white/30">
            <Phone className="h-4 w-4" />Call
          </button>
        )}
        <button onClick={restart} title="Start a new chat" className="rounded-lg p-1.5 hover:bg-white/20"><RotateCcw className="h-4 w-4" /></button>
      </div>

      <div className="urdu-aware flex-1 space-y-3 overflow-y-auto bg-slate-50 px-4 py-4">
        <Bubble role="assistant" content={biz.bot_greeting} color={color} />
        {messages.map((m, i) => <Bubble key={i} role={m.role} content={m.content} color={color} />)}
        {sending && (
          <div className="flex gap-1 rounded-2xl rounded-bl-sm bg-white px-4 py-3 shadow-sm" style={{ width: "fit-content" }}>
            {[0, 1, 2].map((i) => <span key={i} className="h-2 w-2 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: `${i * 0.15}s` }} />)}
          </div>
        )}
        {human && <div className="flex items-center justify-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800"><UserRound className="h-4 w-4" />A team member is handling your chat and will reply here.</div>}
        {placed && biz.phone && (
          <a href={waLink(biz.phone, `Assalam o Alaikum! I placed order #${placed.order_number} (${placed.items.join(", ")}) — total ${placed.total}.`)}
            target="_blank" rel="noreferrer" className="mx-auto flex w-fit items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm">
            <MessageCircle className="h-4 w-4" />Send order #{placed.order_number} to the shop on WhatsApp
          </a>
        )}
        {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        {!sending && biz.chat_enabled && (
          <div className="flex flex-wrap gap-2 pt-1">
            {(biz.quick_replies?.length ? biz.quick_replies : DEFAULT_QUICK).map((q) => (
              <button key={q} onClick={() => void send(undefined, q)} className="rounded-full border bg-white px-3 py-1 text-xs shadow-sm hover:bg-slate-50" style={{ borderColor: color, color }}>{q}</button>
            ))}
          </div>
        )}
        <div ref={bottom} />
      </div>

      {biz.chat_enabled ? (
        <form onSubmit={send} className="flex items-end gap-2 border-t border-slate-200 p-3">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={1} maxLength={1500}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
            dir={isRtl(text) ? "rtl" : "ltr"} placeholder="Type your message…"
            className="max-h-32 flex-1 resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-400" />
          <button type="submit" disabled={!text.trim() || sending} className="rounded-xl p-2.5 text-white disabled:opacity-40" style={{ background: color }} aria-label="Send">
            <Send className="h-5 w-5" />
          </button>
        </form>
      ) : (
        <div className="border-t border-slate-200 p-4 text-center text-sm text-slate-500">Chat is currently unavailable.</div>
      )}
      {biz.show_branding !== false && <div className="pb-2 text-center text-[11px] text-slate-400">Powered by {BRAND.name}</div>}
    </div>
  );
}

function Bubble({ role, content, color }: { role: ChatMsg["role"]; content: string; color: string }) {
  const rtl = isRtl(content);
  const mine = role === "user";
  return (
    <div className={cx("flex", mine ? "justify-end" : "justify-start")}>
      {role === "agent" && <span className="mr-1 self-end text-[10px] text-slate-400">Team</span>}
      <div dir={rtl ? "rtl" : "ltr"} lang={rtl ? "ur" : undefined}
        className={cx("max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-sm shadow-sm",
          mine ? "rounded-br-sm text-white" : role === "agent" ? "rounded-bl-sm border border-amber-200 bg-amber-50 text-slate-800" : "rounded-bl-sm bg-white text-slate-800")}
        style={mine ? { background: color } : undefined}>
        {content}
      </div>
    </div>
  );
}
