import { describe, expect, it } from "vitest";
import { hasIdKind, newId } from "@/lib/db/ids";

describe("prefijos de ID", () => {
  it("reconoce los IDs persistidos de tareas de proyecto con su prefijo canónico", () => {
    const id = newId("projectTask");
    expect(id).toMatch(/^prjt_[a-z0-9]{20}$/);
    expect(hasIdKind(id, "projectTask")).toBe(true);
    expect(hasIdKind("ct_contacto", "projectTask")).toBe(false);
  });
});
