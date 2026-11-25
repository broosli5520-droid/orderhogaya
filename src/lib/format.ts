export function money(value: number | null | undefined, currency = "PKR"): string {
  const n = Number(value ?? 0);
  return `${currency} ${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}
export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
export function dateOnly(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
export function slugify(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
}
export function isoDay(d: Date): string {
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
/** True when the text is mostly Arabic-script (Urdu/Arabic) so we can render it right-to-left. */
export function isRtl(text: string): boolean {
  const rtl = (text.match(/[؀-ۿݐ-ݿ]/g) ?? []).length;
  const ltr = (text.match(/[A-Za-z]/g) ?? []).length;
  return rtl > ltr;
}
export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]): void {
  const esc = (v: string | number | null | undefined) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const blob = new Blob(["﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
