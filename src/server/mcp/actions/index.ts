import { registerActions } from "@/server/mcp/registry";
import { adminActions } from "./admin";
import { catalogActions } from "./catalog";
import { contactsActions } from "./contacts";
import { emailActions } from "./email";
import { messagesActions } from "./messages";
import { pipelineActions } from "./pipeline";
import { quotesActions } from "./quotes";
import { settingsActions } from "./settings";

/**
 * Registro maestro de acciones MCP. Importado y ejecutado por
 * `createMcpServer`: un solo lugar para sumar dominios (contactos, pipeline,
 * cotizaciones, catálogo, bandeja/envíos, ajustes, admin) en cada fase.
 */
export function registerAllActions(): void {
  registerActions(contactsActions);
  registerActions(pipelineActions);
  registerActions(quotesActions);
  registerActions(catalogActions);
  registerActions(messagesActions);
  registerActions(emailActions);
  registerActions(settingsActions);
  registerActions(adminActions);
}
