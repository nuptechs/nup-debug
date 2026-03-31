import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

export function useSessions() {
  return useQuery({
    queryKey: ['sessions'],
    queryFn: api.sessions.list,
    refetchInterval: 5000,
  });
}

export function useSession(id: string) {
  return useQuery({
    queryKey: ['sessions', id],
    queryFn: () => api.sessions.get(id),
    refetchInterval: 3000,
    enabled: !!id,
  });
}

export function useSessionEvents(sessionId: string, params?: { source?: string; type?: string; limit?: number }) {
  return useQuery({
    queryKey: ['events', sessionId, params],
    queryFn: () => api.events.list(sessionId, params),
    refetchInterval: 5000,
    enabled: !!sessionId,
  });
}

export function useTimeline(sessionId: string) {
  return useQuery({
    queryKey: ['timeline', sessionId],
    queryFn: () => api.events.timeline(sessionId),
    enabled: !!sessionId,
  });
}

export function useCreateSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config?: Record<string, unknown>) => api.sessions.create(config),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['sessions'] }); },
  });
}

export function useDeleteSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.sessions.delete(id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['sessions'] }); },
  });
}

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: api.health.check,
    refetchInterval: 10000,
  });
}
