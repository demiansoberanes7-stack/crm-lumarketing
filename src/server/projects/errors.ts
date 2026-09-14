import { apiError } from "@/lib/api";

export class ProjectError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function projectErrorResponse(error: unknown): Response {
  if (error instanceof ProjectError) return apiError(error.status, "project_error", error.message);
  throw error;
}
