import type { MiddlewareHandler } from "hono";
import { HttpError } from "./http";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);
const JSON_TYPE = /^application\/json\s*(;.*)?$/i;
export const VITE_PORT = 5173;

export interface GuardOptions {
  /** The port this server listens on. */
  port: number;
  /** Extra exact origins, e.g. from ZAIN_ALLOWED_ORIGINS. */
  extraOrigins?: readonly string[];
}

export function allowedOrigins({ port, extraOrigins = [] }: GuardOptions): Set<string> {
  const ports = [...new Set([VITE_PORT, port])];
  return new Set([...ports.flatMap((p) => [`http://127.0.0.1:${p}`, `http://localhost:${p}`]), ...extraOrigins]);
}

export function parseOriginList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

function hostname(host: string): string {
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return "";
  }
}

/**
 * The server holds a Hermes token and can create mandates and profiles, so it only serves
 * loopback hosts (defeats DNS rebinding) and only accepts JSON writes from known local origins
 * (a non-simple content type forces a CORS preflight, which fails since no CORS headers are sent).
 */
export function localOnly(options: GuardOptions): MiddlewareHandler {
  const origins = allowedOrigins(options);
  return async (c, next) => {
    if (!LOCAL_HOSTS.has(hostname(c.req.header("host") ?? ""))) throw new HttpError(403, "forbidden host");
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      if (!JSON_TYPE.test(c.req.header("content-type") ?? "")) {
        throw new HttpError(415, "Content-Type must be application/json");
      }
      const origin = c.req.header("origin");
      if (origin !== undefined && !origins.has(origin)) throw new HttpError(403, "forbidden origin");
      if (c.req.header("sec-fetch-site") === "cross-site") throw new HttpError(403, "cross-site request refused");
    }
    await next();
  };
}
