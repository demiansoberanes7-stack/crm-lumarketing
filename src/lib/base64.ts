/**
 * ArrayBuffer → base64 sin explotar el call stack.
 *
 * `btoa(String.fromCharCode(...bytes))` con un spread de un buffer grande
 * (p. ej. un PDF de 200 KB) lanza RangeError: el spread materializa todos
 * los bytes como argumentos. Se convierte por bloques de 32 KB.
 */
export function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
