/**
 * Migraciones al ARRANQUE del contenedor (no en pre-deploy: el pre-deploy de
 * plataformas como Coolify corre en el contenedor viejo). Se bundlea con
 * esbuild dentro de la imagen y corre antes de `node server.js`.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[migrate] DATABASE_URL no está definida");
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder =
  process.env.MIGRATIONS_DIR ?? path.join(here, "drizzle");

function readMigrationManifest() {
  const journalPath = path.join(migrationsFolder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  let previousWhen = -1;
  const hashes = new Set();

  return journal.entries.map((entry) => {
    if (!Number.isSafeInteger(entry.when) || entry.when <= previousWhen) {
      throw new Error(`Orden de migraciones inválido en ${entry.tag}`);
    }
    previousWhen = entry.when;

    const contents = readFileSync(path.join(migrationsFolder, `${entry.tag}.sql`));
    const hash = createHash("sha256").update(contents).digest("hex");
    if (hashes.has(hash)) throw new Error(`Hash duplicado en ${entry.tag}`);
    hashes.add(hash);
    return { tag: entry.tag, hash, when: entry.when };
  });
}

async function reconcileMigrationLedger(sql, manifest) {
  const [table] = await sql`select to_regclass('drizzle.__drizzle_migrations') as name`;
  if (!table?.name) return;

  const byHash = new Map(manifest.map((migration) => [migration.hash, migration]));
  let corrected = 0;
  let purged = 0;

  await sql.begin(async (tx) => {
    await tx`lock table drizzle.__drizzle_migrations in exclusive mode`;
    const rows = await tx`
      select id, hash, created_at
      from drizzle.__drizzle_migrations
      order by id
    `;
    const seen = new Set();

    for (const row of rows) {
      const migration = byHash.get(row.hash);
      if (!migration) {
        await tx`delete from drizzle.__drizzle_migrations where id = ${row.id}`;
        purged++;
        continue;
      }
      if (seen.has(row.hash)) {
        throw new Error(`Hash duplicado en el ledger de migraciones (${migration.tag})`);
      }
      seen.add(row.hash);

      if (BigInt(row.created_at) !== BigInt(migration.when)) {
        await tx`
          update drizzle.__drizzle_migrations
          set created_at = ${migration.when}
          where id = ${row.id}
        `;
        corrected++;
      }
    }
  });

  if (corrected || purged) {
    console.log(
      `[migrate] ledger reconciliado por hash: ${corrected} watermark(s) corregido(s), ${purged} fila(s) huérfana(s) eliminada(s)`
    );
  }
}

const manifest = readMigrationManifest();
const maxAttempts = 15;
for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  const sql = postgres(url, { max: 1 });
  try {
    await reconcileMigrationLedger(sql, manifest);
    const db = drizzle(sql);
    await migrate(db, { migrationsFolder });
    console.log("[migrate] migraciones aplicadas");
    await sql.end();
    process.exit(0);
  } catch (err) {
    await sql.end().catch(() => {});
    if (attempt === maxAttempts) {
      console.error("[migrate] falló tras varios intentos:", err);
      process.exit(1);
    }
    console.log(
      `[migrate] BD no lista (intento ${attempt}/${maxAttempts}), reintento en 2s…`
    );
    await new Promise((r) => setTimeout(r, 2000));
  }
}
