import { redirect } from "next/navigation";

export const metadata = {
  title: "Marketing Hub | Zorro Tech CRM",
};

export default function AnalyticsPage() {
  redirect("/dashboard");
}
