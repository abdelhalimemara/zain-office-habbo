/** Report dates in Riyadh time: "26 Sep 2026" and "September 2026" (en-GB would print "Sept"). */
const TZ = "Asia/Riyadh";

function parts(at: Date): { day: string; month: string; long: string; year: string } {
  const get = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { ...opts, timeZone: TZ }).format(at);
  return { day: get({ day: "numeric" }), month: get({ month: "short" }), long: get({ month: "long" }), year: get({ year: "numeric" }) };
}

export function shortDate(at: Date | number | string): string {
  const d = at instanceof Date ? at : new Date(typeof at === "string" && /^\d{4}-\d{2}-\d{2}$/.test(at) ? `${at}T12:00:00Z` : at);
  const p = parts(d);
  return `${p.day} ${p.month} ${p.year}`;
}

export function monthYear(at: Date): string {
  const p = parts(at);
  return `${p.long} ${p.year}`;
}
