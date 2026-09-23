/** Creates and drops its own database. Requires a LOCAL TEST_DATABASE_ADMIN_URL
 * with CREATEDB privileges and a completed pnpm build. Never uses DATABASE_URL.
 * Run: TEST_DATABASE_ADMIN_URL=postgres://...@localhost:55439/postgres node scripts/e2e-critical-audit.mjs
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { build } from "esbuild";
import postgres from "postgres";
import { chromium } from "playwright";

const adminUrl = new URL(process.env.TEST_DATABASE_ADMIN_URL);
assert(["localhost", "127.0.0.1"].includes(adminUrl.hostname), "Only a local test database is allowed");
const admin = postgres(adminUrl.toString(), { max: 1 });
const database = `audit_e2e_${Date.now()}`;
adminUrl.pathname = `/${database}`;
const port = 3311;
const base = `http://localhost:${port}`;
const bundle = `.tmp/${database}.mjs`;
const env = {
  ...process.env, DATABASE_URL: adminUrl.toString(), APP_BASE_URL: base,
  BETTER_AUTH_SECRET: randomBytes(32).toString("hex"), ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  META_WEBHOOK_VERIFY_TOKEN: "local-audit-webhook-token", META_APP_SECRET: "",
  NODE_ENV: "production", ALLOW_SIGNUP: "true", WA_MOCK_ENABLED: "false",
  OPENROUTER_API_TOKEN: "", CHANNELS: "whatsapp", AGENDA: "off",
  MIGRATIONS_DIR: `${process.cwd()}/drizzle`,
};
let server, browser;
let providerCalls = 0;
const provider = createServer((req, res) => {
  providerCalls++;
  if (req.url.endsWith("audit-stall-headers")) return;
  if (req.url.endsWith("audit-stall-body")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.write('{"pending":');
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end('{"id":"local-meta-message"}');
});
let serverLog = "";
const run = (args) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, args, { env, stdio: "inherit" });
  child.on("error", reject);
  child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Test process exited ${code}`)));
});
try {
  await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
  env.META_GRAPH_BASE_URL = `http://127.0.0.1:${provider.address().port}`;
  await admin.unsafe(`CREATE DATABASE "${database}"`);
  await run(["scripts/migrate.mjs"]);
  await mkdir(".tmp", { recursive: true });
  await build({ entryPoints: ["scripts/critical-audit-db.ts"], outfile: bundle, bundle: true, platform: "node", format: "esm", packages: "external", alias: { "@": "./src" } });
  await run([bundle]);
  assert.equal(providerCalls, 3, "No automatic retry after ambiguous send timeouts");
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], { env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  for (const stream of [server.stdout, server.stderr]) stream.on("data", (data) => { serverLog = (serverLog + data).slice(-12000); });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2000) })).ok) { ready = true; break; } } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert(ready, "Local test app starts");
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL: base });
  const auth = await context.request.post("/api/auth/sign-up/email", {
    data: { email: "audit@example.test", password: "audit-local-password", name: "Audit Owner" }, headers: { origin: base },
  });
  assert(auth.ok(), "Owner can sign up in disposable instance");
  const response = await context.request.get("/api/dashboard?period=30d");
  assert(response.ok(), `Dashboard returns ${response.status()}`);
  assert.equal((await response.json()).contacts.total, 0);
  assert.equal((await context.request.get("/api/dashboard?period=invalid")).status(), 422);
  assert.equal((await fetch(`${base}/api/dashboard`)).status, 401);

  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  await page.goto("/dashboard");
  await page.getByRole("heading", { name: "Dashboard", exact: true }).waitFor();
  // A malformed transport response triggers a real React render exception.
  // The route boundary must contain it and recover via reset when data is fixed.
  await page.route("**/api/dashboard?*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await page.reload();
  await page.getByRole("heading", { name: "No pudimos mostrar esta página", exact: true }).waitFor();
  await page.getByRole("link", { name: "Volver al inicio", exact: true }).waitFor();
  await page.unroute("**/api/dashboard?*");
  await page.getByRole("button", { name: "Reintentar", exact: true }).click();
  await page.getByRole("heading", { name: "Dashboard", exact: true }).waitFor();
  assert.equal(await page.getByRole("heading", { name: "No pudimos mostrar esta página", exact: true }).count(), 0);
  console.log("OK: browser dashboard, API auth/validation, render failure contained and retry recovers");
} catch (error) {
  console.error(error);
  console.error(serverLog);
  process.exitCode = 1;
} finally {
  provider.closeAllConnections();
  provider.close();
  await browser?.close();
  if (server && server.exitCode === null) {
    const exited = new Promise((resolve) => server.once("exit", resolve));
    process.kill(-server.pid, "SIGTERM");
    await exited;
  }
  await admin.unsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  await admin.end();
  await rm(bundle, { force: true });
}
