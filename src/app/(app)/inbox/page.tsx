import { UnifiedInbox } from "@/components/inbox/unified-inbox";
import { CHANNEL_ORDER } from "@/lib/channels";
import { enabledChannels } from "@/server/channels/enabled";

export const dynamic = "force-dynamic";

export default function InboxPage() {
  /**
   * 014 — Qué bandejas existen se decide en el servidor, no mirando los datos.
   * Si se dedujera de las conversaciones cargadas, la marca de canal aparecería
   * y desaparecería sola: una instancia con Instagram encendido pero sin DMs
   * todavía se vería como una instancia de un solo canal, y el primer mensaje
   * repintaría la lista entera.
   *
   * La fila de bandejas pinta TODOS los canales del catálogo con su estado:
   * un canal apagado en el despliegue se ve atenuado y explica qué variable lo
   * enciende, en vez de no existir. Esconderlo hacía que el dueño creyera que
   * el canal no estaba implementado.
   */
  const enabled = enabledChannels();
  const channels = CHANNEL_ORDER;
  const active = CHANNEL_ORDER.filter((c) => enabled.has(c));

  return <UnifiedInbox channels={channels} enabledChannels={active} />;
}
