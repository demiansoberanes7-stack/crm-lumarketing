#!/usr/bin/env node
/**
 * Guardia de migraciones para CI: valida el manifiesto de drizzle ANTES de que
 * un contenedor lo lea en producción.
 *
 * `Dockerfile` arranca con `node migrate.mjs && node server.js`, así que una
 * entrada del journal cuyo `.sql` no exista lanza ENOENT dentro del contenedor,
 * aborta el arranque de Next y deja el sitio en crash loop. Eso no lo ve
 * `pnpm build`, porque el bundler de Next no abre `drizzle/meta/_journal.json`.
 *
 * Este script es deliberadamente una copia barata de `readMigrationManifest()`
 * en scripts/migrate.mjs: mismas comprobaciones, misma fórmula de hash, cero
 * acceso a la base de datos. Si `migrate.mjs` cambia de criterios, cambia aquí.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const migrationsFolder = process.env.MIGRATIONS_DIR ?? path.join(repoRoot, "drizzle");
const journalPath = path.join(migrationsFolder, "meta", "_journal.json");
const allowlistPath = path.join(here, "migrations-guard.allowlist.json");

const errors = [];
const warnings = [];

function loadJson(file, label) {
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    errors.push(`${label}: no se puede leer ${path.relative(repoRoot, file)} (${err.code ?? err.message})`);
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    errors.push(`${label}: JSON inválido en ${path.relative(repoRoot, file)} (${err.message})`);
    return null;
  }
}

const journal = loadJson(journalPath, "journal");
const allowlist = existsSync(allowlistPath) ? loadJson(allowlistPath, "allowlist") : { waived: [] };

if (journal) {
  const entries = Array.isArray(journal.entries) ? journal.entries : [];
  if (entries.length === 0) errors.push("journal: `entries` vacío o ausente");

  const tags = new Set();
  const hashes = new Set();
  let previousWhen = -1;

  for (const entry of entries) {
    if (typeof entry.tag !== "string" || entry.tag.length === 0) {
      errors.push("journal: una entrada no tiene `tag` de texto");
      continue;
    }
    if (tags.has(entry.tag)) errors.push(`journal: tag duplicado ${entry.tag}`);
    tags.add(entry.tag);

    if (!Number.isSafeInteger(entry.when) || entry.when <= previousWhen) {
      errors.push(`journal: orden de migraciones inválido en ${entry.tag}`);
    } else {
      previousWhen = entry.when;
    }

    const sqlPath = path.join(migrationsFolder, `${entry.tag}.sql`);
    if (!existsSync(sqlPath)) {
      const waived = (allowlist?.waived ?? []).find((w) => w.tag === entry.tag);
      if (waived) {
        const until = typeof waived.until === "string" ? Date.parse(`${waived.until}T23:59:59Z`) : NaN;
        if (Number.isSafeInteger(until) && Date.now() > until) {
          errors.push(
            `${entry.tag}.sql sigue ausente y la exención venció el ${waived.until}: o se commitea el .sql o se renueva la fecha con justificación`
          );
        } else {
          warnings.push(
            `${entry.tag}.sql ausente, eximido hasta ${waived.until ?? "(sin fecha)"}: ${waived.reason}`
          );
        }
      } else {
        errors.push(
          `${entry.tag}.sql NO EXISTE pero el journal lo referencia: el contenedor morirá en "node migrate.mjs"`
        );
      }
      continue;
    }

    const contents = readFileSync(sqlPath);
    const hash = createHash("sha256").update(contents).digest("hex");
    if (hashes.has(hash)) errors.push(`hash duplicado en ${entry.tag}`);
    hashes.add(hash);
  }

  // Fichero en el disco pero fuera del journal: `drizzle-kit` nunca lo aplicará.
  const onDisk = readdirSync(migrationsFolder)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => f.slice(0, -4));
  for (const orphan of onDisk.filter((t) => !tags.has(t))) {
    warnings.push(`${orphan}.sql existe pero no está en el journal: nunca se aplicará`);
  }

  // Exención que dejó de hacer falta: hay que borrarla, si no el guardia se apaga solo.
  for (const waived of allowlist?.waived ?? []) {
    if (existsSync(path.join(migrationsFolder, `${waived.tag}.sql`))) {
      errors.push(
        `allowlist: quita "${waived.tag}" de scripts/migrations-guard.allowlist.json, su .sql ya existe`
      );
    } else if (!tags.has(waived.tag)) {
      // El tag eximido ya no está en el journal (se renombró, como pasó con los
      // 0074/0075 originales): la entrada no exime de nada y se queda dormida en
      // el archivo. Aviso y no error: una fila huérfana del allowlist no debe
      // bloquear un despliegue que por lo demás está sano.
      warnings.push(
        `allowlist: "${waived.tag}" ya no está en el journal; la exención no exime de nada, quítala`
      );
    }
  }
}

for (const w of warnings) console.log(`  aviso: ${w}`);
if (errors.length > 0) {
  for (const e of errors) console.error(`  ERROR: ${e}`);
  console.error(`\n[check-migrations] ${errors.length} error(es) de integridad de migraciones.`);
  console.error("[check-migrations] Un deploy de esta rama dejaría el CRM caído en el arranque.");
  process.exit(1);
}
console.log(
  `[check-migrations] OK — journal legible y coherente con drizzle/*.sql (${warnings.length} aviso(s)).`
);
