// OrderHogaya — built-in sales bot.
//
// Works with NO external AI service: no API key, no quota, no cost.
// It answers from the catalogue and knowledge base, lists prices, and runs
// guided flows to place an order, save a call-back request, or check an order.
// Used when a business chooses "Basic (free, unlimited)" mode, when no AI key
// is configured, or automatically when the AI provider is busy / over quota.

export type BotProduct = {
  id: string; kind: string; name: string; description: string; category: string;
  price: number; sale_price: number | null; stock: number | null; sku: string;
};
export type BotBusiness = { name: string; currency: string; phone: string; address: string; bot_name: string };
export type BotState = {
  flow?: "order" | "lead" | "status";
  step?: string;
  items?: { id: string; qty: number }[];
  name?: string; phone?: string; address?: string; interest?: string; number?: number;
  ur?: boolean; // last language used by the customer
};
type Tool = (name: string, args: Record<string, unknown>) => Promise<unknown>;

const URDU_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const normDigits = (s: string) => s.replace(/[۰-۹]/g, (d) => String(URDU_DIGITS.indexOf(d)));
const isUrdu = (s: string) => (s.match(/[؀-ۿ]/g) ?? []).length > (s.match(/[A-Za-z]/g) ?? []).length;
const norm = (s: string) => normDigits(s.toLowerCase()).replace(/[^\p{L}\p{N}\s#+]/gu, " ").replace(/\s+/g, " ").trim();
const tokens = (s: string) => norm(s).split(" ").filter((t) => t.length > 1);
const has = (text: string, words: string[]) => {
  const n = ` ${norm(text)} `;
  return words.some((w) => n.includes(` ${w} `) || (w.length > 3 && n.includes(w)));
};

const W = {
  greet: ["hi", "hello", "hey", "salam", "assalam", "aoa", "slam", "السلام", "سلام", "ہیلو", "ہائے"],
  order: ["order", "buy", "purchase", "khareed", "kharid", "khareedna", "mangwana", "mangwa", "book", "آرڈر", "خرید", "خریدنا", "منگوانا", "منگوا", "بک"],
  status: ["status", "track", "tracking", "kahan", "where is my", "ٹریک", "اسٹیٹس", "سٹیٹس", "کہاں"],
  list: ["products", "product", "items", "list", "menu", "catalog", "catalogue", "rates", "price list", "kya kya", "services", "لسٹ", "چیزیں", "ریٹ", "مینو", "پروڈکٹ", "سروس"],
  contact: ["call", "contact", "number", "phone", "whatsapp", "baat", "callback", "person", "human", "agent", "team", "رابطہ", "فون", "نمبر", "کال", "بات"],
  yes: ["yes", "y", "ok", "okay", "haan", "han", "ha", "ji", "jee", "g", "confirm", "theek", "thik", "done", "ہاں", "جی", "ٹھیک", "کنفرم", "اوکے"],
  no: ["no", "nahi", "nahin", "na", "cancel", "stop", "chhoro", "rehne", "نہیں", "کینسل", "بس", "رہنے"],
  more: ["aur", "more", "add", "another", "اور", "مزید"],
};
const STOP = new Set(["the", "and", "for", "with", "price", "rate", "kitne", "kitna", "ka", "ki", "ke", "hai", "hain", "kya", "of", "is", "what", "how", "much", "me", "mein", "do", "de", "dein", "chahiye", "کا", "کی", "کے", "ہے", "ہیں", "کیا", "میں", "قیمت", "کتنے", "کتنا", "چاہیے"]);

function t(ur: boolean, en: string, urdu: string) { return ur ? urdu : en; }

/** Best matching product for a piece of text (by name / SKU word overlap). */
function matchProduct(text: string, products: BotProduct[]): BotProduct | null {
  const words = new Set(tokens(text).filter((w) => !STOP.has(w)));
  const n = ` ${norm(text)} `;
  let best: BotProduct | null = null, bestScore = 0;
  for (const p of products) {
    const name = norm(p.name);
    if (!name) continue;
    let score = n.includes(` ${name} `) ? 10 : 0;
    const pw = tokens(p.name).filter((w) => !STOP.has(w));
    const hits = pw.filter((w) => words.has(w) || [...words].some((x) => x.length > 3 && (x.startsWith(w) || w.startsWith(x)))).length;
    if (pw.length && hits) score = Math.max(score, (hits / pw.length) * 5 + hits);
    if (p.sku && words.has(p.sku.toLowerCase())) score = Math.max(score, 9);
    if (score > bestScore) { best = p; bestScore = score; }
  }
  return bestScore >= 2 ? best : null;
}

/** Parse "2 sugar, 1 ghee aur 3 rice" into catalogue items. */
function parseItems(text: string, products: BotProduct[]): { id: string; qty: number }[] {
  const parts = normDigits(text).split(/,|،|\+|\band\b|\baur\b|اور|\n/i).map((s) => s.trim()).filter(Boolean);
  const out: { id: string; qty: number }[] = [];
  for (const part of parts) {
    const p = matchProduct(part, products);
    if (!p) continue;
    const m = part.match(/(\d+(?:\.\d+)?)/);
    const qty = Math.max(1, Math.min(10000, Math.round(m ? Number(m[1]) : 1)));
    const ex = out.find((x) => x.id === p.id);
    if (ex) ex.qty += qty; else out.push({ id: p.id, qty });
  }
  return out;
}

function bestKnowledge(text: string, kb: { id?: string; question: string; answer: string }[]) {
  const words = new Set(tokens(text).filter((w) => !STOP.has(w)));
  if (!words.size) return null;
  let best: { id?: string; question: string; answer: string } | null = null, bestScore = 0;
  for (const k of kb) {
    const qw = tokens(k.question).filter((w) => !STOP.has(w));
    const aw = new Set(tokens(k.answer));
    const near = (w: string) => words.has(w) || [...words].some((x) => x.length > 2 && w.length > 2 && (x.startsWith(w) || w.startsWith(x)));
    const qHits = qw.filter(near).length;
    const aHits = [...words].filter((w) => aw.has(w)).length;
    const score = (qw.length ? qHits / qw.length : 0) * 2 + qHits + aHits * 0.3;
    if (score > bestScore) { best = k; bestScore = score; }
  }
  return bestScore >= 1.6 ? best : null;
}

const priceOf = (p: BotProduct) => Number(p.sale_price != null && p.sale_price < p.price ? p.sale_price : p.price);

async function basicReplyInner(input: {
  message: string; state: BotState; business: BotBusiness; products: BotProduct[];
  knowledge: { id?: string; question: string; answer: string }[]; tool: Tool;
}): Promise<{ reply: string; state: BotState; voice?: string }> {
  const { message, business: b, products, knowledge, tool } = input;
  // Keep the customer's language even when they only type a number.
  const ur = /\p{L}/u.test(message) ? isUrdu(message) : !!input.state.ur;
  const money = (n: number) => `${b.currency} ${Number(n).toLocaleString("en-US")}`;
  const byId = new Map(products.map((p) => [p.id, p]));
  let s: BotState = { ...input.state };

  const menu = t(ur,
    "I can help you with:\n• Product list & prices — type \"list\"\n• Price of an item — type its name\n• Place an order — type \"order\"\n• Order status — type \"status\"\n• Call back from our team — type \"call\"",
    "میں ان کاموں میں مدد کر سکتا ہوں:\n• چیزوں کی لسٹ اور ریٹ — \"لسٹ\" لکھیں\n• کسی چیز کی قیمت — اس کا نام لکھیں\n• آرڈر دینا — \"آرڈر\" لکھیں\n• آرڈر کی صورتحال — \"اسٹیٹس\" لکھیں\n• ہماری ٹیم سے رابطہ — \"کال\" لکھیں");
  const listText = () => {
    if (!products.length) return t(ur, "Our catalogue is being updated. Please type \"call\" and we will contact you.", "ہماری لسٹ ابھی اپڈیٹ ہو رہی ہے۔ \"کال\" لکھیں، ہم آپ سے رابطہ کریں گے۔");
    const lines = products.slice(0, 25).map((p) => `• ${p.name} — ${money(priceOf(p))}${p.kind === "product" && p.stock === 0 ? t(ur, " (out of stock)", " (ختم)") : ""}`);
    const more = products.length > 25 ? t(ur, `\n…and ${products.length - 25} more. Type an item's name to ask about it.`, `\n…اور ${products.length - 25} مزید۔ کسی چیز کا نام لکھ کر پوچھیں۔`) : "";
    return t(ur, "Here is our list:\n", "ہماری لسٹ:\n") + lines.join("\n") + more;
  };
  const cartText = (items: { id: string; qty: number }[]) => {
    let total = 0;
    const lines = items.map((i) => { const p = byId.get(i.id)!; const sub = priceOf(p) * i.qty; total += sub; return `• ${i.qty} × ${p.name} = ${money(sub)}`; });
    return { text: lines.join("\n") + `\n${t(ur, "Total", "کل")}: ${money(total)}`, total };
  };
  const askAddress = () => t(ur, "Delivery address? (Type \"pickup\" if you will collect it.)", "ڈلیوری کا پتہ؟ (خود لینے آئیں گے تو \"پک اپ\" لکھیں)");
  const confirmText = () => t(ur, "Please confirm your order:\n", "براہِ کرم اپنا آرڈر کنفرم کریں:\n") + cartText(s.items ?? []).text +
    `\n${t(ur, "Name", "نام")}: ${s.name}\n${t(ur, "Phone", "فون")}: ${s.phone}\n${t(ur, "Address", "پتہ")}: ${s.address}\n\n` +
    t(ur, "Reply \"yes\" to place the order, \"add\" to add more items, or \"cancel\".", "آرڈر کے لیے \"جی\" لکھیں، مزید چیز کے لیے \"اور\"، یا \"کینسل\"۔");
  const phoneOk = (p: string) => p.replace(/\D/g, "").length >= 10;
  const cleanPhone = (p: string) => normDigits(p).replace(/[^\d+]/g, "");

  // Cancel any running flow
  if (s.flow && has(message, W.no) && tokens(message).length <= 3) {
    return { reply: t(ur, "No problem, cancelled. ", "ٹھیک ہے، کینسل کر دیا۔ ") + "\n\n" + menu, state: {} };
  }

  // ------------------------------------------------ running flows
  if (s.flow === "order") {
    if (s.step === "items") {
      const items = parseItems(message, products);
      if (!items.length) return { reply: t(ur, "I couldn't find that item. Please type the item name and quantity, e.g. \"2 ", "یہ چیز نہیں ملی۔ چیز کا نام اور تعداد لکھیں، جیسے \"2 ") + (products[0]?.name ?? "item") + "\".\n\n" + listText(), state: s };
      const merged = (s.items ?? []).map((m) => ({ ...m }));
      for (const it of items) { const ex = merged.find((m) => m.id === it.id); if (ex) ex.qty += it.qty; else merged.push({ ...it }); }
      const out = merged.filter((i) => { const p = byId.get(i.id)!; return p.kind === "product" && p.stock != null && p.stock < i.qty; });
      if (out.length) { const p = byId.get(out[0].id)!; return { reply: t(ur, `Sorry, only ${p.stock} of ${p.name} available. Please change the quantity.`, `معذرت، ${p.name} صرف ${p.stock} دستیاب ہیں۔ تعداد کم کر کے دوبارہ لکھیں۔`), state: s }; }
      s.items = merged;
      s.step = s.name ? (s.phone ? (s.address ? "confirm" : "address") : "phone") : "name";
      const c = cartText(s.items);
      const next = s.step === "confirm" ? confirmText() : s.step === "address" ? askAddress() : s.step === "phone" ? t(ur, "Your phone number please?", "آپ کا فون نمبر؟") : t(ur, "What is your name?", "آپ کا نام کیا ہے؟");
      return { reply: (s.step === "confirm" ? "" : t(ur, "Added:\n", "شامل کر دیا:\n") + c.text + "\n\n") + next, state: s,
        voice: s.step === "name" ? "ask_name" : s.step === "phone" ? "ask_phone" : s.step === "address" ? "ask_address" : undefined };
    }
    if (s.step === "name") {
      s.name = message.trim().slice(0, 120); s.step = "phone";
      return { reply: t(ur, `Thanks ${s.name}. Your phone number please?`, `شکریہ ${s.name}۔ آپ کا فون نمبر؟`), state: s, voice: "ask_phone" };
    }
    if (s.step === "phone") {
      if (!phoneOk(message)) return { reply: t(ur, "Please send a valid phone number (e.g. 03001234567).", "براہِ کرم درست فون نمبر لکھیں (جیسے 03001234567)۔"), state: s };
      s.phone = cleanPhone(message); s.step = "address";
      return { reply: askAddress(), state: s, voice: "ask_address" };
    }
    if (s.step === "address") {
      s.address = message.trim().slice(0, 500); s.step = "confirm";
      return { reply: confirmText(), state: s };
    }
    if (s.step === "confirm") {
      if (has(message, W.more)) { s.step = "items"; return { reply: t(ur, "Sure — which item and how many?", "ضرور — کون سی چیز اور کتنی؟"), state: s }; }
      if (!has(message, W.yes)) return { reply: t(ur, "Reply \"yes\" to confirm, \"add\" for more items, or \"cancel\".", "کنفرم کے لیے \"جی\"، مزید کے لیے \"اور\"، یا \"کینسل\" لکھیں۔"), state: s };
      const r = await tool("create_order", {
        customer_name: s.name, phone: s.phone, address: s.address,
        items: (s.items ?? []).map((i) => ({ product_id: i.id, quantity: i.qty })),
      }) as { ok?: boolean; order_number?: number; total?: string; error?: string };
      if (!r?.ok) return { reply: t(ur, "Sorry, the order could not be placed: ", "معذرت، آرڈر نہیں ہو سکا: ") + (r?.error ?? "") + (b.phone ? `\n${t(ur, "Call us", "ہمیں کال کریں")}: ${b.phone}` : ""), state: {} };
      return { reply: t(ur, `✅ Order #${r.order_number} placed! Total: ${r.total}. Our team will contact you shortly.`, `✅ آپ کا آرڈر نمبر ${r.order_number} ہو گیا! کل رقم: ${r.total}۔ ہماری ٹیم جلد رابطہ کرے گی۔`), state: {} };
    }
  }

  if (s.flow === "lead") {
    if (s.step === "name") { s.name = message.trim().slice(0, 120); s.step = "phone"; return { reply: t(ur, "Your phone number please?", "آپ کا فون نمبر؟"), state: s, voice: "ask_phone" }; }
    if (s.step === "phone") {
      if (!phoneOk(message)) return { reply: t(ur, "Please send a valid phone number.", "براہِ کرم درست فون نمبر لکھیں۔"), state: s };
      const r = await tool("save_lead", { name: s.name, phone: cleanPhone(message), interest: s.interest || "Requested a call back" }) as { ok?: boolean };
      return r?.ok ? { reply: t(ur, "Thank you! Our team will call you soon.", "شکریہ! ہماری ٹیم جلد آپ کو کال کرے گی۔"), state: {}, voice: "lead_thanks" }
        : { reply: t(ur, "Sorry, please try again.", "معذرت، دوبارہ کوشش کریں۔"), state: {} };
    }
  }

  if (s.flow === "status") {
    if (s.step === "number") {
      const m = normDigits(message).match(/\d+/);
      if (!m) return { reply: t(ur, "Please type your order number.", "اپنا آرڈر نمبر لکھیں۔"), state: s };
      s.number = Number(m[0]); s.step = "phone";
      return { reply: t(ur, "And the phone number used for the order?", "آرڈر والا فون نمبر؟"), state: s };
    }
    if (s.step === "phone") {
      const r = await tool("check_order_status", { order_number: s.number, phone: cleanPhone(message) }) as { ok?: boolean; status?: string; total?: string; placed_on?: string; error?: string };
      return { reply: r?.ok ? t(ur, `Order #${s.number}: ${r.status} (total ${r.total}, placed ${r.placed_on}).`, `آرڈر نمبر ${s.number}: ${r.status} (کل ${r.total}، تاریخ ${r.placed_on})۔`) : t(ur, "No order found with that number and phone.", "اس نمبر اور فون سے کوئی آرڈر نہیں ملا۔"), state: {} };
    }
  }

  // ------------------------------------------------ new intents
  s = {};
  if (has(message, W.status)) {
    const m = normDigits(message).match(/#?\s*(\d{1,7})\b/);
    if (m && !phoneOk(m[1])) return { reply: t(ur, "Phone number used for the order?", "آرڈر والا فون نمبر؟"), state: { flow: "status", step: "phone", number: Number(m[1]) } };
    return { reply: t(ur, "Please type your order number.", "اپنا آرڈر نمبر لکھیں۔"), state: { flow: "status", step: "number" } };
  }
  if (has(message, W.order)) {
    const items = parseItems(message, products);
    if (items.length) {
      const c = cartText(items);
      return { reply: c.text + "\n\n" + t(ur, "What is your name?", "آپ کا نام کیا ہے؟"), state: { flow: "order", step: "name", items }, voice: "ask_name" };
    }
    return { reply: t(ur, "Great! Which items and how many? e.g. \"2 ", "بہت اچھا! کون سی چیزیں اور کتنی؟ جیسے \"2 ") + (products[0]?.name ?? "item") + "\"\n\n" + listText(), state: { flow: "order", step: "items" } };
  }
  const kb = bestKnowledge(message, knowledge);
  const product = matchProduct(message, products);
  if (product && (!kb || tokens(message).some((w) => tokens(product.name).includes(w)))) {
    const sale = product.sale_price != null && product.sale_price < product.price;
    const stock = product.kind === "service" || product.stock == null ? "" : product.stock === 0 ? t(ur, "\nCurrently out of stock.", "\nابھی دستیاب نہیں۔") : t(ur, `\nIn stock: ${product.stock}`, `\nدستیاب: ${product.stock}`);
    return {
      reply: `${product.name}: ${money(priceOf(product))}${sale ? t(ur, ` (was ${money(product.price)})`, ` (پہلے ${money(product.price)})`) : ""}` +
        (product.description ? `\n${product.description.slice(0, 400)}` : "") + stock +
        "\n\n" + t(ur, `To order, type: order 1 ${product.name}`, `آرڈر کے لیے لکھیں: آرڈر 1 ${product.name}`),
      state: s,
    };
  }
  if (kb) return { reply: kb.answer, state: s, voice: kb.id ? `kb:${kb.id}` : undefined };
  if (has(message, W.list)) return { reply: listText() + "\n\n" + t(ur, "Type \"order\" to buy.", "خریدنے کے لیے \"آرڈر\" لکھیں۔"), state: s };
  if (has(message, W.contact)) {
    return { reply: (b.phone ? t(ur, `You can call/WhatsApp us at ${b.phone}.\n`, `ہمیں ${b.phone} پر کال یا واٹس ایپ کریں۔\n`) : "") +
      t(ur, "Or tell me your name and we will call you back.", "یا اپنا نام بتائیں، ہم آپ کو کال کر لیں گے۔"), state: { flow: "lead", step: "name", interest: "Requested a call back" } };
  }
  if (has(message, W.greet)) return { reply: t(ur, `Hello! Welcome to ${b.name}. `, `السلام علیکم! ${b.name} میں خوش آمدید۔ `) + "\n\n" + menu, state: s };
  return { reply: t(ur, "Sorry, I didn't fully understand. ", "معذرت، میں پوری بات نہیں سمجھ سکا۔ ") + "\n\n" + menu, state: s, voice: "not_understood" };
}

/** Public entry point: remembers the customer's language between turns. */
export async function basicReply(input: Parameters<typeof basicReplyInner>[0]): Promise<{ reply: string; state: BotState; voice?: string }> {
  const r = await basicReplyInner(input);
  const ur = /\p{L}/u.test(input.message) ? isUrdu(input.message) : !!input.state.ur;
  return { reply: r.reply, state: { ...r.state, ur }, voice: r.voice };
}
