import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { api, qs } from '../../../api/client';

/** GET /api/evidence/<path>. The path and params form the query key, so two panels asking the same question share one answer. */
export function useEvidence<T>(path: string, params?: Record<string, string | undefined>): UseQueryResult<T> {
  // Undefined and empty values are not part of the question: {from: undefined} and {} are the same key.
  const clean = Object.fromEntries(Object.entries(params ?? {}).filter(([, v]) => v !== undefined && v !== ''));
  return useQuery({ queryKey: ['evidence', path, clean], queryFn: () => api.get<T>(`/evidence/${path}${qs(clean)}`) });
}
