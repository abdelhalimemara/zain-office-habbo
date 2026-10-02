import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { badRequest } from "../../http";

/** Resolves a host name to its addresses (node:dns in production, a stub in tests). */
export type Resolver = (host: string) => Promise<string[]>;

export const dnsResolver: Resolver = async (host) => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home", ".corp", ".intranet", ".arpa"];

function ipv4Private(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number) as [number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/** Loopback, private, link-local, CGNAT, multicast and reserved ranges, IPv4 and IPv6 (incl. v4-mapped). */
export function isPrivateAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(ip) === 4) return ipv4Private(ip);
  if (isIP(ip) !== 6) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped) return ipv4Private(mapped[1]!);
  if (ip === "::" || ip === "::1") return true;
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(ip) || ip.startsWith("::ffff:") || ip.startsWith("64:ff9b:");
}

/**
 * A prospect's website as an absolute http(s) URL (a bare domain gets https://). Refuses credentials,
 * odd ports, IP literals and host names that are, or resolve to, private addresses: Apify and Chrome
 * fetch what we pass on, and the URL comes from the browser or an agent.
 */
export async function validateWebsite(input: string, resolve: Resolver = dnsResolver): Promise<string> {
  const raw = input.trim();
  if (!raw || raw.length > 2048) throw badRequest("website must be a URL");
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw badRequest("website must be a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw badRequest("website must use http or https");
  if (url.username || url.password) throw badRequest("website must not contain credentials");
  if (url.port && url.port !== "80" && url.port !== "443") throw badRequest("website must use the default port");
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (isIP(host.replace(/^\[|\]$/g, ""))) throw badRequest("website must be a domain name, not an IP address");
  if (!host.includes(".") || host === "localhost" || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    throw badRequest("website must be a public domain");
  }
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    throw badRequest(`website host ${host} does not resolve`);
  }
  if (addresses.length === 0) throw badRequest(`website host ${host} does not resolve`);
  if (addresses.some(isPrivateAddress)) throw badRequest("website must be a public domain");
  url.hash = "";
  return url.toString();
}

/** The registrable-ish host used to match search results: lower case, without "www.". */
export function siteHost(website: string): string {
  try {
    return new URL(website).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** True when `url` is on the prospect's host or one of its subdomains. */
export function onHost(url: string, host: string): boolean {
  const h = siteHost(url.includes("://") ? url : `https://${url}`);
  return !!host && (h === host || h.endsWith(`.${host}`));
}
