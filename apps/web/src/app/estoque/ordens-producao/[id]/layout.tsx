import type { ReactNode } from "react";

export function generateStaticParams() {
  return [{ id: "OP-00981" }];
}
export default function ProductionOrderLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
