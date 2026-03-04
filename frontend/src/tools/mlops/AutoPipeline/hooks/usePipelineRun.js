/**
 * usePipelineRun.js
 * Manages polling a run's status, exposing steps + overall state.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import autoPilotApi from '../utils/autoPilotApi';

const POLL_INTERVAL_MS = 1500;
const TERMINAL_STATUSES = new Set(['done', 'error', 'canceled', 'cancelled']);
const MAX_CONSECUTIVE_STATUS_FAILURES = 3;

const usePipelineRun = () => {
  const [runId, setRunId]       = useState(null);
  const [run, setRun]           = useState(null);
  const [polling, setPolling]   = useState(false);
  const [error, setError]       = useState(null);
  const pollRef                 = useRef(null);
  const statusFailureCountRef   = useRef(0);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setPolling(false);
  }, []);

  const fetchStatus = useCallback(async (id) => {
    try {
      const res = await autoPilotApi.status(id);
      const data = res?.data?.data ?? res?.data ?? res;
      if (data) setRun(data);
      statusFailureCountRef.current = 0;
      setError(null);
      if (TERMINAL_STATUSES.has(String(data?.status || '').toLowerCase())) {
        stopPolling();
      }
    } catch (e) {
      try {
        const runsRes = await autoPilotApi.listRuns();
        const rows = runsRes?.data?.data ?? runsRes?.data ?? runsRes;
        const matchedRun = Array.isArray(rows)
          ? rows.find((row) => String(row?.run_id || '') === String(id))
          : null;

        if (matchedRun) {
          setRun((prev) => ({
            ...(prev || {}),
            ...matchedRun,
            steps: Array.isArray(matchedRun?.steps) ? matchedRun.steps : (Array.isArray(prev?.steps) ? prev.steps : []),
            logs: Array.isArray(matchedRun?.logs) ? matchedRun.logs : (Array.isArray(prev?.logs) ? prev.logs : []),
          }));
          statusFailureCountRef.current = 0;
          setError(null);
          if (TERMINAL_STATUSES.has(String(matchedRun?.status || '').toLowerCase())) {
            stopPolling();
          }
          return;
        }
      } catch (_) {
        // Ignore history fallback failures and rely on bounded retries below.
      }

      statusFailureCountRef.current += 1;
      if (statusFailureCountRef.current >= MAX_CONSECUTIVE_STATUS_FAILURES) {
        setError(e?.message || 'Failed to fetch pipeline status');
        stopPolling();
      }
    }
  }, [stopPolling]);

  const startRun = useCallback(async (config) => {
    setError(null);
    setRun(null);
    statusFailureCountRef.current = 0;
    try {
      const res = await autoPilotApi.run(config);
      const data = res?.data?.data ?? res?.data ?? res;
      const id = data?.run_id;
      if (!id) throw new Error('No run_id returned from server');
      setRunId(id);
      setRun((prev) => ({
        ...(prev || {}),
        run_id: id,
        status: 'running',
        steps: Array.isArray(prev?.steps) ? prev.steps : [],
      }));
      setPolling(true);
      // Kick off first fetch immediately
      await fetchStatus(id);
      // Then poll
      pollRef.current = setInterval(() => fetchStatus(id), POLL_INTERVAL_MS);
      return id;
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Failed to start pipeline');
      return null;
    }
  }, [fetchStatus]);

  // Cleanup on unmount
  useEffect(() => () => stopPolling(), [stopPolling]);

  const reset = useCallback(() => {
    stopPolling();
    setRunId(null);
    setRun(null);
    setError(null);
    statusFailureCountRef.current = 0;
  }, [stopPolling]);

  const cancelRun = useCallback(async () => {
    if (!runId) return false;
    try {
      const res = await autoPilotApi.cancel(runId);
      const data = res?.data?.data ?? res?.data ?? res;
      setRun(data || null);
      stopPolling();
      return true;
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Failed to cancel pipeline run');
      return false;
    }
  }, [runId, stopPolling]);

  return { runId, run, polling, error, startRun, reset, cancelRun };
};

export default usePipelineRun;
