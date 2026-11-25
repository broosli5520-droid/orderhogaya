import type { BadgeColor } from "../components/ui";
import type { LeadStatus, OrderStatus } from "./types";

export const orderStatuses: OrderStatus[] = ["pending", "confirmed", "processing", "shipped", "delivered", "cancelled"];
export const leadStatuses: LeadStatus[] = ["new", "contacted", "qualified", "won", "lost"];

export const orderColor: Record<OrderStatus, BadgeColor> = {
  pending: "amber", confirmed: "blue", processing: "indigo", shipped: "purple", delivered: "green", cancelled: "red",
};
export const leadColor: Record<LeadStatus, BadgeColor> = {
  new: "blue", contacted: "amber", qualified: "indigo", won: "green", lost: "gray",
};
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
