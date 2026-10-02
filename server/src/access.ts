import { createPublicKey, verify, type JsonWebKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Remote access through a Cloudflare Tunnel. Cloudflare Access sits in front of the public hostname and
 * signs every request it lets through (Cf-Access-Jwt-Assertion); the server checks that signature itself,
 * so a misconfigured Access policy or a request that bypasses Cloudflare still gets nothing.
 */
export interface AccessConfig {
  /** Public hostname served through the tunnel, e.g. "hq.zain-studio.com". */
  host: string;
  /** Cloudflare Zero Trust team domain, e.g. "zain.cloudflareaccess.com". */
  teamDomain: string;
  /** The Access application's AUD tag. */
  aud: string;
  /** Emails allowed in, lowercase. */
  emails: string[];
}

interface Jwk extends JsonWebKey {
  kid?: string;
}

export type CertFetcher = (teamDomain: string) => Promise<Jwk[]>;

const CERT_TTL_MS = 60 * 60 * 1000;
const CLOCK_SKEW_S = 60;
const HOST_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/;
const TEAM_RE = /^[a-z0-9-]+\.cloudflareaccess\.com$/;
const AUD_RE = /^[a-f0-9]{32,128}$/;

export const ACCESS_HEADER = "cf-access-jwt-assertion";

/** Reads .zain/tunnel.json; null when remote access is not set up. Throws on a half-valid file (fail closed). */
export function loadAccessConfig(root: string): AccessConfig | null {
  let raw: string;
  try {
    raw = readFileSync(join(root, ".zain", "tunnel.json"), "utf8");
  } catch {
    return null;
  }
  return parseAccessConfig(JSON.parse(raw) as Record<string, unknown>);
}

export function parseAccessConfig(data: Record<string, unknown>): AccessConfig {
  const host = String(data.host ?? "").toLowerCase();
  const teamDomain = String(data.teamDomain ?? "").toLowerCase();
  const aud = String(data.aud ?? "").toLowerCase();
  const emails = Array.isArray(data.emails) ? data.emails.map((e) => String(e).trim().toLowerCase()).filter(Boolean) : [];
  if (!HOST_RE.test(host)) throw new Error("tunnel.json: host must be a hostname");
  if (!TEAM_RE.test(teamDomain)) throw new Error("tunnel.json: teamDomain must be <team>.cloudflareaccess.com");
  if (!AUD_RE.test(aud)) throw new Error("tunnel.json: aud must be the Access application's AUD tag");
  if (emails.length === 0) throw new Error("tunnel.json: emails must list at least one allowed email");
  return { host, teamDomain, aud, emails };
}

export const fetchCerts: CertFetcher = async (teamDomain) => {
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Access certs: HTTP ${res.status}`);
  const body = (await res.json()) as { keys?: Jwk[] };
  return body.keys ?? [];
};

function b64url(part: string): Buffer {
  return Buffer.from(part, "base64url");
}

export class AccessVerifier {
  private certs: { keys: Jwk[]; at: number } | null = null;

  constructor(
    readonly config: AccessConfig,
    private readonly getCerts: CertFetcher = fetchCerts,
    private readonly now: () => number = Date.now,
  ) {}

  /** The verified email, or null when the token is missing, forged, expired, for another app or another person. */
  async verify(token: string | undefined): Promise<string | null> {
    if (!token) return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [h, p, s] = parts as [string, string, string];
    let header: { alg?: string; kid?: string };
    let payload: { aud?: string | string[]; iss?: string; exp?: number; nbf?: number; email?: string };
    try {
      header = JSON.parse(b64url(h).toString("utf8"));
      payload = JSON.parse(b64url(p).toString("utf8"));
    } catch {
      return null;
    }
    if (header.alg !== "RS256" || !header.kid) return null;
    const key = await this.key(header.kid);
    if (!key) return null;
    const signed = verify("RSA-SHA256", Buffer.from(`${h}.${p}`), createPublicKey({ key, format: "jwk" }), b64url(s));
    if (!signed) return null;
    const nowS = this.now() / 1000;
    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!auds.includes(this.config.aud)) return null;
    if (payload.iss !== `https://${this.config.teamDomain}`) return null;
    if (typeof payload.exp !== "number" || payload.exp < nowS - CLOCK_SKEW_S) return null;
    if (typeof payload.nbf === "number" && payload.nbf > nowS + CLOCK_SKEW_S) return null;
    const email = payload.email?.toLowerCase();
    return email && this.config.emails.includes(email) ? email : null;
  }

  private async key(kid: string): Promise<Jwk | null> {
    const fresh = this.certs && this.now() - this.certs.at < CERT_TTL_MS;
    let found = fresh ? this.certs!.keys.find((k) => k.kid === kid) : undefined;
    if (found) return found;
    // Unknown kid or stale cache: Cloudflare rotates keys, so refetch once.
    try {
      this.certs = { keys: await this.getCerts(this.config.teamDomain), at: this.now() };
    } catch {
      return null;
    }
    found = this.certs.keys.find((k) => k.kid === kid);
    return found ?? null;
  }
}
