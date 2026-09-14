export async function taskRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error?.message ?? "No se pudo guardar o cargar la información");
  if (!data) throw new Error("El servidor devolvió una respuesta vacía");
  return data as T;
}
