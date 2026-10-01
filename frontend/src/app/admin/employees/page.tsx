import type { Metadata } from "next";
import { EmployeesScreen } from "@/screens/Admin";

export const metadata: Metadata = { title: "Employees" };

export default function EmployeesPage() {
  return <EmployeesScreen />;
}
