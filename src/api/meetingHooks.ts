import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BoardMeeting, FounderRemarkRequest, StartMeetingRequest } from "@shared/meetings";
import { api } from "./client";

export const meetingKeys = {
  list: ["meetings"] as const,
  one: (id: string) => ["meeting", id] as const,
};

export const MEETING_POLL_ACTIVE_MS = 5_000;
export const MEETING_POLL_IDLE_MS = 30_000;

const SETTLED: ReadonlySet<BoardMeeting["status"]> = new Set(["concluded", "cancelled"]);

export function isMeetingActive(m: Pick<BoardMeeting, "status">): boolean {
  return !SETTLED.has(m.status);
}

/** Poll fast while any meeting is still running, slowly once they have all settled. */
export function meetingsPollInterval(meetings: readonly Pick<BoardMeeting, "status">[] | undefined): number {
  return meetings?.some(isMeetingActive) ? MEETING_POLL_ACTIVE_MS : MEETING_POLL_IDLE_MS;
}

export function useMeetings() {
  return useQuery({
    queryKey: meetingKeys.list,
    queryFn: api.meetings,
    refetchInterval: (query) => meetingsPollInterval(query.state.data?.meetings),
  });
}

export function useMeeting(id: string) {
  return useQuery({
    queryKey: meetingKeys.one(id),
    queryFn: () => api.meeting(id),
    refetchInterval: (query) => meetingsPollInterval(query.state.data ? [query.state.data.meeting] : undefined),
  });
}

function useInvalidateMeetings() {
  const qc = useQueryClient();
  return (id?: string) => {
    void qc.invalidateQueries({ queryKey: meetingKeys.list });
    if (id) void qc.invalidateQueries({ queryKey: meetingKeys.one(id) });
  };
}

export function useStartMeeting() {
  const invalidate = useInvalidateMeetings();
  return useMutation({
    mutationFn: (input: StartMeetingRequest) => api.startMeeting(input),
    onSuccess: (data) => invalidate(data.meeting.id),
  });
}

export function useFounderRemark() {
  const invalidate = useInvalidateMeetings();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string } & FounderRemarkRequest) => api.founderRemark(id, input),
    onSuccess: (_data, { id }) => invalidate(id),
  });
}

export function useCancelMeeting() {
  const invalidate = useInvalidateMeetings();
  return useMutation({
    mutationFn: (id: string) => api.cancelMeeting(id),
    onSuccess: (_data, id) => invalidate(id),
  });
}
