import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { BookOpen, ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";
import { supabase, errorMessage } from "../../lib/supabase";
import { useAsync, must } from "../../lib/useAsync";
import { can } from "../../lib/permissions";
import type { KnowledgeEntry } from "../../lib/types";
import { useBusiness } from "../../contexts/BusinessContext";
import { Button, Card, Empty, ErrorBox, Field, Input, Modal, PageHeader, Spinner, Textarea, confirmAction, useToast } from "../../components/ui";

const examples = [
  { question: "Do you deliver? What are the charges?", answer: "Yes. Delivery in Lahore is free on orders above Rs 2,000, otherwise Rs 200. Other cities: Rs 350, 3–5 working days." },
  { question: "What payment methods do you accept?", answer: "Cash on delivery, JazzCash, Easypaisa and bank transfer." },
  { question: "What is your return policy?", answer: "Unused items can be exchanged within 7 days with the receipt." },
];

export default function Knowledge() {
  const { business, role } = useBusiness();
  const toast = useToast();
  const editable = can(role, "manageCatalog");
  const [draft, setDraft] = useState<{ id?: string; question: string; answer: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const { data, loading, error, reload } = useAsync(async () =>
    must(await supabase.from("knowledge_entries").select("*").eq("business_id", business.id).order("created_at")) as KnowledgeEntry[], [business.id]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setSaving(true); setFormError(null);
    const row = { business_id: business.id, question: draft.question.trim(), answer: draft.answer.trim() };
    const res = draft.id ? await supabase.from("knowledge_entries").update(row).eq("id", draft.id) : await supabase.from("knowledge_entries").insert(row);
    setSaving(false);
    if (res.error) { setFormError(errorMessage(res.error)); return; }
    toast("success", "Saved"); setDraft(null); void reload();
  }

  async function remove(k: KnowledgeEntry) {
    if (!confirmAction("Delete this entry?")) return;
    const { error } = await supabase.from("knowledge_entries").delete().eq("id", k.id);
    if (error) toast("error", errorMessage(error)); else void reload();
  }

  return (
    <>
      <PageHeader title="Chatbot Knowledge" subtitle="Policies, delivery, payment, timings and FAQs. Your AI agent answers only from this and your catalogue."
        actions={<>
          <a href={`/chat/${business.slug}`} target="_blank" rel="noreferrer"><Button variant="secondary"><ExternalLink className="h-4 w-4" />Test chatbot</Button></a>
          {editable && <Button onClick={() => { setFormError(null); setDraft({ question: "", answer: "" }); }}><Plus className="h-4 w-4" />Add entry</Button>}
        </>} />
      <Card className="mb-4 p-4 text-sm text-slate-600">
        Tone, language and selling rules are set in <Link to="../settings" className="font-medium text-indigo-600">Settings → Chatbot</Link>.
      </Card>
      {loading ? <Spinner /> : error ? <ErrorBox message={error} onRetry={reload} /> : !data?.length ? (
        <Card>
          <Empty icon={<BookOpen className="h-6 w-6" />} title="No knowledge yet" text="Add the answers customers ask for most. Start from an example:"
            action={editable && <div className="flex flex-wrap justify-center gap-2">
              {examples.map((ex) => <Button key={ex.question} variant="secondary" onClick={() => setDraft({ ...ex })}>{ex.question}</Button>)}
            </div>} />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.map((k) => (
            <Card key={k.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-semibold text-slate-900">{k.question}</h3>
                {editable && <div className="flex shrink-0">
                  <button onClick={() => { setFormError(null); setDraft({ id: k.id, question: k.question, answer: k.answer }); }} className="rounded p-1.5 text-slate-500 hover:bg-slate-100" title="Edit"><Pencil className="h-4 w-4" /></button>
                  <button onClick={() => remove(k)} className="rounded p-1.5 text-red-500 hover:bg-red-50" title="Delete"><Trash2 className="h-4 w-4" /></button>
                </div>}
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{k.answer}</p>
            </Card>
          ))}
        </div>
      )}
      <Modal open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? "Edit entry" : "Add entry"}
        footer={<><Button variant="secondary" onClick={() => setDraft(null)}>Cancel</Button><Button form="kb-form" type="submit" loading={saving}>Save</Button></>}>
        {draft && (
          <form id="kb-form" onSubmit={save} className="space-y-4">
            {formError && <ErrorBox message={formError} />}
            <Field label="Topic or question"><Input required maxLength={500} value={draft.question} onChange={(e) => setDraft({ ...draft, question: e.target.value })} /></Field>
            <Field label="Answer"><Textarea required rows={6} maxLength={5000} value={draft.answer} onChange={(e) => setDraft({ ...draft, answer: e.target.value })} /></Field>
          </form>
        )}
      </Modal>
    </>
  );
}
