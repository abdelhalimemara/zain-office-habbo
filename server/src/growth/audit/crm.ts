import { join } from "node:path";
import type { AuditProspect } from "../../../../shared/audits";
import { hermesHome } from "../../clientChannels/hermesPaths";
import { readEnvKey, redact } from "../../connections/run";
import type { FetchLike } from "../../hermes/client";
import { HttpError } from "../../http";
import type { CrmFlags } from "./types";

export const CRM_BASE = "https://crm.zain-studio.com";
const TIMEOUT_MS = 30_000;
/** Twenty's standard attachment.file (FILES) field; the same id in every workspace. */
export const ATTACHMENT_FILE_FIELD = "20202020-15db-460e-8166-c7b5d87ad4be";
export const CRM_NOT_CONNECTED = "The CRM is not connected (ZAIN_CRM_API_KEY)";
export const CRM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CrmRecordKind = "lead" | "company";

export interface CrmProspect {
  prospect: Partial<AuditProspect> & { name: string };
  flags: CrmFlags;
}

/** A CRM record the New audit form can start from (src/api/client.ts ProspectHit on the UI side). */
export interface ProspectHit {
  id: string;
  kind: CrmRecordKind;
  name: string;
  website?: string;
  instagram?: string;
  tiktok?: string;
  facebook?: string;
  x?: string;
  linkedin?: string;
  city?: string;
}

export const PROSPECT_SEARCH_LIMIT = 10;

export interface CrmAttachment {
  fileId: string;
  attachmentId: string;
}

/** What the audit needs from the CRM; tests swap in a fake. */
export interface AuditCrm {
  prospect(kind: CrmRecordKind, id: string): Promise<CrmProspect>;
  /** Leads and companies whose name contains `q` (most recently updated first); recent ones when `q` is empty. */
  search(q: string): Promise<ProspectHit[]>;
  uploadPdf(name: string, pdf: Buffer): Promise<string>;
  attach(kind: CrmRecordKind, id: string, name: string, fileId: string): Promise<string>;
  note(kind: CrmRecordKind, id: string, title: string, markdown: string): Promise<string>;
  recordUrl(kind: CrmRecordKind, id: string): string;
}

export function envCrmKey(home = hermesHome()): () => Promise<string | null> {
  return () => readEnvKey(join(home, ".env"), "ZAIN_CRM_API_KEY");
}

type Json = Record<string, unknown>;
const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const link = (v: unknown) => s((v as { primaryLinkUrl?: unknown } | null)?.primaryLinkUrl);
const withScheme = (url: string | undefined) => (url && !/^https?:\/\//i.test(url) ? `https://${url}` : url);

/** Twenty CRM over REST (records) and the metadata GraphQL endpoint (file upload); verified on crm.zain-studio.com. */
export class TwentyCrm implements AuditCrm {
  constructor(
    private readonly key: () => Promise<string | null>,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
    private readonly base = CRM_BASE,
  ) {}

  async prospect(kind: CrmRecordKind, id: string): Promise<CrmProspect> {
    if (!CRM_ID.test(id)) throw new HttpError(400, `${kind}Id must be a CRM record id`);
    const data = await this.rest<Json>("GET", `/rest/${kind === "lead" ? "leads" : "companies"}/${id}`);
    const r = ((data.data as Json | undefined)?.[kind] ?? {}) as Json;
    if (!s(r.name)) throw new HttpError(404, `CRM ${kind} ${id} not found`);
    if (kind === "lead") {
      return {
        prospect: {
          name: s(r.name)!,
          website: withScheme(link(r.websiteUrl)),
          leadId: id,
          city: s(r.city),
          category: s(r.category),
          instagram: s(r.instagramHandle),
          tiktok: s(r.tiktokHandle),
          facebook: s(r.facebookPageUrl),
        },
        flags: {
          hasPixel: r.hasPixel === true ? true : undefined,
          hasGoogleTagManager: r.hasGoogleTagManager === true ? true : undefined,
          metaAdLibraryUrl: s(r.metaAdLibraryUrl),
        },
      };
    }
    const address = (r.address ?? {}) as Json;
    return {
      prospect: {
        name: s(r.name)!,
        website: withScheme(link(r.domainName)),
        companyId: id,
        city: s(address.addressCity),
        linkedin: link(r.linkedinLink),
        x: link(r.xLink),
      },
      flags: {},
    };
  }

  async search(q: string): Promise<ProspectHit[]> {
    // Twenty's filter grammar quotes the value; quotes, backslashes and wildcards in the query are dropped.
    const term = q.replace(/["\\%_]/g, " ").replace(/\s+/g, " ").trim();
    const query = (limit: number) =>
      `limit=${limit}&order_by=${encodeURIComponent("updatedAt[DescNullsLast]")}${term ? `&filter=${encodeURIComponent(`name[ilike]:"%${term}%"`)}` : ""}`;
    const [leads, companies] = await Promise.all([
      this.rest<Json>("GET", `/rest/leads?${query(PROSPECT_SEARCH_LIMIT)}`),
      this.rest<Json>("GET", `/rest/companies?${query(PROSPECT_SEARCH_LIMIT)}`),
    ]);
    const rows = (data: Json, key: string) => (((data.data as Json | undefined)?.[key] ?? []) as Json[]).filter((r) => s(r.id) && s(r.name));
    const fromLead = (r: Json): ProspectHit => ({
      id: s(r.id)!,
      kind: "lead",
      name: s(r.name)!,
      website: withScheme(link(r.websiteUrl)),
      instagram: s(r.instagramHandle),
      tiktok: s(r.tiktokHandle),
      facebook: s(r.facebookPageUrl),
      city: s(r.city),
    });
    const fromCompany = (r: Json): ProspectHit => ({
      id: s(r.id)!,
      kind: "company",
      name: s(r.name)!,
      website: withScheme(link(r.domainName)),
      x: link(r.xLink),
      linkedin: link(r.linkedinLink),
      city: s((r.address as Json | undefined)?.addressCity),
    });
    const a = rows(leads, "leads").map(fromLead);
    const b = rows(companies, "companies").map(fromCompany);
    // Interleaved so neither kind crowds the other out of the ten.
    const out: ProspectHit[] = [];
    for (let i = 0; out.length < PROSPECT_SEARCH_LIMIT && (i < a.length || i < b.length); i++) {
      if (a[i]) out.push(a[i]!);
      if (b[i] && out.length < PROSPECT_SEARCH_LIMIT) out.push(b[i]!);
    }
    return out.map((h) => Object.fromEntries(Object.entries(h).filter(([, v]) => v !== undefined)) as unknown as ProspectHit);
  }

  /** Uploads to the attachment file field (GraphQL multipart); returns the file id. */
  async uploadPdf(name: string, pdf: Buffer): Promise<string> {
    const form = new FormData();
    form.set(
      "operations",
      JSON.stringify({
        query: `mutation($file: Upload!) { uploadFilesFieldFileByUniversalIdentifier(file: $file, fieldMetadataUniversalIdentifier: "${ATTACHMENT_FILE_FIELD}") { id path } }`,
        variables: { file: null },
      }),
    );
    form.set("map", JSON.stringify({ 0: ["variables.file"] }));
    form.set("0", new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), name);
    const data = await this.call<{ data?: { uploadFilesFieldFileByUniversalIdentifier?: { id?: string } }; errors?: { message: string }[] }>("POST", "/metadata", form);
    const id = data.data?.uploadFilesFieldFileByUniversalIdentifier?.id;
    if (!id) throw new Error(`CRM upload failed${data.errors?.[0] ? `: ${redact(data.errors[0].message)}` : ""}`);
    return id;
  }

  async attach(kind: CrmRecordKind, id: string, name: string, fileId: string): Promise<string> {
    const data = await this.rest<{ data: { createAttachment: { id: string } } }>("POST", "/rest/attachments", {
      name,
      file: [{ fileId, label: name }],
      [kind === "lead" ? "targetLeadId" : "targetCompanyId"]: id,
    });
    return data.data.createAttachment.id;
  }

  async note(kind: CrmRecordKind, id: string, title: string, markdown: string): Promise<string> {
    const note = await this.rest<{ data: { createNote: { id: string } } }>("POST", "/rest/notes", { title, bodyV2: { markdown } });
    const noteId = note.data.createNote.id;
    await this.rest("POST", "/rest/noteTargets", { noteId, [kind === "lead" ? "targetLeadId" : "targetCompanyId"]: id });
    return noteId;
  }

  recordUrl(kind: CrmRecordKind, id: string): string {
    return `${this.base}/object/${kind}/${id}`;
  }

  private rest<T>(method: string, path: string, body?: unknown): Promise<T> {
    return this.call<T>(method, path, body === undefined ? undefined : JSON.stringify(body));
  }

  private async call<T>(method: string, path: string, body?: string | FormData): Promise<T> {
    const key = await this.key();
    if (!key) throw new HttpError(502, CRM_NOT_CONNECTED);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}${path}`, {
        method,
        headers: { Authorization: `Bearer ${key}`, ...(typeof body === "string" ? { "Content-Type": "application/json" } : {}) },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new HttpError(502, `The CRM is unreachable (${err instanceof Error ? err.name : "error"})`);
    }
    const text = await res.text();
    let data: unknown = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      // Error pages are not JSON.
    }
    if (res.status === 404) throw new HttpError(404, "CRM record not found");
    if (res.status === 401 || res.status === 403) throw new HttpError(502, "The CRM rejected the API key");
    if (!res.ok) {
      const messages = (data as { messages?: string[] }).messages;
      throw new HttpError(502, `CRM ${res.status}: ${redact(messages?.[0] ?? res.statusText, [key])}`);
    }
    return data as T;
  }
}
