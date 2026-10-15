import { describe, expect, it } from "vitest";
import { readLimitedBody, requestClientKey } from "@/lib/http/body";

describe("readLimitedBody", () => {
  it("devuelve el cuerpo cuando está dentro del límite", async () => {
    const req = new Request("http://localhost/x", { method: "POST", body: "hola" });
    expect(await readLimitedBody(req, 100)).toBe("hola");
  });

  it("rechaza (null) cuando el stream excede el límite", async () => {
    const req = new Request("http://localhost/x", { method: "POST", body: "x".repeat(200) });
    expect(await readLimitedBody(req, 100)).toBeNull();
  });

  it("rechaza (null) de inmediato si content-length ya declara exceso", async () => {
    const req = new Request("http://localhost/x", {
      method: "POST",
      headers: { "content-length": "999" },
      body: "x".repeat(999),
    });
    expect(await readLimitedBody(req, 10)).toBeNull();
  });

  it("sin cuerpo devuelve cadena vacía", async () => {
    const req = new Request("http://localhost/x", { method: "POST" });
    expect(await readLimitedBody(req, 100)).toBe("");
  });
});

describe("requestClientKey", () => {
  it("prefiere x-real-ip", () => {
    const req = new Request("http://localhost/x", {
      headers: { "x-real-ip": "10.0.0.1", "x-forwarded-for": "1.2.3.4" },
    });
    expect(requestClientKey(req)).toBe("10.0.0.1");
  });

  it("usa el ÚLTIMO hop de x-forwarded-for (el que agrega el proxy)", () => {
    const req = new Request("http://localhost/x", {
      headers: { "x-forwarded-for": "falso-cliente, 172.16.0.9" },
    });
    expect(requestClientKey(req)).toBe("172.16.0.9");
  });

  it("sin headers devuelve unknown", () => {
    expect(requestClientKey(new Request("http://localhost/x"))).toBe("unknown");
  });
});
