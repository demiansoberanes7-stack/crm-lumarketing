import { CommercialRegistrationPage } from "@/components/commercial/registration-page";

export const metadata = {
  // El `template` del layout raíz añade la marca del negocio: aquí solo va la
  // sección. Escribir la empresa a mano dejaba de ser white-label.
  title: "Registros comerciales",
};

export default function CommercialPage() {
  return <CommercialRegistrationPage />;
}
