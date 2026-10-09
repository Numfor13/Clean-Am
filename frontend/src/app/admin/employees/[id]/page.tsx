import type { Metadata } from "next";
import { EmployeeDetailScreen } from "@/screens/Admin";

export const metadata: Metadata = { title: "Employee Details & Assigned Reports" };

type Props = { params: Promise<{ id: string }> };

export default async function EmployeeDetailPage({ params }: Props) {
  const { id } = await params;
  return <EmployeeDetailScreen id={id} initialTab="reports" />;
}
