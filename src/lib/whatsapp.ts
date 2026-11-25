/** Free WhatsApp click-to-chat links (no API, no cost). Pakistani numbers like 0300… become 92300…. */
export function waNumber(phone: string): string {
  let d = (phone || "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0") && d.length === 11) d = "92" + d.slice(1);
  return d;
}
export function waLink(phone: string, text: string): string {
  return `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}`;
}
