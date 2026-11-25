import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Customer } from "../lib/types";
import { Field, Input, Select } from "./ui";

export interface CustomerChoice { mode: "existing" | "new"; customerId: string; name: string; phone: string; address: string; }
export const emptyCustomerChoice: CustomerChoice = { mode: "existing", customerId: "", name: "", phone: "", address: "" };

/** Choose an existing customer or enter a new one. */
export default function CustomerPicker({ businessId, value, onChange }: { businessId: string; value: CustomerChoice; onChange: (v: CustomerChoice) => void }) {
  const [customers, setCustomers] = useState<Pick<Customer, "id" | "name" | "phone" | "address">[]>([]);
  useEffect(() => {
    supabase.from("customers").select("id, name, phone, address").eq("business_id", businessId).order("name").limit(1000)
      .then(({ data }) => {
        setCustomers(data ?? []);
        if (!data?.length && value.mode === "existing") onChange({ ...value, mode: "new" });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  return (
    <div className="space-y-3">
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="radio" checked={value.mode === "existing"} disabled={!customers.length} onChange={() => onChange({ ...value, mode: "existing" })} /> Existing customer</label>
        <label className="flex items-center gap-2"><input type="radio" checked={value.mode === "new"} onChange={() => onChange({ ...value, mode: "new" })} /> New customer</label>
      </div>
      {value.mode === "existing" ? (
        <Field label="Customer">
          <Select required value={value.customerId} onChange={(e) => {
            const c = customers.find((x) => x.id === e.target.value);
            onChange({ ...value, customerId: e.target.value, address: value.address || c?.address || "" });
          }}>
            <option value="">Select…</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name || "(no name)"} {c.phone && `— ${c.phone}`}</option>)}
          </Select>
        </Field>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><Input required value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} /></Field>
          <Field label="Phone"><Input value={value.phone} onChange={(e) => onChange({ ...value, phone: e.target.value })} /></Field>
        </div>
      )}
    </div>
  );
}

/** Resolve the choice to a customer id, creating the customer when needed. */
export async function resolveCustomer(businessId: string, v: CustomerChoice): Promise<string | null> {
  if (v.mode === "existing") return v.customerId || null;
  const phone = v.phone.replace(/[^\d+]/g, "");
  if (phone) {
    const { data: found } = await supabase.from("customers").select("id").eq("business_id", businessId).eq("phone", phone).maybeSingle();
    if (found) return found.id;
  }
  const { data, error } = await supabase.from("customers")
    .insert({ business_id: businessId, name: v.name.trim(), phone, address: v.address.trim() }).select("id").single();
  if (error) throw error;
  return data.id;
}
