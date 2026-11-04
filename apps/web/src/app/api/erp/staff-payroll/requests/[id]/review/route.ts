import { forwardErp } from "@/server/bff/erp-proxy"
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){const {id}=await params;return forwardErp(request,`/staff-payroll/requests/${id}/review`)}
