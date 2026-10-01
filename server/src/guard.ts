import type { MiddlewareHandler } from "hono";
import { HttpError } from "./http";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);
const LOCAL_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?$/;
const JSON_TYPE = /^application\/json\s*(;.*)?$/i;

function hostname(host: string): string {
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return "";
  }
}

/**
 * The server holds a Hermes token and can create mandates and profiles, so it only serves
 * loopback hosts (defeats DNS rebinding) and only accepts JSON writes from a local origin
 * (a non-simple content type forces a CORS preflight, which fails since no CORS headers are sent).
 */
export const localOnly: MiddlewareHandler = async (c, next) => {
  if (!LOCAL_HOSTS.has(hostname(c.req.header("host") ?? ""))) throw new HttpError(403, "forbidden host");
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    if (!JSON_TYPE.test(c.req.header("content-type") ?? "")) {
      throw new HttpError(415, "Content-Type must be application/json");
    }
    const origin = c.req.header("origin");
    if (origin !== undefined && !LOCAL_ORIGIN.test(origin)) throw new HttpError(403, "forbidden origin");
    if (c.req.header("sec-fetch-site") === "cross-site") throw new HttpError(403, "cross-site request refused");
  }
  await next();
};
