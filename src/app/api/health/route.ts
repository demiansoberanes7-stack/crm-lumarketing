import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { APP_VERSION, resolveBuildCommit } from "@/lib/version";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
    const commit = resolveBuildCommit();
    return Response.json({
      ok: true,
      version: APP_VERSION,
      ...(commit ? { commit } : {}),
    });
  } catch {
    return Response.json(
      { ok: false, error: { code: "db_unavailable", message: "Base de datos no disponible" } },
      { status: 503 }
    );
  }
}
