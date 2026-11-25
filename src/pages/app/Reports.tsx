import { useState } from "react";
import { Download } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useAsync, must } from "../../lib/useAsync";
import { dateTime, downloadCsv, isoDay, money } from "../../lib/format";
import { cap, leadStatuses, orderColor, orderStatuses } from "../../lib/status";
import type { Order, SalesReport } from "../../lib/types";
import { useBusiness } from "../../contexts/BusinessContext";
import { Badge, Button, Card, ErrorBox, Field, Input, PageHeader, Spinner, Table, cx, td, th } from "../../components/ui";

const presets = [
  { label: "Today", days: 0 }, { label: "7 days", days: 6 }, { label: "30 days", days: 29 }, { label: "90 days", days: 89 },
];

export default function Reports() {
  const { business } = useBusiness();
  const today = isoDay(new Date());
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 29); return isoDay(d); });
  const [to, setTo] = useState(today);

  const { data, loading, error, reload } = useAsync(async () =>
    must(await supabase.rpc("sales_report", { p_business: business.id, p_from: from, p_to: to })) as SalesReport, [business.id, from, to]);

  function setPreset(days: number) {
    const d = new Date(); d.setDate(d.getDate() - days);
    setFrom(isoDay(d)); setTo(today);
  }

  async function exportOrders() {
    const end = new Date(to); end.setDate(end.getDate() + 1);
    const { data: rows } = await supabase.from("orders").select("*, customers(name, phone), order_items(*)")
      .eq("business_id", business.id).gte("created_at", from).lt("created_at", isoDay(end)).order("created_at");
    downloadCsv(`sales-${business.slug}-${from}-to-${to}.csv`, [
      ["Order", "Date", "Customer", "Phone", "Status", "Source", "Items", `Total (${business.currency})`],
      ...((rows ?? []) as Order[]).map((o) => [o.order_number, dateTime(o.created_at), o.customers?.name, o.customers?.phone, o.status, o.source,
        (o.order_items ?? []).map((i) => `${i.quantity} x ${i.name}`).join("; "), o.total]),
    ]);
  }

  const conversion = data && data.conversations ? Math.round((data.chat_orders / data.conversations) * 100) : 0;

  return (
    <>
      <PageHeader title="Sales Reports" subtitle="Revenue excludes cancelled orders."
        actions={<Button variant="secondary" onClick={exportOrders}><Download className="h-4 w-4" />Export orders (CSV)</Button>} />
      <Card className="mb-6 flex flex-col gap-3 p-4 md:flex-row md:items-end">
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => {
            const d = new Date(); d.setDate(d.getDate() - p.days);
            const active = from === isoDay(d) && to === today;
            return <button key={p.label} onClick={() => setPreset(p.days)} className={cx("rounded-lg border px-3 py-1.5 text-sm", active ? "border-indigo-600 bg-indigo-50 text-indigo-700" : "border-slate-300 bg-white")}>{p.label}</button>;
          })}
        </div>
        <div className="flex gap-3 md:ml-auto">
          <Field label="From"><Input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /></Field>
          <Field label="To"><Input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} /></Field>
        </div>
      </Card>

      {loading ? <Spinner /> : error || !data ? <ErrorBox message={error ?? "Could not load"} onRetry={reload} /> : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="Revenue" value={money(data.revenue, business.currency)} />
            <Kpi label="Orders" value={data.orders} sub={`${data.cancelled} cancelled`} />
            <Kpi label="Average order" value={money(data.avg_order, business.currency)} />
            <Kpi label="Chat → order rate" value={`${conversion}%`} sub={`${data.chat_orders} orders from ${data.conversations} chats`} />
            <Kpi label="New customers" value={data.new_customers} />
            <Kpi label="New leads" value={data.new_leads} />
            <Kpi label="Leads won" value={data.won_leads} />
            <Kpi label="Conversations" value={data.conversations} />
          </div>
          <Card className="mt-6 p-5"><h2 className="mb-4 font-semibold">Revenue per day</h2><BarChart data={data.by_day} currency={business.currency} /></Card>
          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <h2 className="border-b border-slate-200 px-5 py-4 font-semibold">Top products & services</h2>
              {data.top_products.length ? (
                <Table>
                  <thead><tr><th className={th}>Item</th><th className={th}>Qty sold</th><th className={th}>Revenue</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.top_products.map((p) => <tr key={p.name}><td className={td}>{p.name}</td><td className={td}>{p.quantity}</td><td className={td}>{money(p.revenue, business.currency)}</td></tr>)}
                  </tbody>
                </Table>
              ) : <p className="p-8 text-center text-sm text-slate-500">No sales in this period.</p>}
            </Card>
            <div className="space-y-6">
              <Card className="p-5">
                <h2 className="mb-3 font-semibold">Orders by status</h2>
                {orderStatuses.map((s) => (
                  <div key={s} className="flex items-center justify-between py-1 text-sm"><Badge color={orderColor[s]}>{cap(s)}</Badge><span className="font-medium">{data.by_status[s] ?? 0}</span></div>
                ))}
              </Card>
              <Card className="p-5">
                <h2 className="mb-3 font-semibold">Lead pipeline</h2>
                {leadStatuses.map((s) => {
                  const n = data.lead_funnel[s] ?? 0;
                  const pct = data.new_leads ? Math.round((n / data.new_leads) * 100) : 0;
                  return (
                    <div key={s} className="py-1 text-sm">
                      <div className="flex justify-between"><span>{cap(s)}</span><span className="font-medium">{n}</span></div>
                      <div className="mt-1 h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-indigo-500" style={{ width: `${pct}%` }} /></div>
                    </div>
                  );
                })}
              </Card>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return <Card className="p-5"><div className="text-sm text-slate-500">{label}</div><div className="mt-1 text-2xl font-bold">{value}</div>{sub && <div className="text-xs text-slate-500">{sub}</div>}</Card>;
}

/** Lightweight, dependency-free bar chart of revenue per day. */
export function BarChart({ data, currency }: { data: SalesReport["by_day"]; currency: string }) {
  if (!data.length) return <p className="py-8 text-center text-sm text-slate-500">No data.</p>;
  const max = Math.max(1, ...data.map((d) => Number(d.revenue)));
  const total = data.reduce((s, d) => s + Number(d.revenue), 0);
  if (!total) return <p className="py-8 text-center text-sm text-slate-500">No revenue in this period yet.</p>;
  const step = Math.ceil(data.length / 8);
  return (
    <div>
      <div className="flex h-48 items-end gap-[2px]">
        {data.map((d) => (
          <div key={d.day} className="group relative flex h-full flex-1 items-end">
            <div className="w-full rounded-t bg-indigo-500 transition group-hover:bg-indigo-600" style={{ height: `${(Number(d.revenue) / max) * 100}%`, minHeight: Number(d.revenue) ? 2 : 0 }} />
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-xs text-white group-hover:block">
              {d.day}: {money(d.revenue, currency)} · {d.orders} orders
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-[2px] text-[10px] text-slate-400">
        {data.map((d, i) => <div key={d.day} className="flex-1 truncate text-center">{i % step === 0 ? d.day.slice(5) : ""}</div>)}
      </div>
    </div>
  );
}
