import { BRAND } from "./lib/brand";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./contexts/AuthContext";
import { MembershipProvider, useMemberships } from "./contexts/BusinessContext";
import { supabaseConfigured } from "./lib/supabase";
import { Spinner } from "./components/ui";
import Layout from "./components/Layout";
import Landing from "./pages/Landing";
import Login from "./pages/auth/Login";
import Register from "./pages/auth/Register";
import ForgotPassword from "./pages/auth/ForgotPassword";
import ResetPassword from "./pages/auth/ResetPassword";
import NewBusiness from "./pages/NewBusiness";
import PublicChat from "./pages/PublicChat";
import Dashboard from "./pages/app/Dashboard";
import Products from "./pages/app/Products";
import Knowledge from "./pages/app/Knowledge";
import Customers from "./pages/app/Customers";
import Leads from "./pages/app/Leads";
import Orders from "./pages/app/Orders";
import Conversations from "./pages/app/Conversations";
import Reports from "./pages/app/Reports";
import Team from "./pages/app/Team";
import SettingsPage from "./pages/app/Settings";
import VoicePage from "./pages/app/Voice";
import Billing from "./pages/app/Billing";
import PlatformAdmin from "./pages/PlatformAdmin";

function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <MembershipProvider><Outlet /></MembershipProvider>;
}

function AppHome() {
  const { memberships, loading, error, reload } = useMemberships();
  if (loading) return <Spinner />;
  if (error) return <div className="p-8 text-center text-red-600">{error} <button className="underline" onClick={reload}>Retry</button></div>;
  if (!memberships.length) return <Navigate to="/app/new" replace />;
  let last: string | null = null;
  try { last = localStorage.getItem("sp.lastBusiness"); } catch { /* storage unavailable */ }
  const target = memberships.find((m) => m.business.id === last) ?? memberships[0];
  return <Navigate to={`/app/${target.business.id}`} replace />;
}

function NotConfigured() {
  return (
    <div className="mx-auto max-w-xl p-10">
      <h1 className="text-xl font-bold">{BRAND.name} is not connected to Supabase yet</h1>
      <p className="mt-3 text-slate-600">Create a <code>.env</code> file with <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> (see <code>.env.example</code> and the README), then restart the dev server.</p>
    </div>
  );
}

export default function App() {
  if (!supabaseConfigured) return <NotConfigured />;
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/chat/:slug" element={<PublicChat />} />
      <Route path="/app" element={<RequireAuth />}>
        <Route index element={<AppHome />} />
        <Route path="new" element={<NewBusiness />} />
        <Route path="admin" element={<PlatformAdmin />} />
        <Route path=":businessId" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="conversations" element={<Conversations />} />
          <Route path="orders" element={<Orders />} />
          <Route path="leads" element={<Leads />} />
          <Route path="customers" element={<Customers />} />
          <Route path="products" element={<Products />} />
          <Route path="knowledge" element={<Knowledge />} />
          <Route path="voice" element={<VoicePage />} />
          <Route path="reports" element={<Reports />} />
          <Route path="team" element={<Team />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="billing" element={<Billing />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
