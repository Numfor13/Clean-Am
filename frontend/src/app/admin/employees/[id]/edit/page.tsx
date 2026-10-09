import type { Metadata } from "next";
import { EditEmployeeScreen } from "@/screens/Admin";

export const metadata: Metadata = { title: "Edit employee account" };

type Props = { params: Promise<{ id: string }> };

export default async function EditEmployeePage({ params }: Props) {
  const { id } = await params;
  return <EditEmployeeScreen id={id} />;
}
