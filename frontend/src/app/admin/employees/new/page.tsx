import type { Metadata } from "next";
import { CreateEmployeeScreen } from "@/screens/Admin";

export const metadata: Metadata = { title: "Create employee account" };

export default function CreateEmployeePage() {
  return <CreateEmployeeScreen />;
}
