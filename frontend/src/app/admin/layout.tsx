import { redirect } from "next/navigation";
import { StaffShell } from "@/components/shell";
import { getSession } from "@/server/session";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (session.role !== "Admin") redirect(session.role ? "/staff/reports" : "/staff/login?next=/admin/employees");
  return (
    <StaffShell role="Admin" username={session.username}>
      {children}
    </StaffShell>
  );
}
