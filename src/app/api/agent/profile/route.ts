import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { isAiConfigured } from "@/lib/env";
import { encryptSecret, decryptSecret, type EncryptedValue } from "@/lib/crypto";

export const dynamic = "force-dynamic";

function decryptAiToken(row: Record<string, unknown>): string | null {
  if (row.aiTokenCipher && row.aiTokenIv && row.aiTokenTag) {
    try {
      return decryptSecret({ cipher: String(row.aiTokenCipher), iv: String(row.aiTokenIv), tag: String(row.aiTokenTag) });
    } catch {
      return null;
    }
  }
  return typeof row.aiToken === "string" ? row.aiToken : null;
}

export const GET = withAuth(async (session) => {
  const db = getDb();
  if (!db) return apiError(500, "db_error", "Base de datos no disponible");
  const rows = await db
    .select()
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, session.organizationId))
    .limit(1);
  const p = rows[0];
  if (!p) return apiError(404, "not_found", "Perfil del agente no encontrado");
  const aiToken = decryptAiToken(p);
  return Response.json({
    profile: {
      enabled: p.enabled,
      name: p.name,
      tone: p.tone,
      instructions: p.instructions,
      escalationRules: p.escalationRules,
      greeting: p.greeting,
      aiToken: aiToken ? `${aiToken.slice(0, 8)}…${aiToken.slice(-4)}` : null,
      aiTokenSet: !!aiToken,
      aiModel: p.aiModel,
    },
    aiConfigured: isAiConfigured(aiToken ?? undefined),
  });
});

const putSchema = z.object({
  enabled: z.boolean().optional(),
  name: z.string().trim().min(1).max(60).optional(),
  tone: z.string().max(500).nullable().optional(),
  instructions: z.string().max(8000).nullable().optional(),
  escalationRules: z.string().max(4000).nullable().optional(),
  greeting: z.string().max(1000).nullable().optional(),
  aiToken: z.string().max(500).nullable().optional(),
  aiModel: z.string().max(255).nullable().optional(),
});

export const PUT = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;

  const db = getDb();
  if (!db) return apiError(500, "db_error", "Base de datos no disponible");

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const [key, val] of Object.entries(body.data)) {
    if (val !== undefined) {
      if (key === "aiToken") {
        if (val && typeof val === "string" && val.trim().length > 0) {
          const encrypted = encryptSecret(val.trim());
          patch.aiToken = null;
          patch.aiTokenCipher = encrypted.cipher;
          patch.aiTokenIv = encrypted.iv;
          patch.aiTokenTag = encrypted.tag;
        } else if (val === null) {
          patch.aiToken = null;
          patch.aiTokenCipher = null;
          patch.aiTokenIv = null;
          patch.aiTokenTag = null;
        }
      } else {
        patch[key] = val;
      }
    }
  }

  await db
    .update(schema.agentProfile)
    .set(patch)
    .where(scoped(schema.agentProfile.organizationId, session.organizationId));
  return Response.json({ ok: true });
});
