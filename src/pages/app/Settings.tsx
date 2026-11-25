import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Copy, ExternalLink } from "lucide-react";
import { supabase, errorMessage } from "../../lib/supabase";
import { can } from "../../lib/permissions";
import type { Business } from "../../lib/types";
import { useBusiness } from "../../contexts/BusinessContext";
import DataStorage from "../../components/DataStorage";
import ConnectedAccounts from "../../components/ConnectedAccounts";
import { Button, Card, ErrorBox, Field, Input, PageHeader, Select, Textarea, confirmAction, useToast } from "../../components/ui";

type Form = Pick<Business, "name" | "description" | "industry" | "currency" | "phone" | "email" | "address" | "website" |
  "bot_name" | "bot_greeting" | "bot_instructions" | "bot_language" | "brand_color" | "chat_enabled" | "ai_mode" | "quick_replies">;

const languages = ["auto", "English", "Urdu", "Roman Urdu", "Arabic", "Hindi", "Punjabi"];

export default function SettingsPage() {
  const { business, role, refresh } = useBusiness();
  const toast = useToast();
  const navigate = useNavigate();
  const editable = can(role, "manageSettings");
  const [form, setForm] = useState<Form>(() => ({
    name: business.name, description: business.description, industry: business.industry, currency: business.currency,
    phone: business.phone, email: business.email, address: business.address, website: business.website,
    bot_name: business.bot_name, bot_greeting: business.bot_greeting, bot_instructions: business.bot_instructions,
    bot_language: business.bot_language, brand_color: business.brand_color, chat_enabled: business.chat_enabled,
    ai_mode: business.ai_mode ?? "auto", quick_replies: business.quick_replies ?? [],
  }));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const origin = window.location.origin;
  const chatUrl = `${origin}/chat/${business.slug}`;
  const embed = `<script src="${origin}/widget.js" data-business="${business.slug}" data-color="${form.brand_color}" async></script>`;

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true); setErr(null);
    const quick = form.quick_replies.map((q) => q.trim()).filter(Boolean).slice(0, 8);
    const { error } = await supabase.from("businesses").update({ ...form, quick_replies: quick, name: form.name.trim(), currency: form.currency.trim().toUpperCase() }).eq("id", business.id);
    setSaving(false);
    if (error) { setErr(errorMessage(error)); return; }
    toast("success", "Settings saved"); await refresh();
  }

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); toast("success", "Copied"); } catch { toast("error", "Copy failed — select and copy manually"); }
  }

  async function deleteBusiness() {
    const typed = window.prompt(`This permanently deletes ${business.name} and ALL its products, customers, orders and chats.\nType the business name to confirm:`);
    if (typed !== business.name) { if (typed !== null) toast("error", "Name did not match"); return; }
    if (!confirmAction("Last chance — delete everything?")) return;
    const { error } = await supabase.from("businesses").delete().eq("id", business.id);
    if (error) { toast("error", errorMessage(error)); return; }
    await refresh(); navigate("/app", { replace: true });
  }

  return (
    <>
      <PageHeader title="Settings" subtitle={editable ? "Business profile and AI chatbot behaviour." : "You have read-only access to settings."} />
      <form onSubmit={save} className="space-y-6">
        {err && <ErrorBox message={err} />}
        <fieldset disabled={!editable} className="space-y-6">
          <Card className="p-5">
            <h2 className="mb-4 font-semibold">Business profile</h2>
            <p className="-mt-3 mb-4 text-sm text-slate-500">The AI agent shares these details with customers.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Business name"><Input required minLength={2} value={form.name} onChange={(e) => set("name", e.target.value)} /></Field>
              <Field label="Industry"><Input value={form.industry} onChange={(e) => set("industry", e.target.value)} /></Field>
              <Field label="About the business" className="sm:col-span-2"><Textarea rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="What you sell, who you serve, opening hours…" /></Field>
              <Field label="Phone / WhatsApp"><Input value={form.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
              <Field label="Email"><Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} /></Field>
              <Field label="Address"><Input value={form.address} onChange={(e) => set("address", e.target.value)} /></Field>
              <Field label="Website"><Input value={form.website} onChange={(e) => set("website", e.target.value)} /></Field>
              <Field label="Currency code"><Input required maxLength={5} value={form.currency} onChange={(e) => set("currency", e.target.value)} /></Field>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="mb-4 font-semibold">AI chatbot</h2>
            <div className="mb-5 grid gap-3 sm:grid-cols-2">
              {([
                ["auto", "Smart AI + free backup", "Uses the AI model for natural answers. If the AI is busy, over its free quota or not set up, the built-in bot answers instead — customers are never left without a reply."],
                ["basic", "Built-in bot only (100% free, unlimited)", "No AI service at all, so no quota and no cost. Answers prices, product details and FAQs, and takes orders and call-back requests step by step."],
              ] as const).map(([value, title, text]) => (
                <label key={value} className={`cursor-pointer rounded-xl border p-4 ${form.ai_mode === value ? "border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500" : "border-slate-200"}`}>
                  <div className="flex items-center gap-2 font-medium"><input type="radio" name="ai_mode" checked={form.ai_mode === value} onChange={() => set("ai_mode", value)} />{title}</div>
                  <p className="mt-1 text-xs text-slate-600">{text}</p>
                </label>
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Assistant name"><Input required value={form.bot_name} onChange={(e) => set("bot_name", e.target.value)} /></Field>
              <Field label="Reply language" hint="'auto' replies in the customer's own language.">
                <Select value={form.bot_language} onChange={(e) => set("bot_language", e.target.value)}>{languages.map((l) => <option key={l}>{l}</option>)}</Select></Field>
              <Field label="Greeting message" className="sm:col-span-2"><Input value={form.bot_greeting} onChange={(e) => set("bot_greeting", e.target.value)} /></Field>
              <Field label="Quick-reply buttons" className="sm:col-span-2" hint="One per line (max 8). Shown as tap-to-send buttons in the chat. Leave empty for the defaults.">
                <Textarea rows={3} value={form.quick_replies.join("\n")} onChange={(e) => set("quick_replies", e.target.value.split("\n"))}
                  placeholder={"Product list\nPlace an order\nDelivery charges?\nTalk to a person"} /></Field>
              <Field label="Instructions for the AI" className="sm:col-span-2" hint="Tone, upselling, what to avoid, minimum order, etc. Example: “Be polite and use 'aap'. Suggest a matching item. Minimum order Rs 500.”">
                <Textarea rows={5} maxLength={8000} value={form.bot_instructions} onChange={(e) => set("bot_instructions", e.target.value)} /></Field>
              <Field label="Brand colour"><div className="flex gap-2"><input type="color" value={form.brand_color} onChange={(e) => set("brand_color", e.target.value)} className="h-10 w-14 rounded border border-slate-300" />
                <Input value={form.brand_color} pattern="^#[0-9a-fA-F]{6}$" onChange={(e) => set("brand_color", e.target.value)} /></div></Field>
              <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={form.chat_enabled} onChange={(e) => set("chat_enabled", e.target.checked)} /> Chatbot is online</label>
            </div>
          </Card>
        </fieldset>
        {editable && <div className="flex justify-end"><Button type="submit" loading={saving}>Save settings</Button></div>}
      </form>

      <Card className="mt-6 p-5">
        <h2 className="mb-1 font-semibold">Put the chatbot to work</h2>
        <p className="mb-4 text-sm text-slate-500">Share the link on WhatsApp, Instagram or Facebook, or add the chat bubble to your website.</p>
        <Field label="Chat link">
          <div className="flex gap-2"><Input readOnly value={chatUrl} onFocus={(e) => e.target.select()} />
            <Button type="button" variant="secondary" onClick={() => copy(chatUrl)}><Copy className="h-4 w-4" /></Button>
            <a href={chatUrl} target="_blank" rel="noreferrer"><Button type="button" variant="secondary"><ExternalLink className="h-4 w-4" /></Button></a></div>
        </Field>
        <Field label="Website widget — paste before </body>" className="mt-4">
          <div className="flex gap-2"><Textarea readOnly rows={2} className="font-mono text-xs" value={embed} onFocus={(e) => e.target.select()} />
            <Button type="button" variant="secondary" onClick={() => copy(embed)}><Copy className="h-4 w-4" /></Button></div>
        </Field>
      </Card>

      <ConnectedAccounts />
      <DataStorage />

      {can(role, "deleteBusiness") && (
        <Card className="mt-6 border-red-200 p-5">
          <h2 className="font-semibold text-red-700">Danger zone</h2>
          <p className="mt-1 text-sm text-slate-600">Delete this business and all of its data. This cannot be undone.</p>
          <Button variant="danger" className="mt-4" onClick={deleteBusiness}>Delete business</Button>
        </Card>
      )}
    </>
  );
}
