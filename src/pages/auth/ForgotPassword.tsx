import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { supabase, errorMessage } from "../../lib/supabase";
import { Button, ErrorBox, Field, Input } from "../../components/ui";
import AuthShell from "./AuthShell";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/reset-password` });
    setLoading(false);
    if (error) setError(errorMessage(error)); else setSent(true);
  }

  return (
    <AuthShell title="Reset your password" footer={<Link to="/login" className="font-medium text-indigo-600">Back to sign in</Link>}>
      {sent ? (
        <p className="text-slate-600">If an account exists for <b>{email}</b>, a reset link is on its way. Open it on this device.</p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <ErrorBox message={error} />}
          <Field label="Email"><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Button type="submit" loading={loading} className="w-full">Send reset link</Button>
        </form>
      )}
    </AuthShell>
  );
}
