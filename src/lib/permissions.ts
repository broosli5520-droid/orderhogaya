import type { Role } from "./types";

/** What each role may do in the UI. The database (RLS) enforces the same rules. */
const matrix = {
  manageCatalog:  ["owner", "admin"],          // products, services, knowledge base
  manageSettings: ["owner", "admin"],          // business profile, chatbot settings
  manageTeam:     ["owner", "admin"],          // invite / change roles
  editSales:      ["owner", "admin", "agent"], // customers, leads, orders
  deleteSales:    ["owner", "admin"],
  deleteBusiness: ["owner"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof matrix;

export function can(role: Role | undefined, permission: Permission): boolean {
  return !!role && (matrix[permission] as readonly Role[]).includes(role);
}

export const roleLabels: Record<Role, string> = { owner: "Owner", admin: "Admin", agent: "Sales agent", viewer: "Viewer" };
export const roleHelp: Record<Role, string> = {
  owner: "Full control, including deleting the business.",
  admin: "Manage products, chatbot, settings, team (agents & viewers) and all sales data.",
  agent: "Handle customers, leads and orders. Cannot change products or settings.",
  viewer: "Read-only access to everything.",
};
