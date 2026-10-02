import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApproveRequest, BoardConsultRequest, CreateMandateRequest, HireRequest } from "@shared/api";
import { api } from "./client";

export const queryKeys = {
  board: ["board"] as const,
  roster: ["roster"] as const,
  health: ["health"] as const,
  headcount: ["headcount-catalog"] as const,
  task: (id: string) => ["task", id] as const,
};

export function useBoard() {
  return useQuery({ queryKey: queryKeys.board, queryFn: api.board, refetchInterval: 3_000 });
}

export function useRoster() {
  return useQuery({ queryKey: queryKeys.roster, queryFn: api.roster });
}

export function useHealth() {
  return useQuery({ queryKey: queryKeys.health, queryFn: api.health, refetchInterval: 10_000 });
}

export function useTaskDetail(id: string) {
  return useQuery({ queryKey: queryKeys.task(id), queryFn: () => api.task(id) });
}

export function useHeadcountCatalog() {
  return useQuery({ queryKey: queryKeys.headcount, queryFn: api.headcountCatalog, staleTime: 60 * 60 * 1000 });
}

export function useCreateMandate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateMandateRequest) => api.createMandate(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.board }),
  });
}

export function useApprove() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note, finalText }: { id: string } & ApproveRequest) =>
      api.approve(id, { ...(note ? { note } : {}), ...(finalText ? { finalText } : {}) }),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.board });
      void qc.invalidateQueries({ queryKey: queryKeys.task(id) });
    },
  });
}

export function useReject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.reject(id, { reason }),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.board });
      void qc.invalidateQueries({ queryKey: queryKeys.task(id) });
    },
  });
}

export function useReopen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, instructions }: { id: string; instructions: string }) => api.reopen(id, { instructions }),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.board });
      void qc.invalidateQueries({ queryKey: queryKeys.task(id) });
    },
  });
}

export function useBoardConsult() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BoardConsultRequest) => api.boardConsult(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.board }),
  });
}

export function useAddComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => api.addComment(id, body),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.board });
      void qc.invalidateQueries({ queryKey: queryKeys.task(id) });
    },
  });
}

export function useHire() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: HireRequest) => api.hire(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.board });
      void qc.invalidateQueries({ queryKey: queryKeys.roster });
    },
  });
}
