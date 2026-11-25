import { useState, type FormEvent } from "react";
import { Check, Crown, Upload } from "lucide-react";
import { supabase, errorMessage } from "../../lib/supabase";
import { useAsync, must } from "../../lib/useAsync";
import { dateOnly, dateTime, money } from "../../lib/format";
import { can } from "../../lib/permissions";
import { useBusiness } from "../../contexts/BusinessContext";
import { Badge, Button, Card, ErrorBox, Field, Input, Modal, PageHeader, Select, Spinner, Table, cx, td, th, useToast } from "../../components/ui";

export interface Plan {
  id: string; name: string; description: string; currency: string; price_monthly: number; price_yearly: number;
  ai_replies_per_month: number | null; max_products: number | null; max_members: number | null; max_voice_clips: number | null;
  voice_calls: boolean; remove_branding: boolean; features: string[]; sort_order: number; is_active: boolean;
}
interface Usage { plan: Plan; subscribed_plan: string; expires_at: string | null; ai_replies: number; chats: number; products: number; members: number; voice_clips: number }
interface PaymentSettings { jazzcash: string; easypaisa: string; bank_name: string; account_title: string; account_iban: string; instructions: string }
interface PaymentRequest { id: string; plan_id: string; period: string; amount: number; currency: string; method: string; transaction_ref: string; status: string; admin_note: string; created_at: string }

const statusColor = { pending: "amber", approved: "green", rejected: "red" } as const;

export default function Billing() {
  const { business, role } = useBusiness();
  const toast = useToast();
  const admin = can(role, "manageSettings");
  const [period, setPeriod] = useState<"monthly" | "yearly">("monthly");
  const [buying, setBuying] = useState<Plan | null>(null);

  const { data, loading, error, reload } = useAsync(async () => {
    const [usage, plans, settings, payments] = await Promise.all([
      supabase.rpc("plan_usage", { p_business: business.id }),
      supabase.from("plans").select("*").eq("is_active", true).order("sort_order"),
      supabase.from("payment_settings").select("*").eq("id", 1).maybeSingle(),
      admin ? supabase.from("payment_requests").select("*").eq("business_id", business.id).order("created_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
    ]);
    return { usage: must(usage) as Usage, plans: must(plans) as Plan[], settings: (settings.data ?? null) as PaymentSettings | null, payments: must(payments) as PaymentRequest[] };
  }, [business.id, admin]);

  if (loading) return <Spinner />;
  if (error || !data) return <ErrorBox message={error ?? "Could not load"} onRetry={reload} />;
  const { usage: u } = data;
  const bars: [string, number, number | null][] = [
    ["AI replies this month", u.ai_replies, u.plan.ai_replies_per_month],
    ["Products", u.products, u.plan.max_products],
    ["Team members (incl. invites)", u.members, u.plan.max_members],
    ["Own-voice recordings", u.voice_clips, u.plan.max_voice_clips],
  ];
  const expired = u.subscribed_plan !== "free" && u.plan.id === "free";

  return (
    <>
      <PageHeader title="Plan & Billing" subtitle="Chats are unlimited on every plan. Upgrade for more AI replies, products, team and voice." />
      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-3">
          <Crown className="h-5 w-5 text-amber-500" />
          <span className="text-lg font-semibold">{u.plan.name} plan</span>
          {u.expires_at && u.plan.id !== "free" && <Badge color="indigo">Renews / expires {dateOnly(u.expires_at)}</Badge>}
          {expired && <Badge color="red">Your {u.subscribed_plan} plan expired — renew below</Badge>}
          <span className="ml-auto text-sm text-slate-500">{u.chats.toLocaleString()} new chats this month</span>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {bars.map(([label, used, max]) => {
            const pct = max ? Math.min(100, (used / max) * 100) : 0;
            return (
              <div key={label}>
                <div className="mb-1 flex justify-between text-sm"><span>{label}</span><span className="font-medium">{used.toLocaleString()} / {max == null ? "Unlimited" : max.toLocaleString()}</span></div>
                <div className="h-2 rounded-full bg-slate-100"><div className={cx("h-2 rounded-full", pct >= 100 ? "bg-red-500" : pct > 80 ? "bg-amber-500" : "bg-indigo-500")} style={{ width: `${max == null ? 3 : Math.max(pct, 2)}%` }} /></div>
              </div>
            );
          })}
        </div>
        {u.plan.ai_replies_per_month != null && u.ai_replies >= u.plan.ai_replies_per_month &&
          <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">AI replies for this month are used up. Your customers are still answered by the free built-in bot.</p>}
      </Card>

      <div className="mt-8 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Plans</h2>
        <div className="flex rounded-lg border border-slate-300 bg-white p-0.5 text-sm">
          {(["monthly", "yearly"] as const).map((p) => (
            <button key={p} onClick={() => setPeriod(p)} className={cx("rounded-md px-3 py-1", period === p && "bg-indigo-600 text-white")}>{p === "monthly" ? "Monthly" : "Yearly (2 months free)"}</button>
          ))}
        </div>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {data.plans.map((p) => {
          const price = period === "yearly" ? p.price_yearly : p.price_monthly;
          const current = u.plan.id === p.id;
          return (
            <Card key={p.id} className={cx("flex flex-col p-5", current && "ring-2 ring-indigo-500", p.id === "pro" && !current && "ring-1 ring-indigo-200")}>
              <div className="flex items-center justify-between"><h3 className="font-semibold">{p.name}</h3>{p.id === "pro" && <Badge color="indigo">Popular</Badge>}</div>
              <p className="mt-1 text-sm text-slate-500">{p.description}</p>
              <div className="mt-4 text-3xl font-bold">{price ? money(price, p.currency) : "Free"}<span className="text-sm font-normal text-slate-500">{price ? (period === "yearly" ? " / year" : " / month") : ""}</span></div>
              <ul className="mt-4 flex-1 space-y-2 text-sm">
                {p.features.map((f) => <li key={f} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />{f}</li>)}
              </ul>
              <div className="mt-5">
                {current ? <Button variant="secondary" disabled className="w-full">{u.plan.id === "free" ? "Current plan" : "Current plan"}</Button>
                  : p.id === "free" ? <Button variant="secondary" disabled className="w-full">Included</Button>
                  : <Button className="w-full" disabled={!admin} onClick={() => setBuying(p)}>{current ? "Renew" : "Choose " + p.name}</Button>}
                {current && p.id !== "free" && admin && <Button variant="ghost" className="mt-2 w-full" onClick={() => setBuying(p)}>Renew / extend</Button>}
              </div>
            </Card>
          );
        })}
      </div>
      {!admin && <p className="mt-3 text-sm text-slate-500">Only the owner or an admin can buy a plan.</p>}

      {admin && data.payments.length > 0 && (
        <Card className="mt-8">
          <h2 className="border-b border-slate-200 px-5 py-4 font-semibold">Payment history</h2>
          <Table>
            <thead><tr><th className={th}>Date</th><th className={th}>Plan</th><th className={th}>Amount</th><th className={th}>Method / Ref</th><th className={th}>Status</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {data.payments.map((r) => (
                <tr key={r.id}>
                  <td className={td}>{dateTime(r.created_at)}</td>
                  <td className={td}>{r.plan_id} · {r.period}</td>
                  <td className={td}>{money(r.amount, r.currency)}</td>
                  <td className={td}>{r.method} · <span className="font-mono text-xs">{r.transaction_ref}</span></td>
                  <td className={td}><Badge color={statusColor[r.status as keyof typeof statusColor] ?? "gray"}>{r.status}</Badge>{r.admin_note && <div className="text-xs text-slate-500">{r.admin_note}</div>}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {buying && <PayModal plan={buying} period={period} settings={data.settings} onClose={() => setBuying(null)}
        onDone={() => { setBuying(null); toast("success", "Payment submitted. Your plan will be activated after verification."); void reload(); }} />}
    </>
  );
}

function PayModal({ plan, period, settings, onClose, onDone }: { plan: Plan; period: "monthly" | "yearly"; settings: PaymentSettings | null; onClose: () => void; onDone: () => void }) {
  const { business } = useBusiness();
  const [method, setMethod] = useState<"jazzcash" | "easypaisa" | "bank">(settings?.jazzcash ? "jazzcash" : settings?.easypaisa ? "easypaisa" : "bank");
  const [ref, setRef] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const amount = period === "yearly" ? plan.price_yearly : plan.price_monthly;
  const configured = !!(settings && (settings.jazzcash || settings.easypaisa || settings.account_iban));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) { setErr("Please attach the payment screenshot."); return; }
    if (file.size > 3 * 1024 * 1024) { setErr("The screenshot must be smaller than 3 MB."); return; }
    setSaving(true); setErr(null);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
      const path = `${business.id}/${Date.now()}.${ext}`;
      const up = await supabase.storage.from("payment-proofs").upload(path, file, { contentType: file.type || "image/jpeg" });
      if (up.error) throw up.error;
      const { error } = await supabase.from("payment_requests").insert({ business_id: business.id, plan_id: plan.id, period, method, transaction_ref: ref.trim(), proof_path: path });
      if (error) throw error;
      onDone();
    } catch (e2) { setErr(errorMessage(e2)); } finally { setSaving(false); }
  }

  return (
    <Modal open onClose={onClose} title={`Buy ${plan.name} — ${money(amount, plan.currency)} ${period === "yearly" ? "/ year" : "/ month"}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button form="pay-form" type="submit" loading={saving} disabled={!configured}>Submit payment</Button></>}>
      {!configured ? (
        <p className="text-sm text-slate-600">Payments are not set up yet. Please contact the platform owner.</p>
      ) : (
        <form id="pay-form" onSubmit={submit} className="space-y-4 text-sm">
          {err && <ErrorBox message={err} />}
          <ol className="list-decimal space-y-1 pl-5 text-slate-700">
            <li>Send <b>{money(amount, plan.currency)}</b> using one of these accounts.</li>
            <li>Enter the transaction ID (TID) and attach the screenshot.</li>
            <li>We verify and activate your plan (you'll see it here).</li>
          </ol>
          <Field label="Payment method">
            <Select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
              {settings!.jazzcash && <option value="jazzcash">JazzCash</option>}
              {settings!.easypaisa && <option value="easypaisa">Easypaisa</option>}
              {settings!.account_iban && <option value="bank">Bank transfer</option>}
            </Select>
          </Field>
          <div className="rounded-lg bg-slate-50 p-3">
            {method === "jazzcash" && <>JazzCash number: <b className="font-mono">{settings!.jazzcash}</b>{settings!.account_title && <> · {settings!.account_title}</>}</>}
            {method === "easypaisa" && <>Easypaisa number: <b className="font-mono">{settings!.easypaisa}</b>{settings!.account_title && <> · {settings!.account_title}</>}</>}
            {method === "bank" && <>{settings!.bank_name}<br />Title: <b>{settings!.account_title}</b><br />IBAN / Account: <b className="font-mono">{settings!.account_iban}</b></>}
          </div>
          {settings!.instructions && <p className="text-xs text-slate-500">{settings!.instructions}</p>}
          <Field label="Transaction ID (TID)"><Input required minLength={3} maxLength={100} value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border-2 border-dashed border-slate-300 px-3 py-4 text-slate-600 hover:bg-slate-50">
            <Upload className="h-5 w-5" />{file ? file.name : "Attach payment screenshot (JPG / PNG / PDF)"}
            <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
        </form>
      )}
    </Modal>
  );
}
