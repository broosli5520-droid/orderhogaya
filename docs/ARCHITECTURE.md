# OrderHogaya — Architecture, Database Design & Development Plan

## 1. What the system does

OrderHogaya is a multi-tenant SaaS. Each **business** (tenant) gets:

* an **AI sales agent** that chats with customers on a public link or a website widget, answers from the business's own catalogue and knowledge base, saves leads and places real orders;
* an **admin dashboard** for products/services, chatbot knowledge, customers, leads, orders, conversations, sales reports, team members and settings.

One user can own or belong to many businesses, with a different role in each.

## 2. Architecture

```
            ┌──────────────────────────── Browser ────────────────────────────┐
            │  React + TypeScript + Tailwind (Vite SPA)                        │
            │   • /login /register /forgot-password /reset-password            │
            │   • /app/:businessId/*   (dashboard — signed-in members)         │
            │   • /chat/:slug          (public chat page, also used by widget) │
            │   • /widget.js           (embeddable chat bubble → iframe)       │
            └───────────────┬───────────────────────────────┬─────────────────┘
                            │ supabase-js (anon key + user JWT)│ supabase.functions.invoke("chat")
                            ▼                                  ▼
┌──────────────────────────────── Supabase ───────────────────────────────────────────┐
│  Auth (email/password, reset, confirmation)                                         │
│  Postgres  ── tables + triggers + RPCs, every table protected by Row Level Security │
│  Realtime  ── live transcript updates in the dashboard                              │
│  Edge Function "chat" (Deno, service role, never exposed to the browser)            │
│     1. load business + active catalogue + knowledge                                 │
│     2. store visitor message, enforce rate limits                                   │
│     3. call the AI model with tools ───────────────────────────┐                    │
│     4. execute tool calls against Postgres (lead/order/status) │                    │
│     5. store + return reply                                    │                    │
└────────────────────────────────────────────────────────────────┼────────────────────┘
                                                                 ▼
                         Google Gemini API (free tier, AI Studio key)
                         — or any OpenAI-compatible server (self-hosted Ollama, Groq, …)
```

**Why this shape**

| Concern | Decision |
|---|---|
| Multi-tenancy | Single database; every business-owned row has `business_id`; RLS decides access from `business_members`. |
| Security of AI keys | The AI key lives only in Edge Function secrets. The browser never sees it. |
| Anonymous visitors | Get **no** table access (`anon` privileges revoked). They can only call the `chat` function and `get_public_business()`. |
| Prices the AI can't fake | The `create_order` tool accepts only catalogue ids + quantities; prices are read from the database. Totals are computed by a trigger. |
| Roles | Enforced in Postgres (RLS + RPC checks + column-level grants). The UI hides what a role can't do, but the database is the real gate. |
| Free/open source | React, Vite, Tailwind, Supabase (open source; free cloud tier or self-host), Gemini free tier or self-hosted model. No paid libraries. |

## 3. Roles & permissions

| Action | Owner | Admin | Sales agent | Viewer |
|---|:-:|:-:|:-:|:-:|
| View dashboard, reports, all records | ✓ | ✓ | ✓ | ✓ |
| Create/edit customers, leads, orders | ✓ | ✓ | ✓ | – |
| Delete customers, leads, orders, conversations | ✓ | ✓ | – | – |
| Manage products, services, chatbot knowledge | ✓ | ✓ | – | – |
| Edit business profile & chatbot settings | ✓ | ✓ | – | – |
| Invite / change role of agents & viewers | ✓ | ✓ | – | – |
| Make someone admin | ✓ | – | – | – |
| Delete the business | ✓ | – | – | – |

## 4. Database design

All tables live in `public`; see `supabase/migrations/20261124000000_init.sql`.

| Table | Purpose | Key columns |
|---|---|---|
| `profiles` | One row per auth user (auto-created by trigger) | `id`, `email`, `full_name` |
| `businesses` | Tenants + chatbot settings | `slug` (public chat link), `currency`, `bot_*`, `brand_color`, `chat_enabled`, `order_seq` |
| `business_members` | Who belongs to which business, with role | PK (`business_id`, `user_id`), `role` |
| `invitations` | Pending invites by email; accepted automatically on sign-in | `email`, `role` |
| `products` | Products **and** services | `kind`, `price`, `sale_price`, `stock`, `is_active` |
| `knowledge_entries` | Q&A / policies the AI answers from | `question`, `answer` |
| `customers` | Contacts (manual or from chat) | unique (`business_id`, `phone`) |
| `conversations` | One chat thread per visitor session | `visitor_id`, `customer_id`, `message_count` |
| `messages` | Chat messages | `role` (`user`/`assistant`), `content` |
| `leads` | Sales pipeline | `status` (new → contacted → qualified → won/lost), `interest`, `source` |
| `orders` | Orders with per-business numbers (#1, #2…) | `order_number`, `status`, `total`, `source` |
| `order_items` | Lines with price snapshot | `unit_price`, `quantity`, `line_total` (generated) |

**Triggers**: `updated_at` maintenance, profile creation, per-business order numbering, order total recalculation, cross-tenant integrity checks (an order can't reference another business's customer/product).

**RPCs**: `create_business`, `accept_invitations`, `set_member_role`, `remove_member`, `create_order`, `sales_report`, `get_public_business`.

```
businesses 1─* business_members *─1 auth.users 1─1 profiles
businesses 1─* products, knowledge_entries, customers, conversations, leads, orders, invitations
customers  1─* leads, orders, conversations
orders     1─* order_items *─0..1 products
conversations 1─* messages
```

## 5. AI agent design

* **System prompt** is built per request from the business profile, the active catalogue (id, type, price, sale price, stock, description), the knowledge base and the owner's instructions. Strict rules: use only that data, never invent prices, confirm before ordering, reply in the customer's language (Urdu / Roman Urdu / English).
* **Tools** (function calling):
  * `save_lead(name, phone, email?, interest)` → upsert customer, create/update lead.
  * `create_order(customer_name, phone, address, items[{product_id, quantity}], notes)` → validates ids and stock, prices from DB, creates order + items, marks the lead won.
  * `check_order_status(order_number, phone)` → only answers if the phone matches.
* **Abuse protection**: message length cap, per-visitor hourly cap, per-conversation cap (configurable), history limited to the last 20 messages.

## 6. Development plan (as built)

1. **Database** — schema, triggers, RPCs, RLS, column grants. Verified on PostgreSQL 16 with a Supabase-style `auth` stub: owner/agent/stranger/anon permissions, order numbering, totals, cross-tenant guards and the sales report.
2. **AI Edge Function** — Gemini function-calling loop with real DB tools; optional OpenAI-compatible provider.
3. **Frontend shell** — routing, auth context, membership context, responsive sidebar layout, toasts, modals.
4. **Auth** — register (with email confirmation support), login, forgot/reset password.
5. **Onboarding** — create business (atomic owner membership), auto-join by invitation.
6. **Modules** — Products & Services, Chatbot Knowledge, Customers (with history), Leads (pipeline), Orders (create, detail, status, CSV), Conversations (live transcript), Reports (date range, KPIs, chart, top products, funnel, CSV), Team & Roles, Settings (profile, chatbot, link, widget, delete).
7. **Public chat** — `/chat/:slug` page + `widget.js` bubble, persistent conversation per visitor.
8. **Docs** — run & deploy guide (README).

## 7. v2 additions

* **Built-in bot (`basicBot.ts`)** — deterministic sales bot (keyword + fuzzy product matching, knowledge-base scoring, Urdu/English) with state machines for ordering, call-back and order status, stored in `conversations.state`. Used in *Basic* mode, with no AI key, or whenever every AI provider fails.
* **Provider chain** — Gemini and/or an OpenAI-compatible server, tried in order, then the built-in bot.
* **Human handoff** — `conversations.ai_paused`, staff messages with role `agent` (RLS: owner/admin/agent only), unread tracking via trigger, chat page polls for staff replies only while a human is handling it.
* **Realtime alerts**, **WhatsApp click-to-chat**, **quick replies**, **CSV product import**.

## 8. Possible next steps

WhatsApp Business API channel, image/product photos via Supabase Storage, email notifications on new orders, payment links, per-business usage dashboard, automated tests (Vitest + pgTAP).
