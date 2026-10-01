import { execFile as nodeExecFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { WakeReason } from "../../../shared/api";
import { KANBAN_BOARD } from "../../../shared/divisions";
import { allTasks, isMandate } from "../../../shared/flow";
import type { KanbanBoard } from "../../../shared/hermes";
import { CEO_PROFILE, type RosterAgent } from "../../../shared/roster";
import type { HermesClient, HomeChannel } from "../hermes/client";
import { TASK_ID } from "../http";

export type ExecFileLike = (file: string, args: readonly string[], options: { timeout: number }) => Promise<unknown>;

export interface CeoWakeOptions {
  hermes: HermesClient;
  execFile?: ExecFileLike;
  /** Defaults to env HERMES_BIN, then ~/.local/bin/hermes. */
  hermesBin?: string;
  log?: (line: string) => void;
}

export interface WakeResult {
  subscribed: boolean;
  reason?: WakeReason;
}

const CLI_TIMEOUT_MS = 20_000;
const FINISHED = new Set(["done", "archived"]);
const defaultExecFile: ExecFileLike = promisify(nodeExecFile);

const CLI_CHAT_TYPES = new Set(["dm", "group", "channel", "thread"]);

/**
 * The wake rebuilds the CEO's session key from the subscription's chat_type, and build_session_key
 * keys a DM differently from a group or thread (kanban_watchers_notifier.py wake, gateway/session.py),
 * so it must match the real chat. The CLI accepts only dm | group | channel | thread
 * (kanban_parser.py notify-subscribe). Use the home channel's own value when it is one of those;
 * when it is null or unknown, infer it the way Telegram encodes chats: a topic thread is "thread",
 * group ids are negative, and a user's private chat (the adapter's "private" → "dm") is positive.
 */
export function telegramChatType(home: HomeChannel): "dm" | "group" | "channel" | "thread" {
  const given = home.chat_type?.trim().toLowerCase();
  if (given && CLI_CHAT_TYPES.has(given)) return given as "dm" | "group" | "channel" | "thread";
  if (home.thread_id) return "thread";
  return home.chat_id.startsWith("-") ? "group" : "dm";
}

/**
 * `hermes kanban --board <slug> notify-subscribe ...`: --board is a `kanban`-level flag
 * (kanban_parser.py:470). The HTTP home-subscribe cannot set delivery_mode, and `wake` injects
 * a turn into the CEO's own Telegram session instead of a passive message (kanban_db_notify.py).
 */
export function ceoWakeArgs(taskId: string, home: HomeChannel): string[] {
  return [
    "kanban",
    "--board",
    KANBAN_BOARD,
    "notify-subscribe",
    taskId,
    "--platform",
    "telegram",
    "--chat-id",
    home.chat_id,
    ...(home.thread_id ? ["--thread-id", home.thread_id] : []),
    "--chat-type",
    telegramChatType(home),
    "--notifier-profile",
    CEO_PROFILE,
    "--delivery-mode",
    "wake",
  ];
}

/** Subscribes the CEO's Telegram session to wake on a mandate's review/blocked/completed events. */
export class CeoWake {
  private readonly execFile: ExecFileLike;
  private readonly bin: string;
  private readonly log: (line: string) => void;
  private readonly done = new Set<string>();

  constructor(private readonly options: CeoWakeOptions) {
    this.execFile = options.execFile ?? defaultExecFile;
    this.bin = options.hermesBin || process.env.HERMES_BIN || join(homedir(), ".local", "bin", "hermes");
    this.log = options.log ?? console.log;
  }

  async telegramHome(): Promise<HomeChannel | null> {
    const homes = await this.options.hermes.homeChannels();
    return homes.find((h) => h.platform === "telegram" && h.chat_id) ?? null;
  }

  /** add_notify_sub is idempotent on (task, platform, chat, thread), so re-subscribing is safe. */
  async subscribe(taskId: string, home?: HomeChannel | null): Promise<WakeResult> {
    if (!TASK_ID.test(taskId) || taskId.startsWith("-")) return { subscribed: false, reason: "invalid-task-id" };
    let target: HomeChannel | null;
    try {
      target = home === undefined ? await this.telegramHome() : home;
    } catch {
      return { subscribed: false, reason: "hermes-unavailable" };
    }
    if (!target) return { subscribed: false, reason: "no-home-channel" };
    try {
      await this.execFile(this.bin, ceoWakeArgs(taskId, target), { timeout: CLI_TIMEOUT_MS });
    } catch (err) {
      this.log(`ceo-wake: subscribe ${taskId} failed (${err instanceof Error ? err.name : "error"})`);
      return { subscribed: false, reason: "cli-failed" };
    }
    this.done.add(taskId);
    return { subscribed: true };
  }

  /** Ensures every open mandate wakes the CEO; once per task per process, retried until it works. */
  async backfill(board: KanbanBoard, roster: readonly RosterAgent[]): Promise<number> {
    const open = allTasks(board).filter((t) => isMandate(t, roster) && !FINISHED.has(t.status) && !this.done.has(t.id));
    if (open.length === 0) return 0;
    const home = await this.telegramHome();
    if (!home) return 0;
    let subscribed = 0;
    for (const task of open) {
      if ((await this.subscribe(task.id, home)).subscribed) {
        subscribed++;
        this.log(`ceo-wake: subscribed ${task.id}`);
      }
    }
    return subscribed;
  }
}
