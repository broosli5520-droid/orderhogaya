# OrderHogaya — AI Sales Agent

> Product name lives in `src/lib/brand.ts` (and `<title>` in `index.html`) — change it there.

AI sales agent platform for businesses: answers customers, explains products and prices, saves leads, takes real orders, and gives owners a full dashboard (customers, leads, orders, products, chatbot knowledge, reports, team roles). Multi-business, role-based, built only on free/open-source tools.

**Stack:** React 19 · TypeScript · Vite · Tailwind CSS 4 · Supabase (Auth, Postgres + RLS, Edge Functions, Realtime) · Google Gemini (AI Studio free tier) or any OpenAI-compatible model.

Architecture, database design and role matrix: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## 1. Prerequisites (all free)

* **Node.js 20+** — https://nodejs.org
* **Supabase account** — https://supabase.com (free plan)
* **Gemini API key** — https://aistudio.google.com/apikey (free tier)
* **Supabase CLI** — `npm install -g supabase` (or use `npx supabase …`)

## 2. Create the Supabase project

1. In Supabase, **New project**. Note the *Project ref* (in the URL) and your database password.
2. **Project Settings → API**: copy the *Project URL* and the *anon public* key.
3. **Authentication → URL Configuration**:
   * *Site URL*: `http://localhost:5173` while developing (change to your live domain later).
   * *Redirect URLs*: add `http://localhost:5173/**` and later `https://YOUR-DOMAIN/**`.
4. (Optional) **Authentication → Providers → Email**: turn off *Confirm email* if you want instant sign-up while testing.

## 3. Create the database and deploy the AI function

From the project folder:

```bash
npm install
npx supabase login
npx supabase link --project-ref YOUR-PROJECT-REF
npx supabase db push                     # creates all tables, triggers, RLS and functions

npx supabase secrets set GEMINI_API_KEY=your-gemini-key   # optional — skip it to use only the free built-in bot
npx supabase functions deploy chat --no-verify-jwt
npx supabase functions deploy tts --no-verify-jwt
npx supabase functions deploy byok
```

`--no-verify-jwt` is required because website visitors are anonymous. The function itself only accepts a valid business slug and enforces rate limits.

> No CLI? Open **SQL Editor** in Supabase, paste the contents of `supabase/migrations/20261124000000_init.sql` and run it. Then create the function under **Edge Functions → Deploy a new function**, name it `chat`, paste `supabase/functions/chat/index.ts`, turn **off** "Enforce JWT verification", and add the `GEMINI_API_KEY` secret under **Edge Functions → Secrets**.

## 4. Run the app locally

```bash
cp .env.example .env        # then put your Project URL and anon key in .env
npm run dev                 # http://localhost:5173
```

1. Register, create your business.
2. Add products/services (with prices) and a few knowledge entries (delivery, payment, returns).
3. Click **Test chatbot** — try “Do you deliver?”, “Price of …?”, then place an order. It appears under **Orders**, the customer under **Customers** and the lead under **Leads**.

## 5. Deploy the frontend (free)

Any static host works. Build command `npm run build`, output folder `dist`, and set the two `VITE_SUPABASE_*` environment variables in the host's dashboard.

* **Cloudflare Pages / Netlify** — `public/_redirects` already sends all routes to `index.html`.
* **Vercel** — `vercel.json` already contains the SPA rewrite.

After deploying, update Supabase **Site URL** and **Redirect URLs** to your domain. Optionally lock the chat function to your domains:

```bash
npx supabase secrets set ALLOWED_ORIGINS=https://your-app.com,https://customer-shop.com
```

## 6. Put the chatbot on a customer's website

In **Settings → Put the chatbot to work**, copy the snippet:

```html
<script src="https://YOUR-APP-DOMAIN/widget.js" data-business="your-slug" data-color="#4f46e5" async></script>
```

Or share the direct link `https://YOUR-APP-DOMAIN/chat/your-slug` on WhatsApp / Instagram / Facebook.

## 7. Free forever — how the limits are removed

The chatbot **never depends on a paid or quota-limited service**:

| Mode (Settings → AI chatbot) | What answers customers | Cost / limit |
|---|---|---|
| **Built-in bot only** | OrderHogaya's own sales bot: prices, product details, FAQ answers, step-by-step ordering, call-back requests, order status — in Urdu and English. | Free, **no quota**. Needs no AI key at all. |
| **Smart AI + free backup** (default) | Gemini (or your own model) for natural conversation. If the AI is busy, over its free quota, or not set up, the built-in bot answers automatically. | Free; customers are never left without a reply. |

Other free pieces:

| Part | Free option | Note |
|---|---|---|
| Frontend | Cloudflare Pages / Netlify / Vercel | Generous free plans. |
| Database, login, chat function | Supabase free plan | Roughly 500 MB database, 50,000 monthly users, 500,000 function calls/month; a project with **no activity for about a week is paused** (resume it from the dashboard). Check current numbers on supabase.com/pricing. |
| Alerts, WhatsApp buttons | Supabase Realtime + `wa.me` links | No WhatsApp API fees. |

**No limits at all (still free software, you pay only for a server):**

* **Own AI model:** run [Ollama](https://ollama.com) (e.g. `qwen2.5:7b`, which supports tool calling) on a PC/VPS reachable from the internet:
  ```bash
  npx supabase secrets set AI_PROVIDER=openai OPENAI_BASE_URL=https://your-ollama-host/v1 OPENAI_MODEL=qwen2.5:7b
  ```
  You can set both Gemini and Ollama — the function tries them in order, then the built-in bot.
* **Own database:** Supabase is open source and can be self-hosted with Docker (https://supabase.com/docs/guides/self-hosting).

## 8. Features added for daily selling

* **Human takeover** — in Conversations, *Take over* pauses the AI for that chat; your replies appear in the customer's chat. *Hand back to AI* resumes it. Unread chats are marked.
* **Live alerts** — sound + browser notification + toast for new orders, new leads and customers waiting for a human (turn on "order alerts" in the sidebar).
* **WhatsApp buttons** — message a customer from an order, lead, customer or chat with one click; after a chat order the customer can also send it to your WhatsApp.
* **Quick-reply buttons** in the chat (customisable in Settings).
* **Import products from Excel/CSV** (template included).

### Keeping the free database from filling up

* **Settings → Data & storage** shows how much of the ~500 MB free database is used.
* **Automatic chat clean-up** (default: chats older than 6 months) runs every night with `pg_cron`. Orders, customers and leads are never deleted; abandoned one-message chats are removed after 7 days.
* **Clean now** and **Download full backup** (one JSON file with all your data) buttons.
* The website widget loads the chat only when a visitor opens it.

### Voice calls (free)

* Customers tap **Call** in the chat, speak (Urdu or English), and hear the reply — orders work by voice too. It uses the browser's built-in speech features (best in Chrome / Edge), so there is no cost or quota.
* **Voice & Calls** page: on/off, speaking speed and pitch, test buttons.
* **Your own voice:** record the greeting, the bot's questions (name, phone, address…) and every FAQ answer. During calls customers hear these real recordings instead of the device voice. Recordings are stored in the Supabase Storage bucket `voice` (created by the migration).
* Phone-style call screen: ringing tone, connected timer, mute and end-call buttons, call-ended summary.
* Not included: an AI clone of your voice that can say *anything*. Good Urdu voice cloning today needs a paid service (e.g. ElevenLabs) or a GPU server; it can be added later as an optional paid add-on. Only clone a voice with that person's permission.

## 8b. Selling plans from your own site

Businesses buy more capacity on **Plan & Billing**; you approve payments in **Platform admin**.

1. **Make yourself the platform owner** (once, in Supabase → SQL Editor, after registering):
   ```sql
   insert into public.platform_admins (user_id)
   select id from auth.users where email = 'you@example.com';
   ```
   A **Platform admin** link then appears in your sidebar.
2. **Payment accounts:** Platform admin → *Payment accounts* — enter your JazzCash / Easypaisa number and/or bank IBAN.
3. **Plans & prices:** Free, Starter, Pro and Business are created for you (PKR). Edit prices, limits and the feature list any time; changes show immediately on the pricing page and in every dashboard.
4. **How a purchase works:** the business owner picks a plan (monthly or yearly), sends money to your account, enters the transaction ID and uploads the screenshot. You see it under *Payments*, open the screenshot, check the TID in your wallet/bank app, and press **Approve** — the plan is activated for one month or one year (renewals extend from the current expiry). When a plan expires the business falls back to Free automatically; nothing is deleted.
5. You can also gift or correct a plan from *Businesses*.

**What the limits do:** chats are unlimited on every plan. When a business uses up its monthly AI replies, customers are still answered by the free built-in bot. Product, team and voice-recording limits are checked by the database. Voice calls and the "Powered by" badge are controlled per plan.

**Automatic card / wallet payments (later):** Pakistani gateways such as **Safepay** support recurring subscriptions with webhooks (needs a registered merchant account). Lemon Squeezy is closing (no new sign-ups). When you have a gateway account, a checkout + webhook function can call the same `review_payment` logic automatically.

## 8c. Bring your own key (paid plans) — the platform pays nothing

* **Settings → Connect your own AI accounts:** a business on a paid plan pastes its own **Gemini** key and/or **ElevenLabs** key. Keys are tested, stored server-side (no browser can read them back) and used only for that business.
* With its own Gemini key the monthly AI-reply limit no longer applies — Google bills the business directly.
* **Voice & Calls → Premium human voice:** pick a voice from the business's ElevenLabs library or clone the owner's voice (consent checkbox required). Calls then speak every reply in that voice (Urdu needs the `eleven_v3` model). If ElevenLabs fails or runs out of credit, the call falls back to the free device voice automatically.
* Why not resell ElevenLabs ourselves: their terms only allow offering it to your customers on their Scale plan or higher (about $299/month) — BYOK avoids that cost entirely.

## Deploying without the CLI

`deploy/ALL_MIGRATIONS.sql` contains every migration in order — paste it into Supabase → SQL Editor and run once.
`deploy/dashboard-functions/` has one-file versions of the three Edge Functions (`chat`, `tts`, `byok`) for the dashboard editor. Turn **off** "Verify JWT" for `chat` and `tts`; keep it on for `byok`.

## 9. Configuration reference (Edge Function secrets)

| Secret | Default | Meaning |
|---|---|---|
| `GEMINI_API_KEY` | — | Optional. Without any AI key the built-in bot answers. |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Any Gemini model that supports function calling. |
| `AI_PROVIDER` | `gemini` | Which provider to try first: `gemini` or `openai` (OpenAI-compatible). Unset keys are skipped; the built-in bot is always last. |
| `OPENAI_BASE_URL`, `OPENAI_MODEL`, `OPENAI_API_KEY` | — | For `AI_PROVIDER=openai`. API key optional for Ollama. |
| `MAX_MESSAGES_PER_VISITOR_PER_HOUR` | `60` | Anti-spam cap per visitor. |
| `MAX_MESSAGES_PER_CONVERSATION` | `100` | Cap per chat thread. |
| `ALLOWED_ORIGINS` | `*` | Comma-separated origins allowed to call the function. |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to Edge Functions automatically.

## 10. Project structure

```
supabase/
  migrations/…_init.sql      schema, triggers, RPCs, RLS, grants
  functions/chat/index.ts    chat endpoint: AI providers → built-in bot fallback; tools save_lead, create_order, check_order_status
  functions/chat/basicBot.ts built-in sales bot (no AI service needed)
public/widget.js             embeddable chat bubble
src/
  lib/                       supabase client, types, permissions, formatting
  contexts/                  auth + business membership
  components/                UI kit, layout, customer picker
  pages/auth/                login, register, forgot/reset password
  pages/app/                 dashboard modules
  pages/PublicChat.tsx       customer-facing chat
docs/ARCHITECTURE.md
```

## 11. Security notes

* Row Level Security is on for every table; anonymous users have no table privileges.
* Members can't change a business's slug/owner/order counter or an order's total (column-level grants).
* AI keys exist only as Edge Function secrets.
* Order prices always come from the database, never from the AI.
