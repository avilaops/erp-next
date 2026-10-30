import { redirect } from "next/navigation"
export default function PreviousDashboard() { redirect("/") }

export const metadata = { title: "Visão geral" }
