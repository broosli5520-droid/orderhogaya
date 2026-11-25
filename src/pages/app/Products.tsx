import { useMemo, useState, type FormEvent } from "react";
import { FileUp, Package, Pencil, Plus, Search, Trash2 } from "lucide-react";
import ImportProducts from "../../components/ImportProducts";
import { supabase, errorMessage } from "../../lib/supabase";
import { useAsync, must } from "../../lib/useAsync";
import { money } from "../../lib/format";
import { can } from "../../lib/permissions";
import type { Product } from "../../lib/types";
import { useBusiness } from "../../contexts/BusinessContext";
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, PageHeader, Select, Spinner, Table, Textarea, confirmAction, td, th, useToast } from "../../components/ui";

type Draft = { id?: string; kind: "product" | "service"; name: string; description: string; category: string; price: string; sale_price: string; stock: string; sku: string; is_active: boolean };
const blank: Draft = { kind: "product", name: "", description: "", category: "", price: "", sale_price: "", stock: "", sku: "", is_active: true };

export default function Products() {
  const { business, role } = useBusiness();
  const toast = useToast();
  const editable = can(role, "manageCatalog");
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("all");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const { data, loading, error, reload } = useAsync(async () =>
    must(await supabase.from("products").select("*").eq("business_id", business.id).order("name")) as Product[], [business.id]);

  const list = useMemo(() => (data ?? []).filter((p) =>
    (kind === "all" || p.kind === kind) &&
    (!q || `${p.name} ${p.category} ${p.sku}`.toLowerCase().includes(q.toLowerCase()))), [data, q, kind]);

  function edit(p: Product) {
    setFormError(null);
    setDraft({ id: p.id, kind: p.kind, name: p.name, description: p.description, category: p.category, price: String(p.price),
      sale_price: p.sale_price == null ? "" : String(p.sale_price), stock: p.stock == null ? "" : String(p.stock), sku: p.sku, is_active: p.is_active });
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    const price = Number(draft.price);
    const sale = draft.sale_price === "" ? null : Number(draft.sale_price);
    if (!(price >= 0)) { setFormError("Enter a valid price."); return; }
    if (sale != null && !(sale >= 0)) { setFormError("Enter a valid sale price."); return; }
    const row = {
      business_id: business.id, kind: draft.kind, name: draft.name.trim(), description: draft.description.trim(),
      category: draft.category.trim(), price, sale_price: sale, sku: draft.sku.trim(), is_active: draft.is_active,
      stock: draft.kind === "service" || draft.stock === "" ? null : Math.max(0, Math.floor(Number(draft.stock))),
    };
    setSaving(true); setFormError(null);
    const res = draft.id ? await supabase.from("products").update(row).eq("id", draft.id) : await supabase.from("products").insert(row);
    setSaving(false);
    if (res.error) { setFormError(errorMessage(res.error)); return; }
    toast("success", draft.id ? "Saved" : "Added to catalogue");
    setDraft(null); void reload();
  }

  async function toggle(p: Product) {
    const { error } = await supabase.from("products").update({ is_active: !p.is_active }).eq("id", p.id);
    if (error) toast("error", errorMessage(error)); else void reload();
  }

  async function remove(p: Product) {
    if (!confirmAction(`Delete "${p.name}"? Past orders keep their item names.`)) return;
    const { error } = await supabase.from("products").delete().eq("id", p.id);
    if (error) toast("error", errorMessage(error)); else { toast("success", "Deleted"); void reload(); }
  }

  return (
    <>
      <PageHeader title="Products & Services" subtitle="Everything your AI agent can explain and sell. Only active items are offered to customers."
        actions={editable && <>
          <Button variant="secondary" onClick={() => setImporting(true)}><FileUp className="h-4 w-4" />Import CSV</Button>
          <Button onClick={() => { setFormError(null); setDraft({ ...blank }); }}><Plus className="h-4 w-4" />Add item</Button>
        </>} />
      {importing && <ImportProducts businessId={business.id} onClose={() => setImporting(false)} onDone={(n) => { setImporting(false); toast("success", `${n} items imported`); void reload(); }} />}
      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row">
          <div className="relative flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input className="pl-9" placeholder="Search name, category, SKU…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <Select className="sm:w-44" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="all">All types</option><option value="product">Products</option><option value="service">Services</option>
          </Select>
        </div>
        {loading ? <Spinner /> : error ? <div className="p-4"><ErrorBox message={error} onRetry={reload} /></div> :
          !list.length ? <Empty icon={<Package className="h-6 w-6" />} title={data?.length ? "No matches" : "No products yet"}
            text={data?.length ? "Try a different search." : "Add your products and services with prices so the AI agent can sell them."}
            action={editable && !data?.length && <Button onClick={() => setDraft({ ...blank })}><Plus className="h-4 w-4" />Add first item</Button>} /> : (
          <Table>
            <thead><tr><th className={th}>Name</th><th className={th}>Type</th><th className={th}>Price</th><th className={th}>Stock</th><th className={th}>Status</th>{editable && <th className={th} />}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {list.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className={td}><div className="font-medium">{p.name}</div><div className="text-xs text-slate-500">{[p.category, p.sku].filter(Boolean).join(" · ")}</div></td>
                  <td className={td}><Badge color={p.kind === "service" ? "purple" : "blue"}>{p.kind}</Badge></td>
                  <td className={td}>
                    {p.sale_price != null && p.sale_price < p.price
                      ? <><span className="font-medium">{money(p.sale_price, business.currency)}</span> <span className="text-xs text-slate-400 line-through">{money(p.price, business.currency)}</span></>
                      : money(p.price, business.currency)}
                  </td>
                  <td className={td}>{p.kind === "service" || p.stock == null ? <span className="text-slate-400">—</span> : p.stock === 0 ? <Badge color="red">Out of stock</Badge> : p.stock}</td>
                  <td className={td}>
                    <button disabled={!editable} onClick={() => toggle(p)} className="disabled:cursor-default">
                      <Badge color={p.is_active ? "green" : "gray"}>{p.is_active ? "Active" : "Hidden"}</Badge>
                    </button>
                  </td>
                  {editable && <td className={`${td} whitespace-nowrap text-right`}>
                    <button onClick={() => edit(p)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100" title="Edit"><Pencil className="h-4 w-4" /></button>
                    <button onClick={() => remove(p)} className="rounded p-1.5 text-red-500 hover:bg-red-50" title="Delete"><Trash2 className="h-4 w-4" /></button>
                  </td>}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? "Edit item" : "Add item"}
        footer={<><Button variant="secondary" onClick={() => setDraft(null)}>Cancel</Button><Button form="product-form" type="submit" loading={saving}>Save</Button></>}>
        {draft && (
          <form id="product-form" onSubmit={save} className="space-y-4">
            {formError && <ErrorBox message={formError} />}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Type"><Select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as Draft["kind"] })}><option value="product">Product</option><option value="service">Service</option></Select></Field>
              <Field label="Category"><Input value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} placeholder="e.g. Shoes" /></Field>
            </div>
            <Field label="Name"><Input required maxLength={200} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
            <Field label="Description" hint="Sizes, colours, features, what's included — the AI uses this to answer questions.">
              <Textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={`Price (${business.currency})`}><Input required type="number" min="0" step="0.01" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} /></Field>
              <Field label="Sale price" hint="Optional"><Input type="number" min="0" step="0.01" value={draft.sale_price} onChange={(e) => setDraft({ ...draft, sale_price: e.target.value })} /></Field>
              {draft.kind === "product" && <Field label="Stock" hint="Empty = not tracked"><Input type="number" min="0" step="1" value={draft.stock} onChange={(e) => setDraft({ ...draft, stock: e.target.value })} /></Field>}
            </div>
            <Field label="SKU / code"><Input value={draft.sku} onChange={(e) => setDraft({ ...draft, sku: e.target.value })} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.is_active} onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })} /> Active (AI can offer this item)</label>
          </form>
        )}
      </Modal>
    </>
  );
}
