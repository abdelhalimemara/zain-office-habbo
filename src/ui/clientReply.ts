import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CLIENT_REPLY_PREFIX } from "@shared/flow";
import type { KanbanTask } from "@shared/hermes";
import { api } from "../api/client";
import { queryKeys } from "../api/hooks";

export type ClientChannel = "email" | "whatsapp";

export const CHANNEL_LABEL: Record<ClientChannel, string> = { email: "Email", whatsapp: "WhatsApp" };

export interface ClientReplyDetails {
  client: string | null;
  topic: string | null;
  channel: ClientChannel | null;
  message: string | null;
  draft: string | null;
  reason: string | null;
}

type Field = "channel" | "client" | "message" | "draft" | "reason";

const LABELS: readonly [Field, RegExp][] = [
  ["channel", /^(?:client\s+)?channel$/],
  ["message", /^(?:the\s+)?(?:client'?s?\s+|their\s+|original\s+|inbound\s+|incoming\s+)?message(?:\s+from\s+.+)?$|^client\s+wrote$/],
  ["draft", /^(?:my\s+|your\s+)?(?:proposed|draft|suggested)(?:\s+(?:reply|response|answer))?$|^(?:draft\s+)?reply(?:\s+to\s+send)?$/],
  ["reason", /^why(?:\s+(?:it|this))?(?:\s+needs?)?(?:\s+hq)?\s*approval(?:\s+is\s+needed)?$|^why$|^reason(?:\s+for\s+approval)?$|^approval\s+reason$/],
  ["client", /^client(?:\s+name)?$|^from$|^customer$/],
];

function fieldFor(label: string): Field | null {
  const key = label.trim().toLowerCase().replace(/\s+/g, " ");
  return LABELS.find(([, re]) => re.test(key))?.[0] ?? null;
}

const LABEL_LINE = /^\s*(?:#{1,6}\s*)?(?:[-*•]\s+)?([A-Za-z][A-Za-z' ]{0,40}?)\s*(?::\s*(.*)|\s*$)$/;

function clean(value: string): string | null {
  const text = value
    .split("\n")
    .map((l) => l.replace(/^\s*>\s?/, ""))
    .join("\n")
    .trim()
    .replace(/^["“](.*)["”]$/s, "$1")
    .trim();
  return text || null;
}

/** Splits a free-form "Client reply" body on labelled lines ("Channel: email", "**Proposed reply:**", "## Why approval"). */
export function parseClientReplyBody(body: string | null | undefined): Partial<Record<Field, string>> {
  const out: Partial<Record<Field, string>> = {};
  if (!body) return out;
  let current: Field | null = null;
  let buffer: string[] = [];
  const flush = () => {
    if (current && out[current] === undefined) {
      const value = clean(buffer.join("\n"));
      if (value) out[current] = value;
    }
    buffer = [];
  };
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/\*\*|__/g, "");
    const m = LABEL_LINE.exec(line);
    const field = m ? fieldFor(m[1]!) : null;
    const isHeading = /^\s*#{1,6}\s/.test(line);
    if (field && (m![2] !== undefined || isHeading)) {
      flush();
      current = field;
      const colon = raw.indexOf(":");
      const value = colon < 0 ? "" : raw.slice(colon + 1).replace(/^\s*(?:\*\*|__)?\s*/, "");
      if (value) buffer.push(value);
    } else if (current) {
      buffer.push(raw);
    }
  }
  flush();
  return out;
}

function channelOf(text: string | undefined): ClientChannel | null {
  if (!text) return null;
  if (/whats\s*app/i.test(text)) return "whatsapp";
  if (/e-?mail/i.test(text)) return "email";
  return null;
}

/** Everything HQ needs to decide on a client reply; missing pieces are null, never guessed. */
export function parseClientReply(task: Pick<KanbanTask, "title" | "body" | "latest_summary" | "result">): ClientReplyDetails {
  const rest = task.title.startsWith(CLIENT_REPLY_PREFIX) ? task.title.slice(CLIENT_REPLY_PREFIX.length).trim() : task.title.trim();
  const [client, ...topic] = rest.split(/\s+[—–]\s+|\s+-\s+/);
  const body = parseClientReplyBody(task.body);
  return {
    client: client?.trim() || body.client || null,
    topic: topic.join(" — ").trim() || null,
    channel: channelOf(body.channel),
    message: body.message ?? null,
    draft: task.latest_summary?.trim() || task.result?.trim() || body.draft || null,
    reason: body.reason ?? null,
  };
}

export function useApproveClientReply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, finalText }: { id: string; finalText?: string }) => api.approve(id, finalText === undefined ? {} : { finalText }),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.board });
      void qc.invalidateQueries({ queryKey: queryKeys.task(id) });
    },
  });
}
