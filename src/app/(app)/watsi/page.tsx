import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function WatsiPage() {
  // Alias de compatibilidad para favoritos/enlaces existentes.
  redirect("/copiloto");
}
