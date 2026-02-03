// frontend/src/tools/btsy/context/SnapshotContext.jsx
import React, { createContext, useContext, useState, useEffect } from 'react';
import btsyApi from '../services/btsyApi';

const SnapshotContext = createContext();

export const useSnapshot = () => {
  const context = useContext(SnapshotContext);
  if (!context) {
    throw new Error('useSnapshot must be used within SnapshotProvider');
  }
  return context;
};

export const SnapshotProvider = ({ children }) => {
  const [activeSnapshot, setActiveSnapshot] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [foundationLocked, setFoundationLocked] = useState(false);
  const [draftSnapshot, setDraftSnapshot] = useState(null);
  const [envId, setEnvId] = useState(() => {
    if (typeof window === 'undefined') return 'default';
    return sessionStorage.getItem('btsy_env_id') || 'default';
  });

  useEffect(() => {
    const id = setInterval(() => {
      const v = sessionStorage.getItem('btsy_env_id') || 'default';
      setEnvId((prev) => (prev !== v ? v : prev));
    }, 500);
    return () => clearInterval(id);
  }, []);

  // Load snapshots on env change
  useEffect(() => {
    loadSnapshots();
  }, [envId]);

  const loadSnapshots = async () => {
    try {
      setLoading(true);
      const response = await btsyApi.snapshot.listSnapshots();
      
      if (response.success && response.data) {
        setSnapshots(response.data);

        const stored = sessionStorage.getItem(`btsy_active_snapshot_id:${envId}`);
        const byId = new Map((response.data || []).map((s) => [String(s.snapshot_id), s]));
        const next =
          (stored && byId.get(String(stored))) ||
          (activeSnapshot?.snapshot_id && byId.get(String(activeSnapshot.snapshot_id))) ||
          (response.data[0] || null);

        setActiveSnapshot(next);
        setFoundationLocked(false);
      }
    } catch (error) {
      console.error('Failed to load snapshots:', error);
    } finally {
      setLoading(false);
    }
  };

  const selectSnapshot = async (snapshotId) => {
    try {
      const response = await btsyApi.snapshot.getSnapshot(snapshotId);
      if (response.success) {
        setActiveSnapshot(response.data);
        sessionStorage.setItem(`btsy_active_snapshot_id:${envId}`, String(response.data.snapshot_id));
        setFoundationLocked(false);
      }
    } catch (error) {
      console.error('Failed to load snapshot:', error);
    }
  };

  const unlockFoundation = () => {
    setActiveSnapshot(null);
    setFoundationLocked(false);
    setDraftSnapshot(null);
    sessionStorage.removeItem(`btsy_active_snapshot_id:${envId}`);
  };

  const startNewDraft = async (snapshotName, createdBy = 'user') => {
    await btsyApi.upload.clearAll();
    const res = await btsyApi.snapshot.createDraft(snapshotName, createdBy);
    if (!res.success) {
      throw new Error(res.error || 'Failed to create draft snapshot');
    }
    setDraftSnapshot(res.data);
    setActiveSnapshot(res.data);
    sessionStorage.setItem(`btsy_active_snapshot_id:${envId}`, String(res.data.snapshot_id));
    setFoundationLocked(false);
    return res.data;
  };

  const createNewSnapshot = async (frozenBy, { snapshotId = null, snapshotName = null } = {}) => {
    try {
      const response = await btsyApi.snapshot.createSnapshot(frozenBy, { snapshotId, snapshotName });
      if (response.success) {
        await loadSnapshots(); // Refresh list
        setDraftSnapshot(null);
        return response.data;
      }
      throw new Error(response.error || 'Failed to create snapshot');
    } catch (error) {
      throw error;
    }
  };

  const value = {
    activeSnapshot,
    snapshots,
    loading,
    foundationLocked,
    envId,
    draftSnapshot,
    selectSnapshot,
    unlockFoundation,
    startNewDraft,
    createNewSnapshot,
    refreshSnapshots: loadSnapshots
  };

  return (
    <SnapshotContext.Provider value={value}>
      {children}
    </SnapshotContext.Provider>
  );
};
