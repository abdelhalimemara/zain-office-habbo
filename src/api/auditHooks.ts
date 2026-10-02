import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AuditResponse, StartAuditRequest } from "@shared/audits";
import { auditsPollInterval } from "../ui/auditModel";
import { api } from "./client";

export const auditKeys = {
  list: ["audits"] as const,
  one: (id: string) => ["audit", id] as const,
  prospects: (q: string) => ["prospects", q] as const,
};

export function useAudits() {
  return useQuery({
    queryKey: auditKeys.list,
    queryFn: api.audits,
    refetchInterval: (query) => auditsPollInterval(query.state.data?.audits),
  });
}

export function useAudit(id: string) {
  return useQuery({
    queryKey: auditKeys.one(id),
    queryFn: () => api.audit(id),
    refetchInterval: (query) => auditsPollInterval(query.state.data ? [query.state.data.audit] : undefined),
  });
}

/** CRM leads and companies matching `q`; an empty query lists recent ones. */
export function useProspectSearch(q: string, enabled = true) {
  return useQuery({
    queryKey: auditKeys.prospects(q),
    queryFn: () => api.prospects(q),
    enabled,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

function useStoreAudit() {
  const qc = useQueryClient();
  return (data: AuditResponse) => {
    qc.setQueryData(auditKeys.one(data.audit.id), data);
    void qc.invalidateQueries({ queryKey: auditKeys.list });
  };
}

export function useStartAudit() {
  const store = useStoreAudit();
  return useMutation({ mutationFn: (input: StartAuditRequest) => api.startAudit(input), onSuccess: store });
}

export function useRetryAudit(id: string) {
  const store = useStoreAudit();
  return useMutation({ mutationFn: () => api.retryAudit(id), onSuccess: store });
}

export function useCancelAudit(id: string) {
  const store = useStoreAudit();
  return useMutation({ mutationFn: () => api.cancelAudit(id), onSuccess: store });
}
