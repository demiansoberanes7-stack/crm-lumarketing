import { eq } from "drizzle-orm";
import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Avatar del usuario de la barra lateral. Se guarda en `user.image` como
 * identificador del icono (gato, zorro, león o perro); null vuelve a las
 * iniciales. No hay subida de archivos: son cuatro iconos fijos.
 */
export const PATCH = withAuth(async (session, req: Request) => {
  const body = await parseBody(
    req,
    z.object({ avatar: z.enum(["cat", "fox", "lion", "dog"]).nullable() })
  );
  if (!body.ok) return body.response;

  await getDb()
    .update(schema.user)
    .set({ image: body.data.avatar, updatedAt: new Date() })
    .where(eq(schema.user.id, session.userId));

  return Response.json({ ok: true, avatar: body.data.avatar });
});
