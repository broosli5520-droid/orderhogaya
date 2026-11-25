import { BRAND } from "../lib/brand";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check } from "lucide-react";
import { supabase } from "../lib/supabase";
import { money } from "../lib/format";
import { BarChart3, Bot, Building2, MessageSquare, ShieldCheck, ShoppingCart, Target } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";

const features = [
  { icon: MessageSquare, title: "Answers customers 24/7", text: "Your AI agent explains products, services and prices using only your catalogue and knowledge base." },
  { icon: ShoppingCart, title: "Takes real orders", text: "It confirms items and totals with the customer, then saves the order straight into your dashboard." },
  { icon: Target, title: "Captures every lead", text: "Names, phone numbers and interests are saved automatically so your team can follow up." },
  { icon: BarChart3, title: "Sales reports", text: "Revenue, orders, top products and lead conversion for any date range, exportable to Excel." },
  { icon: Building2, title: "Multiple businesses", text: "Run several shops or brands from one account, each with its own chatbot and data." },
  { icon: ShieldCheck, title: "Team roles", text: "Owners, admins, sales agents and viewers — enforced by the database, not just the screen." },
];

export default function Landing() {
  const { user } = useAuth();
  const [plans, setPlans] = useState<{ id: string; name: string; description: string; currency: string; price_monthly: number; features: string[] }[]>([]);
  useEffect(() => {
    void supabase.from("plans").select("id, name, description, currency, price_monthly, features").eq("is_active", true).order("sort_order")
      .then(({ data }) => setPlans(data ?? []));
  }, []);
  return (
    <div className="min-h-full bg-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white"><Bot className="h-5 w-5" /></div>
          <span className="text-lg font-bold">{BRAND.first}<span className="text-indigo-600">{BRAND.second}</span></span>
        </div>
        <div className="flex gap-2">
          {user ? (
            <Link to="/app" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white">Open dashboard</Link>
          ) : (<>
            <Link to="/login" className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">Sign in</Link>
            <Link to="/register" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white">Get started</Link>
          </>)}
        </div>
      </header>
      <section className="mx-auto max-w-6xl px-4 pb-16 pt-12 text-center sm:pt-20">
        <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">AI sales agent for every business</span>
        <h1 className="mx-auto mt-5 max-w-3xl text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">
          Turn website visitors into <span className="text-indigo-600">orders</span> — automatically.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-slate-600">
          {BRAND.name} answers questions, explains your prices, collects customer details and books orders — in Urdu, Roman Urdu or English — while you run your business.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link to={user ? "/app" : "/register"} className="rounded-lg bg-indigo-600 px-6 py-3 font-medium text-white shadow-sm hover:bg-indigo-700">
            {user ? "Go to dashboard" : "Create free account"}
          </Link>
        </div>
      </section>
      <section className="border-t border-slate-100 bg-slate-50 py-16">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(({ icon: Icon, title, text }) => (
            <div key={title} className="rounded-xl border border-slate-200 bg-white p-6">
              <Icon className="h-6 w-6 text-indigo-600" />
              <h3 className="mt-3 font-semibold">{title}</h3>
              <p className="mt-1 text-sm text-slate-600">{text}</p>
            </div>
          ))}
        </div>
      </section>
      {plans.length > 0 && (
        <section className="py-16">
          <h2 className="text-center text-3xl font-bold">Simple pricing</h2>
          <p className="mt-2 text-center text-slate-600">Unlimited customer chats on every plan. Start free, upgrade any time.</p>
          <div className="mx-auto mt-10 grid max-w-6xl gap-6 px-4 sm:grid-cols-2 lg:grid-cols-4">
            {plans.map((p) => (
              <div key={p.id} className={`flex flex-col rounded-xl border bg-white p-6 ${p.id === "pro" ? "border-indigo-500 ring-1 ring-indigo-500" : "border-slate-200"}`}>
                <h3 className="font-semibold">{p.name}</h3>
                <p className="mt-1 text-sm text-slate-500">{p.description}</p>
                <div className="mt-4 text-3xl font-bold">{p.price_monthly ? money(p.price_monthly, p.currency) : "Free"}<span className="text-sm font-normal text-slate-500">{p.price_monthly ? " / month" : ""}</span></div>
                <ul className="mt-4 flex-1 space-y-2 text-sm">{p.features.map((f) => <li key={f} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />{f}</li>)}</ul>
                <Link to={user ? "/app" : "/register"} className="mt-6 rounded-lg bg-indigo-600 px-4 py-2 text-center text-sm font-medium text-white">{p.price_monthly ? "Get " + p.name : "Start free"}</Link>
              </div>
            ))}
          </div>
        </section>
      )}
      <footer className="py-8 text-center text-sm text-slate-500">© {new Date().getFullYear()} {BRAND.name}</footer>
    </div>
  );
}
