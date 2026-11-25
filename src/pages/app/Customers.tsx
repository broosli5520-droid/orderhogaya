import { useMemo, useState, type FormEvent } from "react";
import { Download, MessageCircle, Pencil, Plus, Search, Trash2, Users } from "lucide-react";
import { waLink } from "../../lib/whatsapp";
import { supabase, errorMessage } from "../../lib/supabase";
import { useAsync, must } from "../../lib/useAsync";
import { dateOnly, downloadCsv, money } from "../../lib/format";
import { can } from "../../lib/permissions";
import { cap, leadColor, orderColor } from "../../lib/status";
import type { Customer, Lead, Order } from "../../lib/types";
import { useBusiness } from "../../contexts/BusinessContext";
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, PageHeader, Spinner, Table, Textarea, confirmAction, td, th, useToast } from "../../components/ui";

type Draft = { id?: string; name: string; phone: string; email: string; address: string; notes: string };

export default function Customers() {
  const { business, role } = useBusiness();
  const toast = useToast();
  const editable = can(role, "editSales");
  const deletable = can(role, "deleteSales");
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Customer | null>(null);

  const { data, loading, error, reload } = useAsync(async () =>
    must(await supabase.from("customers").select("*").eq("business_id", business.id).order("created_at", { ascending: false }).limit(2000)) as Customer[], [business.id]);

  const list = useMemo(() => (data ?? []).filter((c) => !q || `${c.name} ${c.phone} ${c.email}`.toLowerCase().includes(q.toLowerCase())), [data, q]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setSaving(true); setFormError(null);
    const row = { business_id: business.id, name: draft.name.trim(), phone: draft.phone.replace(/[^\d+]/g, ""), email: draft.email.trim(), address: draft.address.trim(), notes: draft.notes.trim() };
    const res = draft.id ? await supabase.from("customers").update(row).eq("id", draft.id) : await supabase.from("customers").insert(row);
    setSaving(false);
    if (res.error) { setFormError(errorMessage(res.error)); return; }
    toast("success", "Saved"); setDraft(null); void reload();
  }

  async function remove(c: Customer) {
    if (!confirmAction(`Delete ${c.name || "this customer"}? Their leads are deleted too; orders are kept without a customer.`)) return;
    const { error } = await supabase.from("customers").delete().eq("id", c.id);
    if (error) toast("error", errorMessage(error)); else { toast("success", "Deleted"); void reload(); }
  }

  return (
    <>
      <PageHeader title="Customers" subtitle="People who chatted, ordered or were added by your team."
        actions={<>
          <Button variant="secondary" disabled={!data?.length} onClick={() => downloadCsv(`customers-${business.slug}.csv`,
            [["Name", "Phone", "Email", "Address", "Source", "Added"], ...(data ?? []).map((c) => [c.name, c.phone, c.email, c.address, c.source, dateOnly(c.created_at)])])}>
            <Download className="h-4 w-4" />Export</Button>
          {editable && <Button onClick={() => { setFormError(null); setDraft({ name: "", phone: "", email: "", address: "", notes: "" }); }}><Plus className="h-4 w-4" />Add customer</Button>}
        </>} />
      <Card>
        <div className="border-b border-slate-200 p-4"><div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <Input className="pl-9" placeholder="Search name, phone or email…" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
        {loading ? <Spinner /> : error ? <div className="p-4"><ErrorBox message={error} onRetry={reload} /></div> : !list.length ? (
          <Empty icon={<Users className="h-6 w-6" />} title={data?.length ? "No matches" : "No customers yet"} text="Customers appear here automatically when the AI agent saves a lead or an order." />
        ) : (
          <Table>
            <thead><tr><th className={th}>Name</th><th className={th}>Contact</th><th className={th}>Source</th><th className={th}>Added</th><th className={th} /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {list.map((c) => (
                <tr key={c.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setViewing(c)}>
                  <td className={td}><div className="font-medium">{c.name || "(no name)"}</div>{c.address && <div className="max-w-xs truncate text-xs text-slate-500">{c.address}</div>}</td>
                  <td className={td}><div>{c.phone || "—"}</div><div className="text-xs text-slate-500">{c.email}</div></td>
                  <td className={td}><Badge color={c.source === "chat" ? "indigo" : "gray"}>{c.source === "chat" ? "AI chat" : "Manual"}</Badge></td>
                  <td className={td}>{dateOnly(c.created_at)}</td>
                  <td className={`${td} whitespace-nowrap text-right`} onClick={(e) => e.stopPropagation()}>
                    {editable && <button onClick={() => { setFormError(null); setDraft({ id: c.id, name: c.name, phone: c.phone, email: c.email, address: c.address, notes: c.notes }); }} className="rounded p-1.5 text-slate-500 hover:bg-slate-100" title="Edit"><Pencil className="h-4 w-4" /></button>}
                    {deletable && <button onClick={() => remove(c)} className="rounded p-1.5 text-red-500 hover:bg-red-50" title="Delete"><Trash2 className="h-4 w-4" /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? "Edit customer" : "Add customer"}
        footer={<><Button variant="secondary" onClick={() => setDraft(null)}>Cancel</Button><Button form="cust-form" type="submit" loading={saving}>Save</Button></>}>
        {draft && (
          <form id="cust-form" onSubmit={save} className="space-y-4">
            {formError && <ErrorBox message={formError} />}
            <Field label="Name"><Input required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Phone"><Input value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} /></Field>
              <Field label="Email"><Input type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} /></Field>
            </div>
            <Field label="Address"><Input value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} /></Field>
            <Field label="Notes"><Textarea rows={3} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></Field>
          </form>
        )}
      </Modal>

      {viewing && <CustomerDetail customer={viewing} onClose={() => setViewing(null)} currency={business.currency} />}
    </>
  );
}

function CustomerDetail({ customer, onClose, currency }: { customer: Customer; onClose: () => void; currency: string }) {
  const { data, loading, error } = useAsync(async () => {
    const [orders, leads] = await Promise.all([
      supabase.from("orders").select("id, order_number, status, total, created_at").eq("customer_id", customer.id).order("created_at", { ascending: false }),
      supabase.from("leads").select("id, interest, status, created_at").eq("customer_id", customer.id).order("created_at", { ascending: false }),
    ]);
    return { orders: must(orders) as Order[], leads: must(leads) as Lead[] };
  }, [customer.id]);
  const spent = (data?.orders ?? []).filter((o) => o.status !== "cancelled").reduce((s, o) => s + Number(o.total), 0);

  return (
    <Modal open onClose={onClose} title={customer.name || "Customer"} wide>
      <div className="grid gap-3 text-sm sm:grid-cols-3">
        <div><div className="text-slate-500">Phone</div>{customer.phone || "—"}
          {customer.phone && <a href={waLink(customer.phone, `Assalam o Alaikum ${customer.name}!`)} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-1 text-emerald-600"><MessageCircle className="h-4 w-4" />WhatsApp</a>}</div>
        <div><div className="text-slate-500">Email</div>{customer.email || "—"}</div>
        <div><div className="text-slate-500">Total spent</div><b>{money(spent, currency)}</b></div>
        <div className="sm:col-span-3"><div className="text-slate-500">Address</div>{customer.address || "—"}</div>
        {customer.notes && <div className="sm:col-span-3"><div className="text-slate-500">Notes</div><p className="whitespace-pre-wrap">{customer.notes}</p></div>}
      </div>
      {loading ? <Spinner /> : error ? <ErrorBox message={error} /> : data && (
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <div>
            <h3 className="mb-2 font-semibold">Orders ({data.orders.length})</h3>
            {data.orders.length ? data.orders.map((o) => (
              <div key={o.id} className="flex items-center justify-between border-b border-slate-100 py-2 text-sm">
                <span>#{o.order_number} · {dateOnly(o.created_at)}</span>
                <span className="flex items-center gap-2"><Badge color={orderColor[o.status]}>{cap(o.status)}</Badge>{money(o.total, currency)}</span>
              </div>)) : <p className="text-sm text-slate-500">No orders.</p>}
          </div>
          <div>
            <h3 className="mb-2 font-semibold">Leads ({data.leads.length})</h3>
            {data.leads.length ? data.leads.map((l) => (
              <div key={l.id} className="border-b border-slate-100 py-2 text-sm">
                <div className="flex items-center justify-between"><span className="text-slate-500">{dateOnly(l.created_at)}</span><Badge color={leadColor[l.status]}>{cap(l.status)}</Badge></div>
                <div>{l.interest || "—"}</div>
              </div>)) : <p className="text-sm text-slate-500">No leads.</p>}
          </div>
        </div>
      )}
    </Modal>
  );
}
