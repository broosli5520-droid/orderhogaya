import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { supabase, errorMessage } from "../../lib/supabase";
import { useAuth } from "../../contexts/AuthContext";
import { Button, ErrorBox, Field, Input, Spinner } from "../../components/ui";
import AuthShell from "./AuthShell";

export default function ResetPassword() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    setLoading(true); setError(null);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) setError(errorMessage(error)); else navigate("/app", { replace: true });
  }

  if (authLoading) return <Spinner />;
  return (
    <AuthShell title="Choose a new password">
      {!user ? (
        <p className="text-slate-600">This reset link is invalid or has expired. Request a new one from the sign-in page.</p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <ErrorBox message={error} />}
          <Field label="New password" hint="At least 8 characters."><Input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <Button type="submit" loading={loading} className="w-full">Save password</Button>
        </form>
      )}
    </AuthShell>
  );
}
