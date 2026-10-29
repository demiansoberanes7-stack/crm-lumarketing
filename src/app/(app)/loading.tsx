/**
 * Frontera de carga de toda la zona autenticada.
 *
 * Al pulsar un elemento del menú, App Router actualiza la URL al instante y
 * pinta la vista nueva cuando el servidor termina de renderizarla. Sin esta
 * frontera no hay nada entre ambos momentos: la pantalla anterior se queda
 * quieta y la navegación parece congelada. Con ella, el clic pinta de inmediato
 * y la vista real sustituye al marcador en cuanto está lista.
 */
export default function AppLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex h-full items-center justify-center p-6 text-sm text-text-3"
    >
      Cargando…
    </div>
  );
}
