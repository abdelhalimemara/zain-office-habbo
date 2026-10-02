import { nameFromDomain } from "./benchmark";
import { CostCapReached } from "./budget";
import { type Candidate, MAX_NEIGHBOURS, MIN_SEMRUSH_PEERS, categoryTerms, isRelevant, mergeCandidates, neighbourCandidates } from "./collect/peers";
import { collectSearch, pickCompetitors } from "./collect/search";
import { buildSeo, keywordOverlap, rankingKeywords, semrushAudit, semrushNumbers, semrushProspect } from "./collect/seo";
import { asOfLabel, type Outcome, type StepContext } from "./steps";
import { siteHost } from "./url";
import type { SeoData, StoredAudit } from "./types";

const failure = (label: string, err: unknown) => (err instanceof CostCapReached ? err.message : `${label} failed (${(err as Error).message.slice(0, 60)})`);

/**
 * Semrush first (the home-page audit and the prospect's domain read, together): its keywords become the
 * category searches and its organic competitors (keyword overlap) the first competitor candidates. Then the
 * brand and category searches, whose competitors are the fallback, then Semrush's numbers for the candidates.
 */
export async function searchStep(s: StoredAudit, ctx: StepContext): Promise<Outcome> {
  const p = s.audit.prospect;
  const asOf = s.data.asOf ?? asOfLabel(s.audit.createdAt);
  const host = siteHost(p.website);
  let costUsd = 0;
  const notes: string[] = [];
  const settle = <T extends { costUsd: number }>(r: PromiseSettledResult<T>, label: string): T | undefined => {
    if (r.status === "fulfilled") {
      costUsd += r.value.costUsd;
      return r.value;
    }
    costUsd += (r.reason as { costUsd?: number }).costUsd ?? 0;
    notes.push(failure(label, r.reason));
    return undefined;
  };
  const [auditRun, prospectRun] = await Promise.allSettled([semrushAudit(s.id, p.website, ctx.budget), semrushProspect(s.id, p.website, ctx.budget)]);
  const auditItem = settle(auditRun, "Semrush audit")?.item;
  const prospectItem = settle(prospectRun, "Semrush")?.item;
  const semrush = (auditItem?.semrush ?? {}) as { top_organic_keywords?: { keyword?: string; volume?: number }[] };
  const keywords = (semrush.top_organic_keywords ?? [])
    .filter((k) => typeof k.keyword === "string")
    .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
    .map((k) => k.keyword!);
  const serp = settle((await Promise.allSettled([collectSearch(s.id, p, s.data.website, ctx.budget, p.category ? [] : keywords)]))[0], "Searches");
  if (serp) notes.unshift(serp.note);
  const overlap = keywordOverlap(prospectItem, auditItem);
  const candidates: Candidate[] = mergeCandidates(overlap, pickCompetitors(p, serp?.data), host).map((c) => ({ ...c, name: nameFromDomain(c.domain) }));
  let seo: SeoData | undefined;
  if (prospectItem || auditItem) {
    let numbers: SeoData["competitors"] = {};
    const lookup = async (domains: string[]) => {
      try {
        const r = await semrushNumbers(s.id, domains, ctx.budget);
        numbers = { ...numbers, ...r.numbers };
        costUsd += r.costUsd;
        return r.items;
      } catch (err) {
        costUsd += (err as { costUsd?: number }).costUsd ?? 0;
        notes.push(failure("Semrush competitors", err));
        return {};
      }
    };
    const items = await lookup(candidates.map((c) => c.domain));
    // Too few of the prospect's own keyword competitors: those of the Saudi candidates stand in (peers.ts).
    if (candidates.filter((c) => c.source === "semrush").length < MIN_SEMRUSH_PEERS) {
      // Seeds must rank for the category themselves (their Semrush keywords match it), or their neighbours are another trade's.
      const terms = categoryTerms(serp?.data?.runs ?? []);
      const seeds = candidates
        .filter((c) => items[c.domain] && isRelevant(rankingKeywords(items[c.domain]).join(" \n "), terms))
        .map((c) => ({ domain: c.domain, overlap: keywordOverlap(items[c.domain], undefined) }));
      const neighbours = neighbourCandidates(seeds, candidates, host, MAX_NEIGHBOURS).map((c) => ({ ...c, name: nameFromDomain(c.domain) }));
      if (neighbours.length) {
        await lookup(neighbours.map((c) => c.domain));
        candidates.unshift(...neighbours);
      }
    }
    seo = buildSeo(prospectItem, auditItem, numbers, asOf);
    notes.push(`Semrush authority ${seo.read.authorityScore ?? "—"}`);
  }
  if (!serp && !seo) throw Object.assign(new Error(notes.join("; ")), { costUsd });
  const bySemrush = candidates.filter((c) => c.source === "semrush").length;
  notes.push(`${candidates.length} competitor candidates (${bySemrush} by keyword overlap): ${candidates.map((c) => (c.via ? `${c.domain} (via ${c.via})` : c.domain)).join(", ") || "none found"}`);
  return {
    status: "done",
    note: notes.join("; "),
    costUsd,
    patch: (x) => {
      if (serp) {
        x.data.search = serp.data;
        x.audit.searchRuns = serp.data!.runs;
      }
      if (seo) {
        x.data.seo = seo;
        x.audit.seo = seo.read;
      }
      x.data.competitors = candidates;
    },
  };
}
