import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { api, qs } from '../../../api/client';

/** GET /api/evidence/<path>. The path and params form the query key, so two panels asking the same question share one answer. */
export function useEvidence<T>(path: string, params?: Record<string, string | undefined>, options: { enabled?: boolean } = {}): UseQueryResult<T> {
  // Undefined and empty values are not part of the question: {from: undefined} and {} are the same key.
  const clean = Object.fromEntries(Object.entries(params ?? {}).filter(([, v]) => v !== undefined && v !== ''));
  return useQuery({ queryKey: ['evidence', path, clean], queryFn: () => api.get<T>(`/evidence/${path}${qs(clean)}`), enabled: options.enabled ?? true });
}

/**
 * For the endpoints that answer { definition, provenance, data }. A response whose `data` is missing is treated as a failed
 * load (error state with Retry) rather than drawn as empty or zero, and the sections read every field defensively besides.
 */
export function useEnvelope<T extends { data?: unknown }>(path: string, params?: Record<string, string | undefined>, options: { enabled?: boolean } = {}): UseQueryResult<T> {
  const q = useEvidence<T>(path, params, options);
  const d = q.data?.data;
  const malformed = q.isSuccess && (typeof d !== 'object' || d === null);
  return malformed ? ({ ...q, isError: true, isSuccess: false } as unknown as UseQueryResult<T>) : q;
}
