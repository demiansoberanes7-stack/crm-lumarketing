import { describe, expect, it } from "vitest";
import { diagnosticError, diagnosticMetadata, errorCode } from "@/server/diagnostics/redact";

describe("diagnóstico técnico seguro", () => {
  it("conserva identificadores operativos y elimina query strings de URLs", () => {
    const metadata = diagnosticMetadata({
      taskId: "task_123",
      webhookId: "wh_456",
      event: "quote.created",
      attempts: 3,
      url: "https://hooks.example.test/api/callback?token=do-not-store&access_token=also-secret",
      error: "HTTP 403: access_token=private-value",
      authorization: "Bearer must-not-be-stored",
    });

    expect(metadata).toMatchObject({
      taskId: "task_123",
      webhookId: "wh_456",
      event: "quote.created",
      attempts: 3,
      endpoint: "https://hooks.example.test",
    });
    expect(metadata.errorMessage).toContain("[redacted]");
    expect(JSON.stringify(metadata)).not.toContain("do-not-store");
    expect(JSON.stringify(metadata)).not.toContain("private-value");
    expect(JSON.stringify(metadata)).not.toContain("must-not-be-stored");
  });

  it("guarda causa, status, código y fbtrace_id, pero redacta secretos del mensaje y stack", () => {
    const error = Object.assign(
      new Error("Meta respondió access_token=private-value"),
      {
        status: 403,
        code: 200,
        type: "OAuthException",
        error_subcode: 1234,
        fbtrace_id: "trace-reference",
        cause: new Error("Bearer another-private-value"),
      }
    );
    error.stack = `${error.name}: ${error.message}\n    at send (src/server/send.ts:12:3)\n    at https://api.example.test/send?token=query-secret`;

    const details = diagnosticError(error);
    const json = JSON.stringify(details);
    expect(details).toMatchObject({
      name: "Error",
      status: 403,
      code: 200,
      type: "OAuthException",
      error_subcode: 1234,
      fbtrace_id: "trace-reference",
    });
    expect(errorCode(error)).toBe("200");
    expect(json).toContain("[redacted]");
    expect(json).not.toContain("private-value");
    expect(json).not.toContain("query-secret");
  });
});
