import { z } from "zod";
import {
  actionKindEnabled,
  type McpActionKind,
  type McpPrincipal,
} from "@/server/mcp/oauth";

/**
 * Registro de acciones del CRM expuestas por MCP.
 *
 * En vez de una herramienta por operación (600+), cada acción declara su
 * dominio, tier, scope y handler; las meta-herramientas `actions_list`,
 * `actions_describe` y `actions_run` las descubren y ejecutan. Así el LLM ve
 * pocas herramientas nativas pero puede operar todo el sistema.
 */

export type McpActionResult = {
  text: string;
  structuredContent?: Record<string, unknown>;
};

export type McpActionDefinition = {
  name: string;
  domain: string;
  kind: McpActionKind;
  scope: string;
  title: string;
  description: string;
  destructive?: boolean;
  inputSchema: z.ZodTypeAny;
  /** Parsea la entrada y ejecuta el handler del servicio. */
  execute: (principal: McpPrincipal, rawInput: unknown) => Promise<McpActionResult>;
};

export function defineAction<TInput>(def: {
  name: string;
  domain: string;
  kind: McpActionKind;
  scope: string;
  title: string;
  description: string;
  destructive?: boolean;
  input: z.ZodType<TInput>;
  handler: (principal: McpPrincipal, input: TInput) => Promise<McpActionResult>;
}): McpActionDefinition {
  return {
    name: def.name,
    domain: def.domain,
    kind: def.kind,
    scope: def.scope,
    title: def.title,
    description: def.description,
    ...(def.destructive !== undefined ? { destructive: def.destructive } : {}),
    inputSchema: def.input,
    // async para que una entrada inválida llegue como rechazo (no como throw
    // síncrono) y el llamador la audite siempre por el mismo camino.
    execute: async (principal, rawInput) =>
      def.handler(principal, def.input.parse(rawInput)),
  };
}

const registry = new Map<string, McpActionDefinition>();

/**
 * Alta de acciones (upsert): se llama al arrancar y vuelve segura ante una
 * re-evaluación de módulos en desarrollo.
 */
export function registerActions(actions: McpActionDefinition[]): void {
  for (const action of actions) registry.set(action.name, action);
}

export function getAllActions(): McpActionDefinition[] {
  return [...registry.values()];
}

export function findAction(name: string): McpActionDefinition | undefined {
  return registry.get(name);
}

/**
 * Acciones visibles para el principal del token: tier habilitado + scope
 * concedido. Es lo que responde `actions_list` y lo que acepta `actions_run`.
 */
export function availableActions(principal: McpPrincipal): McpActionDefinition[] {
  return getAllActions().filter(
    (action) => actionKindEnabled(action.kind) && principal.scopes.has(action.scope)
  );
}

export function isActionAvailable(
  principal: McpPrincipal,
  action: McpActionDefinition
): boolean {
  return actionKindEnabled(action.kind) && principal.scopes.has(action.scope);
}

/* ---------------------------------------------------------------------------
 * Zod → JSON Schema (subconjunto que usan las acciones).
 * `actions_describe` lo sirve al LLM para saber qué argumentos pedir.
 * ------------------------------------------------------------------------ */

type JsonSchema = Record<string, unknown>;

export function zodToInputSchema(schema: z.ZodTypeAny): JsonSchema {
  return convert(schema) ?? {};

  function convert(value: z.ZodTypeAny): JsonSchema | null {
    if (value instanceof z.ZodEffects) return convert(value._def.schema);
    if (value instanceof z.ZodOptional) return convert(value._def.innerType);
    if (value instanceof z.ZodNullable) return convert(value._def.innerType);
    if (value instanceof z.ZodDefault) return convert(value._def.innerType);
    if (value instanceof z.ZodObject) {
      const shape = value.shape as Record<string, z.ZodTypeAny>;
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      for (const [key, field] of Object.entries(shape)) {
        properties[key] = convert(field) ?? {};
        const optional =
          field instanceof z.ZodOptional ||
          field instanceof z.ZodNullable ||
          field instanceof z.ZodDefault;
        if (!optional) required.push(key);
      }
      return {
        type: "object",
        properties,
        ...(required.length > 0 ? { required } : {}),
      };
    }
    if (value instanceof z.ZodString) return { type: "string" };
    if (value instanceof z.ZodNumber) return { type: "number" };
    if (value instanceof z.ZodBoolean) return { type: "boolean" };
    if (value instanceof z.ZodEnum) return { type: "string", enum: [...value._def.values] };
    if (value instanceof z.ZodArray) {
      return { type: "array", items: convert(value._def.type) ?? {} };
    }
    if (value instanceof z.ZodLiteral) return { const: value._def.value };
    if (value instanceof z.ZodRecord) return { type: "object" };
    if (value instanceof z.ZodUnion) {
      const options = value._def.options as z.ZodTypeAny[];
      const enums = options
        .filter((option) => option instanceof z.ZodEnum)
        .flatMap((option) => (option as z.ZodEnum<[string]>)._def.values);
      if (enums.length === options.length) return { type: "string", enum: [...new Set(enums)] };
      return { anyOf: options.map((option) => convert(option) ?? {}) };
    }
    if (value instanceof z.ZodUnknown || value instanceof z.ZodAny) return {};
    return null;
  }
}
