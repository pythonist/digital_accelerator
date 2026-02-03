import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import btsyApi from '../services/btsyApi';
import { useSnapshot } from './SnapshotContext';

const CalibrationRunContext = createContext();

export const useCalibrationRun = () => {
  const ctx = useContext(CalibrationRunContext);
  if (!ctx) throw new Error('useCalibrationRun must be used within CalibrationRunProvider');
  return ctx;
};

const STORAGE_KEY = 'btsy_active_calibration_run_id';

export const CalibrationRunProvider = ({ children }) => {
  const { activeSnapshot } = useSnapshot();
  const [envId, setEnvId] = useState(() => sessionStorage.getItem('btsy_env_id') || 'default');
  const [activeCalibrationRunId, setActiveCalibrationRunId] = useState(() => {
    const currentEnv = sessionStorage.getItem('btsy_env_id') || 'default';
    const v = sessionStorage.getItem(`${STORAGE_KEY}:${currentEnv}`);
    return v ? String(v) : '';
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const id = setInterval(() => {
      const v = sessionStorage.getItem('btsy_env_id') || 'default';
      setEnvId((prev) => (prev !== v ? v : prev));
    }, 500);
    return () => clearInterval(id);
  }, []);

  const refreshActive = async () => {
    setLoading(true);
    try {
      const res = await btsyApi.calibrationRuns.getActive();
      if (res.success && res.data?.calibration_run_id) {
        const id = String(res.data.calibration_run_id);
        setActiveCalibrationRunId(id);
        sessionStorage.setItem(`${STORAGE_KEY}:${envId}`, id);
      }
      if (res.success && !res.data?.calibration_run_id) {
        setActiveCalibrationRunId('');
        sessionStorage.removeItem(`${STORAGE_KEY}:${envId}`);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!activeCalibrationRunId) {
      refreshActive();
    }
  }, []);

  useEffect(() => {
    const v = sessionStorage.getItem(`${STORAGE_KEY}:${envId}`);
    const next = v ? String(v) : '';
    if (next !== activeCalibrationRunId) {
      setActiveCalibrationRunId(next);
      if (!next) {
        refreshActive();
      }
    }
  }, [envId]);

  useEffect(() => {
    if (!activeSnapshot?.snapshot_id) return;
    if (!activeCalibrationRunId) return;
    const validate = async () => {
      try {
        const res = await btsyApi.calibrationRuns.getRun(parseInt(activeCalibrationRunId, 10));
        if (!res.success) {
          setActiveCalibrationRunId('');
          sessionStorage.removeItem(`${STORAGE_KEY}:${envId}`);
          return;
        }
        if (res.data?.snapshot_id && String(res.data.snapshot_id) !== String(activeSnapshot.snapshot_id)) {
          setActiveCalibrationRunId('');
          sessionStorage.removeItem(`${STORAGE_KEY}:${envId}`);
        }
      } catch {
        setActiveCalibrationRunId('');
        sessionStorage.removeItem(`${STORAGE_KEY}:${envId}`);
      }
    };
    validate();
  }, [activeSnapshot?.snapshot_id, activeCalibrationRunId, envId]);

  const setActive = async (calibrationRunId) => {
    const id = String(calibrationRunId || '');
    if (!id) return;
    await btsyApi.calibrationRuns.activateRun(parseInt(id, 10));
    setActiveCalibrationRunId(id);
    sessionStorage.setItem(`${STORAGE_KEY}:${envId}`, id);
  };

  const value = useMemo(() => ({
    activeCalibrationRunId,
    setActiveCalibrationRunId: setActive,
    loading,
    refreshActive,
  }), [activeCalibrationRunId, loading]);

  return (
    <CalibrationRunContext.Provider value={value}>
      {children}
    </CalibrationRunContext.Provider>
  );
};
