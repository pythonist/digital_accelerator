import { create } from 'zustand';
import muleApi from '../services/muleApi';

export const useMuleStore = create((set, get) => ({
  envId: localStorage.getItem('activeEnvId') || 'fcip_env',
  hasData: false,
  hasModel: false,
  dataStats: null,
  loadingStatus: false,
  statusError: null,
  accounts: [],
  loadingAccounts: false,
  accountsError: null,
  selectedAccountId: localStorage.getItem('mule_selected_account') || '',
  selectedAccountIds: (() => {
    try {
      const raw = localStorage.getItem('mule_selected_accounts');
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch {}
    const single = localStorage.getItem('mule_selected_account') || '';
    return single ? [single] : [];
  })(),
  investigationOpen: false,

  setEnvId: (envId) => {
    const next = envId || 'fcip_env';
    localStorage.setItem('activeEnvId', next);
    set({ envId: next });
  },

  setSelectedAccountId: (accountId) => {
    const next = accountId || '';
    localStorage.setItem('mule_selected_account', next);
    const nextList = next ? [next] : [];
    localStorage.setItem('mule_selected_accounts', JSON.stringify(nextList));
    set({ selectedAccountId: next, selectedAccountIds: nextList });
  },

  setSelectedAccountIds: (accountIds) => {
    const list = Array.isArray(accountIds) ? accountIds.filter(Boolean) : [];
    localStorage.setItem('mule_selected_accounts', JSON.stringify(list));
    const primary = list[0] || '';
    localStorage.setItem('mule_selected_account', primary);
    set({ selectedAccountIds: list, selectedAccountId: primary });
  },

  openInvestigation: (accountId = null) => {
    if (accountId != null) {
      const next = accountId || '';
      localStorage.setItem('mule_selected_account', next);
      const nextList = next ? [next] : [];
      localStorage.setItem('mule_selected_accounts', JSON.stringify(nextList));
      set({ selectedAccountId: next, selectedAccountIds: nextList, investigationOpen: true });
      return;
    }
    set({ investigationOpen: true });
  },

  closeInvestigation: () => set({ investigationOpen: false }),

  loadAccounts: async () => {
    set({ loadingAccounts: true, accountsError: null });
    try {
      const res = await muleApi.getAccounts();
      const list = res?.accounts || res?.data?.accounts || res?.results || res?.account_ids || [];
      const accounts = Array.isArray(list)
        ? list
            .map((a) => (typeof a === 'string' ? { account_id: a } : a))
            .filter((a) => a && a.account_id)
        : [];
      set({ accounts });
      const sel = get().selectedAccountId;
      if (!sel && accounts.length) {
        localStorage.setItem('mule_selected_account', accounts[0].account_id);
        const nextList = [accounts[0].account_id];
        localStorage.setItem('mule_selected_accounts', JSON.stringify(nextList));
        set({ selectedAccountId: accounts[0].account_id, selectedAccountIds: nextList });
      }
    } catch (e) {
      set({ accounts: [], accountsError: e?.message || 'Failed to load accounts' });
    } finally {
      set({ loadingAccounts: false });
    }
  },

  refreshStatus: async () => {
    set({ loadingStatus: true, statusError: null });
    try {
      const res = await muleApi.getDataStatus();
      set({
        hasData: Boolean(res?.has_data),
        hasModel: Boolean(res?.has_ml_model),
        dataStats: res?.stats || null,
      });
    } catch (e) {
      set({
        hasData: false,
        hasModel: false,
        dataStats: null,
        statusError: e?.message || 'Failed to load status',
      });
    } finally {
      set({ loadingStatus: false });
    }
  },
}));
