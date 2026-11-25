import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Check, ExternalLink, ShieldCheck, X } from "lucide-react";
import { supabase, errorMessage } from "../lib/supabase";
import { useAsync, must } from "../lib/useAsync";
import { dateOnly, dateTime, money } from "../lib/format";
import type { Plan } from "./app/Billing";
import { Badge, Button, Card, ErrorBox, Field, Input, PageHeader, Select, Spinner, Table, Textarea, cx, td, th, useToast } from "../components/ui";

type Tab = "payments" | "businesses" | "plans" | "settings";

/** Platform owner panel: approve payments, manage plans, see all businesses. Only for rows in platform_admins. */
export default function PlatformAdmin() {
  const [tab, setTab] = useState<Tab>("payments");
  const { data: isAdmin, loading } = useAsync(async () => must(await supabase.rpc("is_platform_admin")) as boolean, []);
  if (loading) return <Spinner />;
  if (!isAdmin) return <div className="p-10 text-center text-slate-600">This page is only for the platform owner. <Link to="/app" className="text-indigo-600">Back</Link></div>;
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <Link to="/app" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500"><ArrowLeft className="h-4 w-4" />Back to my businesses</Link>
      <PageHeader title="Platform admin" subtitle="Payments, plans and all businesses on your platform." />
      <div className="mb-6 flex flex-wrap gap-2">
        {([["payments", "Payments"], ["businesses", "Businesses"], ["plans", "Plans & prices"], ["settings", "Payment accounts"]] as [Tab, string][]).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={cx("rounded-lg px-4 py-2 text-sm font-medium", tab === k ? "bg-indigo-600 text-white" : "bg-white text-slate-600 border border-slate-200")}>{l}</button>
        ))}
      </div>
      {tab === "payments" && <Payments />}
      {tab === "businesses" && <Businesses />}
      {tab === "plans" && <Plans />}
      {tab === "settings" && <PaymentAccounts />}
    </div>
  );
}

interface PR { id: string; business_id: string; plan_id: string; period: string; amount: number; currency: string; method: string; transaction_ref: string; proof_path: string | null; status: string; admin_note: string; created_at: string; businesses?: { name: string } | null }

function Payments() {
  const toast = useToast();
  const [status, setStatus] = useState("pending");
  const { data, loading, error, reload } = useAsync(async () =>
    must(await supabase.from("payment_requests").select("*, businesses(name)").eq("status", status).order("created_at", { ascending: false }).limit(200)) as PR[], [status]);

  async function proof(path: string) {
    const { data: s, error } = await supabase.storage.from("payment-proofs").createSignedUrl(path, 300);
    if (error || !s) toast("error", errorMessage(error)); else window.open(s.signedUrl, "_blank");
  }
  async function review(r: PR, approve: boolean) {
    const note = approve ? "" : (window.prompt("Reason for rejecting (shown to the customer):") ?? "");
    if (!approve && !note) return;
    const { error } = await supabase.rpc("review_payment", { p_id: r.id, p_approve: approve, p_note: note });
    if (error) toast("error", errorMessage(error)); else { toast("success", approve ? "Approved — plan activated" : "Rejected"); void reload(); }
  }

  return (
    <Card>
      <div className="flex items-center gap-3 border-b border-slate-200 p-4">
        <Select className="w-44" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option>
        </Select>
        <span className="text-sm text-slate-500">Check each transaction ID in your JazzCash / Easypaisa / bank app before approving.</span>
      </div>
      {loading ? <Spinner /> : error ? <div className="p-4"><ErrorBox message={error} onRetry={reload} /></div> : !data?.length ? <p className="p-8 text-center text-sm text-slate-500">Nothing here.</p> : (
        <Table>
          <thead><tr><th className={th}>Date</th><th className={th}>Business</th><th className={th}>Plan</th><th className={th}>Amount</th><th className={th}>Method / TID</th><th className={th} /></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {data.map((r) => (
              <tr key={r.id}>
                <td className={td}>{dateTime(r.created_at)}</td>
                <td className={td}>{r.businesses?.name ?? r.business_id}</td>
                <td className={td}>{r.plan_id} · {r.period}</td>
                <td className={`${td} font-medium`}>{money(r.amount, r.currency)}</td>
                <td className={td}>{r.method}<div className="font-mono text-xs">{r.transaction_ref}</div></td>
                <td className={`${td} whitespace-nowrap text-right`}>
                  {r.proof_path && <Button variant="ghost" onClick={() => proof(r.proof_path!)}><ExternalLink className="h-4 w-4" />Screenshot</Button>}
                  {r.status === "pending" ? <>
                    <Button className="ml-1" onClick={() => review(r, true)}><Check className="h-4 w-4" />Approve</Button>
                    <Button variant="danger" className="ml-1" onClick={() => review(r, false)}><X className="h-4 w-4" />Reject</Button>
                  </> : <Badge color={r.status === "approved" ? "green" : "red"}>{r.status}</Badge>}
                  {r.admin_note && <div className="text-xs text-slate-500">{r.admin_note}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

interface AB { id: string; name: string; slug: string; owner_email: string | null; plan_id: string; plan_expires_at: string | null; ai_replies: number; chats: number; orders: number; created_at: string }

function Businesses() {
  const toast = useToast();
  const [q, setQ] = useState("");
  const { data, loading, error, reload } = useAsync(async () => {
    const [b, p] = await Promise.all([supabase.rpc("admin_businesses"), supabase.from("plans").select("id, name").order("sort_order")]);
    return { list: must(b) as AB[], plans: must(p) as { id: string; name: string }[] };
  }, []);

  async function setPlan(b: AB, plan: string) {
    let expires: string | null = null;
    if (plan !== "free") {
      const months = window.prompt(`Give ${b.name} the ${plan} plan for how many months? (0 = no expiry)`, "1");
      if (months === null) return;
      const m = Math.max(0, Math.floor(Number(months) || 0));
      if (m > 0) { const d = new Date(); d.setMonth(d.getMonth() + m); expires = d.toISOString(); }
    }
    const { error } = await supabase.rpc("admin_set_plan", { p_business: b.id, p_plan: plan, p_expires: expires });
    if (error) toast("error", errorMessage(error)); else { toast("success", "Plan updated"); void reload(); }
  }

  const list = (data?.list ?? []).filter((b) => !q || `${b.name} ${b.slug} ${b.owner_email}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Card>
      <div className="border-b border-slate-200 p-4"><Input placeholder="Search business or owner email…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {loading ? <Spinner /> : error ? <div className="p-4"><ErrorBox message={error} onRetry={reload} /></div> : (
        <Table>
          <thead><tr><th className={th}>Business</th><th className={th}>Owner</th><th className={th}>Plan</th><th className={th}>This month</th><th className={th}>Orders</th><th className={th}>Joined</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {list.map((b) => (
              <tr key={b.id}>
                <td className={td}><div className="font-medium">{b.name}</div><a href={`/chat/${b.slug}`} target="_blank" rel="noreferrer" className="text-xs text-indigo-600">/chat/{b.slug}</a></td>
                <td className={td}>{b.owner_email ?? "—"}</td>
                <td className={td}>
                  <Select className="w-36 py-1" value={b.plan_id} onChange={(e) => setPlan(b, e.target.value)}>
                    {data!.plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </Select>
                  {b.plan_expires_at && <div className={cx("mt-1 text-xs", new Date(b.plan_expires_at) < new Date() ? "text-red-600" : "text-slate-500")}>until {dateOnly(b.plan_expires_at)}</div>}
                </td>
                <td className={td}>{b.ai_replies} AI · {b.chats} chats</td>
                <td className={td}>{b.orders}</td>
                <td className={td}>{dateOnly(b.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function Plans() {
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(async () => must(await supabase.from("plans").select("*").order("sort_order")) as Plan[], []);
  const [edit, setEdit] = useState<Plan | null>(null);
  const [saving, setSaving] = useState(false);
  const num = (v: string) => (v.trim() === "" ? null : Math.max(0, Math.floor(Number(v))));

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!edit) return;
    setSaving(true);
    const { id, ...rest } = edit;
    const { error } = await supabase.from("plans").update({ ...rest, features: rest.features.map((f) => f.trim()).filter(Boolean) }).eq("id", id);
    setSaving(false);
    if (error) toast("error", errorMessage(error)); else { toast("success", "Plan saved"); setEdit(null); void reload(); }
  }

  if (loading) return <Spinner />;
  if (error || !data) return <ErrorBox message={error ?? "Could not load"} onRetry={reload} />;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {data.map((p) => edit?.id === p.id ? (
        <Card key={p.id} className="p-5">
          <form onSubmit={save} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
              <Field label="Currency"><Input value={edit.currency} onChange={(e) => setEdit({ ...edit, currency: e.target.value })} /></Field>
              <Field label="Price / month"><Input type="number" min="0" value={edit.price_monthly} onChange={(e) => setEdit({ ...edit, price_monthly: Number(e.target.value) })} /></Field>
              <Field label="Price / year"><Input type="number" min="0" value={edit.price_yearly} onChange={(e) => setEdit({ ...edit, price_yearly: Number(e.target.value) })} /></Field>
              <Field label="AI replies / month" hint="Empty = unlimited"><Input type="number" min="0" value={edit.ai_replies_per_month ?? ""} onChange={(e) => setEdit({ ...edit, ai_replies_per_month: num(e.target.value) })} /></Field>
              <Field label="Max products" hint="Empty = unlimited"><Input type="number" min="0" value={edit.max_products ?? ""} onChange={(e) => setEdit({ ...edit, max_products: num(e.target.value) })} /></Field>
              <Field label="Max team members" hint="Empty = unlimited"><Input type="number" min="1" value={edit.max_members ?? ""} onChange={(e) => setEdit({ ...edit, max_members: num(e.target.value) })} /></Field>
              <Field label="Max voice recordings" hint="Empty = unlimited"><Input type="number" min="0" value={edit.max_voice_clips ?? ""} onChange={(e) => setEdit({ ...edit, max_voice_clips: num(e.target.value) })} /></Field>
            </div>
            <Field label="Description"><Input value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
            <Field label="Features (one per line, shown on the pricing card)"><Textarea rows={5} value={edit.features.join("\n")} onChange={(e) => setEdit({ ...edit, features: e.target.value.split("\n") })} /></Field>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={edit.voice_calls} onChange={(e) => setEdit({ ...edit, voice_calls: e.target.checked })} />Voice calls</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={edit.remove_branding} onChange={(e) => setEdit({ ...edit, remove_branding: e.target.checked })} />Remove branding</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={edit.is_active} disabled={edit.id === "free"} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} />On sale</label>
            </div>
            <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button type="submit" loading={saving}>Save</Button></div>
          </form>
        </Card>
      ) : (
        <Card key={p.id} className="p-5">
          <div className="flex items-center justify-between"><h3 className="font-semibold">{p.name} {!p.is_active && <Badge>hidden</Badge>}</h3><Button variant="secondary" onClick={() => setEdit({ ...p })}>Edit</Button></div>
          <p className="mt-1 text-sm text-slate-500">{money(p.price_monthly, p.currency)} / month · {money(p.price_yearly, p.currency)} / year</p>
          <p className="mt-2 text-sm">AI: {p.ai_replies_per_month ?? "∞"} · Products: {p.max_products ?? "∞"} · Team: {p.max_members ?? "∞"} · Voice: {p.max_voice_clips ?? "∞"}</p>
        </Card>
      ))}
    </div>
  );
}

function PaymentAccounts() {
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(async () => must(await supabase.from("payment_settings").select("*").eq("id", 1).single()) as Record<string, string>, []);
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [saving, setSaving] = useState(false);
  const f = form ?? data;
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!f) return;
    setSaving(true);
    const { error } = await supabase.from("payment_settings").update({
      jazzcash: f.jazzcash, easypaisa: f.easypaisa, bank_name: f.bank_name, account_title: f.account_title, account_iban: f.account_iban, instructions: f.instructions,
    }).eq("id", 1);
    setSaving(false);
    if (error) toast("error", errorMessage(error)); else { toast("success", "Saved"); void reload(); }
  }
  if (loading) return <Spinner />;
  if (error || !f) return <ErrorBox message={error ?? "Could not load"} onRetry={reload} />;
  const set = (k: string, v: string) => setForm({ ...f, [k]: v });
  return (
    <Card className="max-w-2xl p-5">
      <h2 className="mb-1 flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4" />Where customers send plan payments</h2>
      <p className="mb-4 text-sm text-slate-500">Shown on every business's Plan & Billing page. Leave a field empty to hide that method.</p>
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <Field label="JazzCash number"><Input value={f.jazzcash} onChange={(e) => set("jazzcash", e.target.value)} /></Field>
        <Field label="Easypaisa number"><Input value={f.easypaisa} onChange={(e) => set("easypaisa", e.target.value)} /></Field>
        <Field label="Account title (name)"><Input value={f.account_title} onChange={(e) => set("account_title", e.target.value)} /></Field>
        <Field label="Bank name"><Input value={f.bank_name} onChange={(e) => set("bank_name", e.target.value)} /></Field>
        <Field label="IBAN / account number" className="sm:col-span-2"><Input value={f.account_iban} onChange={(e) => set("account_iban", e.target.value)} /></Field>
        <Field label="Instructions" className="sm:col-span-2"><Textarea rows={3} value={f.instructions} onChange={(e) => set("instructions", e.target.value)} /></Field>
        <div className="sm:col-span-2 flex justify-end"><Button type="submit" loading={saving}>Save</Button></div>
      </form>
    </Card>
  );
}
