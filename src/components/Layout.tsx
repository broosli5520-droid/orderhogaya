import { BRAND } from "../lib/brand";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Link, NavLink, Outlet, useNavigate, useParams } from "react-router-dom";
import { BarChart3, Bell, BookOpen, Bot, ChevronDown, CreditCard, Mic, ShieldCheck, LayoutDashboard, LogOut, Menu, MessageSquare, Package, Plus, Settings, ShoppingCart, Target, Users, UserCog, X } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { CurrentBusinessProvider, useMemberships } from "../contexts/BusinessContext";
import { roleLabels } from "../lib/permissions";
import { Spinner, cx } from "./ui";
import LiveAlerts from "./LiveAlerts";

const nav = [
  { to: "", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "conversations", label: "Conversations", icon: MessageSquare },
  { to: "orders", label: "Orders", icon: ShoppingCart },
  { to: "leads", label: "Leads", icon: Target },
  { to: "customers", label: "Customers", icon: Users },
  { to: "products", label: "Products & Services", icon: Package },
  { to: "knowledge", label: "Chatbot Knowledge", icon: BookOpen },
  { to: "voice", label: "Voice & Calls", icon: Mic },
  { to: "reports", label: "Sales Reports", icon: BarChart3 },
  { to: "team", label: "Team & Roles", icon: UserCog },
  { to: "settings", label: "Settings", icon: Settings },
  { to: "billing", label: "Plan & Billing", icon: CreditCard },
];

export default function Layout() {
  const { businessId } = useParams();
  const { memberships, loading, reload } = useMemberships();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [switcher, setSwitcher] = useState(false);
  const [platformAdmin, setPlatformAdmin] = useState(false);
  useEffect(() => { void supabase.rpc("is_platform_admin").then(({ data }) => setPlatformAdmin(data === true)); }, []);

  if (loading) return <Spinner />;
  const current = memberships.find((m) => m.business.id === businessId);
  if (!current) {
    return (
      <div className="mx-auto max-w-md p-10 text-center">
        <p className="text-slate-600">This business was not found or you no longer have access.</p>
        <Link to="/app" className="mt-4 inline-block font-medium text-indigo-600">Go to my businesses</Link>
      </div>
    );
  }

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-5 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white"><Bot className="h-5 w-5" /></div>
        <span className="text-lg font-bold">{BRAND.first}<span className="text-indigo-600">{BRAND.second}</span></span>
      </div>
      <div className="relative px-3">
        <button onClick={() => setSwitcher(!switcher)} className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left">
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{current.business.name}</span>
            <span className="block text-xs text-slate-500">{roleLabels[current.role]}</span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
        </button>
        {switcher && (
          <div className="absolute left-3 right-3 z-20 mt-1 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
            {memberships.map((m) => (
              <button key={m.business.id} onClick={() => { setSwitcher(false); setOpen(false); navigate(`/app/${m.business.id}`); }}
                className={cx("block w-full px-3 py-2 text-left text-sm hover:bg-slate-50", m.business.id === businessId && "font-semibold text-indigo-600")}>
                {m.business.name}
              </button>
            ))}
            <Link to="/app/new" onClick={() => setSwitcher(false)} className="flex items-center gap-2 border-t border-slate-100 px-3 py-2 text-sm text-indigo-600 hover:bg-slate-50">
              <Plus className="h-4 w-4" /> New business
            </Link>
          </div>
        )}
      </div>
      <nav className="mt-4 flex-1 space-y-0.5 overflow-y-auto px-3">
        {nav.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} onClick={() => setOpen(false)}
            className={({ isActive }) => cx("flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
              isActive ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-100")}>
            <Icon className="h-4 w-4" />{label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-slate-200 p-3">
        {platformAdmin && (
          <Link to="/app/admin" onClick={() => setOpen(false)} className="mb-1 flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50">
            <ShieldCheck className="h-4 w-4" /> Platform admin
          </Link>
        )}
        {typeof Notification !== "undefined" && Notification.permission === "default" && (
          <button onClick={() => void Notification.requestPermission()} className="mb-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-indigo-600 hover:bg-indigo-50">
            <Bell className="h-4 w-4" /> Turn on order alerts
          </button>
        )}
        <div className="truncate px-3 pb-2 text-xs text-slate-500">{user?.email}</div>
        <button onClick={async () => { await signOut(); navigate("/login"); }}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </div>
    </div>
  );

  return (
    <CurrentBusinessProvider value={{ business: current.business, role: current.role, refresh: reload }}>
      <LiveAlerts businessId={current.business.id} />
      <div className="flex h-full">
        <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white lg:block">{sidebar}</aside>
        {open && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} />
            <aside className="absolute inset-y-0 left-0 w-72 bg-white shadow-xl">
              <button className="absolute right-3 top-5 rounded p-1 text-slate-500" onClick={() => setOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></button>
              {sidebar}
            </aside>
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
            <button onClick={() => setOpen(true)} className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100" aria-label="Open menu"><Menu className="h-5 w-5" /></button>
            <span className="truncate font-semibold">{current.business.name}</span>
          </header>
          <main className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8"><Outlet /></div>
          </main>
        </div>
      </div>
    </CurrentBusinessProvider>
  );
}
