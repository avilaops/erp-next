import type { ReactNode } from "react";

export function generateStaticParams() {
  return [{ id: "INV-2026-004" }];
}
export default function InventoryLayout({ children }: { children: ReactNode }) {
  return children;
}
