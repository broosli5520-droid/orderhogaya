import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Download, MessageCircle, MessageSquare, Plus, Search, ShoppingCart, Trash2, X } from "lucide-react";
import { waLink } from "../../lib/whatsapp";
import { supabase, errorMessage } from "../../lib/supabase";
import { useAsync, must } from "../../lib/useAsync";
import { dateTime, downloadCsv, money } from "../../lib/format";
import { can } from "../../lib/permissions";
import { cap, orderColor, orderStatuses } from "../../lib/status";
import type { Order, OrderStatus, Product } from "../../lib/types";
import { useBusiness } from "../../contexts/BusinessContext";
import CustomerPicker, { emptyCustomerChoice, resolveCustomer, type CustomerChoice } from "../../components/CustomerPicker";
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, PageHeader, Select, Spinner, Table, Textarea, confirmAction, cx, td, th, useToast } from "../../components/ui";

export default function Orders() {
  const { business, role } = useBusiness();
  const toast = useToast();
  const editable = can(role, "editSales");
  const [status, setStatus] = useState<OrderStatus | "all">("all");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, loading, error, reload } = useAsync(async () =>
    must(await supabase.from("orders").select("*, customers(name, phone), order_items(*)").eq("business_id", business.id)
      .order("created_at", { ascending: false }).limit(1000)) as Order[], [business.id]);

  const list = useMemo(() => (data ?? []).filter((o) =>
    (status === "all" || o.status === status) &&
    (!q || `#${o.order_number} ${o.order_number} ${o.customers?.name ?? ""} ${o.customers?.phone ?? ""}`.toLowerCase().includes(q.toLowerCase()))), [data, status, q]);

  function exportCsv() {
    downloadCsv(`orders-${business.slug}.csv`, [
      ["Order", "Date", "Customer", "Phone", "Status", "Source", "Items", `Total (${business.currency})`, "Address", "Notes"],
      ...list.map((o) => [o.order_number, dateTime(o.created_at), o.customers?.name, o.customers?.phone, o.status, o.source,
        (o.order_items ?? []).map((i) => `${i.quantity} x ${i.name}`).join("; "), o.total, o.delivery_address, o.notes]),
    ]);
  }

  const opened = data?.find((o) => o.id === openId) ?? null;

  return (
    <>
      <PageHeader title="Orders" subtitle="Orders placed through the AI chat or created by your team."
        actions={<>
          <Button variant="secondary" onClick={exportCsv} disabled={!list.length}><Download className="h-4 w-4" />Export</Button>
          {editable && <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" />New order</Button>}
        </>} />
      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row">
          <div className="relative flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input className="pl-9" placeholder="Search order #, customer or phone…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <Select className="lg:w-48" value={status} onChange={(e) => setStatus(e.target.value as OrderStatus | "all")}>
            <option value="all">All statuses</option>
            {orderStatuses.map((s) => <option key={s} value={s}>{cap(s)}</option>)}
          </Select>
        </div>
        {loading ? <Spinner /> : error ? <div className="p-4"><ErrorBox message={error} onRetry={reload} /></div> : !list.length ? (
          <Empty icon={<ShoppingCart className="h-6 w-6" />} title={data?.length ? "No matches" : "No orders yet"} text="Orders confirmed by customers in the chat land here automatically." />
        ) : (
          <Table>
            <thead><tr><th className={th}>Order</th><th className={th}>Customer</th><th className={th}>Items</th><th className={th}>Total</th><th className={th}>Status</th><th className={th}>Date</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {list.map((o) => (
                <tr key={o.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpenId(o.id)}>
                  <td className={td}><span className="font-semibold">#{o.order_number}</span> {o.source === "chat" && <Badge color="indigo">AI</Badge>}</td>
                  <td className={td}><div>{o.customers?.name || "—"}</div><div className="text-xs text-slate-500">{o.customers?.phone}</div></td>
                  <td className={`${td} max-w-xs truncate text-slate-600`}>{(o.order_items ?? []).map((i) => `${i.quantity}× ${i.name}`).join(", ")}</td>
                  <td className={`${td} font-medium`}>{money(o.total, business.currency)}</td>
                  <td className={td}><Badge color={orderColor[o.status]}>{cap(o.status)}</Badge></td>
                  <td className={`${td} whitespace-nowrap text-slate-500`}>{dateTime(o.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {creating && <NewOrder onClose={() => setCreating(false)} onSaved={() => { setCreating(false); toast("success", "Order created"); void reload(); }} />}
      {opened && <OrderDetail order={opened} onClose={() => setOpenId(null)} onChanged={reload} />}
    </>
  );
}

function OrderDetail({ order, onClose, onChanged }: { order: Order; onClose: () => void; onChanged: () => void }) {
  const { business, role } = useBusiness();
  const toast = useToast();
  const editable = can(role, "editSales");
  const [busy, setBusy] = useState(false);

  async function setStatus(s: OrderStatus) {
    setBusy(true);
    const { error } = await supabase.from("orders").update({ status: s }).eq("id", order.id);
    setBusy(false);
    if (error) toast("error", errorMessage(error)); else { toast("success", `Order #${order.order_number} is ${s}`); onChanged(); }
  }
  async function remove() {
    if (!confirmAction(`Delete order #${order.order_number}? This cannot be undone.`)) return;
    const { error } = await supabase.from("orders").delete().eq("id", order.id);
    if (error) toast("error", errorMessage(error)); else { onClose(); onChanged(); }
  }

  return (
    <Modal open onClose={onClose} title={`Order #${order.order_number}`} wide
      footer={can(role, "deleteSales") && <Button variant="danger" onClick={remove}><Trash2 className="h-4 w-4" />Delete order</Button>}>
      <div className="grid gap-4 text-sm sm:grid-cols-3">
        <div><div className="text-slate-500">Customer</div><div className="font-medium">{order.customers?.name || "—"}</div><div>{order.customers?.phone}</div></div>
        <div><div className="text-slate-500">Placed</div>{dateTime(order.created_at)}<div className="text-xs text-slate-500">{order.source === "chat" ? "via AI chat" : "by team"}</div></div>
        <div><div className="text-slate-500">Status</div>
          {editable ? <Select disabled={busy} value={order.status} onChange={(e) => setStatus(e.target.value as OrderStatus)}>
            {orderStatuses.map((s) => <option key={s} value={s}>{cap(s)}</option>)}</Select>
            : <Badge color={orderColor[order.status]}>{cap(order.status)}</Badge>}
        </div>
        <div className="sm:col-span-3"><div className="text-slate-500">Delivery address</div>{order.delivery_address || "—"}</div>
        {order.notes && <div className="sm:col-span-3"><div className="text-slate-500">Notes</div><p className="whitespace-pre-wrap">{order.notes}</p></div>}
      </div>
      <div className="mt-5 overflow-hidden rounded-lg border border-slate-200">
        <Table>
          <thead><tr><th className={th}>Item</th><th className={th}>Qty</th><th className={th}>Price</th><th className={th}>Total</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {(order.order_items ?? []).map((i) => (
              <tr key={i.id}><td className={td}>{i.name}</td><td className={td}>{i.quantity}</td><td className={td}>{money(i.unit_price, business.currency)}</td><td className={td}>{money(i.line_total, business.currency)}</td></tr>
            ))}
            <tr className="bg-slate-50 font-semibold"><td className={td} colSpan={3}>Total</td><td className={td}>{money(order.total, business.currency)}</td></tr>
          </tbody>
        </Table>
      </div>
      {order.customers?.phone && (
        <a href={waLink(order.customers.phone, `Assalam o Alaikum ${order.customers.name ?? ""}! ${business.name}: your order #${order.order_number} (${(order.order_items ?? []).map((i) => `${i.quantity} x ${i.name}`).join(", ")}) — total ${money(order.total, business.currency)} — is now ${order.status}. Thank you!`)}
          target="_blank" rel="noreferrer" className="mr-4 mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white"><MessageCircle className="h-4 w-4" />Send update on WhatsApp</a>
      )}
      {order.conversation_id && <Link to={`../conversations?c=${order.conversation_id}`} className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-indigo-600"><MessageSquare className="h-4 w-4" />View the chat that created this order</Link>}
    </Modal>
  );
}

type Line = { key: number; productId: string; name: string; price: string; qty: string };

function NewOrder({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { business } = useBusiness();
  const [customer, setCustomer] = useState<CustomerChoice>(emptyCustomerChoice);
  const [lines, setLines] = useState<Line[]>([{ key: 1, productId: "", name: "", price: "", qty: "1" }]);
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<OrderStatus>("confirmed");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const { data: products } = useAsync(async () =>
    must(await supabase.from("products").select("*").eq("business_id", business.id).eq("is_active", true).order("name")) as Product[], [business.id]);

  const total = lines.reduce((s, l) => s + (Number(l.price) || 0) * (Number(l.qty) || 0), 0);
  const upd = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  function pick(key: number, productId: string) {
    const p = products?.find((x) => x.id === productId);
    upd(key, { productId, name: p?.name ?? "", price: p ? String(p.sale_price ?? p.price) : "" });
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const items = lines.filter((l) => (l.productId || l.name.trim()) && Number(l.qty) > 0).map((l) => ({
      product_id: l.productId || null, name: l.name.trim(), unit_price: Number(l.price) || 0, quantity: Math.floor(Number(l.qty)),
    }));
    if (!items.length) { setErr("Add at least one item."); return; }
    setSaving(true); setErr(null);
    try {
      const customerId = await resolveCustomer(business.id, { ...customer, address });
      if (!customerId) throw new Error("Choose a customer.");
      const { error } = await supabase.rpc("create_order", { p_business: business.id, p_customer: customerId, p_items: items, p_address: address.trim(), p_notes: notes.trim(), p_status: status });
      if (error) throw error;
      onSaved();
    } catch (e) { setErr(errorMessage(e)); } finally { setSaving(false); }
  }

  return (
    <Modal open onClose={onClose} title="New order" wide
      footer={<><span className="mr-auto self-center font-semibold">Total: {money(total, business.currency)}</span>
        <Button variant="secondary" onClick={onClose}>Cancel</Button><Button form="order-form" type="submit" loading={saving}>Create order</Button></>}>
      <form id="order-form" onSubmit={save} className="space-y-5">
        {err && <ErrorBox message={err} />}
        <CustomerPicker businessId={business.id} value={customer} onChange={setCustomer} />
        <div>
          <div className="mb-2 text-sm font-medium text-slate-700">Items</div>
          <div className="space-y-2">
            {lines.map((l) => (
              <div key={l.key} className="grid grid-cols-12 items-center gap-2">
                <Select className="col-span-12 sm:col-span-5" value={l.productId} onChange={(e) => pick(l.key, e.target.value)}>
                  <option value="">Custom item…</option>
                  {(products ?? []).map((p) => <option key={p.id} value={p.id}>{p.name} — {money(p.sale_price ?? p.price, business.currency)}</option>)}
                </Select>
                <Input className={cx("col-span-12 sm:col-span-3", l.productId && "hidden sm:block sm:invisible")} placeholder="Item name" value={l.name} onChange={(e) => upd(l.key, { name: e.target.value })} />
                <Input className="col-span-5 sm:col-span-2" type="number" min="0" step="0.01" placeholder="Price" value={l.price} onChange={(e) => upd(l.key, { price: e.target.value })} />
                <Input className="col-span-5 sm:col-span-1" type="number" min="1" step="1" value={l.qty} onChange={(e) => upd(l.key, { qty: e.target.value })} />
                <button type="button" className="col-span-2 justify-self-center rounded p-1.5 text-slate-400 hover:bg-slate-100 sm:col-span-1" onClick={() => setLines((ls) => ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls)} aria-label="Remove"><X className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
          <Button type="button" variant="ghost" className="mt-2" onClick={() => setLines((ls) => [...ls, { key: Date.now(), productId: "", name: "", price: "", qty: "1" }])}><Plus className="h-4 w-4" />Add item</Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Delivery address"><Input value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
          <Field label="Status"><Select value={status} onChange={(e) => setStatus(e.target.value as OrderStatus)}>{orderStatuses.map((s) => <option key={s} value={s}>{cap(s)}</option>)}</Select></Field>
        </div>
        <Field label="Notes"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </form>
    </Modal>
  );
}
