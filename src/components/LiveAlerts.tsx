import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useToast } from "./ui";

/** Short "ding" made with the Web Audio API (no sound file needed). */
function ding() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 880; g.gain.setValueAtTime(0.15, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    o.start(); o.stop(ctx.currentTime + 0.5);
  } catch { /* audio blocked until the user interacts with the page */ }
}

function notify(title: string, body: string, onClick: () => void) {
  ding();
  if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
    const n = new Notification(title, { body, icon: "/favicon.svg" });
    n.onclick = () => { window.focus(); onClick(); n.close(); };
  }
}

/** Real-time alerts for new orders, new leads and customers waiting for a human. Free (Supabase Realtime). */
export default function LiveAlerts({ businessId }: { businessId: string }) {
  const toast = useToast();
  const navigate = useNavigate();
  useEffect(() => {
    const base = `/app/${businessId}`;
    const ch = supabase.channel(`alerts-${businessId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "orders", filter: `business_id=eq.${businessId}` }, (p) => {
        const o = p.new as { order_number: number; source: string };
        toast("success", `New order #${o.order_number}${o.source === "chat" ? " from AI chat" : ""}`);
        // total is filled a moment later by a trigger, so the message omits it
        notify("New order", `Order #${o.order_number}`, () => navigate(`${base}/orders`));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "leads", filter: `business_id=eq.${businessId}` }, (p) => {
        const l = p.new as { interest: string };
        toast("success", "New lead captured");
        notify("New lead", l.interest || "A customer left their details", () => navigate(`${base}/leads`));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `business_id=eq.${businessId}` }, async (p) => {
        const m = p.new as { role: string; conversation_id: string; content: string };
        if (m.role !== "user") return;
        const { data } = await supabase.from("conversations").select("ai_paused").eq("id", m.conversation_id).maybeSingle();
        if (data?.ai_paused) {
          toast("success", "A customer is waiting for your reply");
          notify("Customer waiting", m.content.slice(0, 120), () => navigate(`${base}/conversations?c=${m.conversation_id}`));
        }
      })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [businessId, navigate, toast]);
  return null;
}
