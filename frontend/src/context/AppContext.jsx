// src/context/AppContext.jsx
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import apiClient from "@services/api";
import {
  clearShellSelection,
  persistShellSelection,
  readInitialActiveEnv,
  readInitialActiveTool,
} from '../utils/navigationPersistence';

const AppContext = createContext();

export const ENV_STATE = {
  NOT_SELECTED: 'not_selected',
  SELECTED: 'selected',
  DATA_LOADED: 'data_loaded',
  MASTER_BUILT: 'master_built',
  ERROR: 'error'
};

export const AppProvider = ({ children }) => {
  // ==================== AUTHENTICATION ====================
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [username, setUsername] = useState('');
  const [tenantId, setTenantId] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [error, setError] = useState(null);

  // ==================== ENVIRONMENT & TOOL ====================
  const [activeEnv, setActiveEnvState] = useState(() => readInitialActiveEnv());
  const [activeBankName, setActiveBankName] = useState('Default');
  const [activeBankLogo, setActiveBankLogo] = useState(null);
  const [activeTool, setActiveTool] = useState(() => readInitialActiveTool());
  const [isSystemLoading, setIsSystemLoading] = useState(false);
  const [availableEnvironments, setAvailableEnvironments] = useState([]);
  
  const [envReadyState, setEnvReadyState] = useState(ENV_STATE.NOT_SELECTED);
  const [datasetLoaded, setDatasetLoaded] = useState(false);
  const [masterDataBuilt, setMasterDataBuilt] = useState(false);
  const [isCleaned, setIsCleaned] = useState(false);

  // ==================== INVESTIGATION CONTEXT ====================
  const [activeCaseId, setActiveCaseId] = useState(null);
  const [activeCaseData, setActiveCaseData] = useState(null);
  const [analysisScope, setAnalysisScope] = useState('GLOBAL');
  const [isHydrating, setIsHydrating] = useState(false);

  // ==================== âœ… CASE SCOPE SYSTEM (Authoritative) ====================
  const [caseScope, setCaseScope] = useState({
    type: 'GLOBAL',
    value: null,
    runId: null,
    caseIds: [],
    caseCount: 0,
    isLoading: false
  });

  // ==================== LEGACY: PRIORITY BUCKETS (UI State Only) ====================
  const [priorityBuckets, setPriorityBuckets] = useState({
    enabled: false,
    activeBucket: 'All',
    buckets: ['All', 'Priority', 'Monitor', 'Review'],
    allCases: [],
    lastRunId: null,
    lastRunDate: null
  });

  // ==================== RESOURCES ====================
  const [dbStats, setDbStats] = useState(null);
  const [ollamaModels, setOllamaModels] = useState([]);
  const [casePack, setCasePack] = useState(null);
  const [loadingCasePack, setLoadingCasePack] = useState(false);
  const [caseList, setCaseList] = useState([]); 
  const [loadingCaseList, setLoadingCaseList] = useState(false);
  const [globalStore, setGlobalStore] = useState({});

  // ✅ MEMOIZED FUNCTIONS (CRITICAL FIX)
  
  const checkAuth = useCallback(async () => {
    setIsAuthLoading(true);
    const token = localStorage.getItem('auth_token');
    if (!token) { setIsAuthenticated(false); setIsAuthLoading(false); return; }
    try {
      const data = await apiClient.get('/api/check-auth');
      if (data.authenticated) { 
        setIsAuthenticated(true); 
        setUsername(data.user?.username || '');
        setTenantId(data.user?.tenant_id);
        setUserRole(data.user?.role);
      } else {
        localStorage.removeItem('auth_token');
        setIsAuthenticated(false);
      }
    } catch (err) { 
      localStorage.removeItem('auth_token');
      setIsAuthenticated(false); 
    } finally { setIsAuthLoading(false); }
  }, []);

  const loadAvailableEnvironments = useCallback(async () => {
    try {
      const res = await apiClient.get('/api/v2/env/list');
      setAvailableEnvironments(res.cases || []);
    } catch (err) { setAvailableEnvironments([]); }
  }, []);

  const fetchModels = useCallback(async () => {
    try {
      const data = await apiClient.get('/api/v2/llm/models');
      if (data.success && Array.isArray(data.models)) setOllamaModels(data.models);
    } catch (err) {}
  }, []);

  const checkEnvironmentReadiness = useCallback(async () => {
    if (!activeEnv) {
      setEnvReadyState(ENV_STATE.NOT_SELECTED);
      setDatasetLoaded(false);
      setMasterDataBuilt(false);
      return ENV_STATE.NOT_SELECTED;
    }

    try {
      const validateRes = await apiClient.get(`/api/v2/env/${activeEnv}/validate`);
      
      if (validateRes.has_cases_table) {
        setEnvReadyState(ENV_STATE.DATA_LOADED);
        setDatasetLoaded(true);
        setMasterDataBuilt(validateRes.case_count > 0);
        
        loadDbStats();
        loadCaseList();
        
        return ENV_STATE.DATA_LOADED;
      } else {
        setEnvReadyState(ENV_STATE.SELECTED);
        setDatasetLoaded(false);
        setMasterDataBuilt(false);
        return ENV_STATE.SELECTED;
      }
    } catch (err) {
      console.warn('Readiness check failed, defaulting to SELECTED:', err);
      setEnvReadyState(ENV_STATE.SELECTED);
      return ENV_STATE.SELECTED;
    }
  }, [activeEnv]); // ✅ Only depends on activeEnv

  const loadCaseScope = useCallback(async () => {
    if (!activeEnv) return;
    
    setCaseScope(prev => ({ ...prev, isLoading: true }));
    try {
      const res = await apiClient.get('/api/v2/case-scope/get');
      if (res.success && res.scope) {
        setCaseScope({
          type: res.scope.type,
          value: res.scope.value,
          runId: res.scope.run_id,
          caseIds: res.scope.case_ids || [],
          caseCount: res.scope.case_count || 0,
          isLoading: false
        });
      }
    } catch (err) {
      console.warn('Failed to load case scope, defaulting to GLOBAL:', err);
      resetCaseScope();
    }
  }, [activeEnv]);

  const loadPriorityBuckets = useCallback(async () => {
    try {
      const res = await apiClient.getFocusInbox();
      if (res.success && res.cases && res.cases.length > 0) {
        const uniqueBuckets = new Set(['All', 'Priority', 'Monitor', 'Review']);
        res.cases.forEach(c => {
          if (c.bucket) uniqueBuckets.add(c.bucket);
        });

        setPriorityBuckets({
          enabled: true,
          activeBucket: 'All',
          buckets: Array.from(uniqueBuckets),
          allCases: res.cases,
          lastRunId: res.run_id,
          lastRunDate: res.run_at
        });
      }
    } catch (err) {
      console.log('No priority buckets available (this is OK)', err);
    }
  }, []);

  const loadDbStats = useCallback(async () => {
    try {
      const data = await apiClient.get('/api/v2/db/stats');
      setDbStats(data.stats);
    } catch(e) {}
  }, []);

  const loadCaseList = useCallback(async (force = false) => {
    if (!force && caseList.length > 0) return; 
    setLoadingCaseList(true);
    try {
      const data = await apiClient.get('/api/v2/case-list');
      setCaseList(Array.isArray(data) ? data : []);
    } catch (err) {} 
    finally { setLoadingCaseList(false); }
  }, [caseList.length]);

  const refreshSystemState = useCallback(async () => {
    setIsSystemLoading(true);
    try {
      const envRes = await apiClient.get('/api/v2/env/status');
      if (envRes.active) {
        setActiveEnv(envRes.name);
        setActiveBankName(envRes.name);
        await checkEnvironmentReadiness();
      } 
    } catch (err) {} 
    finally { setIsSystemLoading(false); }
  }, [checkEnvironmentReadiness]); // ✅ CRITICAL FIX

  // ==================== EFFECTS ====================
  
  useEffect(() => { checkAuth(); }, [checkAuth]);
  
  useEffect(() => {
    if (isAuthenticated && tenantId) {
      loadAvailableEnvironments();
      fetchModels();
    }
  }, [isAuthenticated, tenantId, loadAvailableEnvironments, fetchModels]);

  useEffect(() => {
    if (isAuthLoading) return;

    if (activeEnv && isAuthenticated) {
      apiClient.setActiveEnv(activeEnv);
      checkEnvironmentReadiness();
      loadCaseScope();
      loadPriorityBuckets();
    } else {
      apiClient.setActiveEnv(null);
      setEnvReadyState(ENV_STATE.NOT_SELECTED);
      resetCaseScope();
      resetPriorityBuckets();
    }
  }, [activeEnv, isAuthenticated, isAuthLoading, checkEnvironmentReadiness, loadCaseScope, loadPriorityBuckets]);

  useEffect(() => {
    persistShellSelection({ activeEnv, activeTool });
  }, [activeEnv, activeTool]);

  const setActiveEnv = (envId) => {
    setActiveEnvState(envId);
    if (envId) apiClient.setActiveEnv(envId);
    else apiClient.setActiveEnv(null);
  };

  const handleLogin = async (userData) => {
    if (userData.token) {
      localStorage.setItem('auth_token', userData.token);
      setIsAuthenticated(true);
      setUsername(userData.user?.username || '');
      setTenantId(userData.user?.tenant_id);
      setUserRole(userData.user?.role);
      setError(null);
      setTimeout(() => loadAvailableEnvironments(), 100);
    }
  };

  const handleLogout = async () => {
    try { await apiClient.post('/api/logout', {}); } catch (err) {} 
    finally {
      localStorage.removeItem('auth_token');
      clearShellSelection();
      setIsAuthenticated(false); 
      setUsername('');
      setTenantId(null);
      setUserRole(null);
      clearActiveCase();
      disconnectEnv();
      setAvailableEnvironments([]);
      setGlobalStore({});
      resetCaseScope();
      resetPriorityBuckets();
    }
  };

  const canAccessScreen = (screenKey) => {
    if (['load', 'connectors', 'history'].includes(screenKey)) {
        return envReadyState !== ENV_STATE.NOT_SELECTED;
    }
    return envReadyState !== ENV_STATE.NOT_SELECTED;
  };

  const setCaseScopeRemote = async (type, value, runId = null) => {
    try {
      const res = await apiClient.post('/api/v2/case-scope/set', {
        scope_type: type,
        scope_value: value,
        run_id: runId
      });
      
      if (res.success) {
        await loadCaseScope();
        await loadCaseList(true);
        await loadPriorityBuckets();
        return { success: true };
      }
      return { success: false, error: res.error };
    } catch (err) {
      return { success: false, error: err.message };
    }
  };

  const resetCaseScope = () => {
    setCaseScope({
      type: 'GLOBAL',
      value: null,
      runId: null,
      caseIds: [],
      caseCount: 0,
      isLoading: false
    });
  };

  const resetPriorityBuckets = () => {
    setPriorityBuckets({
      enabled: false,
      activeBucket: 'All',
      buckets: ['All', 'Priority', 'Monitor', 'Review'],
      allCases: [],
      lastRunId: null,
      lastRunDate: null
    });
  };

  const activateBucket = async (bucketName) => {
    setPriorityBuckets(prev => ({
      ...prev,
      activeBucket: bucketName
    }));

    if (bucketName === 'All') {
      await setCaseScopeRemote('GLOBAL', null);
    } else {
      await setCaseScopeRemote('BUCKET', bucketName, priorityBuckets.lastRunId);
    }
  };

  const addBucketToPriority = (bucketName) => {
    setPriorityBuckets(prev => {
      if (prev.buckets.includes(bucketName)) return prev;
      return {
        ...prev,
        buckets: [...prev.buckets, bucketName]
      };
    });
  };

  const refreshPriorityBuckets = async () => {
    if (activeEnv) {
      await loadPriorityBuckets();
      await loadCaseScope();
    }
  };

  const getFilteredCaseList = () => {
    if (caseScope.type !== 'GLOBAL' && caseScope.caseIds.length > 0) {
      const scopeSet = new Set(caseScope.caseIds.map(String));
      return caseList.filter(c => {
        const id = String(c.case_id || c.caseid || c.Case_ID || c.id);
        return scopeSet.has(id);
      });
    }
    return caseList;
  };

  const setActiveCase = (caseId, hydratedData) => {
    setActiveCaseId(caseId);
    setActiveCaseData(hydratedData);
    setAnalysisScope('ACTIVE_CASE');
  };

  const clearActiveCase = () => {
    setActiveCaseId(null);
    setActiveCaseData(null);
    setAnalysisScope('GLOBAL');
  };

  const hydrateAndActivateCase = async (caseId, dateWindow = 90) => {
    if (!caseId) return { success: false, error: 'Case ID required' };
    setIsHydrating(true);
    setError(null);
    try {
      const response = await apiClient.hydrateCase(caseId, dateWindow);
      if (response.success) {
        setActiveCase(caseId, response.data);
        return { success: true, data: response.data };
      } else {
        setError(response.error || 'Hydration failed');
        return { success: false, error: response.error };
      }
    } catch (err) {
      setError(err.message);
      return { success: false, error: err.message };
    } finally { setIsHydrating(false); }
  };

  const disconnectEnv = async () => {
    clearActiveCase();
    setActiveEnv(null);
    setActiveTool(null);
    setActiveBankName('Default');
    setActiveBankLogo(null);
    setEnvReadyState(ENV_STATE.NOT_SELECTED);
    setDatasetLoaded(false);
    setMasterDataBuilt(false);
    setIsCleaned(false);
    setCasePack(null);
    setCaseList([]);
    setDbStats(null);
    resetCaseScope();
    resetPriorityBuckets();
    clearShellSelection();
  };

  const loadCasePack = async (caseId) => {
    if (!caseId) { setCasePack(null); return; }
    setLoadingCasePack(true); setError(null);
    try {
      const data = await apiClient.get(`/api/v2/case-pack/${caseId}`);
      setCasePack(data);
    } catch (err) { setError(err.message); setCasePack(null); } 
    finally { setLoadingCasePack(false); }
  };

  const value = {
    isAuthenticated, isAuthLoading, username, tenantId, userRole, handleLogin, handleLogout,
    activeEnv, setActiveEnv, availableEnvironments, loadAvailableEnvironments,
    activeBankName, setActiveBankName, activeBankLogo, activeTool, setActiveTool,
    disconnectEnv, isSystemLoading, envReadyState, checkEnvironmentReadiness, canAccessScreen, ENV_STATE,
    datasetLoaded, setDatasetLoaded, masterDataBuilt, setMasterDataBuilt, isCleaned, setIsCleaned,
    activeCaseId, activeCaseData, analysisScope, isHydrating, setActiveCase, clearActiveCase,
    hydrateAndActivateCase, setAnalysisScope, dbStats, ollamaModels, casePack, loadingCasePack, 
    caseList, loadingCaseList, refreshSystemState, checkDatasetStatus: refreshSystemState,
    loadCasePack, loadCaseList, globalStore, setGlobalStore, error, setError,
    
    caseScope,
    setCaseScopeRemote,
    resetCaseScope,
    loadCaseScope,
    
    priorityBuckets,
    activateBucket,
    addBucketToPriority,
    refreshPriorityBuckets,
    getFilteredCaseList
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export const useAppContext = () => useContext(AppContext);

export const usePersistentState = (key, initialValue) => {
  const { globalStore, setGlobalStore } = useAppContext();
  const stateValue = globalStore[key] !== undefined ? globalStore[key] : initialValue;
  const setStateValue = (newValue) => {
    setGlobalStore(prevStore => {
      const resolvedValue = newValue instanceof Function ? newValue(prevStore[key] !== undefined ? prevStore[key] : initialValue) : newValue;
      return { ...prevStore, [key]: resolvedValue };
    });
  };
  return [stateValue, setStateValue];
};
