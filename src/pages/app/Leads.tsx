import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { MessageCircle, MessageSquare, Plus, Target, Trash2 } from "lucide-react";
import { waLink } from "../../lib/whatsapp";
import { supabase, errorMessage } from "../../lib/supabase";
import { useAsync, must } from "../../lib/useAsync";
import { dateTime } from "../../lib/format";
import { can } from "../../lib/permissions";
import { cap, leadColor, leadStatuses } from "../../lib/status";
import type { Lead, LeadStatus } from "../../lib/types";
import { useBusiness } from "../../contexts/BusinessContext";
import CustomerPicker, { emptyCustomerChoice, resolveCustomer, type CustomerChoice } from "../../components/CustomerPicker";
import { Badge, Button, Card, Empty, ErrorBox, Field, Modal, PageHeader, Select, Spinner, Table, Textarea, confirmAction, cx, td, th, useToast } from "../../components/ui";

export default function Leads() {
  const { business, role } = useBusiness();
  const toast = useToast();
  const editable = can(role, "editSales");
  const deletable = can(role, "deleteSales");
  const [status, setStatus] = useState<LeadStatus | "all">("all");
  const [adding, setAdding] = useState(false);
  const [notesFor, setNotesFor] = useState<Lead | null>(null);

  const { data, loading, error, reload, setData } = useAsync(async () =>
    must(await supabase.from("leads").select("*, customers(name, phone)").eq("business_id", business.id).order("created_at", { ascending: false }).limit(1000)) as Lead[], [business.id]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: data?.length ?? 0 };
    (data ?? []).forEach((l) => { c[l.status] = (c[l.status] ?? 0) + 1; });
    return c;
  }, [data]);
  const list = (data ?? []).filter((l) => status === "all" || l.status === status);

  async function changeStatus(l: Lead, s: LeadStatus) {
    const prev = data;
    setData((d) => d?.map((x) => (x.id === l.id ? { ...x, status: s } : x)) ?? null);
    const { error } = await supabase.from("leads").update({ status: s }).eq("id", l.id);
    if (error) { setData(prev); toast("error", errorMessage(error)); }
  }

  async function remove(l: Lead) {
    if (!confirmAction("Delete this lead?")) return;
    const { error } = await supabase.from("leads").delete().eq("id", l.id);
    if (error) toast("error", errorMessage(error)); else void reload();
  }

  return (
    <>
      <PageHeader title="Leads" subtitle="Interested customers captured by the AI agent or added by your team. Move them through the pipeline."
        actions={editable && <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" />Add lead</Button>} />
      <div className="mb-4 flex flex-wrap gap-2">
        {(["all", ...leadStatuses] as const).map((s) => (
          <button key={s} onClick={() => setStatus(s)}
            className={cx("rounded-full border px-3 py-1 text-sm", status === s ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50")}>
            {cap(s)} <span className="opacity-70">{counts[s] ?? 0}</span>
          </button>
        ))}
      </div>
      <Card>
        {loading ? <Spinner /> : error ? <div className="p-4"><ErrorBox message={error} onRetry={reload} /></div> : !list.length ? (
          <Empty icon={<Target className="h-6 w-6" />} title="No leads here" text="When a customer shares their name and phone in the chat, a lead is created automatically." />
        ) : (
          <Table>
            <thead><tr><th className={th}>Customer</th><th className={th}>Interest</th><th className={th}>Status</th><th className={th}>Created</th><th className={th} /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {list.map((l) => (
                <tr key={l.id} className="hover:bg-slate-50">
                  <td className={td}><div className="font-medium">{l.customers?.name || "(no name)"}</div><div className="text-xs text-slate-500">{l.customers?.phone}</div></td>
                  <td className={`${td} max-w-md`}>
                    <div className="whitespace-pre-wrap">{l.interest || "—"}</div>
                    {l.notes && <div className="mt-1 text-xs text-slate-500">Note: {l.notes}</div>}
                  </td>
                  <td className={td}>
                    {editable ? (
                      <Select className="w-36 py-1" value={l.status} onChange={(e) => changeStatus(l, e.target.value as LeadStatus)}>
                        {leadStatuses.map((s) => <option key={s} value={s}>{cap(s)}</option>)}
                      </Select>
                    ) : <Badge color={leadColor[l.status]}>{cap(l.status)}</Badge>}
                  </td>
                  <td className={td}><div>{dateTime(l.created_at)}</div><div className="text-xs text-slate-500">{l.source === "chat" ? "AI chat" : "Manual"}</div></td>
                  <td className={`${td} whitespace-nowrap text-right`}>
                    {l.customers?.phone && <a href={waLink(l.customers.phone, `Assalam o Alaikum ${l.customers.name ?? ""}! ${business.name} here about your enquiry: ${l.interest}`)} target="_blank" rel="noreferrer" className="inline-block rounded p-1.5 text-emerald-600 hover:bg-emerald-50" title="WhatsApp"><MessageCircle className="h-4 w-4" /></a>}
                    {l.conversation_id && <Link to={`../conversations?c=${l.conversation_id}`} className="inline-block rounded p-1.5 text-slate-500 hover:bg-slate-100" title="Open conversation"><MessageSquare className="h-4 w-4" /></Link>}
                    {editable && <button onClick={() => setNotesFor(l)} className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100">Notes</button>}
                    {deletable && <button onClick={() => remove(l)} className="rounded p-1.5 text-red-500 hover:bg-red-50" title="Delete"><Trash2 className="h-4 w-4" /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {adding && <AddLead businessId={business.id} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); toast("success", "Lead added"); void reload(); }} />}
      {notesFor && <NotesModal lead={notesFor} onClose={() => setNotesFor(null)} onSaved={() => { setNotesFor(null); void reload(); }} />}
    </>
  );
}

function AddLead({ businessId, onClose, onSaved }: { businessId: string; onClose: () => void; onSaved: () => void }) {
  const [customer, setCustomer] = useState<CustomerChoice>(emptyCustomerChoice);
  const [interest, setInterest] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      const customerId = await resolveCustomer(businessId, customer);
      if (!customerId) throw new Error("Choose a customer.");
      const { error } = await supabase.from("leads").insert({ business_id: businessId, customer_id: customerId, interest: interest.trim() });
      if (error) throw error;
      onSaved();
    } catch (e) { setErr(errorMessage(e)); } finally { setSaving(false); }
  }
  return (
    <Modal open onClose={onClose} title="Add lead" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button form="lead-form" type="submit" loading={saving}>Save</Button></>}>
      <form id="lead-form" onSubmit={save} className="space-y-4">
        {err && <ErrorBox message={err} />}
        <CustomerPicker businessId={businessId} value={customer} onChange={setCustomer} />
        <Field label="Interested in"><Textarea rows={3} value={interest} onChange={(e) => setInterest(e.target.value)} /></Field>
      </form>
    </Modal>
  );
}

function NotesModal({ lead, onClose, onSaved }: { lead: Lead; onClose: () => void; onSaved: () => void }) {
  const [notes, setNotes] = useState(lead.notes);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  async function save() {
    setSaving(true);
    const { error } = await supabase.from("leads").update({ notes: notes.trim() }).eq("id", lead.id);
    setSaving(false);
    if (error) toast("error", errorMessage(error)); else onSaved();
  }
  return (
    <Modal open onClose={onClose} title={`Notes — ${lead.customers?.name || "lead"}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={saving}>Save</Button></>}>
      <Textarea rows={6} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Called on Monday, will order next week…" />
    </Modal>
  );
}
