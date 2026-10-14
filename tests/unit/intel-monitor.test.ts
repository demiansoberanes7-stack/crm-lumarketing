import { describe, expect, it } from "vitest";
import { findTermByKeyword } from "@/server/intel/terms";

const terms = [
  { id: "itr_1", name: "Cámaras de seguridad", keywords: ["camara de seguridad", "videovigilancia"] },
  { id: "itr_2", name: "Starlink", keywords: ["starlink", "internet satelital"] },
];

describe("findTermByKeyword (dedupe al monitorear)", () => {
  it("encuentra por nombre exacto sin importar acentos ni mayúsculas", () => {
    expect(findTermByKeyword(terms, "STARLINK")?.id).toBe("itr_2");
    expect(findTermByKeyword(terms, "starlink")?.id).toBe("itr_2");
  });
  it("encuentra por keyword del término", () => {
    expect(findTermByKeyword(terms, "videovigilancia")?.id).toBe("itr_1");
  });
  it("una keyword contenida en un nicho mayor reutiliza ese nicho", () => {
    expect(findTermByKeyword(terms, "cámara de seguridad para casa")?.id).toBe("itr_1");
    expect(findTermByKeyword(terms, "internet satelital rural")?.id).toBe("itr_2");
  });
  it("un término mayor contenido en la consulta también cubre", () => {
    expect(findTermByKeyword(terms, "starlink en méxico precio")?.id).toBe("itr_2");
  });
  it("devuelve null si no hay coincidencia (keyword nueva)", () => {
    expect(findTermByKeyword(terms, "impresora 3d")).toBeNull();
    expect(findTermByKeyword(terms, "")).toBeNull();
  });
});
