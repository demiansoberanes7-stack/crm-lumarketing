/**
 * Limitación de tasa local para rutas internas y distribuida para superficies
 * públicas. El bucket distribuido vive en PostgreSQL para funcionar con varias
 * réplicas sin añadir Redis al núcleo.
 */

import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";

type Bucket = number[]; // timestamps (ms) de los intentos

const globalForRl = globalThis as unknown as {
  __voceroRateLimit?: Map<string, Bucket>;
};

function store(): Map<string, Bucket> {
  if (!globalForRl.__voceroRateLimit) {
    globalForRl.__voceroRateLimit = new Map();
  }
  return globalForRl.__voceroRateLimit;
}

export type RateLimitResult = { allowed: boolean; remaining: number };

export function checkRateLimit(
  key: string,
  opts: { windowMs: number; max: number },
  now: number = Date.now()
): RateLimitResult {
  const buckets = store();
  const cutoff = now - opts.windowMs;
  const bucket = (buckets.get(key) ?? []).filter((t) => t > cutoff);

  if (bucket.length >= opts.max) {
    buckets.set(key, bucket);
    return { allowed: false, remaining: 0 };
  }
  bucket.push(now);
  buckets.set(key, bucket);
  return { allowed: true, remaining: opts.max - bucket.length };
}

/** Solo para tests. */
export function resetRateLimit(): void {
  store().clear();
}

/** 10 intentos / 10 minutos por IP en login y registro (FR-062). */
export const AUTH_RATE_LIMIT = { windowMs: 10 * 60 * 1000, max: 10 };

export async function checkDistributedRateLimit(
  key: string,
  opts: { windowMs: number; max: number },
  now = new Date()
): Promise<RateLimitResult> {
  const windowStartedAt = new Date(Math.floor(now.getTime() / opts.windowMs) * opts.windowMs);
  const expiresAt = new Date(windowStartedAt.getTime() + opts.windowMs);
  try {
    const result = await getDb().execute(sql`
      INSERT INTO "rate_limit_bucket" ("key", "window_started_at", "count", "expires_at")
      VALUES (${key}, ${windowStartedAt}, 1, ${expiresAt})
      ON CONFLICT ("key") DO UPDATE SET
        "window_started_at" = CASE
          WHEN "rate_limit_bucket"."window_started_at" = ${windowStartedAt}
            THEN "rate_limit_bucket"."window_started_at"
          ELSE ${windowStartedAt}
        END,
        "count" = CASE
          WHEN "rate_limit_bucket"."window_started_at" = ${windowStartedAt}
            THEN "rate_limit_bucket"."count" + 1
          ELSE 1
        END,
        "expires_at" = ${expiresAt}
      RETURNING "count"
    `);
    const count = Number((result as { rows?: Array<{ count?: number }> }).rows?.[0]?.count ?? opts.max + 1);
    return { allowed: count <= opts.max, remaining: Math.max(0, opts.max - count) };
  } catch (error) {
    // Una caída de la tabla no debe descartar webhooks legítimos; queda visible
    // en logs para corregir la infraestructura, pero el endpoint sigue vivo.
    console.error("[rate-limit] bucket distribuido no disponible:", error);
    return { allowed: true, remaining: opts.max };
  }
}

export const WEBHOOK_RATE_LIMIT = { windowMs: 60_000, max: 120 };
