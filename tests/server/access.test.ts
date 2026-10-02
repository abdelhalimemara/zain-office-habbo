import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { AccessVerifier, parseAccessConfig, type AccessConfig } from "../../server/src/access";
import { KANBAN, setup } from "./helpers";

const config: AccessConfig = {
  host: "hq.zain-studio.com",
  teamDomain: "zain.cloudflareaccess.com",
  aud: "a".repeat(64),
  emails: ["founder@example.com"],
};
const NOW = 1_800_000_000_000;

function keyPair(kid: string) {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return { kid, privateKey, jwk: { ...publicKey.export({ format: "jwk" }), kid } };
}
const good = keyPair("k1");
const other = keyPair("k2");

function jwt(claims: Record<string, unknown>, key: KeyObject = good.privateKey, header: Record<string, unknown> = { alg: "RS256", kid: "k1" }) {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const body = `${enc(header)}.${enc(claims)}`;
  return `${body}.${sign("RSA-SHA256", Buffer.from(body), key).toString("base64url")}`;
}
const valid = {
  aud: [config.aud],
  iss: "https://zain.cloudflareaccess.com",
  exp: NOW / 1000 + 600,
  nbf: NOW / 1000 - 10,
  email: "Founder@Example.com",
};

function verifier(keys = [good.jwk]) {
  const fetches: string[] = [];
  const v = new AccessVerifier(config, async (team) => (fetches.push(team), keys), () => NOW);
  return { v, fetches };
}

describe("Cloudflare Access verification", () => {
  it("accepts a token Access signed for an allowed email", async () => {
    const { v, fetches } = verifier();
    expect(await v.verify(jwt(valid))).toBe("founder@example.com");
    expect(await v.verify(jwt(valid))).toBe("founder@example.com");
    expect(fetches).toEqual(["zain.cloudflareaccess.com"]);
  });

  it.each([
    ["no token", undefined],
    ["garbage", "not.a.jwt"],
    ["another app", jwt({ ...valid, aud: ["b".repeat(64)] })],
    ["another team", jwt({ ...valid, iss: "https://evil.cloudflareaccess.com" })],
    ["expired", jwt({ ...valid, exp: NOW / 1000 - 3600 })],
    ["not yet valid", jwt({ ...valid, nbf: NOW / 1000 + 3600 })],
    ["another person", jwt({ ...valid, email: "someone@example.com" })],
    ["forged signature", jwt(valid, other.privateKey)],
    ["alg none", jwt(valid, good.privateKey, { alg: "none", kid: "k1" })],
    ["unknown key", jwt(valid, other.privateKey, { alg: "RS256", kid: "k2" })],
  ])("refuses %s", async (_label, token) => {
    expect(await verifier().v.verify(token)).toBeNull();
  });

  it("refetches the certs when Cloudflare rotates keys", async () => {
    let keys = [good.jwk];
    const fetches: string[] = [];
    const v = new AccessVerifier(config, async (team) => (fetches.push(team), keys), () => NOW);
    expect(await v.verify(jwt(valid))).toBe("founder@example.com");
    keys = [other.jwk];
    expect(await v.verify(jwt(valid, other.privateKey, { alg: "RS256", kid: "k2" }))).toBe("founder@example.com");
    expect(fetches).toHaveLength(2);
  });

  it("rejects a half-valid tunnel config instead of opening up", () => {
    expect(() => parseAccessConfig({ ...config, aud: "" })).toThrow(/aud/);
    expect(() => parseAccessConfig({ ...config, emails: [] })).toThrow(/emails/);
    expect(() => parseAccessConfig({ ...config, teamDomain: "evil.com" })).toThrow(/teamDomain/);
    expect(parseAccessConfig({ ...config, emails: [" Founder@Example.com "] }).emails).toEqual(["founder@example.com"]);
  });
});

describe("guard with remote access", () => {
  const board = { columns: [], tenants: [], assignees: [], latest_event_id: 0, now: 1 };
  function app() {
    const { v } = verifier();
    return setup({ [`GET ${KANBAN}/board`]: () => board }, { guard: { port: 8787, access: v } });
  }

  it("serves the tunnel host only with a valid Access token", async () => {
    const { send, hermesFetch } = app();
    const denied = await send("GET", "/api/board", undefined, { Host: config.host });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: "access required" });
    const forged = await send("GET", "/api/board", undefined, { Host: config.host, "Cf-Access-Jwt-Assertion": jwt(valid, other.privateKey) });
    expect(forged.status).toBe(403);
    expect(hermesFetch.calls).toHaveLength(0);
    const ok = await send("GET", "/api/board", undefined, { Host: config.host, "Cf-Access-Jwt-Assertion": jwt(valid) });
    expect(ok.status).toBe(200);
  });

  it("still serves loopback and still refuses other hosts", async () => {
    const { send } = app();
    expect((await send("GET", "/api/board", undefined, { Host: "127.0.0.1:8787" })).status).toBe(200);
    expect((await send("GET", "/api/board", undefined, { Host: "attacker.com", "Cf-Access-Jwt-Assertion": jwt(valid) })).status).toBe(403);
  });

  it("accepts writes from the tunnel origin", async () => {
    const { send } = app();
    const res = await send("POST", "/api/mandates", { division: "tech", title: "x" }, {
      Host: config.host,
      Origin: `https://${config.host}`,
      "Cf-Access-Jwt-Assertion": jwt(valid),
    });
    expect(res.status).not.toBe(403);
  });
});
