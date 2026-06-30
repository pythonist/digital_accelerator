// frontend/src/App.jsx
import React, { Suspense, useEffect, useMemo, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAppContext } from "@context/AppContext";
import { ScaleLoader } from 'react-spinners';
import { PageTransition } from "./components/LoadingAnimations";
import { persistLastRoute, readLastRoute } from './utils/navigationPersistence';
import { lazyWithReload } from './utils/lazyWithReload';

const LoginScreen = lazyWithReload(() => import("@screens/auth/LoginScreen"), 'login');
const RegisterScreen = lazyWithReload(() => import("@screens/auth/RegisterScreen"), 'register');
const AdminDashboard = lazyWithReload(() => import("@screens/admin/AdminDashboard"), 'admin');
const EnvironmentSelectScreen = lazyWithReload(() => import("@screens/admin/EnvironmentSelectScreen"), 'environments');
const EnvironmentModuleTransitionScreen = lazyWithReload(() => import("@screens/admin/EnvironmentModuleTransitionScreen"), 'tools-transition');
const ToolSelectScreen = lazyWithReload(() => import("@screens/admin/ToolSelectScreen"), 'tools');

const InvestigationPlatform = lazyWithReload(() => import("@tools/investigation/InvestigationPlatform"), 'investigation');
// const CalibrationPlatform = lazyWithReload(() => import("@tools/calibration/CalibrationPlatform"), 'calibration');
const MulePlatform = lazyWithReload(() => import("@tools/mule_detection/MulePlatform"), 'mule');
const BTSYPlatform = lazyWithReload(() => import("@tools/btsy/BTSYPlatform"), 'btsy');
const MLOpsPlatform = lazyWithReload(() => import("@tools/mlops/MLOpsPlatform"), 'mlops');

const RESTORE_ENTRY_PATHS = new Set(['/', '/environments']);
const TOOL_ROUTE_PREFIXES = [
  ['/investigation', 'investigation'],
  // ['/calibration', 'calibration'],
  ['/mule', 'mule_detection'],
  ['/btsy', 'btsy'],
  ['/mlops', 'mlops'],
];

const resolveToolKeyFromPath = (pathname = '') => {
  const match = TOOL_ROUTE_PREFIXES.find(([prefix]) => pathname.startsWith(prefix));
  return match ? match[1] : null;
};

const shouldPersistRoute = (pathname = '') =>
  Boolean(pathname) && !['/login', '/register', '/environments', '/tools-transition'].includes(pathname);

const RouteLoader = () => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-gradient-to-br from-orange-50 via-amber-50 to-slate-100">
    <div className="text-center space-y-4" role="status" aria-live="polite">
      <div className="flex justify-center">
        <ScaleLoader
          color="#D04A02"
          height={34}
          width={5}
          radius={3}
          margin={4}
          speedMultiplier={0.85}
          aria-label="Switching module"
        />
      </div>
      <div>
        <p className="text-xs font-semibold tracking-[0.16em] uppercase text-[#9A3412]">Switching Module</p>
        <p className="text-sm text-slate-600">Loading workspace...</p>
      </div>
    </div>
  </div>
);

class RouteErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-100">
        <div className="border border-slate-200 bg-white p-6 shadow-sm">
          <p className="mb-3 text-sm font-semibold text-slate-900">This screen needs a refresh.</p>
          <button
            className="border border-orange-700 bg-orange-700 px-4 py-2 text-sm font-semibold text-white"
            onClick={() => window.location.reload()}
          >
            Refresh
          </button>
        </div>
      </div>
    );
  }
}

const RouteSuspense = ({ children }) => (
  <RouteErrorBoundary>
    <Suspense fallback={<RouteLoader />}>{children}</Suspense>
  </RouteErrorBoundary>
);

const NavigationStateManager = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { activeEnv, isAuthenticated, isAuthLoading, setActiveTool, username } = useAppContext();
  const restoredScopeRef = useRef('');
  const scopeKey = useMemo(
    () => `${username || 'anonymous'}::${activeEnv || 'default'}`,
    [activeEnv, username]
  );

  useEffect(() => {
    const derivedTool = resolveToolKeyFromPath(location.pathname);
    if (!derivedTool) {
      if (location.pathname === '/tools') {
        setActiveTool((previousTool) => (previousTool == null ? previousTool : null));
      }
      return;
    }

    setActiveTool((previousTool) => (previousTool === derivedTool ? previousTool : derivedTool));
  }, [location.pathname, setActiveTool]);

  useEffect(() => {
    if (isAuthLoading || !isAuthenticated || !activeEnv) return;
    if (!shouldPersistRoute(location.pathname)) return;

    const fullPath = `${location.pathname}${location.search || ''}${location.hash || ''}`;
    persistLastRoute({ username, envId: activeEnv }, fullPath);
  }, [
    activeEnv,
    isAuthenticated,
    isAuthLoading,
    location.hash,
    location.pathname,
    location.search,
    username,
  ]);

  useEffect(() => {
    if (isAuthLoading || !isAuthenticated || !activeEnv) return;
    if (restoredScopeRef.current === scopeKey) return;

    if (location.state?.skipRestore) {
      restoredScopeRef.current = scopeKey;
      return;
    }

    if (!RESTORE_ENTRY_PATHS.has(location.pathname)) {
      restoredScopeRef.current = scopeKey;
      return;
    }

    restoredScopeRef.current = scopeKey;
    const rememberedRoute = readLastRoute({ username, envId: activeEnv });
    if (!rememberedRoute || rememberedRoute === location.pathname) return;

    navigate(rememberedRoute, { replace: true });
  }, [activeEnv, isAuthenticated, isAuthLoading, location.pathname, navigate, scopeKey, username]);

  return null;
};

// --- MAIN LAYOUT ---
const MainLayout = () => {
  const { isAuthenticated, isAuthLoading } = useAppContext();
  const location = useLocation();

  if (isAuthLoading) {
    return <RouteLoader />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <PageTransition key={location.pathname} className="h-full w-full">
      <Outlet />
    </PageTransition>
  );
};

// --- TOOL LAYOUT (Requires Environment) ---
const ToolLayout = () => {
  const { activeEnv } = useAppContext();
  const location = useLocation();

  if (!activeEnv) return <Navigate to="/environments" replace />;

  return (
    <div className="flex h-screen min-h-0 flex-col overflow-hidden animate-in fade-in duration-700">
      <div className="relative flex-1 min-h-0 overflow-hidden bg-slate-100">
        <PageTransition className="h-full w-full">
          <Outlet key={location.pathname} />
        </PageTransition>
      </div>
    </div>
  );
};

// --- ROUTES CONFIGURATION ---
const AppRoutes = () => {
  const { isAuthenticated, userRole } = useAppContext();

  return (
    <Routes>
      {/* PUBLIC ROUTES */}
      <Route
        path="/login"
        element={
          !isAuthenticated
            ? (
              <PageTransition>
                <RouteSuspense><LoginScreen /></RouteSuspense>
              </PageTransition>
            )
            : <Navigate to="/environments" />
        }
      />
      <Route
        path="/register"
        element={
          !isAuthenticated
            ? (
              <PageTransition>
                <RouteSuspense><RegisterScreen /></RouteSuspense>
              </PageTransition>
            )
            : <Navigate to="/environments" />
        }
      />

      {/* PROTECTED ROUTES */}
      <Route element={<MainLayout />}>
        <Route
          path="/admin"
          element={
            userRole === 'TENANT_ADMIN'
              ? <RouteSuspense><AdminDashboard /></RouteSuspense>
              : <Navigate to="/environments" />
          }
        />

        <Route path="/environments" element={<RouteSuspense><EnvironmentSelectScreen /></RouteSuspense>} />
        <Route path="/tools-transition" element={<RouteSuspense><EnvironmentModuleTransitionScreen /></RouteSuspense>} />
        <Route path="/tools" element={<RouteSuspense><ToolSelectScreen /></RouteSuspense>} />

        {/* Tool Platforms */}
        <Route element={<ToolLayout />}>
          <Route path="/investigation/*" element={<RouteSuspense><InvestigationPlatform /></RouteSuspense>} />
          {/* <Route path="/calibration/*" element={<RouteSuspense><CalibrationPlatform /></RouteSuspense>} /> */}
          <Route path="/mule/*" element={<RouteSuspense><MulePlatform /></RouteSuspense>} />
          <Route path="/btsy/*" element={<RouteSuspense><BTSYPlatform /></RouteSuspense>} />
          <Route path="/mlops/*" element={<RouteSuspense><MLOpsPlatform /></RouteSuspense>} />
        </Route>

        <Route path="/" element={<Navigate to="/environments" replace />} />
      </Route>

      <Route path="*" element={<Navigate to="/login" />} />
    </Routes>
  );
};

const App = () => {
  return (
    <BrowserRouter>
      <NavigationStateManager />
      <AppRoutes />
    </BrowserRouter>
  );
};

export default App;
