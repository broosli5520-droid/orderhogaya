import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowLeft, Bot, ExternalLink, MessageCircle, MessageSquare, RefreshCw, Send, Trash2, UserRound } from "lucide-react";
import { waLink } from "../../lib/whatsapp";
import { supabase, errorMessage } from "../../lib/supabase";
import { useAsync, must } from "../../lib/useAsync";
import { dateTime, isRtl } from "../../lib/format";
import { can } from "../../lib/permissions";
import type { Conversation, Message } from "../../lib/types";
import { useBusiness } from "../../contexts/BusinessContext";
import { Badge, Button, Card, Empty, ErrorBox, PageHeader, Spinner, confirmAction, cx, useToast } from "../../components/ui";

export default function Conversations() {
  const { business, role } = useBusiness();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const selected = params.get("c");

  const { data, loading, error, reload } = useAsync(async () =>
    must(await supabase.from("conversations").select("*, customers(name, phone)").eq("business_id", business.id)
      .order("last_message_at", { ascending: false }).limit(300)) as Conversation[], [business.id]);

  async function remove(id: string) {
    if (!confirmAction("Delete this conversation and its messages?")) return;
    const { error } = await supabase.from("conversations").delete().eq("id", id);
    if (error) toast("error", errorMessage(error)); else { setParams({}); void reload(); }
  }

  return (
    <>
      <PageHeader title="Conversations" subtitle="Every chat between customers and your AI agent."
        actions={<>
          <Button variant="secondary" onClick={reload}><RefreshCw className="h-4 w-4" />Refresh</Button>
          <a href={`/chat/${business.slug}`} target="_blank" rel="noreferrer"><Button variant="secondary"><ExternalLink className="h-4 w-4" />Open chat page</Button></a>
        </>} />
      {loading ? <Spinner /> : error ? <ErrorBox message={error} onRetry={reload} /> : !data?.length ? (
        <Card><Empty icon={<MessageSquare className="h-6 w-6" />} title="No conversations yet" text="Share your chat link or add the widget to your website. Chats will appear here." /></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
          <Card className={cx("max-h-[70vh] overflow-y-auto", selected && "hidden lg:block")}>
            {data.map((c) => (
              <button key={c.id} onClick={() => setParams({ c: c.id })}
                className={cx("block w-full border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50", selected === c.id && "bg-indigo-50")}>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    {c.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-indigo-600" title="Unread" />}
                    <span className="truncate font-medium">{c.customers?.name || `Visitor ${c.visitor_id.slice(0, 6)}`}</span>
                    {c.ai_paused && <Badge color="amber">Human</Badge>}
                  </span>
                  <span className="shrink-0 text-xs text-slate-400">{dateTime(c.last_message_at)}</span>
                </div>
                <div className="text-xs text-slate-500">{c.customers?.phone || "Not identified yet"} · {c.message_count} messages</div>
              </button>
            ))}
          </Card>
          <Card className={cx("min-h-[50vh]", !selected && "hidden lg:block")}>
            {selected ? <Transcript conv={data.find((c) => c.id === selected) ?? null} id={selected} canReply={can(role, "editSales")} onChanged={reload}
              onBack={() => setParams({})} onDelete={can(role, "deleteSales") ? () => remove(selected) : undefined} />
              : <Empty title="Select a conversation" text="Pick a chat on the left to read it." />}
          </Card>
        </div>
      )}
    </>
  );
}

function Transcript({ id, conv, canReply, onChanged, onBack, onDelete }:
  { id: string; conv: Conversation | null; canReply: boolean; onChanged: () => void; onBack: () => void; onDelete?: () => void }) {
  const { business } = useBusiness();
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const { data, loading, error, reload } = useAsync(async () =>
    must(await supabase.from("messages").select("id, role, content, created_at").eq("conversation_id", id).order("id")) as Message[], [id]);

  useEffect(() => {
    const ch = supabase.channel(`conv-${id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${id}` }, () => void reload())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [id, reload]);

  // Opening a chat marks it as read.
  useEffect(() => {
    if (canReply && conv?.unread) void supabase.from("conversations").update({ unread: false }).eq("id", id).then(() => onChanged());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, conv?.unread]);

  async function setPaused(paused: boolean) {
    setBusy(true);
    const { error } = await supabase.from("conversations").update({ ai_paused: paused }).eq("id", id);
    setBusy(false);
    if (error) toast("error", errorMessage(error));
    else { toast("success", paused ? "You are now handling this chat. The AI is paused." : "The AI agent is answering again."); onChanged(); }
  }

  async function reply(e: FormEvent) {
    e.preventDefault();
    const msg = text.trim();
    if (!msg) return;
    setBusy(true);
    if (!conv?.ai_paused) await supabase.from("conversations").update({ ai_paused: true }).eq("id", id);
    const { error } = await supabase.from("messages").insert({ conversation_id: id, business_id: business.id, role: "agent", content: msg });
    setBusy(false);
    if (error) { toast("error", errorMessage(error)); return; }
    setText(""); void reload(); onChanged();
  }

  const phone = conv?.customers?.phone;
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-slate-600 lg:hidden"><ArrowLeft className="h-4 w-4" />Back</button>
        <span className="hidden text-sm text-slate-500 lg:flex lg:items-center lg:gap-2">
          {conv?.ai_paused ? <><UserRound className="h-4 w-4 text-amber-600" />Team is handling this chat</> : <><Bot className="h-4 w-4 text-indigo-600" />AI agent is answering</>}
        </span>
        <div className="flex items-center gap-1">
          {canReply && conv && (conv.ai_paused
            ? <Button variant="secondary" className="py-1" loading={busy} onClick={() => setPaused(false)}><Bot className="h-4 w-4" />Hand back to AI</Button>
            : <Button variant="secondary" className="py-1" loading={busy} onClick={() => setPaused(true)}><UserRound className="h-4 w-4" />Take over</Button>)}
          {phone && <a href={waLink(phone, `Assalam o Alaikum ${conv?.customers?.name ?? ""}, ${business.name} here.`)} target="_blank" rel="noreferrer" className="rounded p-1.5 text-emerald-600 hover:bg-emerald-50" title="WhatsApp customer"><MessageCircle className="h-4 w-4" /></a>}
          <button onClick={() => void reload()} className="rounded p-1.5 text-slate-500 hover:bg-slate-100" title="Refresh"><RefreshCw className="h-4 w-4" /></button>
          {onDelete && <button onClick={onDelete} className="rounded p-1.5 text-red-500 hover:bg-red-50" title="Delete"><Trash2 className="h-4 w-4" /></button>}
        </div>
      </div>
      <div className="urdu-aware max-h-[56vh] flex-1 space-y-3 overflow-y-auto bg-slate-50 p-4">
        {loading ? <Spinner /> : error ? <ErrorBox message={error} /> : (data ?? []).map((m) => {
          const rtl = isRtl(m.content);
          return (
            <div key={m.id} className={cx("flex", m.role === "user" ? "justify-start" : "justify-end")}>
              <div className="max-w-[85%]">
                <div dir={rtl ? "rtl" : "ltr"} lang={rtl ? "ur" : undefined}
                  className={cx("whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm shadow-sm",
                    m.role === "user" ? "rounded-bl-sm bg-white" : m.role === "agent" ? "rounded-br-sm bg-amber-500 text-white" : "rounded-br-sm bg-indigo-600 text-white")}>
                  {m.content}
                </div>
                <div className={cx("mt-1 text-[11px] text-slate-400", m.role !== "user" && "text-right")}>
                  {m.role === "user" ? "Customer" : m.role === "agent" ? "Team" : "AI agent"} · {dateTime(m.created_at)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {canReply && (
        <form onSubmit={reply} className="flex gap-2 border-t border-slate-200 p-3">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Reply as the team (the AI pauses automatically)…" dir={isRtl(text) ? "rtl" : "ltr"}
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
          <Button type="submit" loading={busy} disabled={!text.trim()}><Send className="h-4 w-4" /></Button>
        </form>
      )}
    </div>
  );
}
