import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AssignActionsRequest, StartLeadershipRequest, UpdateActionsRequest } from "@shared/leadership";
import { api } from "./client";
import { queryKeys } from "./hooks";
import { meetingKeys, useInvalidateMeetings } from "./meetingHooks";

export function useStartLeadership() {
  const invalidate = useInvalidateMeetings();
  return useMutation({
    mutationFn: (input: StartLeadershipRequest) => api.startLeadership(input),
    onSuccess: (data) => invalidate(data.meeting.id),
  });
}

export function useUpdateActions(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateActionsRequest) => api.updateActions(id, input),
    onSuccess: (data) => {
      qc.setQueryData(meetingKeys.one(id), { meeting: data.meeting });
      void qc.invalidateQueries({ queryKey: meetingKeys.list });
    },
  });
}

/** Assigning creates mandates, so the kanban board is refreshed too. */
export function useAssignActions(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AssignActionsRequest) => api.assignActions(id, input),
    onSuccess: (data) => {
      qc.setQueryData(meetingKeys.one(id), { meeting: data.meeting });
      void qc.invalidateQueries({ queryKey: meetingKeys.list });
      void qc.invalidateQueries({ queryKey: queryKeys.board });
    },
  });
}
