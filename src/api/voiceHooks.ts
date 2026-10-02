import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

export const voiceKeys = {
  voices: ["voices"] as const,
};

export function useVoices(enabled = true) {
  return useQuery({ queryKey: voiceKeys.voices, queryFn: api.voices, staleTime: 60_000, enabled });
}

export function useSetVoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ profile, voiceId }: { profile: string; voiceId: string | null }) => api.setVoice(profile, { voiceId }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: voiceKeys.voices }),
  });
}

export function useTranscribe() {
  return useMutation({ mutationFn: ({ audio, contentType }: { audio: Blob; contentType: string }) => api.transcribe(audio, contentType) });
}
