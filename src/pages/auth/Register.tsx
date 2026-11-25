import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { MailCheck } from "lucide-react";
import { supabase, errorMessage } from "../../lib/supabase";
import { useAuth } from "../../contexts/AuthContext";
import { Button, ErrorBox, Field, Input } from "../../components/ui";
import AuthShell from "./AuthShell";

export default function Register() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  if (user) return <Navigate to="/app" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    setLoading(true); setError(null);
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(), password,
      options: { data: { full_name: name.trim() }, emailRedirectTo: `${window.location.origin}/app` },
    });
    setLoading(false);
    if (error) { setError(errorMessage(error)); return; }
    if (data.session) navigate("/app", { replace: true }); // email confirmation disabled
    else setSent(true);                                     // confirmation email sent
  }

  if (sent) {
    return (
      <AuthShell title="Check your email">
        <div className="flex flex-col items-center text-center">
          <MailCheck className="h-12 w-12 text-indigo-600" />
          <p className="mt-3 text-slate-600">We sent a confirmation link to <b>{email}</b>. Open it to activate your account, then sign in.</p>
          <Link to="/login" className="mt-6 font-medium text-indigo-600">Back to sign in</Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Create your account" subtitle="Start answering customers and taking orders with AI."
      footer={<>Already have an account? <Link to="/login" className="font-medium text-indigo-600">Sign in</Link></>}>
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorBox message={error} />}
        <Field label="Full name"><Input required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Email"><Input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Password" hint="At least 8 characters."><Input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <Button type="submit" loading={loading} className="w-full">Create account</Button>
        <p className="text-xs text-slate-500">If a teammate invited you, register with the same email to join their business automatically.</p>
      </form>
    </AuthShell>
  );
}
