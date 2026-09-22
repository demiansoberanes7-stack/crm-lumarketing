import { requireSession } from "@/lib/auth/session";
import { getCalTodoTasks, getCalTodoSettings } from "@/server/caltodo/store";
import { TodoPageClient } from "./todo-page-client";

export const dynamic = "force-dynamic";

export default async function TodoPage() {
  const session = await requireSession();
  const [tasks, settings] = await Promise.all([
    getCalTodoTasks(session.userId, session.organizationId),
    getCalTodoSettings(session.userId, session.organizationId),
  ]);
  return <TodoPageClient initialTasks={tasks} initialSettings={settings} />;
}
