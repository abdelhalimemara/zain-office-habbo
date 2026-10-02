import { AUDIT_MAX_COST_USD } from "../../../../shared/audits";
import type { ActorRunner, ActorRunResult } from "./apify";

/** One Apify actor as the audit uses it; prices from the Apify Store (see ACTORS.md). */
export interface ActorSpec {
  id: string;
  maxItems: number;
  /** Passed to Apify as maxTotalChargeUsd and reserved from the audit's budget while the run lasts. */
  maxChargeUsd: number;
  timeoutSecs: number;
  memoryMbytes?: number;
  /** Price per result/event and per start, for when Apify's run cost is lower than the charge. */
  perItemUsd: number;
  startUsd: number;
}

/**
 * Google Search and Google Maps refuse a maxTotalChargeUsd under $0.50, so they reserve that much and are
 * held down by maxItems instead (they cost cents).
 */
export const ACTORS = {
  website: { id: "apify/playwright-scraper", maxItems: 20, maxChargeUsd: 0.3, timeoutSecs: 360, memoryMbytes: 4096, perItemUsd: 0.003, startUsd: 0 },
  competitorHomes: { id: "apify/playwright-scraper", maxItems: 6, maxChargeUsd: 0.1, timeoutSecs: 240, memoryMbytes: 2048, perItemUsd: 0.003, startUsd: 0 },
  serp: { id: "apify/google-search-scraper", maxItems: 10, maxChargeUsd: 0.5, timeoutSecs: 300, perItemUsd: 0.0045, startUsd: 0.001 },
  semrush: { id: "pro100chok/semrush-scraper", maxItems: 7, maxChargeUsd: 0.05, timeoutSecs: 300, perItemUsd: 0.0045, startUsd: 0 },
  semrushAudit: { id: "pro100chok/semrush-scraper", maxItems: 1, maxChargeUsd: 0.02, timeoutSecs: 300, perItemUsd: 0.0045, startUsd: 0 },
  instagram: { id: "apify/instagram-profile-scraper", maxItems: 7, maxChargeUsd: 0.05, timeoutSecs: 240, perItemUsd: 0.0026, startUsd: 0 },
  tiktok: { id: "clockworks/tiktok-profile-scraper", maxItems: 15, maxChargeUsd: 0.08, timeoutSecs: 240, perItemUsd: 0.003, startUsd: 0 },
  facebookPage: { id: "apify/facebook-pages-scraper", maxItems: 1, maxChargeUsd: 0.05, timeoutSecs: 180, perItemUsd: 0.012, startUsd: 0 },
  facebookPosts: { id: "apify/facebook-posts-scraper", maxItems: 10, maxChargeUsd: 0.08, timeoutSecs: 240, perItemUsd: 0.005, startUsd: 0.001 },
  metaAds: { id: "apify/facebook-ads-scraper", maxItems: 40, maxChargeUsd: 0.25, timeoutSecs: 300, perItemUsd: 0.0058, startUsd: 0 },
  googleAds: { id: "scrapesage/google-ads-transparency-scraper", maxItems: 80, maxChargeUsd: 0.2, timeoutSecs: 300, perItemUsd: 0.002, startUsd: 0 },
  similarweb: { id: "pro100chok/similarweb-scraper", maxItems: 7, maxChargeUsd: 0.05, timeoutSecs: 240, perItemUsd: 0.0019, startUsd: 0 },
  maps: { id: "compass/crawler-google-places", maxItems: 1, maxChargeUsd: 0.5, timeoutSecs: 240, perItemUsd: 0.0035, startUsd: 0 },
} as const satisfies Record<string, ActorSpec>;

export type ActorKey = keyof typeof ACTORS;

export class CostCapReached extends Error {
  constructor(cap = AUDIT_MAX_COST_USD) {
    super(`Cost cap reached ($${cap})`);
  }
}

/**
 * The per-audit spend ledger. A run reserves its maxTotalChargeUsd up front, so concurrent steps can
 * never together go over the cap; when the run ends the reservation becomes what it actually cost.
 */
export class Budget {
  private readonly spent = new Map<string, number>();
  private readonly reserved = new Map<string, number>();

  constructor(
    private readonly runner: ActorRunner,
    private readonly cap = AUDIT_MAX_COST_USD,
  ) {}

  /** Starts from the audit's recorded spend unless runs for it are under way. */
  open(auditId: string, recordedUsd: number): void {
    if ((this.reserved.get(auditId) ?? 0) > 0) return;
    this.spent.set(auditId, recordedUsd);
  }

  remaining(auditId: string): number {
    return this.cap - (this.spent.get(auditId) ?? 0) - (this.reserved.get(auditId) ?? 0);
  }

  /** Runs the actor within the remaining budget; throws CostCapReached instead of starting a run that could exceed it. */
  async run(auditId: string, key: ActorKey, input: Record<string, unknown>): Promise<ActorRunResult> {
    const spec: ActorSpec = ACTORS[key];
    const charge = Math.min(spec.maxChargeUsd, this.remaining(auditId));
    if (charge < spec.maxChargeUsd / 2 || charge <= 0) throw new CostCapReached(this.cap);
    this.reserved.set(auditId, (this.reserved.get(auditId) ?? 0) + charge);
    let cost = charge;
    try {
      const result = await this.runner.run(spec.id, input, {
        maxItems: spec.maxItems,
        maxTotalChargeUsd: charge,
        timeoutSecs: spec.timeoutSecs,
        memoryMbytes: spec.memoryMbytes,
      });
      // Apify stops pay-per-event actors at maxTotalChargeUsd; the compute-billed crawler is bounded by its timeout and memory.
      cost = Math.min(charge, Math.max(result.costUsd, spec.startUsd + result.items.length * spec.perItemUsd));
      return { ...result, costUsd: round(cost) };
    } catch (err) {
      // A failed run may still have been charged; assume what it reported, else the start fee.
      const reported = (err as { costUsd?: number }).costUsd;
      cost = Math.min(charge, typeof reported === "number" ? reported : spec.startUsd);
      throw Object.assign(err as Error, { costUsd: round(cost) });
    } finally {
      this.reserved.set(auditId, (this.reserved.get(auditId) ?? 0) - charge);
      this.spent.set(auditId, (this.spent.get(auditId) ?? 0) + cost);
    }
  }
}

export const round = (usd: number) => Math.round(usd * 10_000) / 10_000;
