/** Isolated local PostgreSQL regression for personal settings and task access. */
import assert from "node:assert/strict";
import postgres from "postgres";
import { request } from "playwright";
const base = process.env.APP_BASE_URL ?? "http://localhost:3199";
const url = process.env.DATABASE_URL;
assert(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
assert(url && ["localhost", "127.0.0.1"].includes(new URL(url).hostname));
const sql = postgres(url, { max: 1 });
const owner = await request.newContext({ baseURL: base, extraHTTPHeaders: { origin: base } });
const other = await request.newContext({ baseURL: base, extraHTTPHeaders: { origin: base } });
const email = `isolation-${Date.now()}@example.test`;
let id;
try {
  assert((await owner.post("/api/auth/sign-in/email", { data: { email: "e2e@vocero.test", password: "password-e2e-123" } })).ok());
  assert((await owner.post("/api/settings/team", { data: { name: "CalTodo isolation", email, password: "local-isolation-password" } })).ok());
  assert((await other.post("/api/auth/sign-in/email", { data: { email, password: "local-isolation-password" } })).ok());
  const settings = { workStartHour: 10, workEndHour: 18, timezone: "America/Mexico_City", defaultDuration: 45 };
  assert((await other.patch("/api/caltodo/settings", { data: settings })).ok(), "Second member can save personal settings");
  assert.equal((await (await other.get("/api/caltodo/settings")).json()).settings.defaultDuration, 45);
  console.log("OK: dos usuarios de la misma organización guardan configuración independiente");
  const created = await owner.post("/api/caltodo/tasks", { data: { title: "Isolation test task", duration: 15 } });
  assert(created.ok()); id = (await created.json()).task.id;
  assert(!(await (await other.get("/api/caltodo/tasks")).json()).tasks.some((t) => t.id === id));
  assert.equal((await other.patch(`/api/caltodo/tasks?id=${id}`, { data: { completed: true } })).status(), 404);
  assert.equal((await other.delete(`/api/caltodo/tasks?id=${id}`)).status(), 404);
  assert.equal((await other.post("/api/caltodo/tasks/reorder", { data: { taskIds: [id] } })).status(), 409);
  assert.equal((await owner.post("/api/caltodo/tasks/reorder", { data: { taskIds: [id, id] } })).status(), 422);
  assert.equal((await owner.post("/api/caltodo/tasks/reorder", { data: { taskIds: "bad" } })).status(), 422);
  console.log("OK: listar, editar, borrar y reordenar respetan el usuario; inputs inválidos devuelven 422");
  const own = (await (await owner.get("/api/caltodo/tasks")).json()).tasks.find((t) => t.id === id);
  assert(own && !own.completed);
  console.log("PASS: aislamiento de calendario verificado contra PostgreSQL real");
} finally {
  if (id) await owner.delete(`/api/caltodo/tasks?id=${id}`);
  await sql`DELETE FROM caltodo_settings WHERE user_id IN (SELECT id FROM "user" WHERE email = ${email})`;
  await sql`DELETE FROM "user" WHERE email = ${email}`;
  await sql.end(); await owner.dispose(); await other.dispose();
}
