import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { HermesError, HermesUnreachableError } from "./hermes/client";

export class HttpError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string) => new HttpError(400, message);

export async function readJsonObject(c: Context): Promise<Record<string, unknown>> {
  let data: unknown;
  try {
    data = await c.req.json();
  } catch {
    throw badRequest("request body must be valid JSON");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw badRequest("request body must be a JSON object");
  return data as Record<string, unknown>;
}

export function requiredString(body: Record<string, unknown>, field: string, min: number, max: number): string {
  const value = body[field];
  if (typeof value !== "string") throw badRequest(`${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw badRequest(`${field} must be ${min}..${max} characters`);
  }
  return trimmed;
}

export function optionalString(body: Record<string, unknown>, field: string, max: number): string | undefined {
  if (body[field] === undefined || body[field] === null) return undefined;
  const value = requiredString(body, field, 0, max);
  return value === "" ? undefined : value;
}

const TASK_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function taskIdParam(c: Context): string {
  const id = c.req.param("id") ?? "";
  if (!TASK_ID.test(id)) throw badRequest("invalid task id");
  return id;
}

export function errorResponse(err: unknown, c: Context): Response {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
  if (err instanceof HermesUnreachableError) return c.json({ error: err.message }, 502);
  if (err instanceof HermesError) {
    if (err.status === 401 || err.status === 403) return c.json({ error: "Hermes rejected the session token" }, 502);
    const status = err.status === 404 || err.status === 409 || err.status === 400 ? err.status : 502;
    return c.json({ error: err.detail }, status);
  }
  console.error("Unhandled server error", err instanceof Error ? err.message : err);
  return c.json({ error: "internal server error" }, 500);
}
