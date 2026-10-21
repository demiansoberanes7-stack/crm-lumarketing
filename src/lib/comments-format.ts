/**
 * Los comentarios ingeridos antes de este cambio guardaron la publicación
 * como prefijo `sobre: {caption}\n\n` dentro del mensaje. La tarjeta de la
 * publicación ya muestra ese caption una sola vez, así que aquí se recorta
 * el prefijo — solo si coincide exactamente con el caption guardado, para no
 * comerse un comentario que empiece legítimamente con "sobre:".
 */
export function commentBodyText(
  text: string | null,
  postCaption: string | null
): string {
  const value = text ?? "";
  if (!postCaption || !value.startsWith("sobre: ")) return value;

  // La cabecera vieja era el caption recortado a 120 (con «…» si sobraba).
  // Se compara por prefijo contra el caption guardado: así también se limpian
  // filas antiguas cuyo recorte no coincide carácter por carácter.
  const [firstLine, ...rest] = value.split("\n");
  const headerCaption = (firstLine ?? "").slice("sobre: ".length).replace(/…$/, "");
  if (!headerCaption || rest[0] !== "" || !postCaption.startsWith(headerCaption)) {
    return value;
  }
  return rest.slice(1).join("\n");
}
