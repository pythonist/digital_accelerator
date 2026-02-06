// frontend/src/App.jsx
import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useAppContext, AppProvider } from "@context/AppContext";
import { Loader } from 'lucide-react';
import { PageTransition } from "./components/LoadingAnimations";

// 1. Auth & Admin Screens
import LoginScreen from "@screens/auth/LoginScreen";
import RegisterScreen from "@screens/auth/RegisterScreen";
import AdminDashboard from "@screens/admin/AdminDashboard";
import EnvironmentSelectScreen from "@screens/admin/EnvironmentSelectScreen";
import ToolSelectScreen from "@screens/admin/ToolSelectScreen";

// 2. The Three Isolated Platforms
import InvestigationPlatform from "@tools/investigation/InvestigationPlatform";
import CalibrationPlatform from "@tools/calibration/CalibrationPlatform";
import MulePlatform from "@tools/mule_detection/MulePlatform";
import BTSYPlatform from "@tools/btsy/BTSYPlatform";

// --- MAIN LAYOUT ---
const MainLayout = () => {
  const { isAuthenticated, isAuthLoading } = useAppContext();

  if (isAuthLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-50">
        <Loader className="animate-spin h-10 w-10 text-blue-600" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <PageTransition className="h-full w-full">
      <Outlet />
    </PageTransition>
  );
};

// --- TOOL LAYOUT (Requires Environment) ---
const ToolLayout = () => {
  const { activeEnv } = useAppContext();

  if (!activeEnv) return <Navigate to="/environments" replace />;

  return (
    <div className="flex flex-col h-screen overflow-hidden animate-in fade-in duration-700">
      <div className="flex-1 overflow-hidden relative bg-slate-100">
        <PageTransition className="h-full w-full">
          <Outlet />
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
      <Route path="/login" element={
        !isAuthenticated 
          ? <PageTransition><LoginScreen /></PageTransition> 
          : <Navigate to="/environments" />
      } />
      <Route path="/register" element={
        !isAuthenticated 
          ? <PageTransition><RegisterScreen /></PageTransition> 
          : <Navigate to="/environments" />
      } />

      {/* PROTECTED ROUTES */}
      <Route element={<MainLayout />}>
        
        <Route path="/admin" element={
          userRole === 'TENANT_ADMIN' ? <AdminDashboard /> : <Navigate to="/environments" />
        } />

        <Route path="/environments" element={<EnvironmentSelectScreen />} />
        <Route path="/tools" element={<ToolSelectScreen />} />

        {/* ✅ THE THREE PLATFORMS */}
        <Route element={<ToolLayout />}>
          <Route path="/investigation/*" element={<InvestigationPlatform />} />
          <Route path="/calibration/*" element={<CalibrationPlatform />} />
          <Route path="/mule/*" element={<MulePlatform />} />
          <Route path="/btsy/*" element={<BTSYPlatform />} />
        </Route>

        <Route path="/" element={<Navigate to="/environments" replace />} />
      </Route>

      <Route path="*" element={<Navigate to="/login" />} />
    </Routes>
  );
};

const App = () => {
  return (
    <AppProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AppProvider>
  );
};

export default App;
