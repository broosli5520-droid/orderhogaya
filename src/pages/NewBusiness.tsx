import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Bot } from "lucide-react";
import { supabase, errorMessage } from "../lib/supabase";
import { slugify } from "../lib/format";
import { useMemberships } from "../contexts/BusinessContext";
import { Button, ErrorBox, Field, Input, Select } from "../components/ui";

const currencies = ["PKR", "USD", "GBP", "EUR", "AED", "SAR", "INR", "BDT", "CAD", "AUD"];

export default function NewBusiness() {
  const navigate = useNavigate();
  const { memberships, reload } = useMemberships();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [industry, setIndustry] = useState("");
  const [currency, setCurrency] = useState("PKR");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finalSlug = slugTouched ? slug : slugify(name);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!/^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])$/.test(finalSlug)) {
      setError("The link name must be 3–50 characters: lowercase letters, numbers and dashes."); return;
    }
    setLoading(true); setError(null);
    const { data, error } = await supabase.rpc("create_business", { p_name: name.trim(), p_slug: finalSlug, p_industry: industry.trim(), p_currency: currency });
    if (error) { setLoading(false); setError(errorMessage(error)); return; }
    await reload();
    navigate(`/app/${data as string}/products`, { replace: true });
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-slate-100 px-4 py-12">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white"><Bot className="h-6 w-6" /></div>
          <div>
            <h1 className="text-xl font-bold">Set up your business</h1>
            <p className="text-sm text-slate-500">Your AI sales agent will represent this business.</p>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4">
          {error && <ErrorBox message={error} />}
          <Field label="Business name"><Input required minLength={2} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ali General Store" /></Field>
          <Field label="Chat link name" hint={`Customers will chat at ${window.location.origin}/chat/${finalSlug || "your-name"}`}>
            <Input required value={finalSlug} onChange={(e) => { setSlugTouched(true); setSlug(slugify(e.target.value)); }} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Industry"><Input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g. Grocery, Clothing" /></Field>
            <Field label="Currency"><Select value={currency} onChange={(e) => setCurrency(e.target.value)}>{currencies.map((c) => <option key={c}>{c}</option>)}</Select></Field>
          </div>
          <Button type="submit" loading={loading} className="w-full">Create business</Button>
          {memberships.length > 0 && <Link to="/app" className="block text-center text-sm text-slate-500">Cancel</Link>}
        </form>
      </div>
    </div>
  );
}
