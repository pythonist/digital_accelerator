// frontend/src/tools/calibration/hooks/useScenario.js
import { useState, useEffect } from 'react';
import apiClient from '@services/api';

export const useScenario = () => {
  const [scenarios, setScenarios] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedScenario, setSelectedScenario] = useState(null);

  const loadScenarios = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/api/v2/calibration/scenario/list');
      setScenarios(res.scenarios || []);
    } catch (err) {
      console.error('Failed to load scenarios:', err);
    } finally {
      setLoading(false);
    }
  };

  const getScenario = async (scenarioId) => {
    try {
      const res = await apiClient.get(`/api/v2/calibration/scenario/${scenarioId}/template`);
      setSelectedScenario(res.scenario);
      return res.scenario;
    } catch (err) {
      console.error('Failed to load scenario:', err);
      return null;
    }
  };

  const createCustomScenario = async (scenarioData) => {
    try {
      const res = await apiClient.post('/api/v2/calibration/scenario/custom', scenarioData);
      return res.scenario;
    } catch (err) {
      console.error('Failed to create custom scenario:', err);
      throw err;
    }
  };

  useEffect(() => {
    loadScenarios();
  }, []);

  return {
    scenarios,
    loading,
    selectedScenario,
    loadScenarios,
    getScenario,
    createCustomScenario
  };
};