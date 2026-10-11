/**
 * Backfill de credenciales de `integration` a cifrado AES-256-GCM (0044).
 *
 * Las filas escritas antes de 0044 dejan sus tokens en el jsonb `credentials`
 * en claro. Este script las re-cifra al triple cipher/iv/tag y vacía el jsonb.
 * Es idempotente: las filas ya cifradas se omiten.
 *
 * Corre DESPUÉS de aplicar la migración 0044 (arranque del contenedor):
 *
 *   node scripts/encrypt-integrations.mjs
 *
 * Requiere DATABASE_URL y ENCRYPTION_KEY (32 bytes base64), igual que la app.
 */
import { createCipheriv, randomBytes } from "node:crypto";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[encrypt-integrations] DATABASE_URL no está definida");
  process.exit(1);
}
const key = Buffer.from(process.env.ENCRYPTION_KEY ?? "", "base64");
if (key.length !== 32) {
  console.error("[encrypt-integrations] ENCRYPTION_KEY debe ser 32 bytes en base64");
  process.exit(1);
}

function encrypt(plain) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return {
    cipher: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

const sql = postgres(url, { max: 1 });
try {
  const rows = await sql`
    SELECT id, provider, credentials
    FROM integration
    WHERE credentials_cipher IS NULL
      AND credentials IS NOT NULL
      AND credentials::text NOT IN ('{}', 'null')
  `;
  let done = 0;
  for (const row of rows) {
    const encrypted = encrypt(JSON.stringify(row.credentials));
    await sql`
      UPDATE integration
      SET credentials = '{}',
          credentials_cipher = ${encrypted.cipher},
          credentials_iv = ${encrypted.iv},
          credentials_tag = ${encrypted.tag},
          updated_at = now()
      WHERE id = ${row.id}
    `;
    done += 1;
    console.log(`[encrypt-integrations] cifrada ${row.provider} (${row.id})`);
  }
  console.log(`[encrypt-integrations] listo: ${done} fila(s) cifrada(s)`);
} catch (error) {
  console.error("[encrypt-integrations] falló:", error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
