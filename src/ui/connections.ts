import type { Connection, ConnectionKind, ConnectionStatus } from "@shared/api";

export const CONNECTION_GROUPS: readonly { kind: ConnectionKind; label: string }[] = [
  { kind: "channel", label: "Channels" },
  { kind: "mcp", label: "MCP" },
  { kind: "cli", label: "CLI" },
];

export const STATUS_META: Record<ConnectionStatus, { label: string; icon: string }> = {
  ok: { label: "OK", icon: "✓" },
  warn: { label: "Needs attention", icon: "!" },
  error: { label: "Error", icon: "✕" },
  off: { label: "Off", icon: "–" },
};

const SEVERITY: Record<ConnectionStatus, number> = { off: 0, ok: 1, warn: 2, error: 3 };

/** Worst status among the connections; "off" only when every one is off (or there are none). */
export function worstStatus(connections: readonly Pick<Connection, "status">[]): ConnectionStatus {
  return connections.reduce<ConnectionStatus>((worst, c) => (SEVERITY[c.status] > SEVERITY[worst] ? c.status : worst), "off");
}

export interface ConnectionGroup {
  kind: ConnectionKind;
  label: string;
  status: ConnectionStatus;
  connections: Connection[];
  counts: Record<ConnectionStatus, number>;
}

const RANK: Record<ConnectionStatus, number> = { error: 0, warn: 1, ok: 2, off: 3 };

export function groupConnections(connections: readonly Connection[]): ConnectionGroup[] {
  return CONNECTION_GROUPS.map(({ kind, label }) => {
    const list = connections
      .filter((c) => c.kind === kind)
      .sort((a, b) => RANK[a.status] - RANK[b.status] || a.name.localeCompare(b.name));
    const counts = { ok: 0, warn: 0, error: 0, off: 0 };
    for (const c of list) counts[c.status]++;
    return { kind, label, status: worstStatus(list), connections: list, counts };
  });
}

/** "2 errors, 1 needs attention, 3 OK" — for screen readers and tooltips. */
export function describeCounts(counts: Record<ConnectionStatus, number>): string {
  const parts = [
    counts.error && `${counts.error} ${counts.error === 1 ? "error" : "errors"}`,
    counts.warn && `${counts.warn} ${counts.warn === 1 ? "needs" : "need"} attention`,
    counts.ok && `${counts.ok} OK`,
    counts.off && `${counts.off} off`,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "none configured";
}

export function checkedAgo(at: number, now: number): string {
  const s = Math.max(0, Math.round(now - (at > 1e12 ? at / 1000 : at)));
  if (s < 60) return `checked ${s}s ago`;
  if (s < 3600) return `checked ${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `checked ${Math.floor(s / 3600)}h ago`;
  return `checked ${Math.floor(s / 86400)}d ago`;
}
