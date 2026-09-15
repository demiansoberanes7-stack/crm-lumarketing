import { apiError } from "@/lib/api";

export class ProjectError extends Error {
  constructor(public status: number | string, message: string) { super(message); }
}

export function projectErrorResponse(error: unknown): Response {
  if (error instanceof ProjectError) {
    const status = typeof error.status === "number" ? error.status : 400;
    return apiError(status, "project_error", error.message);
  }
  throw error;
}
