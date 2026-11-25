import { BRAND } from "../../lib/brand";
import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { supabase, errorMessage } from "../../lib/supabase";
import { useAuth } from "../../contexts/AuthContext";
import { Button, ErrorBox, Field, Input } from "../../components/ui";
import AuthShell from "./AuthShell";

export default function Login() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user) return <Navigate to={location.state?.from ?? "/app"} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) setError(/invalid login/i.test(error.message) ? "Wrong email or password." : errorMessage(error));
    else navigate(location.state?.from ?? "/app", { replace: true });
  }

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to manage your AI sales agent."
      footer={<>New to {BRAND.name}? <Link to="/register" className="font-medium text-indigo-600">Create an account</Link></>}>
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorBox message={error} />}
        <Field label="Email"><Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Password"><Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <div className="text-right text-sm"><Link to="/forgot-password" className="text-indigo-600">Forgot password?</Link></div>
        <Button type="submit" loading={loading} className="w-full">Sign in</Button>
      </form>
    </AuthShell>
  );
}
