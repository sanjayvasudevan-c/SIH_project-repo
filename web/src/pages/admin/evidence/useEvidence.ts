import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { api, qs } from '../../../api/client';

/** GET /api/evidence/<path>. The path and params form the query key, so two panels asking the same question share one answer. */
export function useEvidence<T>(path: string, params?: Record<string, string | undefined>): UseQueryResult<T> {
  return useQuery({ queryKey: ['evidence', path, params ?? {}], queryFn: () => api.get<T>(`/evidence/${path}${qs(params ?? {})}`) });
}
