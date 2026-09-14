/** Regresión de proyectos/tareas contra la app real y una BD aislada.
 * DATABASE_URL debe apuntar a lumark_test. E2E_BROWSER=1 incluye flujo visual.
 */
import assert from "node:assert/strict";
import postgres from "postgres";

const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
if (!process.env.DATABASE_URL || new URL(process.env.DATABASE_URL).pathname !== "/lumark_test") throw new Error("Esta prueba requiere la base aislada lumark_test");
const sql = postgres(process.env.DATABASE_URL, { max: 2 });
const suffix = Date.now().toString(36);
const otherOrg = `test_tasks_org_${suffix}`;
const teamUser = `test_tasks_user_${suffix}`;
const foreignUser = `test_tasks_foreign_${suffix}`;
const teamMember = `test_tasks_member_${suffix}`;
const foreignStage = `test_tasks_stage_${suffix}`;
let cookie = "";
let projectId, secondProjectId, browser;
let checks = 0;
function check(name, condition) { assert.ok(condition, name); checks++; console.log(`OK ${name}`); }
async function api(path, method = "GET", body, authenticated = true) {
  const response = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", origin: base, ...(authenticated && cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const cookies = response.headers.getSetCookie();
  if (cookies.length && authenticated) cookie = cookies.map((c) => c.split(";")[0]).join("; ");
  return { status: response.status, data: await response.json() };
}
try {
  let auth = await api("/api/auth/sign-in/email", "POST", { email: "e2e@vocero.test", password: "password-e2e-123" });
  if (auth.status !== 200) auth = await api("/api/auth/sign-up/email", "POST", { email: "e2e@vocero.test", password: "password-e2e-123", name: "Operador E2E" });
  check("login", auth.status === 200);
  const [membership] = await sql`SELECT organization_id FROM member WHERE user_id = ${auth.data.user.id} LIMIT 1`;
  const orgId = membership.organization_id;
  await sql`INSERT INTO organization (id, name, slug, created_at) VALUES (${otherOrg}, 'Organización externa de prueba', ${otherOrg}, now())`;
  await sql`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES
    (${teamUser}, 'Responsable de prueba', ${teamUser + '@lumark.test'}, false, now(), now()),
    (${foreignUser}, 'Usuario externo', ${foreignUser + '@lumark.test'}, false, now(), now())`;
  await sql`INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES
    (${teamMember}, ${orgId}, ${teamUser}, 'member', now()),
    (${foreignUser}, ${otherOrg}, ${foreignUser}, 'member', now())`;
  await sql`INSERT INTO project_stage (id, organization_id, name, position) VALUES (${foreignStage}, ${otherOrg}, 'Etapa externa', 0)`;
  check("API de tareas requiere sesión", (await api("/api/tareas", "GET", undefined, false)).status === 401);
  const members = (await api("/api/members")).data.members;
  check("selector entrega userId de miembros de la organización", members.some((m) => m.userId === teamUser) && !members.some((m) => m.userId === foreignUser));
  const created = await api("/api/projects", "POST", { name: `Proyecto pruebas ${suffix}`, assignedUserId: teamUser });
  check("crear proyecto asignado", created.status === 201);
  projectId = created.data.projectId;
  secondProjectId = (await api("/api/projects", "POST", { name: `Segundo proyecto ${suffix}` })).data.projectId;
  let project = (await api(`/api/projects/${projectId}`)).data.project;
  const stages = project.stages;
  check("siete etapas propias con ID real", stages.length === 7 && project.stageId === stages[0].id && project.avance === 0);
  check("etapa de otra organización rechazada", (await api(`/api/projects/${projectId}/transition`, "POST", { toStageId: foreignStage })).status === 422);
  check("terminar desde etapa inicial rechazado", (await api(`/api/projects/${projectId}/transition`, "POST", { toStageId: stages[0].id, complete: true })).status === 422);
  const race = await Promise.all([1, 2].map(() => api(`/api/projects/${projectId}/transition`, "POST", { toStageId: stages[1].id, expectedStageId: stages[0].id })));
  check("cambio concurrente protegido", race.filter((r) => r.status === 200).length === 1 && race.filter((r) => r.status === 409).length === 1);
  check("retroceder etapa", (await api(`/api/projects/${projectId}/transition`, "POST", { toStageId: stages[0].id })).status === 200);
  for (let i = 1; i < stages.length; i++) {
    check(`completar etapa ${i}`, (await api(`/api/projects/${projectId}/transition`, "POST", { toStageId: stages[i].id, expectedStageId: stages[i - 1].id })).status === 200);
  }
  project = (await api(`/api/projects/${projectId}`)).data.project;
  check("última etapa aún requiere terminar", project.avance < 100);
  check("terminar proyecto", (await api(`/api/projects/${projectId}/transition`, "POST", { toStageId: stages[6].id, complete: true })).status === 200);
  project = (await api(`/api/projects/${projectId}`)).data.project;
  check("100% y cerrado persistidos", project.avance === 100 && project.estado === "cerrado");
  await api(`/api/projects/${projectId}/transition`, "POST", { toStageId: stages[0].id });
  project = (await api(`/api/projects/${projectId}`)).data.project;
  check("reabrir y retroceder recalcula avance", project.estado === "activo" && project.avance === 0);
  check("editar responsable y riesgo", (await api(`/api/projects/${projectId}`, "PATCH", { name: `Proyecto editado ${suffix}`, assignedUserId: teamUser, riesgo: "alto" })).status === 200);
  check("responsable externo rechazado en proyecto", (await api(`/api/projects/${projectId}`, "PATCH", { assignedUserId: foreignUser })).status === 422);
  const taskBase = `/api/projects/${projectId}/tasks`;
  check("tarea en proyecto externo o inexistente rechazada", (await api("/api/projects/no-existe/tasks", "POST", { title: "No crear" })).status === 404);
  check("asignación usa userId, no member.id", (await api(taskBase, "POST", { title: "Inválida", assigneeId: teamMember })).status === 422);
  check("responsable externo rechazado", (await api(taskBase, "POST", { title: "Inválida", assigneeId: foreignUser })).status === 422);
  const taskCreated = await api(taskBase, "POST", { title: `Tarea prueba ${suffix}`, assigneeId: teamUser });
  check("crear tarea asignada", taskCreated.status === 201);
  const taskId = taskCreated.data.taskId;
  let tasks = (await api(taskBase)).data.tasks;
  check("No empezado por defecto y nombre del miembro", tasks[0].estado === "no_empezado" && tasks[0].assigneeName === "Responsable de prueba");
  check("estado inválido rechazado", (await api(`${taskBase}/${taskId}`, "PATCH", { estado: "completada" })).status === 422);
  check("no editar tarea a través de otro proyecto", (await api(`/api/projects/${secondProjectId}/tasks/${taskId}`, "PATCH", { estado: "terminado" })).status === 404);
  for (const estado of ["pendiente", "terminado", "no_empezado"]) {
    check(`cambiar estado a ${estado}`, (await api(`${taskBase}/${taskId}`, "PATCH", { estado })).status === 200);
    const global = await api(`/api/tareas?projectId=${projectId}&estado=${estado}&assigneeId=${teamUser}`);
    check(`estado ${estado} visible globalmente`, global.data.tasks.length === 1 && global.data.tasks[0].id === taskId);
  }
  check("editar descripción, prioridad y vencimiento", (await api(`${taskBase}/${taskId}`, "PATCH", { description: "Editada", prioridad: "alta", dueDate: "2026-12-20T12:00:00.000Z" })).status === 200);
  check("reasignar y quitar vencimiento", (await api(`${taskBase}/${taskId}`, "PATCH", { assigneeId: auth.data.user.id, dueDate: null })).status === 200);
  tasks = (await api(taskBase)).data.tasks;
  check("cambios persistidos sin perder título", tasks[0].description === "Editada" && tasks[0].dueDate === null && tasks[0].title === `Tarea prueba ${suffix}`);
  const report = (await api(`/api/projects/${projectId}/report`)).data.report;
  check("historial con nombres y finalización", report.stageHistory.some((e) => e.fromStageName === stages[0].name) && report.stageHistory.some((e) => e.source === "completado"));

  if (process.env.E2E_BROWSER === "1") {
    console.log("Iniciando comprobación visual con Chromium…");
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium", args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] });
    const context = await browser.newContext();
    await context.addCookies(cookie.split("; ").map((pair) => { const i = pair.indexOf("="); return { name: pair.slice(0, i), value: pair.slice(i + 1), url: base }; }));
    const page = await context.newPage();
    const defaultTimeout = 120000;
    page.setDefaultTimeout(defaultTimeout);
    console.log("Navegando a Proyectos…");
    await page.goto(`${base}/projects?projectId=${projectId}`, { waitUntil: "networkidle" });
    console.log("Página cargada, esperando contenido del proyecto…");
    const advanceBtn = page.getByRole("button", { name: "Completar etapa y continuar" });
    await advanceBtn.waitFor({ timeout: defaultTimeout });
    console.log("Botón encontrado, avanzando etapa…");
    await advanceBtn.click();
    await page.getByRole("status").filter({ hasText: "Etapa actualizada" }).waitFor();
    check("UI avanza etapa", (await api(`/api/projects/${projectId}`)).data.project.stageId === stages[1].id);
    console.log("Retrocediendo etapa…");
    await page.getByRole("button", { name: "Etapa anterior" }).click();
    await page.waitForFunction(() => document.querySelector('[aria-current="step"]')?.textContent.includes("Activación"), { timeout: defaultTimeout });
    console.log("Creando tarea desde formulario…");
    const form = page.locator("form").filter({ has: page.getByText("Nueva tarea", { exact: true }) });
    await form.getByRole("combobox", { name: "Responsable", exact: true }).waitFor({ timeout: defaultTimeout });
    await form.getByLabel("Título", { exact: true }).fill(`Tarea navegador ${suffix}`);
    await form.getByRole("combobox", { name: "Responsable", exact: true }).selectOption(teamUser);
    await form.getByRole("button", { name: "Agregar tarea" }).click();
    await page.getByRole("heading", { name: `Tarea navegador ${suffix}` }).waitFor();
    console.log("Navegando a Tareas…");
    await page.getByRole("link", { name: "Tareas", exact: true }).click();
    await page.getByRole("combobox", { name: "Filtrar proyecto", exact: true }).waitFor({ timeout: defaultTimeout });
    await page.getByRole("combobox", { name: "Filtrar proyecto", exact: true }).selectOption(projectId);
    console.log("Cambiando estado a terminado…");
    const row = page.getByRole("listitem", { name: `Tarea: Tarea navegador ${suffix}`, exact: true });
    await row.getByRole("combobox", { name: "Estado", exact: true }).selectOption("terminado");
    await page.waitForFunction(async ({ projectId, suffix }) => {
      const data = await (await fetch(`/api/tareas?projectId=${projectId}&estado=terminado`)).json();
      return data.tasks.some((t) => t.title === `Tarea navegador ${suffix}`);
    }, { projectId, suffix }, { timeout: defaultTimeout });
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("combobox", { name: "Filtrar estado", exact: true }).waitFor({ timeout: defaultTimeout });
    await page.getByRole("combobox", { name: "Filtrar estado", exact: true }).selectOption("terminado");
    await row.waitFor();
    check("UI crea tarea asignada y termina desde vista global", (await row.getByRole("combobox", { name: "Responsable", exact: true }).inputValue()) === teamUser);
    console.log("Navegando de Tareas a Proyecto…");
    const projectLink = row.getByRole("link", { name: `Proyecto editado ${suffix}` });
    const projectHref = await projectLink.getAttribute("href");
    await projectLink.click();
    await page.waitForURL(`**${projectHref}**`, { timeout: defaultTimeout });
    await page.getByRole("heading", { name: `Tarea navegador ${suffix}` }).waitFor({ timeout: defaultTimeout });
    check("navegación Tareas → proyecto", page.url().includes(projectId));
    await browser.close(); browser = null;
  }
  check("eliminar tarea", (await api(`${taskBase}/${taskId}`, "DELETE")).status === 200);
  check("tarea eliminada ya no aparece", !(await api(taskBase)).data.tasks.some((t) => t.id === taskId));
  console.log(`Proyectos y tareas: ${checks}/${checks} comprobaciones correctas`);
} finally {
  await browser?.close();
  if (projectId) await sql`DELETE FROM project WHERE id = ${projectId}`;
  if (secondProjectId) await sql`DELETE FROM project WHERE id = ${secondProjectId}`;
  await sql`DELETE FROM organization WHERE id = ${otherOrg}`;
  await sql`DELETE FROM "user" WHERE id IN (${teamUser}, ${foreignUser})`;
  await sql.end();
}
