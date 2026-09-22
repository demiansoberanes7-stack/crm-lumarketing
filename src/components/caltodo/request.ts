export async function todoRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error?.message ?? "No se pudo guardar. Intenta de nuevo.");
  if (!data) throw new Error("Respuesta inválida del servidor");
  return data as T;
}
