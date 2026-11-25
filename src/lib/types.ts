export type Role = "owner" | "admin" | "agent" | "viewer";
export type LeadStatus = "new" | "contacted" | "qualified" | "won" | "lost";
export type OrderStatus = "pending" | "confirmed" | "processing" | "shipped" | "delivered" | "cancelled";

export interface Business {
  id: string; name: string; slug: string; description: string; industry: string; currency: string;
  phone: string; email: string; address: string; website: string;
  bot_name: string; bot_greeting: string; bot_instructions: string; bot_language: string;
  brand_color: string; chat_enabled: boolean; created_at: string;
  ai_mode: "auto" | "basic"; quick_replies: string[]; chat_retention_days: number;
  voice_enabled: boolean; voice_rate: number; voice_pitch: number;
}
export interface Membership { role: Role; business: Business; }

export interface Product {
  id: string; business_id: string; kind: "product" | "service"; name: string; description: string; category: string;
  price: number; sale_price: number | null; stock: number | null; sku: string; is_active: boolean; created_at: string;
}
export interface KnowledgeEntry { id: string; business_id: string; question: string; answer: string; updated_at: string; }
export interface Customer {
  id: string; business_id: string; name: string; phone: string; email: string; address: string; notes: string;
  source: "manual" | "chat"; created_at: string;
}
export interface Lead {
  id: string; business_id: string; customer_id: string; conversation_id: string | null; interest: string;
  status: LeadStatus; notes: string; source: "manual" | "chat"; created_at: string;
  customers?: Pick<Customer, "name" | "phone"> | null;
}
export interface OrderItem { id: string; product_id: string | null; name: string; unit_price: number; quantity: number; line_total: number; }
export interface Order {
  id: string; business_id: string; order_number: number; customer_id: string | null; conversation_id: string | null;
  status: OrderStatus; total: number; delivery_address: string; notes: string; source: "manual" | "chat"; created_at: string;
  customers?: Pick<Customer, "name" | "phone"> | null;
  order_items?: OrderItem[];
}
export interface Conversation {
  id: string; customer_id: string | null; visitor_id: string; message_count: number; created_at: string; last_message_at: string;
  ai_paused: boolean; unread: boolean;
  customers?: Pick<Customer, "name" | "phone"> | null;
}
export interface Message { id: number; role: "user" | "assistant" | "agent"; content: string; created_at: string; }
export interface Member { user_id: string; role: Role; created_at: string; profile?: { email: string; full_name: string } | null; }
export interface Invitation { id: string; email: string; role: Role; created_at: string; }

export interface SalesReport {
  orders: number; revenue: number; avg_order: number; cancelled: number; chat_orders: number;
  new_customers: number; new_leads: number; won_leads: number; conversations: number;
  by_day: { day: string; orders: number; revenue: number }[];
  by_status: Partial<Record<OrderStatus, number>>;
  lead_funnel: Partial<Record<LeadStatus, number>>;
  top_products: { name: string; quantity: number; revenue: number }[];
}
