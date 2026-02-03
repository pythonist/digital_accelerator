// frontend/src/tools/btsy/screens/calibration/transaction_universe/hooks/useTransactionUniverses.js
import { useState, useEffect, useCallback } from 'react';
import btsyApi from '@btsy/services/btsyApi';

/**
 * Custom hook for managing transaction universes (FIXED)
 */
export const useTransactionUniverses = (calibrationRunId, snapshotId) => {
  const [universes, setUniverses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadUniverses = useCallback(async () => {
    if (!calibrationRunId) {
      console.log('[HOOK] No calibrationRunId, skipping load');
      return;
    }
    
    try {
      setLoading(true);
      setError(null);
      
      console.log('[HOOK] Loading universes for calibration_run_id:', calibrationRunId);
      
      const response = await btsyApi.universe.listUniverses(calibrationRunId);
      
      console.log('[HOOK] List response:', response);
      
      if (response.success) {
        setUniverses(response.data || []);
        console.log('[HOOK] Loaded universes:', response.data?.length || 0);
      } else {
        setError(response.error || 'Failed to load universes');
        console.error('[HOOK] List failed:', response.error);
      }
    } catch (err) {
      console.error('[HOOK] Failed to load universes:', err);
      setError(err.message || 'Failed to load universes');
    } finally {
      setLoading(false);
    }
  }, [calibrationRunId]);

  useEffect(() => {
    loadUniverses();
  }, [loadUniverses]);

  const createUniverse = async (universeData) => {
    try {
      setLoading(true);
      setError(null);
      
      console.log('[HOOK] Creating universe with data:', universeData);
      
      const response = await btsyApi.universe.createUniverse(universeData);
      
      console.log('[HOOK] Create response:', response);
      
      if (response.success) {
        await loadUniverses();
        return response.data;
      } else {
        throw new Error(response.error || 'Failed to create universe');
      }
    } catch (err) {
      console.error('[HOOK] Create failed:', err);
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const freezeUniverse = async (universeId) => {
    try {
      setLoading(true);
      setError(null);
      
      console.log('[HOOK] Freezing universe:', universeId);
      
      const response = await btsyApi.universe.freezeUniverse(universeId, 'user');
      
      if (response.success) {
        await loadUniverses();
        return response.data;
      } else {
        throw new Error(response.error || 'Failed to freeze universe');
      }
    } catch (err) {
      console.error('[HOOK] Freeze failed:', err);
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const deleteUniverse = async (universeId) => {
    try {
      setLoading(true);
      setError(null);
      
      console.log('[HOOK] Deleting universe:', universeId);
      
      const response = await btsyApi.universe.deleteUniverse(universeId);
      
      if (response.success) {
        await loadUniverses();
        return true;
      } else {
        throw new Error(response.error || 'Failed to delete universe');
      }
    } catch (err) {
      console.error('[HOOK] Delete failed:', err);
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return {
    universes,
    loading,
    error,
    createUniverse,
    freezeUniverse,
    deleteUniverse,
    refresh: loadUniverses
  };
};
