import { AsyncLocalStorage } from "node:async_hooks";
import type { McpPrincipal } from "@/server/mcp/oauth";

const storage = new AsyncLocalStorage<McpPrincipal | null>();

export function withMcpPrincipal<T>(principal: McpPrincipal | null, fn: () => Promise<T>) {
  return storage.run(principal, fn);
}

export function getMcpPrincipal(): McpPrincipal | null {
  return storage.getStore() ?? null;
}
