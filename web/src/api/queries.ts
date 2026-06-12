import {
  keepPreviousData, useMutation, useQuery, useQueryClient,
} from '@tanstack/react-query';
import type {
  DashboardSummaryDto, HistoryDto, HistoryRange, HoldingDetailDto, HoldingDto,
  LegacySnapshotDto, RecurringDto, SessionUser, SettingsDto, SymbolLookupDto,
} from '@api';
import { api, ApiError } from './client.js';

export type HoldingKind = 'assets' | 'liabilities';

// ---------- auth ----------

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async (): Promise<SessionUser | null> => {
      try {
        const res = await api<{ user: SessionUser }>('/api/auth/me');
        return res.user;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (creds: { username: string; password: string }) =>
      api<{ user: SessionUser }>('/api/auth/login', { method: 'POST', body: creds }),
    onSuccess: (data) => {
      qc.setQueryData(['me'], data.user);
      void qc.invalidateQueries();
    },
  });
}

export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { username: string; password: string; displayName?: string }) =>
      api<{ user: SessionUser }>('/api/auth/register', { method: 'POST', body: input }),
    onSuccess: (data) => {
      qc.setQueryData(['me'], data.user);
      void qc.invalidateQueries();
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>('/api/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      qc.setQueryData(['me'], null);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    },
  });
}

// ---------- dashboard ----------

export function useSummary() {
  return useQuery({
    queryKey: ['dashboard', 'summary'],
    queryFn: () => api<DashboardSummaryDto>('/api/dashboard/summary'),
  });
}

export function useHistory(range: HistoryRange) {
  return useQuery({
    queryKey: ['dashboard', 'history', range],
    queryFn: () => api<HistoryDto>(`/api/dashboard/history?range=${range}`),
    placeholderData: keepPreviousData,
  });
}

// ---------- holdings (assets / liabilities) ----------

export function useHoldings(kind: HoldingKind) {
  return useQuery({
    queryKey: ['holdings', kind],
    queryFn: () => api<HoldingDto[]>(`/api/${kind}`),
  });
}

export function useHoldingDetail(kind: HoldingKind, id: number | null) {
  return useQuery({
    queryKey: ['holdings', kind, id],
    queryFn: () => api<HoldingDetailDto>(`/api/${kind}/${id}`),
    enabled: id !== null,
  });
}

function useInvalidatePortfolio() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['holdings'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
    void qc.invalidateQueries({ queryKey: ['recurring'] });
  };
}

export interface HoldingInput {
  category: string;
  name: string;
  notes?: string | null;
  metal?: string | null;
  valueMinor?: number;
  valuationMode?: 'manual' | 'market';
  marketSymbol?: string | null;
  quantity?: number | null;
}

export function useCreateHolding(kind: HoldingKind) {
  const invalidate = useInvalidatePortfolio();
  return useMutation({
    mutationFn: (input: HoldingInput) => api<HoldingDto>(`/api/${kind}`, { method: 'POST', body: input }),
    onSuccess: invalidate,
  });
}

export function useUpdateHolding(kind: HoldingKind) {
  const invalidate = useInvalidatePortfolio();
  return useMutation({
    mutationFn: ({ id, ...patch }: Partial<HoldingInput> & { id: number }) =>
      api<HoldingDto>(`/api/${kind}/${id}`, { method: 'PATCH', body: patch }),
    onSuccess: invalidate,
  });
}

export function useDeleteHolding(kind: HoldingKind) {
  const invalidate = useInvalidatePortfolio();
  return useMutation({
    mutationFn: (id: number) => api<void>(`/api/${kind}/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

export function useRevalueHolding(kind: HoldingKind) {
  const invalidate = useInvalidatePortfolio();
  return useMutation({
    mutationFn: ({ id, valueMinor }: { id: number; valueMinor: number }) =>
      api<HoldingDto>(`/api/${kind}/${id}/valuations`, { method: 'POST', body: { valueMinor } }),
    onSuccess: invalidate,
  });
}

// ---------- recurring ----------

export function useRecurring() {
  return useQuery({
    queryKey: ['recurring'],
    queryFn: () => api<RecurringDto[]>('/api/recurring'),
  });
}

export interface RecurringInput {
  name: string;
  targetType: 'asset' | 'liability';
  targetId: number;
  amountMinor: number;
  cadence: string;
  nextRunOn: string;
}

export function useCreateRecurring() {
  const invalidate = useInvalidatePortfolio();
  return useMutation({
    mutationFn: (input: RecurringInput) => api<RecurringDto>('/api/recurring', { method: 'POST', body: input }),
    onSuccess: invalidate,
  });
}

export function useUpdateRecurring() {
  const invalidate = useInvalidatePortfolio();
  return useMutation({
    mutationFn: ({ id, ...patch }: Partial<Omit<RecurringInput, 'targetType' | 'targetId'>> & { id: number; active?: boolean }) =>
      api<RecurringDto>(`/api/recurring/${id}`, { method: 'PATCH', body: patch }),
    onSuccess: invalidate,
  });
}

export function useDeleteRecurring() {
  const invalidate = useInvalidatePortfolio();
  return useMutation({
    mutationFn: (id: number) => api<void>(`/api/recurring/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

// ---------- settings & market ----------

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => api<SettingsDto>('/api/settings'),
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: { displayName?: string; currency?: string; birthYear?: number | null }) =>
      api<SettingsDto>('/api/settings', { method: 'PATCH', body: patch }),
    onSuccess: () => {
      void qc.invalidateQueries();
    },
  });
}

// ---------- legacy wealth ----------

export function useLegacyWealth() {
  return useQuery({
    queryKey: ['history', 'legacy'],
    queryFn: () => api<LegacySnapshotDto[]>('/api/history/legacy'),
  });
}

export function useSetLegacyWealth() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { date: string; netWorthMinor: number }) =>
      api<LegacySnapshotDto>('/api/history/legacy', { method: 'POST', body: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['history'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useDeleteLegacyWealth() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (date: string) => api<void>(`/api/history/legacy/${date}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['history'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

/** Resolve a ticker to its instrument name (asset-creation verification). */
export function useSymbolLookup() {
  return useMutation({
    mutationFn: (symbol: string) =>
      api<SymbolLookupDto>(`/api/market/lookup?symbol=${encodeURIComponent(symbol)}`),
  });
}

export function useMarketRefresh() {
  const invalidate = useInvalidatePortfolio();
  return useMutation({
    mutationFn: () => api<{ updated: number }>('/api/market/refresh', { method: 'POST' }),
    onSuccess: invalidate,
  });
}
