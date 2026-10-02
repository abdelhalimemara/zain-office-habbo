import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

export const memoryKeys = {
  all: ["board-memory"] as const,
};

export function useBoardMemory() {
  return useQuery({ queryKey: memoryKeys.all, queryFn: api.boardMemory, refetchInterval: 60_000 });
}

export function useDeleteMemoryNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ profile, id }: { profile: string; id: string }) => api.deleteMemoryNote(profile, id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: memoryKeys.all }),
  });
}
