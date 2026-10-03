import { redirect } from "next/navigation";
import { StaffShell } from "@/components/shell";
import { getSession } from "@/server/session";

export const dynamic = "force-dynamic";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (session.role !== "Employee" && session.role !== "Admin") redirect("/staff/login?next=/staff/reports");
  return (
    <StaffShell role={session.role} username={session.username}>
      {children}
    </StaffShell>
  );
}
