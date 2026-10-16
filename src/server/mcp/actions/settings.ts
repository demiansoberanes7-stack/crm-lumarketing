import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { getBusinessSettings } from "@/server/business-settings";
import { getConnectionsStatus } from "@/server/connections/status";
import { defineAction } from "@/server/mcp/registry";

const emptyInput = z.object({});

export const settingsActions = [
  defineAction({
    name: "settings.get",
    domain: "settings",
    kind: "read",
    scope: "crm.settings.read",
    title: "Ver datos del negocio",
    description:
      "Devuelve los datos fiscales/de contacto de la empresa (nombre, RFC, dirección, teléfono, correo, sitio, logo). Solo lectura; nunca expone credenciales.",
    input: emptyInput,
    handler: async (principal) => {
      const [settings, org] = await Promise.all([
        getBusinessSettings(principal.organizationId),
        getDb()
          .select({ name: schema.organization.name, logo: schema.organization.logo })
          .from(schema.organization)
          .where(eq(schema.organization.id, principal.organizationId))
          .limit(1),
      ]);
      const payload = {
        organization: { name: org[0]?.name ?? null, logo: org[0]?.logo ?? null },
        business: settings,
      };
      return {
        text: `Datos del negocio: ${settings.companyName || org[0]?.name || "sin nombre"}.`,
        structuredContent: payload,
      };
    },
  }),

  defineAction({
    name: "members.list",
    domain: "settings",
    kind: "read",
    scope: "crm.settings.read",
    title: "Listar el equipo",
    description: "Lista los miembros de la organización con su rol (owner/member). Solo lectura.",
    input: emptyInput,
    handler: async (principal) => {
      const rows = await getDb()
        .select({
          id: schema.member.id,
          userId: schema.member.userId,
          role: schema.member.role,
          name: schema.user.name,
          email: schema.user.email,
        })
        .from(schema.member)
        .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
        .where(scoped(schema.member.organizationId, principal.organizationId))
        .orderBy(schema.user.name);
      return {
        text: `El equipo tiene ${rows.length} miembro(s).`,
        structuredContent: { count: rows.length, members: rows },
      };
    },
  }),

  defineAction({
    name: "connections.status",
    domain: "settings",
    kind: "read",
    scope: "crm.settings.read",
    title: "Estado de conexiones",
    description:
      "Estado de las integraciones no-mensajería (Meta Ads, GA4, Google Ads, Calendar, CAPI, Google Business, Mercado Libre, Intel, Buzón de correo). Solo banderas de estado e identificadores públicos; jamás tokens ni contraseñas.",
    input: emptyInput,
    handler: async (principal) => {
      const status = await getConnectionsStatus(principal.organizationId);
      return {
        text: `Conexiones: ${Object.entries(status.status)
          .map(([key, value]) => `${key}=${value}`)
          .join(", ")}.`,
        structuredContent: status,
      };
    },
  }),
];
