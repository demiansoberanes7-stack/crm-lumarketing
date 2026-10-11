import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { ConnectionsClient } from "@/components/settings/connections-client";

export const dynamic = "force-dynamic";

export default async function ConnectionsPage() {
  const session = await requireSession();
  if (session.role !== "owner") notFound();
  return <ConnectionsClient />;
}
