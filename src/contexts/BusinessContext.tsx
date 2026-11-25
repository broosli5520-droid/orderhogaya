import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase, errorMessage } from "../lib/supabase";
import type { Business, Membership, Role } from "../lib/types";
import { useAuth } from "./AuthContext";

interface BusinessState {
  memberships: Membership[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}
const Ctx = createContext<BusinessState>({ memberships: [], loading: true, error: null, reload: async () => {} });
export const useMemberships = () => useContext(Ctx);

/** Loads every business the signed-in user belongs to (and accepts pending invitations first). */
export function MembershipProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!user) { setMemberships([]); setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      await supabase.rpc("accept_invitations");
      const { data, error } = await supabase.from("business_members")
        .select("role, business:businesses(*)").eq("user_id", user.id).order("created_at");
      if (error) throw error;
      const rows = (data ?? []) as unknown as { role: Role; business: Business | null }[];
      setMemberships(rows.filter((r) => r.business).map((r) => ({ role: r.role, business: r.business as Business })));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { void reload(); }, [reload]);
  return <Ctx.Provider value={{ memberships, loading, error, reload }}>{children}</Ctx.Provider>;
}

/** The business currently open in the dashboard. */
interface CurrentBusiness { business: Business; role: Role; refresh: () => Promise<void>; }
const CurrentCtx = createContext<CurrentBusiness | null>(null);
export function CurrentBusinessProvider({ value, children }: { value: CurrentBusiness; children: ReactNode }) {
  return <CurrentCtx.Provider value={value}>{children}</CurrentCtx.Provider>;
}
export function useBusiness(): CurrentBusiness {
  const v = useContext(CurrentCtx);
  if (!v) throw new Error("useBusiness must be used inside a business route");
  return v;
}
