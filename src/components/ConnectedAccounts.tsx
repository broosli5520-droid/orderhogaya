import { useState } from "react";
import { KeyRound, Link2, Unlink } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase, errorMessage } from "../lib/supabase";
import { useAsync, must } from "../lib/useAsync";
import { can } from "../lib/permissions";
import { useBusiness } from "../contexts/BusinessContext";
import { Badge, Button, Card, ErrorBox, Field, Input, Spinner, useToast } from "./ui";

export interface ByokStatus { allowed: boolean; gemini: boolean; gemini_hint: string; elevenlabs: boolean; elevenlabs_hint: string; voice_id: string; voice_name: string; model: string }

/** Read an Edge Function error body ({ error }) into a message. */
export async function fnError(error: unknown, data?: { error?: string } | null): Promise<string> {
  if (data?.error) return data.error;
  const ctx = (error as { context?: Response } | null)?.context;
  if (ctx) { try { return (await ctx.json()).error ?? errorMessage(error); } catch { /* not json */ } }
  return errorMessage(error);
}

export function useByok() {
  const { business } = useBusiness();
  return useAsync(async () => must(await supabase.rpc("byok_status", { p_business: business.id })) as ByokStatus, [business.id]);
}

/** Paid plans: connect the business's own Gemini and ElevenLabs accounts. Keys are write-only. */
export default function ConnectedAccounts() {
  const { business, role } = useBusiness();
  const toast = useToast();
  const admin = can(role, "manageSettings");
  const { data, loading, error, reload } = useByok();
  const [gemini, setGemini] = useState("");
  const [eleven, setEleven] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function save(which: "gemini" | "elevenlabs", value: string) {
    setBusy(which);
    const { data: res, error } = await supabase.functions.invoke("byok", { body: { action: "save", businessId: business.id, [which]: value } });
    setBusy(null);
    if (error || res?.error) { toast("error", await fnError(error, res)); return; }
    toast("success", value ? "Connected and verified" : "Disconnected");
    if (which === "gemini") setGemini(""); else setEleven("");
    void reload();
  }

  return (
    <Card className="mt-6 p-5">
      <h2 className="mb-1 flex items-center gap-2 font-semibold"><KeyRound className="h-4 w-4" />Connect your own AI accounts</h2>
      <p className="mb-4 text-sm text-slate-500">
        Use your own Google Gemini and ElevenLabs accounts — you pay them directly and get their limits (no OrderHogaya AI limit).
        Keys are checked, stored securely on the server and can never be viewed again.
      </p>
      {loading ? <Spinner /> : error || !data ? <ErrorBox message={error ?? "Could not load"} onRetry={reload} /> : !data.allowed ? (
        <p className="rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-800">Available on paid plans. <Link to="../billing" className="font-medium underline">See plans</Link></p>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between"><b>Google Gemini</b>{data.gemini ? <Badge color="green">Connected {data.gemini_hint}</Badge> : <Badge>Not connected</Badge>}</div>
            <p className="mt-1 text-xs text-slate-500">Free key from aistudio.google.com/apikey (paid billing there for higher limits).</p>
            {admin && <>
              <Field label="API key" className="mt-3"><Input type="password" autoComplete="off" value={gemini} onChange={(e) => setGemini(e.target.value)} placeholder="AIza…" /></Field>
              <div className="mt-2 flex gap-2">
                <Button disabled={!gemini.trim()} loading={busy === "gemini"} onClick={() => save("gemini", gemini)}><Link2 className="h-4 w-4" />Save & test</Button>
                {data.gemini && <Button variant="secondary" onClick={() => save("gemini", "")}><Unlink className="h-4 w-4" />Disconnect</Button>}
              </div>
            </>}
          </div>
          <div className="rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between"><b>ElevenLabs (human voice)</b>{data.elevenlabs ? <Badge color="green">Connected {data.elevenlabs_hint}</Badge> : <Badge>Not connected</Badge>}</div>
            <p className="mt-1 text-xs text-slate-500">Key from elevenlabs.io → Developers → API keys. Then pick or clone a voice on the Voice & Calls page.</p>
            {admin && <>
              <Field label="API key" className="mt-3"><Input type="password" autoComplete="off" value={eleven} onChange={(e) => setEleven(e.target.value)} placeholder="sk_…" /></Field>
              <div className="mt-2 flex gap-2">
                <Button disabled={!eleven.trim()} loading={busy === "elevenlabs"} onClick={() => save("elevenlabs", eleven)}><Link2 className="h-4 w-4" />Save & test</Button>
                {data.elevenlabs && <Button variant="secondary" onClick={() => save("elevenlabs", "")}><Unlink className="h-4 w-4" />Disconnect</Button>}
              </div>
            </>}
          </div>
        </div>
      )}
    </Card>
  );
}
