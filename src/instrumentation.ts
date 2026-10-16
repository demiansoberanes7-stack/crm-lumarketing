/**
 * Hook de arranque de Next. El trabajo real vive en instrumentation-node.ts
 * (import dinámico condicionado al runtime para que el bundler edge no
 * intente resolver dependencias de Node como `postgres`).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { cleanupOrphanRuns } = await import("./instrumentation-node");
    await cleanupOrphanRuns();
    const { startAutomationWorker } = await import("./server/automation-queue");
    await startAutomationWorker();
    const { startBroadcastWorker } = await import("./server/broadcast-queue");
    await startBroadcastWorker();
    // Reseñas de Google Business: el poller checa su propia bandera en cada
    // barrido, así que registrarlo es inofensivo en instancias sin el módulo.
    const { startGoogleBusinessWorker } = await import("./server/google-business/poller");
    await startGoogleBusinessWorker();
    // Insights de Meta Ads: persiste gasto/métricas reales por campaña; solo
    // sincroniza orgs con credenciales guardadas.
    const { startMetaAdsWorker } = await import("./server/ads/poller");
    await startMetaAdsWorker();
    // Comentarios de publicaciones (canal `comments`): el poller checa su
    // propio canal en cada barrido, así que registrarlo es inofensivo en
    // instancias sin el módulo encendido.
    const { startCommentsWorker } = await import("./server/comments/poller");
    await startCommentsWorker();
    // Mensajes post-venta de Mercado Libre (canal `mercado_libre`): mismo
    // trato — checa su propio canal en cada barrido.
    const { startMercadoLibreWorker } = await import("./server/mercado-libre/poller");
    await startMercadoLibreWorker();
    // Buzón IMAP: sincroniza las cuentas de correo habilitadas; sin esto el
    // correo solo llegaba cuando alguien pulsaba el sync manual.
    const { startEmailWorker } = await import("./server/email/poller");
    await startEmailWorker();
    // MCP: poda de códigos/tokens/auditoría/clientes caducados; barre su
    // propia bandera en cada tick, así registrarla es inofensivo sin MCP.
    const { startMcpMaintenance } = await import("./server/mcp/maintenance");
    await startMcpMaintenance();
  }
}
