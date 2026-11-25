import { useState } from "react";
import { Upload } from "lucide-react";
import { supabase, errorMessage } from "../lib/supabase";
import { downloadCsv } from "../lib/format";
import { Button, ErrorBox, Modal } from "./ui";

/** Minimal RFC-4180 CSV parser (quotes, commas and new lines inside quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let q = false;
  const t = text.replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

const COLS = ["name", "price", "sale_price", "category", "description", "stock", "type", "sku"];

type Row = { business_id: string; kind: "product" | "service"; name: string; price: number; sale_price: number | null; category: string; description: string; stock: number | null; sku: string };

export default function ImportProducts({ businessId, onClose, onDone }: { businessId: string; onClose: () => void; onDone: (n: number) => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load(file: File) {
    setErr(null);
    const data = parseCsv(await file.text());
    if (data.length < 2) { setErr("The file has no rows."); return; }
    const head = data[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
    const idx = (k: string) => head.indexOf(k);
    if (idx("name") < 0 || idx("price") < 0) { setErr('The first row must contain at least "name" and "price" columns.'); return; }
    const out: Row[] = []; const bad: string[] = [];
    data.slice(1).forEach((r, i) => {
      const get = (k: string) => (idx(k) >= 0 ? (r[idx(k)] ?? "").trim() : "");
      const num = (v: string) => Number(v.replace(/[^\d.]/g, ""));
      const name = get("name"); const price = num(get("price"));
      if (!name || !(price >= 0) || get("price") === "") { bad.push(`Row ${i + 2}: missing name or price`); return; }
      const sale = get("sale_price"); const stock = get("stock");
      out.push({
        business_id: businessId, name: name.slice(0, 200), price,
        kind: /serv/i.test(get("type")) ? "service" : "product",
        sale_price: sale ? num(sale) : null, category: get("category"), description: get("description"),
        stock: stock === "" ? null : Math.max(0, Math.floor(num(stock))), sku: get("sku"),
      });
    });
    setRows(out); setProblems(bad);
  }

  async function save() {
    setSaving(true); setErr(null);
    try {
      for (let i = 0; i < rows.length; i += 200) {
        const { error } = await supabase.from("products").insert(rows.slice(i, i + 200));
        if (error) throw error;
      }
      onDone(rows.length);
    } catch (e) { setErr(errorMessage(e)); } finally { setSaving(false); }
  }

  return (
    <Modal open onClose={onClose} title="Import products from Excel / CSV"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={saving} disabled={!rows.length}>Import {rows.length || ""} items</Button></>}>
      <div className="space-y-4 text-sm">
        <p className="text-slate-600">Save your sheet as <b>CSV</b> (Excel: File → Save As → CSV UTF-8). Columns: <code>{COLS.join(", ")}</code>. Only name and price are required; type is "product" or "service".</p>
        <button type="button" className="font-medium text-indigo-600" onClick={() => downloadCsv("products-template.csv", [COLS,
          ["Desi Ghee 1kg", "600", "560", "Grocery", "Pure desi ghee", "20", "product", "DG1"],
          ["Home delivery", "150", "", "Services", "Within Lahore", "", "service", ""]])}>Download a template</button>
        <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 px-4 py-8 text-slate-500 hover:bg-slate-50">
          <Upload className="mb-2 h-6 w-6" />Choose CSV file
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void load(f); }} />
        </label>
        {err && <ErrorBox message={err} />}
        {rows.length > 0 && <p className="text-emerald-700">{rows.length} items ready to import (first: {rows[0].name}).</p>}
        {problems.length > 0 && <div className="rounded-lg bg-amber-50 p-3 text-amber-800">{problems.length} rows skipped:<br />{problems.slice(0, 5).join("; ")}{problems.length > 5 ? "…" : ""}</div>}
      </div>
    </Modal>
  );
}
