/** Regresión de proyectos/tareas contra la app real y una BD aislada.
 * DATABASE_URL debe apuntar a lumark_test. E2E_BROWSER=1 incluye flujo visual.
 */
import assert from "node:assert/strict";
import zlib from "node:zlib";
import postgres from "postgres";

const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
if (!process.env.DATABASE_URL || new URL(process.env.DATABASE_URL).pathname !== "/lumark_test") throw new Error("Esta prueba requiere la base aislada lumark_test");
const hostBase = new URL(base).hostname;
if (!["localhost", "127.0.0.1", "::1"].includes(hostBase) && process.env.E2E_ALLOW_REMOTE !== "1")
  throw new Error(`La prueba solo corre contra local (recibido: ${base}); define E2E_ALLOW_REMOTE=1 si realmente quieres remoto`);
const sql = postgres(process.env.DATABASE_URL, { max: 2 });
const suffix = Date.now().toString(36);
const otherOrg = `test_tasks_org_${suffix}`;
const teamUser = `test_tasks_user_${suffix}`;
const foreignUser = `test_tasks_foreign_${suffix}`;
const teamMember = `test_tasks_member_${suffix}`;
const foreignStage = `test_tasks_stage_${suffix}`;
let cookie = "";
let projectId, secondProjectId, foreignProjectId, browser;
let checks = 0;
/** pdf-lib guarda el texto en streams Flate + strings hex: inflar y comparar en hex. */
function pdfAplanado(buf) {
  const plano = buf.toString("latin1");
  const partes = [plano];
  for (const m of plano.matchAll(/stream\r?\n/g)) {
    const inicio = m.index + m[0].length;
    const fin = buf.indexOf(Buffer.from("endstream"), inicio);
    if (fin < 0) continue;
    const chunk = buf.subarray(inicio, fin);
    for (const inflate of [zlib.inflateSync, zlib.inflateRawSync]) {
      try {
        partes.push(inflate(chunk).toString("latin1"));
        break;
      } catch { /* stream sin comprimir o con otro método */ }
    }
  }
  return partes.join("\n");
}
function pdfIncluye(buf, texto) {
  const objetivo = Buffer.from(texto, "latin1").toString("hex").toUpperCase();
  const a = pdfAplanado(buf);
  return a.includes(objetivo) || a.includes(texto);
}
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

  // ── Módulo de proyectos: expediente por tipos, borradores y PDF ──
  const wf = secondProjectId;
  const wfTaskTitle = `Tarea PDF ${suffix}`;
  const wfTaskDescription = "Descripción detallada de integración en el expediente.";
  const wfTaskCreated = await api(`/api/projects/${wf}/tasks`, "POST", {
    title: wfTaskTitle,
    description: wfTaskDescription,
    assigneeId: auth.data.user.id,
    prioridad: "alta",
    dueDate: "2026-10-22T18:00:00.000Z",
  });
  const wfTaskId = wfTaskCreated.data.taskId;
  check("tarea de proyecto usa prefijo prjt_", wfTaskCreated.status === 201 && wfTaskId.startsWith("prjt_"));
  const todoTasks = (await api("/api/caltodo/tasks")).data.tasks;
  check("tarea asignada de proyecto aparece en Pendientes", todoTasks.some((t) => t.id === wfTaskId));
  check(
    "reordenar Pendientes acepta IDs prjt_",
    (await api("/api/caltodo/tasks/reorder", "POST", {
      taskIds: todoTasks.filter((t) => !t.completed).map((t) => t.id),
    })).status === 200
  );
  check("completar tarea desde Pendientes", (await api(`/api/caltodo/tasks?id=${wfTaskId}`, "PATCH", { completed: true })).status === 200);
  let wfProjectTasks = (await api(`/api/projects/${wf}/tasks`)).data.tasks;
  check("completado en Pendientes sincroniza a Proyectos", wfProjectTasks.find((t) => t.id === wfTaskId)?.estado === "terminado");
  check("descompletar tarea desde Pendientes", (await api(`/api/caltodo/tasks?id=${wfTaskId}`, "PATCH", { completed: false })).status === 200);
  wfProjectTasks = (await api(`/api/projects/${wf}/tasks`)).data.tasks;
  check("pendiente en Pendientes sincroniza a Proyectos", wfProjectTasks.find((t) => t.id === wfTaskId)?.estado === "pendiente");

  foreignProjectId = `test_prj_foreign_${suffix}`;
  await sql`INSERT INTO project (id, organization_id, code, name) VALUES (${foreignProjectId}, ${otherOrg}, ${'PRJ-X-' + suffix}, 'Proyecto ajeno')`;
  let wfSteps = (await api(`/api/projects/${wf}/steps`)).data;
  check("stepper con paso general + 7 pasos de marketing", wfSteps.steps.length === 8 && wfSteps.steps[0].key === "general" && wfSteps.status === "borrador");
  check("pasos de otra organización rechazados", (await api(`/api/projects/${foreignProjectId}/steps`)).status === 404);
  check("guardar paso de otra organización rechazado", (await api(`/api/projects/${foreignProjectId}/steps/general`, "PUT", { data: { name: "No" } })).status === 404);
  check("paso inexistente para el tipo rechazado", (await api(`/api/projects/${wf}/steps/inventario`, "PUT", { data: {} })).status === 422);
  check("datos inválidos rechazados con 422", (await api(`/api/projects/${wf}/steps/objetivos`, "PUT", { data: {}, complete: true })).status === 422);
  check("finalizar sin pasos completos rechazado", (await api(`/api/projects/${wf}/status`, "POST", { status: "completado" })).status === 422);
  const genSave = await api(`/api/projects/${wf}/steps/general`, "PUT", { data: { name: `Proyecto workflow ${suffix}`, startDate: "2026-10-01", endDate: "2026-12-15", notas: "Expediente completo" }, complete: true });
  check("completar paso general", genSave.status === 200 && genSave.data.step.status === "completado");
  const rawIdMarker = `ct_private_pdf_${suffix}`;
  await sql`UPDATE project_step SET data = COALESCE(data, '{}'::jsonb) || ${JSON.stringify({ contactId: rawIdMarker, assignedUserId: auth.data.user.id })}::jsonb WHERE project_id = ${wf} AND step_key = 'general'`;
  const genProject = (await api(`/api/projects/${wf}`)).data.project;
  check("nombre y fechas viven en el proyecto", genProject.name === `Proyecto workflow ${suffix}` && String(genProject.startDate).startsWith("2026-10-01") && String(genProject.endDate).startsWith("2026-12-15"));
  check("borrador avanza a en_proceso", genProject.status === "en_proceso" && genProject.estado === "activo");
  check("avance proporcional a pasos", genProject.avance === 13);
  const stepPayloads = {
    objetivos: { objetivo: "Generar leads calificados", meta: "+30% leads" },
    buyer_person: {
      cobertura: "nacional",
      demografia: "30 a 45 años, CDMX y GDL, NSE B/C, dueños de negocio",
      psicografia: "Crecer sin depender de publicidad pagada; valoran los resultados medibles",
      comportamiento: "Compara 3 agencias antes de decidir; objeción principal: costo",
    },
    presupuesto: { presupuesto: 15000, duracion_dias: 90 },
    canales: { canales: ["instagram", "facebook"] },
    contenido: { pilares: "Educación de producto" },
    metricas: { kpis: "CPL, ROAS" },
    cierre: { entregables: "Reporte final editable" },
  };
  for (const [key, data] of Object.entries(stepPayloads)) {
    const r = await api(`/api/projects/${wf}/steps/${key}`, "PUT", { data, complete: true });
    check(`completar paso ${key}`, r.status === 200 && r.data.step.status === "completado");
  }
  wfSteps = (await api(`/api/projects/${wf}/steps`)).data;
  check("avance 100 con todos los pasos completos", wfSteps.avance === 100 && wfSteps.steps.every((s) => s.status === "completado"));
  const draftSave = await api(`/api/projects/${wf}/steps/cierre`, "PUT", { data: { entregables: "Borrador sin completar" }, complete: false });
  check("guardar borrador no completa el paso", draftSave.status === 200 && draftSave.data.step.status === "en_proceso" && draftSave.data.avance === 88);
  check("reponer paso completado", (await api(`/api/projects/${wf}/steps/cierre`, "PUT", { data: { entregables: "Reporte final editable" }, complete: true })).status === 200);
  check("finalizar proyecto", (await api(`/api/projects/${wf}/status`, "POST", { status: "completado" })).status === 200);
  const wfDone = (await api(`/api/projects/${wf}`)).data.project;
  check("completado: avance 100 y estado legado cerrado", wfDone.status === "completado" && wfDone.avance === 100 && wfDone.estado === "cerrado");
  check("reabrir proyecto", (await api(`/api/projects/${wf}/status`, "POST", { status: "en_proceso" })).status === 200 && (await api(`/api/projects/${wf}`)).data.project.estado === "activo");
  const pdfRes = await fetch(`${base}/api/projects/${wf}/pdf`, { headers: { cookie } });
  check("PDF del expediente servido", pdfRes.status === 200 && String(pdfRes.headers.get("content-type")).includes("application/pdf"));
  const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
  check("PDF real con encabezado y código", pdfBuffer.subarray(0, 5).toString("latin1") === "%PDF-" && pdfIncluye(pdfBuffer, "EXPEDIENTE DE PROYECTO") && pdfIncluye(pdfBuffer, wfDone.code));
  check("PDF omite IDs técnicos del paso general", !pdfIncluye(pdfBuffer, rawIdMarker) && !pdfIncluye(pdfBuffer, auth.data.user.id));
  check("PDF desglosa título y descripción de tarea", pdfIncluye(pdfBuffer, wfTaskTitle) && pdfIncluye(pdfBuffer, wfTaskDescription));
  check("PDF incluye estado, prioridad, entrega y responsable", pdfIncluye(pdfBuffer, "Pendiente") && pdfIncluye(pdfBuffer, "Alta") && pdfIncluye(pdfBuffer, "octubre de 2026") && pdfIncluye(pdfBuffer, "Operador E2E"));
  check("PDF sin sesión rechazado", (await fetch(`${base}/api/projects/${wf}/pdf`)).status === 401);

  // ── PDF: mismos datos de empresa y logo que la cotización ──
  const empresa = `Casa Demo ${suffix}`;
  check(
    "sembrar datos de empresa",
    (await api("/api/settings/business", "PUT", {
      companyName: empresa,
      email: "hola@lumark.qa",
      phone: "55 1234 5678",
      address: "Av. Siempre Viva 742",
    })).status === 200
  );
  const pedirPdf = async (qs = "") =>
    Buffer.from(await (await fetch(`${base}/api/projects/${wf}/pdf${qs}`, { headers: { cookie } })).arrayBuffer());
  const pdfEmpresa = await pedirPdf();
  check("PDF con el nombre de la empresa", pdfIncluye(pdfEmpresa, empresa));
  check(
    "PDF con footer de contacto",
    pdfIncluye(pdfEmpresa, "hola@lumark.qa") && pdfIncluye(pdfEmpresa, "55 1234 5678")
  );

  const descarga = await fetch(`${base}/api/projects/${wf}/pdf?download=1`, { headers: { cookie } });
  const disposition = descarga.headers.get("content-disposition") ?? "";
  await descarga.arrayBuffer();
  check(
    "?download=1 devuelve attachment",
    descarga.ok && disposition.startsWith("attachment") && disposition.includes(".pdf")
  );

  async function subirLogo(nombre, mime, contenido) {
    const form = new FormData();
    form.append("file", new Blob([contenido], { type: mime }), nombre);
    const res = await fetch(`${base}/api/settings/business/logo`, {
      method: "POST",
      headers: { cookie },
      body: form,
    });
    return res.status;
  }
  const pngLogo = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGPgjf5PEmIY1TCqYfhqAADpLGcQ7emRCgAAAABJRU5ErkJggg==",
    "base64"
  );
  const svgLogo =
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="8" fill="#0d5bff"/><path d="M16 44 L32 16 L48 44 Z" fill="#ffffff"/></svg>';

  check("subir logo PNG", (await subirLogo("logo.png", "image/png", pngLogo)) === 200);
  check("PDF con logo PNG embebido", pdfAplanado(await pedirPdf()).includes("/Image"));
  check("subir logo SVG", (await subirLogo("logo.svg", "image/svg+xml", svgLogo)) === 200);
  check("PDF rasteriza el logo SVG a imagen", pdfAplanado(await pedirPdf()).includes("/Image"));
  check("eliminar tarea de proyecto desde Pendientes", (await api(`/api/caltodo/tasks?id=${wfTaskId}`, "DELETE")).status === 200);
  check("eliminar en Pendientes elimina la tarea del proyecto", !(await api(`/api/projects/${wf}/tasks`)).data.tasks.some((t) => t.id === wfTaskId));
  // Volcado opcional para inspección visual (solo si E2E_PDF_DUMP define una ruta).
  if (process.env.E2E_PDF_DUMP) {
    const fsdump = await import("node:fs");
    fsdump.writeFileSync(process.env.E2E_PDF_DUMP, await pedirPdf());
  }

  if (process.env.E2E_BROWSER === "1") {
    console.log("Iniciando comprobación visual con Chromium…");
    const { chromium } = await import("playwright");
    const fsmod = await import("node:fs");
    const exe = process.env.CHROMIUM_PATH ?? (fsmod.existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
    browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] });
    const context = await browser.newContext();
    await context.addCookies(cookie.split("; ").map((pair) => { const i = pair.indexOf("="); return { name: pair.slice(0, i), value: pair.slice(i + 1), url: base }; }));
    const page = await context.newPage();
    const defaultTimeout = 120000;
    page.setDefaultTimeout(defaultTimeout);
    // confirm() nativo (cambios sin guardar): se acepta como lo haría un usuario.
    page.on("dialog", (dialog) => { void dialog.accept().catch(() => {}); });
    console.log("Navegando a Proyectos…");
    await page.goto(`${base}/projects?projectId=${projectId}`, { waitUntil: "domcontentloaded" });
    console.log("Página cargada, esperando contenido del proyecto…");
    const continueBtn = page.getByRole("button", { name: /Continuar expediente|Revisar expediente/ });
    await continueBtn.waitFor({ timeout: defaultTimeout });
    console.log("Expediente visible, abriendo stepper…");
    check("UI muestra los pasos del expediente", await page.getByText("Información general").first().isVisible());
    await continueBtn.click();
    await page.getByRole("dialog").waitFor({ timeout: defaultTimeout });
    await page.getByRole("button", { name: "Guardar borrador" }).click();
    await page.getByRole("button", { name: "Guardar borrador" }).getByText("Guardar borrador").waitFor({ timeout: defaultTimeout });
    const uiSteps = (await api(`/api/projects/${projectId}/steps`)).data;
    check("UI guarda borrador del paso general", uiSteps.steps[0].status === "en_proceso" && uiSteps.steps[0].data.name === `Proyecto editado ${suffix}`);
    await page.getByRole("button", { name: "Salir del expediente" }).click();
    await page.waitForSelector('[role="dialog"]', { state: "detached", timeout: defaultTimeout });
    console.log("Creando tarea desde formulario…");
    const form = page.locator("form").filter({ has: page.getByText("Nueva tarea", { exact: true }) });
    await form.getByRole("combobox", { name: "Responsable", exact: true }).waitFor({ timeout: defaultTimeout });
    await form.getByLabel("Título", { exact: true }).fill(`Tarea navegador ${suffix}`);
    await form.getByRole("combobox", { name: "Responsable", exact: true }).selectOption(teamUser);
    await form.getByRole("button", { name: "Agregar tarea" }).click();
    await page.getByRole("heading", { name: `Tarea navegador ${suffix}` }).waitFor();
    console.log("Navegando a Tareas…");
    // La navegación principal no tiene entrada "Tareas": la vista vive en /tareas.
    await page.goto(`${base}/tareas`, { waitUntil: "domcontentloaded" });
    await page.getByRole("combobox", { name: "Filtrar proyecto", exact: true }).waitFor({ timeout: defaultTimeout });
    await page.getByRole("combobox", { name: "Filtrar proyecto", exact: true }).selectOption(projectId);
    console.log("Cambiando estado a terminado…");
    const row = page.getByRole("listitem", { name: `Tarea: Tarea navegador ${suffix}`, exact: true });
    await row.getByRole("combobox", { name: "Estado", exact: true }).selectOption("terminado");
    await page.waitForFunction(async ({ projectId, suffix }) => {
      const data = await (await fetch(`/api/tareas?projectId=${projectId}&estado=terminado`)).json();
      return data.tasks.some((t) => t.title === `Tarea navegador ${suffix}`);
    }, { projectId, suffix }, { timeout: defaultTimeout });
    await page.reload({ waitUntil: "domcontentloaded" });
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

    console.log("Flujo completo: selector de tipo → wizard → finalizar…");
    await page.goto(`${base}/projects`, { waitUntil: "domcontentloaded" });
    const nuevoBtn = page.getByRole("button", { name: "Nuevo Proyecto" });
    await nuevoBtn.waitFor({ timeout: defaultTimeout });
    let pickerAbierto = false;
    for (let intento = 0; intento < 6 && !pickerAbierto; intento++) {
      await nuevoBtn.click();
      try {
        await page.getByRole("dialog", { name: "Nuevo proyecto" }).waitFor({ timeout: 5000 });
        pickerAbierto = true;
      } catch { await page.waitForTimeout(1000); }
    }
    check("el selector de tipo se abre", pickerAbierto);
    if (!pickerAbierto) throw new Error("No se abrió el diálogo de tipo de proyecto");
    const picker = page.getByRole("dialog", { name: "Nuevo proyecto" });
    await picker.getByRole("button", { name: /Marketing/ }).first().click();
    await picker.getByLabel("Nombre del proyecto").fill(`Wizard UI ${suffix}`);
    await picker.getByRole("button", { name: "Crear y continuar" }).click();
    await page.getByRole("heading", { name: "1. Información general" }).waitFor({ timeout: defaultTimeout });
    check("el selector de tipo abre el wizard en el paso 1", await page.getByRole("button", { name: "Guardar y continuar" }).isVisible());
    await page.getByRole("button", { name: "Guardar y continuar" }).click();
    await page.getByRole("heading", { name: "2. Objetivos" }).waitFor({ timeout: defaultTimeout });
    await page.getByRole("button", { name: "Guardar y continuar" }).click();
    await page.getByText("Revisa los campos marcados antes de guardar.").waitFor({ timeout: defaultTimeout });
    check("el wizard valida campos obligatorios", true);
    await page.getByLabel(/^Objetivo principal/).fill("Generar leads calificados desde la web");
    await page.getByLabel(/^Meta medible/).fill("+30% de leads en 90 días");
    await page.getByRole("button", { name: "Guardar borrador" }).click();
    await page.getByText("Borrador guardado").waitFor({ timeout: defaultTimeout });
    check("guardar borrador marca el paso", true);
    await page.getByRole("button", { name: "Salir del expediente" }).click();
    await page.waitForSelector('[role="dialog"]', { state: "detached", timeout: defaultTimeout });
    await page.getByRole("button", { name: /Continuar expediente|Revisar expediente/ }).click();
    await page.getByRole("dialog").waitFor({ timeout: defaultTimeout });
    const reanudado = await page.getByLabel(/^Objetivo principal/).inputValue();
    check("al reabrir se recuperan los datos del borrador", reanudado === "Generar leads calificados desde la web");
    await page.getByRole("button", { name: "Guardar y continuar" }).click();
    await page.getByRole("heading", { name: "3. Buyer person" }).waitFor({ timeout: defaultTimeout });
    await page.getByLabel(/^Cobertura/).selectOption("nacional");
    await page.getByLabel(/^Perfil demográfico/).fill("30 a 45 años, CDMX, NSE B, dueños de negocio");
    await page.getByLabel(/^Perfil psicográfico/).fill("Quieren crecer sin depender de pauta; valoran lo medible");
    await page.getByRole("button", { name: "Guardar y continuar" }).click();
    await page.getByRole("heading", { name: "4. Presupuesto" }).waitFor({ timeout: defaultTimeout });
    await page.getByLabel(/^Presupuesto total/).fill("15000");
    await page.getByRole("button", { name: "Guardar y continuar" }).click();
    await page.getByRole("heading", { name: "5. Canales y audiencia" }).waitFor({ timeout: defaultTimeout });
    await page.getByLabel("Instagram").check();
    await page.getByRole("button", { name: "Guardar y continuar" }).click();
    await page.getByRole("heading", { name: "6. Plan de contenido" }).waitFor({ timeout: defaultTimeout });
    await page.getByLabel(/^Pilares de contenido/).fill("Educación y casos de éxito");
    await page.getByRole("button", { name: "Guardar y continuar" }).click();
    await page.getByRole("heading", { name: "7. Métricas y reportes" }).waitFor({ timeout: defaultTimeout });
    await page.getByLabel(/^KPIs a perseguir/).fill("CPL y ROAS");
    await page.getByRole("button", { name: "Guardar y continuar" }).click();
    await page.getByRole("heading", { name: "8. Entregables y cierre" }).waitFor({ timeout: defaultTimeout });
    await page.getByRole("button", { name: "Guardar y finalizar" }).click();
    await page.getByRole("heading", { name: "Proyecto finalizado" }).waitFor({ timeout: defaultTimeout });
    check(
      "finalizar muestra el resumen con PDF",
      await page.getByRole("button", { name: "Descargar PDF", exact: true }).isVisible()
    );
    await page.getByRole("button", { name: "Ver expediente" }).click();
    await page.getByText("Completado", { exact: true }).first().waitFor({ timeout: defaultTimeout });
    await page.getByText("8 de 8 pasos completados").waitFor({ timeout: defaultTimeout });
    check("el expediente refleja 8 de 8 y estado Completado", true);
    console.log("Verificando controles PDF en la lista y vista previa…");
    await page.goto(`${base}/projects`, { waitUntil: "domcontentloaded" });
    const verPdfBtn = page.getByRole("button", { name: /^Ver PDF de PRJ-/ }).first();
    await verPdfBtn.waitFor({ timeout: defaultTimeout });
    check("la lista enseña controles de PDF", await page.getByRole("button", { name: /^Descargar PDF de PRJ-/ }).first().isVisible());
    let modalAbierto = false;
    for (let intento = 0; intento < 5 && !modalAbierto; intento++) {
      await verPdfBtn.click();
      try {
        await page.getByRole("dialog", { name: /^Vista previa de/ }).waitFor({ timeout: 5000 });
        modalAbierto = true;
      } catch { await page.waitForTimeout(1000); }
    }
    check("ver PDF abre la vista previa en modal", modalAbierto);
    if (modalAbierto) {
      await page.locator('iframe[title^="Vista previa"]').waitFor({ timeout: defaultTimeout });
      check("el modal carga el PDF en el iframe", true);
      await page.getByRole("button", { name: "Cerrar vista previa" }).click();
      await page.getByRole("dialog", { name: /^Vista previa de/ }).waitFor({ state: "detached", timeout: defaultTimeout });
      check("el modal se cierra", true);
    }

    const wizardProject = (await api("/api/projects?limit=1")).data.projects.find((p) => p.name === `Wizard UI ${suffix}`);
    check("proyecto creado por la UI persiste completado", !!wizardProject && wizardProject.status === "completado" && wizardProject.avance === 100 && wizardProject.projectType === "marketing");
    await browser.close(); browser = null;
  }
  check("eliminar tarea", (await api(`${taskBase}/${taskId}`, "DELETE")).status === 200);
  check("tarea eliminada ya no aparece", !(await api(taskBase)).data.tasks.some((t) => t.id === taskId));
  console.log(`Proyectos y tareas: ${checks}/${checks} comprobaciones correctas`);
} finally {
  await browser?.close();
  if (projectId) await sql`DELETE FROM project WHERE id = ${projectId}`;
  if (secondProjectId) await sql`DELETE FROM project WHERE id = ${secondProjectId}`;
  if (foreignProjectId) await sql`DELETE FROM project WHERE id = ${foreignProjectId}`;
  await sql`DELETE FROM organization WHERE id = ${otherOrg}`;
  await sql`DELETE FROM "user" WHERE id IN (${teamUser}, ${foreignUser})`;
  await sql.end();
}
