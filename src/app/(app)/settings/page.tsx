import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";

export default async function SettingsPage() {
  const session = await requireSession();
  redirect(session.role === "owner" ? "/settings/connections" : "/settings/whatsapp");
}
