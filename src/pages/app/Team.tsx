import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Mail, Trash2, UserPlus } from "lucide-react";
import { supabase, errorMessage } from "../../lib/supabase";
import { useAsync, must } from "../../lib/useAsync";
import { dateOnly } from "../../lib/format";
import { can, roleHelp, roleLabels } from "../../lib/permissions";
import type { Invitation, Member, Role } from "../../lib/types";
import { useAuth } from "../../contexts/AuthContext";
import { useBusiness } from "../../contexts/BusinessContext";
import { Badge, Button, Card, ErrorBox, Field, Input, PageHeader, Select, Spinner, confirmAction, useToast } from "../../components/ui";

export default function Team() {
  const { business, role, refresh } = useBusiness();
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const manage = can(role, "manageTeam");
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("agent");
  const [sending, setSending] = useState(false);

  const { data, loading, error, reload } = useAsync(async () => {
    const members = must(await supabase.from("business_members").select("user_id, role, created_at").eq("business_id", business.id).order("created_at")) as Member[];
    const profiles = must(await supabase.from("profiles").select("id, email, full_name").in("id", members.map((m) => m.user_id))) as { id: string; email: string; full_name: string }[];
    const invites = manage ? must(await supabase.from("invitations").select("id, email, role, created_at").eq("business_id", business.id).order("created_at")) as Invitation[] : [];
    return { members: members.map((m) => ({ ...m, profile: profiles.find((p) => p.id === m.user_id) ?? null })), invites };
  }, [business.id, manage]);

  // Owners can grant admin; admins can only grant agent/viewer.
  const grantable: Role[] = role === "owner" ? ["admin", "agent", "viewer"] : ["agent", "viewer"];

  async function invite(e: FormEvent) {
    e.preventDefault();
    const em = email.trim().toLowerCase();
    if (data?.members.some((m) => m.profile?.email === em)) { toast("error", "This person is already a member."); return; }
    setSending(true);
    const { error } = await supabase.from("invitations").insert({ business_id: business.id, email: em, role: inviteRole, invited_by: user?.id });
    setSending(false);
    if (error) { toast("error", /duplicate/i.test(error.message) ? "This email is already invited." : errorMessage(error)); return; }
    setEmail(""); toast("success", "Invitation saved"); void reload();
  }

  async function changeRole(m: Member, r: Role) {
    const { error } = await supabase.rpc("set_member_role", { p_business: business.id, p_user: m.user_id, p_role: r });
    if (error) toast("error", errorMessage(error)); else { toast("success", "Role updated"); void reload(); }
  }

  async function removeMember(m: Member) {
    const self = m.user_id === user?.id;
    if (!confirmAction(self ? `Leave ${business.name}?` : `Remove ${m.profile?.email ?? "this member"} from ${business.name}?`)) return;
    const { error } = await supabase.rpc("remove_member", { p_business: business.id, p_user: m.user_id });
    if (error) { toast("error", errorMessage(error)); return; }
    if (self) { await refresh(); navigate("/app"); } else void reload();
  }

  async function cancelInvite(i: Invitation) {
    const { error } = await supabase.from("invitations").delete().eq("id", i.id);
    if (error) toast("error", errorMessage(error)); else void reload();
  }

  const canManageMember = (m: Member) => manage && m.user_id !== user?.id && m.role !== "owner" && (role === "owner" || m.role === "agent" || m.role === "viewer");

  return (
    <>
      <PageHeader title="Team & Roles" subtitle="Give your staff their own login with the right level of access." />
      {loading ? <Spinner /> : error || !data ? <ErrorBox message={error ?? "Could not load"} onRetry={reload} /> : (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <h2 className="border-b border-slate-200 px-5 py-4 font-semibold">Members ({data.members.length})</h2>
            {data.members.map((m) => (
              <div key={m.user_id} className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 last:border-0 sm:flex-row sm:items-center">
                <div className="flex flex-1 items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-100 font-semibold text-indigo-700">
                    {(m.profile?.full_name || m.profile?.email || "?").charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-medium">{m.profile?.full_name || m.profile?.email} {m.user_id === user?.id && <span className="text-xs text-slate-400">(you)</span>}</div>
                    <div className="truncate text-xs text-slate-500">{m.profile?.email} · joined {dateOnly(m.created_at)}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {canManageMember(m) ? (
                    <Select className="w-36 py-1" value={m.role} onChange={(e) => changeRole(m, e.target.value as Role)}>
                      {Array.from(new Set<Role>([m.role, ...grantable])).map((r) => <option key={r} value={r}>{roleLabels[r]}</option>)}
                    </Select>
                  ) : <Badge color={m.role === "owner" ? "indigo" : "gray"}>{roleLabels[m.role]}</Badge>}
                  {(canManageMember(m) || (m.user_id === user?.id && m.role !== "owner")) && (
                    <button onClick={() => removeMember(m)} className="rounded p-1.5 text-red-500 hover:bg-red-50" title={m.user_id === user?.id ? "Leave" : "Remove"}><Trash2 className="h-4 w-4" /></button>
                  )}
                </div>
              </div>
            ))}
          </Card>

          <div className="space-y-6">
            {manage && (
              <Card className="p-5">
                <h2 className="flex items-center gap-2 font-semibold"><UserPlus className="h-4 w-4" />Invite a teammate</h2>
                <form onSubmit={invite} className="mt-4 space-y-3">
                  <Field label="Email"><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
                  <Field label="Role"><Select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Role)}>{grantable.map((r) => <option key={r} value={r}>{roleLabels[r]}</option>)}</Select></Field>
                  <p className="text-xs text-slate-500">{roleHelp[inviteRole]}</p>
                  <Button type="submit" loading={sending} className="w-full">Save invitation</Button>
                  <p className="text-xs text-slate-500">Ask them to sign up (or sign in) at <b>{window.location.origin}</b> with this email — they join automatically.</p>
                </form>
                {data.invites.length > 0 && (
                  <div className="mt-5 border-t border-slate-100 pt-4">
                    <h3 className="mb-2 text-sm font-medium">Pending invitations</h3>
                    {data.invites.map((i) => (
                      <div key={i.id} className="flex items-center justify-between py-1.5 text-sm">
                        <span className="flex min-w-0 items-center gap-2"><Mail className="h-4 w-4 shrink-0 text-slate-400" /><span className="truncate">{i.email}</span></span>
                        <span className="flex items-center gap-1"><Badge>{roleLabels[i.role]}</Badge>
                          <button onClick={() => cancelInvite(i)} className="rounded p-1 text-slate-400 hover:text-red-500" title="Cancel"><Trash2 className="h-4 w-4" /></button></span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            )}
            <Card className="p-5">
              <h2 className="mb-3 font-semibold">What each role can do</h2>
              {(Object.keys(roleLabels) as Role[]).map((r) => (
                <div key={r} className="py-1.5 text-sm"><span className="font-medium">{roleLabels[r]}:</span> <span className="text-slate-600">{roleHelp[r]}</span></div>
              ))}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
