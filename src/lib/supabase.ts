import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && anonKey);

export const supabase = createClient(url ?? "http://localhost:54321", anonKey ?? "missing-anon-key", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

/** Turn a Supabase/Postgres error into a short, human message. */
export function errorMessage(e: unknown): string {
  if (!e) return "Something went wrong.";
  const msg = typeof e === "string" ? e : (e as { message?: string }).message ?? String(e);
  const limit = msg.match(/plan limit: (.*)/i);
  if (limit) return limit[1];
  if (/duplicate key.*slug/i.test(msg)) return "That link name is already taken. Try another.";
  if (/customers_business_phone_uidx/i.test(msg)) return "A customer with this phone number already exists.";
  if (/row-level security|permission denied/i.test(msg)) return "You don't have permission to do that.";
  if (/violates foreign key/i.test(msg)) return "This record is used elsewhere and can't be removed.";
  return msg;
}
