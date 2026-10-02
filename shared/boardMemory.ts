/**
 * Board memory: what each board member keeps from earlier meetings, so the founder never has to repeat himself.
 * Members write 1–3 durable insights in a MEMORY block when they vote; the server keeps them per member in
 * `.zain/board-memory/<profile>.json`. The founder can read and delete them from the Board panel.
 */

export interface MemoryNote {
  /** "note_" + 10 hex characters. */
  id: string;
  text: string;
  /** Unix seconds. */
  at: number;
  meetingId?: string;
  meetingTopic?: string;
}

export interface MemberMemory {
  profile: string;
  /** Newest first. */
  notes: MemoryNote[];
}

export interface BoardMemoryResponse {
  members: MemberMemory[];
}

export const BOARD_MEMORY_API = {
  /** GET → BoardMemoryResponse, one entry per board seat. */
  list: "/api/board/memory",
  /** DELETE → 204. */
  note: (profile: string, id: string) => `/api/board/memory/${encodeURIComponent(profile)}/notes/${encodeURIComponent(id)}`,
} as const;

export const MEMORY_NOTE_ID = /^note_[a-f0-9]{10}$/;
export const MEMORY_NOTE_MAX = 280;
/** Insights taken from one vote. */
export const MEMORY_NOTES_PER_VOTE = 3;
/** Notes kept per member; the oldest go first. */
export const MEMORY_NOTES_PER_MEMBER = 40;
