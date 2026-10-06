/**
 * Traduce el error de envío de Meta a algo que el operador pueda ACCIONAR.
 *
 * Meta manda el motivo en inglés y en jerga propia ("User's number is part of
 * an experiment"), y el CRM lo guardaba sin mostrarlo: el mensaje fallido solo
 * enseñaba un triángulo mudo. Aquí se convierte en una frase que dice qué
 * pasó y qué hacer, conservando el código para poder rastrearlo en la
 * documentación de Meta.
 */

const DESCRIPTIONS: Record<number, string> = {
  100:
    "Meta rechazó la etiqueta HUMAN_AGENT: la ventana de 24 h ya se cerró y esta conversación no califica para mensajes con etiqueta. Pide al cliente que te escriba primero para reabrirla.",
  130472:
    "Meta tiene el número del destinatario en un experimento y le está bloqueando los mensajes de MARKETING. No es un fallo de tu configuración: espera un tiempo o prueba con otro número.",
  131049:
    "Meta limitó los mensajes de marketing hacia este usuario para cuidar la calidad del ecosistema. Espera a que se levante el límite.",
  131047:
    "Pasaron más de 24 h desde el último mensaje del cliente: WhatsApp no permite reabrir la conversación desde el CRM.",
  131048:
    "Meta frenó el envío por límite de spam en tu número. Baja el ritmo de envíos y revisa la calidad del número.",
  131026:
    "El destinatario no puede recibir mensajes de WhatsApp (número inexistente, sin cuenta o que no acepta mensajes de empresas).",
  131031:
    "Tu cuenta de WhatsApp Business está bloqueada o restringida por Meta. Revísalo en el Administrador de WhatsApp.",
  131030:
    "El número del destinatario no está en la lista de permitidos de tu app en modo de prueba.",
  130429:
    "Superaste el límite de mensajes por segundo de Meta. Reintenta en unos momentos.",
  133010: "El número no está registrado en la Cloud API.",
  368: "El número está temporalmente bloqueado por infringir las políticas de Meta.",
};

/**
 * @param code   Código numérico de Meta (`errors[0].code`), si vino.
 * @param detail Texto crudo de Meta, como respaldo cuando el código es nuevo.
 */
export function describeSendError(
  code: number | null | undefined,
  detail?: string | null
): string {
  const known = code != null ? DESCRIPTIONS[code] : undefined;
  // `||` y no `??`: Meta a veces manda el texto vacío o en blanco, y un
  // mensaje de error vacío es tan inútil como el triángulo mudo.
  const base = known || detail?.trim() || "Meta rechazó el envío";
  return code != null ? `${base} (Meta ${code})` : base;
}

/**
 * Igual que `describeSendError`, pero partiendo del mensaje COMPLETO del
 * error — que es lo único que llega cuando la excepción ya fue envuelta
 * (`String(err)` en las rutas). Detecta los tres formatos en que Meta escribe
 * su código (`(#100)`, `(Meta 100)`, `código 100`) y, si no encuentra ninguno,
 * deja pasar el texto original: traducir a ciegas sería mentir.
 */
export function describeSendErrorText(raw: string): string {
  const code = /\(#(\d+)\)|\(Meta (\d+)\)|\bcódigo\s+(\d+)\b/i.exec(raw);
  const digits = code?.slice(1).find((g) => g !== undefined);
  if (!digits) return raw;
  return describeSendError(Number(digits), raw.replace(/^\w*Error:\s*/, ""));
}
