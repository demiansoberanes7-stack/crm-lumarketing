import { getSignupState } from "@/server/auth/registration";
import { LoginForm, type SignupOffer } from "./login-form";

export const dynamic = "force-dynamic";

/**
 * El alta se ofrece según el estado real de la instancia, no con una frase fija:
 * sin organizaciones queda «crear la cuenta inicial», con el registro abierto ya
 * se trata de negocios nuevos, y si está cerrado no se invita a intentarlo.
 */
export default async function LoginPage() {
  const { allowed, hasOrganizations } = await getSignupState();
  const signup: SignupOffer = allowed
    ? hasOrganizations
      ? "business"
      : "initial"
    : "closed";

  return <LoginForm signup={signup} />;
}
