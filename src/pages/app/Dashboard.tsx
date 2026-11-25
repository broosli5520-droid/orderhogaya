import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, BookOpen, CheckCircle2, Circle, Code2, MessageSquare, Package, ShoppingCart, Target, TrendingUp, Users } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useAsync, must } from "../../lib/useAsync";
import { dateTime, isoDay, money } from "../../lib/format";
import { cap, leadColor, orderColor } from "../../lib/status";
import type { Lead, Order, SalesReport } from "../../lib/types";
import { useBusiness } from "../../contexts/BusinessContext";
import { Badge, Card, ErrorBox, PageHeader, Spinner } from "../../components/ui";
import { BarChart } from "./Reports";

export default function Dashboard() {
  const { business } = useBusiness();
  useEffect(() => { try { localStorage.setItem("sp.lastBusiness", business.id); } catch { /* ignore */ } }, [business.id]);

  const { data, loading, error, reload } = useAsync(async () => {
    const to = new Date();
    const from = new Date(); from.setDate(from.getDate() - 29);
    const [report, orders, leads, products, knowledge] = await Promise.all([
      supabase.rpc("sales_report", { p_business: business.id, p_from: isoDay(from), p_to: isoDay(to) }),
      supabase.from("orders").select("id, order_number, status, total, created_at, source, customers(name, phone)").eq("business_id", business.id).order("created_at", { ascending: false }).limit(6),
      supabase.from("leads").select("id, interest, status, created_at, customers(name, phone)").eq("business_id", business.id).order("created_at", { ascending: false }).limit(6),
      supabase.from("products").select("id", { count: "exact", head: true }).eq("business_id", business.id),
      supabase.from("knowledge_entries").select("id", { count: "exact", head: true }).eq("business_id", business.id),
    ]);
    return {
      report: must(report) as SalesReport,
      orders: must(orders) as unknown as Order[],
      leads: must(leads) as unknown as Lead[],
      productCount: products.count ?? 0,
      knowledgeCount: knowledge.count ?? 0,
    };
  }, [business.id]);

  if (loading) return <Spinner />;
  if (error || !data) return <ErrorBox message={error ?? "Could not load"} onRetry={reload} />;
  const r = data.report;

  const setup = [
    { done: data.productCount > 0, label: "Add your products or services with prices", to: "products", icon: Package },
    { done: data.knowledgeCount > 0, label: "Teach the chatbot your delivery, payment and return policies", to: "knowledge", icon: BookOpen },
    { done: !!(business.phone || business.address || business.description), label: "Complete your business profile", to: "settings", icon: Users },
    { done: r.conversations > 0, label: "Share your chat link or add the website widget", to: "settings", icon: Code2 },
  ];
  const setupLeft = setup.filter((s) => !s.done).length;

  const kpis = [
    { label: "Revenue (30 days)", value: money(r.revenue, business.currency), icon: TrendingUp },
    { label: "Orders", value: r.orders, sub: `${r.chat_orders} by AI`, icon: ShoppingCart },
    { label: "New leads", value: r.new_leads, sub: `${r.won_leads} won`, icon: Target },
    { label: "Conversations", value: r.conversations, sub: `${r.new_customers} new customers`, icon: MessageSquare },
  ];

  return (
    <>
      <PageHeader title={`Welcome to ${business.name}`} subtitle="Your sales at a glance for the last 30 days." />

      {setupLeft > 0 && (
        <Card className="mb-6 p-5">
          <h2 className="font-semibold">Get your AI sales agent ready</h2>
          <p className="text-sm text-slate-500">{setup.length - setupLeft} of {setup.length} steps done</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {setup.map((s) => (
              <Link key={s.label} to={s.to} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2.5 text-sm hover:bg-slate-50">
                {s.done ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <Circle className="h-5 w-5 text-slate-300" />}
                <span className={s.done ? "text-slate-400 line-through" : ""}>{s.label}</span>
              </Link>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map(({ label, value, sub, icon: Icon }) => (
          <Card key={label} className="p-5">
            <div className="flex items-center justify-between text-sm text-slate-500">{label}<Icon className="h-4 w-4 text-indigo-500" /></div>
            <div className="mt-2 text-2xl font-bold">{value}</div>
            {sub && <div className="text-xs text-slate-500">{sub}</div>}
          </Card>
        ))}
      </div>

      <Card className="mt-6 p-5">
        <div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">Revenue per day</h2><Link to="reports" className="text-sm text-indigo-600">Full report</Link></div>
        <BarChart data={r.by_day} currency={business.currency} />
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><h2 className="font-semibold">Latest orders</h2><Link to="orders" className="flex items-center gap-1 text-sm text-indigo-600">All <ArrowRight className="h-4 w-4" /></Link></div>
          {data.orders.length ? data.orders.map((o) => (
            <div key={o.id} className="flex items-center justify-between border-b border-slate-100 px-5 py-3 text-sm last:border-0">
              <div><span className="font-medium">#{o.order_number}</span> · {o.customers?.name || "—"}<div className="text-xs text-slate-500">{dateTime(o.created_at)}</div></div>
              <div className="text-right"><div className="font-medium">{money(o.total, business.currency)}</div><Badge color={orderColor[o.status]}>{cap(o.status)}</Badge></div>
            </div>
          )) : <p className="px-5 py-8 text-center text-sm text-slate-500">No orders yet.</p>}
        </Card>
        <Card>
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><h2 className="font-semibold">Latest leads</h2><Link to="leads" className="flex items-center gap-1 text-sm text-indigo-600">All <ArrowRight className="h-4 w-4" /></Link></div>
          {data.leads.length ? data.leads.map((l) => (
            <div key={l.id} className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3 text-sm last:border-0">
              <div className="min-w-0"><div className="font-medium">{l.customers?.name || "—"} <span className="font-normal text-slate-500">{l.customers?.phone}</span></div><div className="truncate text-xs text-slate-500">{l.interest}</div></div>
              <Badge color={leadColor[l.status]}>{cap(l.status)}</Badge>
            </div>
          )) : <p className="px-5 py-8 text-center text-sm text-slate-500">No leads yet.</p>}
        </Card>
      </div>
    </>
  );
}
