import { useState } from "react";
import { Database, Download, Trash2 } from "lucide-react";
import { supabase, errorMessage } from "../lib/supabase";
import { useAsync, must } from "../lib/useAsync";
import { dateOnly } from "../lib/format";
import { can } from "../lib/permissions";
import { useBusiness } from "../contexts/BusinessContext";
import { Button, Card, ErrorBox, Field, Select, Spinner, confirmAction, useToast } from "./ui";

interface Usage {
  database_bytes: number; business_bytes: number; messages_bytes: number;
  conversations: number; messages: number; customers: number; orders: number; products: number; oldest_chat: string | null;
}
const FREE_PLAN_BYTES = 500 * 1024 * 1024; // Supabase free plan database size (check supabase.com/pricing)
const mb = (b: number) => `${(b / 1024 / 1024).toFixed(b < 10 * 1024 * 1024 ? 1 : 0)} MB`;
const retentionOptions = [
  [30, "1 month"], [90, "3 months"], [180, "6 months (recommended)"], [365, "1 year"], [730, "2 years"], [0, "Keep forever"],
] as const;

/** Storage usage, automatic chat clean-up and full backup download. */
export default function DataStorage() {
  const { business, role, refresh } = useBusiness();
  const toast = useToast();
  const admin = can(role, "manageSettings");
  const [busy, setBusy] = useState<string | null>(null);
  const { data, loading, error, reload } = useAsync(async () =>
    must(await supabase.rpc("storage_usage", { p_business: business.id })) as Usage, [business.id]);

  async function setRetention(days: number) {
    setBusy("ret");
    const { error } = await supabase.from("businesses").update({ chat_retention_days: days }).eq("id", business.id);
    setBusy(null);
    if (error) toast("error", errorMessage(error)); else { toast("success", "Saved"); await refresh(); }
  }

  async function cleanNow() {
    if (!confirmAction("Delete chats older than the retention period, and abandoned one-message chats older than 7 days? Orders, customers and leads are kept.")) return;
    setBusy("clean");
    const { data: res, error } = await supabase.rpc("cleanup_old_data", { p_business: business.id });
    setBusy(null);
    if (error) { toast("error", errorMessage(error)); return; }
    const r = res as { old_chats_deleted: number; abandoned_chats_deleted: number };
    toast("success", `Removed ${r.old_chats_deleted + r.abandoned_chats_deleted} chats`);
    void reload();
  }

  /** Download every record of this business as one JSON file (keep it safe — it is your own backup). */
  async function backup() {
    setBusy("backup");
    try {
      const tables = ["products", "knowledge_entries", "customers", "leads", "orders", "order_items", "conversations", "messages"] as const;
      const out: Record<string, unknown> = { exported_at: new Date().toISOString(), business };
      for (const t of tables) {
        const rows: unknown[] = [];
        for (let from = 0; ; from += 1000) {
          const { data, error } = await supabase.from(t).select("*").eq("business_id", business.id).range(from, from + 999);
          if (error) throw error;
          rows.push(...(data ?? []));
          if (!data || data.length < 1000) break;
        }
        out[t] = rows;
      }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 1)], { type: "application/json" }));
      a.download = `${business.slug}-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (e) { toast("error", errorMessage(e)); } finally { setBusy(null); }
  }

  const pct = data ? Math.min(100, (data.database_bytes / FREE_PLAN_BYTES) * 100) : 0;
  return (
    <Card className="mt-6 p-5">
      <h2 className="mb-1 flex items-center gap-2 font-semibold"><Database className="h-4 w-4" />Data & storage</h2>
      <p className="mb-4 text-sm text-slate-500">Keeps your database small so the free plan never fills up. Orders, customers and leads are never deleted automatically.</p>
      {loading ? <Spinner /> : error || !data ? <ErrorBox message={error ?? "Could not load"} onRetry={reload} /> : (
        <>
          <div className="mb-1 flex justify-between text-sm"><span>Whole database (all businesses)</span><span className="font-medium">{mb(data.database_bytes)} of ~500 MB free</span></div>
          <div className="h-2 rounded-full bg-slate-100"><div className={`h-2 rounded-full ${pct > 80 ? "bg-red-500" : pct > 60 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.max(pct, 1)}%` }} /></div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
            {[["Chats", data.conversations], ["Messages", data.messages], ["Customers", data.customers], ["Orders", data.orders], ["Products", data.products]].map(([k, v]) => (
              <div key={k} className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">{k}</div><div className="text-lg font-semibold">{Number(v).toLocaleString()}</div></div>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">This business uses about {mb(data.business_bytes)} ({mb(data.messages_bytes)} in chat messages). {data.oldest_chat && `Oldest chat: ${dateOnly(data.oldest_chat)}.`}</p>
        </>
      )}
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label="Delete chats automatically after" hint="Runs every night. Chats linked to orders lose only the chat text; the order stays.">
          <Select disabled={!admin || busy === "ret"} value={business.chat_retention_days ?? 180} onChange={(e) => setRetention(Number(e.target.value))}>
            {retentionOptions.map(([d, l]) => <option key={d} value={d}>{l}</option>)}
          </Select>
        </Field>
        <div className="flex flex-wrap items-end gap-2">
          {admin && <Button variant="secondary" loading={busy === "clean"} onClick={cleanNow}><Trash2 className="h-4 w-4" />Clean now</Button>}
          <Button variant="secondary" loading={busy === "backup"} onClick={backup}><Download className="h-4 w-4" />Download full backup</Button>
        </div>
      </div>
    </Card>
  );
}
