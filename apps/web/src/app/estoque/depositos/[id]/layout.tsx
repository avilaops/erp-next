export function generateStaticParams() {
  return [{ id: "DEP-01" }];
}
export default function WarehouseLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
