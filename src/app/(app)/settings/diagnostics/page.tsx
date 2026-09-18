import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { DiagnosticsClient } from "@/components/settings/diagnostics-client";
export default async function DiagnosticsPage() {
  const session = await requireSession();
  if (session.role !== "owner") notFound();
  return <DiagnosticsClient />;
}
