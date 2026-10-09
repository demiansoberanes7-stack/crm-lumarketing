import { redirect } from "next/navigation";

export const metadata = {
  title: "Control comercial | Zorro Tech CRM",
};

export default function CommercialPage() {
  redirect("/dashboard");
}
