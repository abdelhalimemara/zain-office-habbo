import type { MiddlewareHandler } from "hono";
import { VOICE_API } from "../../shared/voice";
import { ACCESS_HEADER, type AccessVerifier } from "./access";
import { HttpError } from "./http";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);
const JSON_TYPE = /^application\/json\s*(;.*)?$/i;
const AUDIO_TYPE = /^audio\/[a-z0-9.+-]+\s*(;.*)?$/i;
/** Writes that take a raw recording instead of JSON; audio/* is not a CORS-simple type either. */
const AUDIO_PATHS: ReadonlySet<string> = new Set([VOICE_API.transcribe]);
export const VITE_PORT = 5173;

export interface GuardOptions {
  /** The port this server listens on. */
  port: number;
  /** Extra exact origins, e.g. from ZAIN_ALLOWED_ORIGINS. */
  extraOrigins?: readonly string[];
  /** Remote access through a Cloudflare Tunnel; requests to its host must carry a valid Access token. */
  access?: AccessVerifier | null;
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
 * loopback hosts (defeats DNS rebinding), plus the tunnel host when a request carries a valid Cloudflare
 * Access token, and only accepts JSON writes from known origins
 * (a non-simple content type forces a CORS preflight, which fails since no CORS headers are sent).
 */
export function localOnly(options: GuardOptions): MiddlewareHandler {
  const access = options.access ?? null;
  const origins = allowedOrigins(options);
  if (access) origins.add(`https://${access.config.host}`);
  return async (c, next) => {
    const host = hostname(c.req.header("host") ?? "");
    if (access && host === access.config.host) {
      // Through the tunnel: only requests Cloudflare Access signed for an allowed person.
      if (!(await access.verify(c.req.header(ACCESS_HEADER)))) throw new HttpError(403, "access required");
    } else if (!LOCAL_HOSTS.has(host)) {
      throw new HttpError(403, "forbidden host");
    }
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      const contentType = c.req.header("content-type") ?? "";
      if (AUDIO_PATHS.has(c.req.path)) {
        if (!AUDIO_TYPE.test(contentType)) throw new HttpError(415, "Content-Type must be an audio/* type");
      } else if (!JSON_TYPE.test(contentType)) {
        throw new HttpError(415, "Content-Type must be application/json");
      }
      const origin = c.req.header("origin");
      if (origin !== undefined && !origins.has(origin)) throw new HttpError(403, "forbidden origin");
      if (c.req.header("sec-fetch-site") === "cross-site") throw new HttpError(403, "cross-site request refused");
    }
    await next();
  };
}
