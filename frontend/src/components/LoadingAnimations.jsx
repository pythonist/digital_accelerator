import React from 'react';
import { Loader, Database, Shield, Activity, BarChart3 } from 'lucide-react';

// ============================================================================
// ✨ ANIMATION WRAPPERS (New)
// ============================================================================

/**
 * Wraps page content to provide a smooth entrance animation.
 * Usage: <PageTransition> <MyContent /> </PageTransition>
 */
export const PageTransition = ({ children, className = "" }) => {
  return (
    <div className={`animate-in fade-in slide-in-from-bottom-4 duration-500 ease-out fill-mode-forwards ${className}`}>
      {children}
    </div>
  );
};

// ============================================================================
// FULL SCREEN LOADERS
// ============================================================================

export const FullScreenLoader = ({ message = "Loading..." }) => {
  return (
    <div className="fixed inset-0 bg-gradient-to-br from-slate-50 via-blue-50 to-slate-50 flex items-center justify-center z-50">
      <div className="text-center space-y-6 animate-in fade-in zoom-in duration-500">
        <div className="relative w-24 h-24 mx-auto">
          <div className="absolute inset-0 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
          <div 
            className="absolute inset-2 border-4 border-transparent border-b-emerald-400 rounded-full animate-spin"
            style={{ animationDirection: 'reverse', animationDuration: '1.5s' }}
          ></div>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-3 h-3 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-full animate-pulse"></div>
          </div>
        </div>
        <div>
          <p className="text-slate-900 font-bold text-lg mb-1">{message}</p>
          <p className="text-slate-500 text-sm">Please wait while we process your request...</p>
        </div>
      </div>
    </div>
  );
};

export const DataLoadingScreen = ({ message = "Loading data..." }) => {
  return (
    <div className="fixed inset-0 bg-gradient-to-br from-slate-50 via-blue-50 to-slate-50 flex items-center justify-center z-50">
      <div className="text-center space-y-8 animate-in fade-in zoom-in duration-500">
        <div className="relative w-32 h-32 mx-auto">
          <div className="absolute inset-0 flex items-center justify-center">
            <Database size={48} className="text-blue-600 animate-pulse" />
          </div>
          <div className="absolute inset-0 border-4 border-blue-200 border-t-transparent rounded-full animate-spin" style={{ animationDuration: '2s' }}></div>
          <div className="absolute inset-4 border-4 border-emerald-200 border-b-transparent rounded-full animate-spin" style={{ animationDuration: '1.5s', animationDirection: 'reverse' }}></div>
        </div>
        
        <div className="space-y-3">
          <h3 className="text-xl font-bold text-slate-900">{message}</h3>
          <div className="flex items-center justify-center gap-2">
            <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
            <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
            <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ... (Keep standard loaders: InlineSpinner, CardLoader, TableLoader, DashboardSkeleton) ...
export const InlineSpinner = ({ size = 'md', color = 'blue' }) => {
  const sizeClasses = { sm: 'w-4 h-4 border-2', md: 'w-8 h-8 border-3', lg: 'w-12 h-12 border-4' };
  const colorClasses = { blue: 'border-blue-200 border-t-blue-600', emerald: 'border-emerald-200 border-t-emerald-600', slate: 'border-slate-200 border-t-slate-600' };
  return <div className={`${sizeClasses[size]} ${colorClasses[color]} rounded-full animate-spin`}></div>;
};

export const CardLoader = () => (
  <div className="bg-white rounded-2xl border border-slate-200 p-6 animate-pulse">
    <div className="flex items-center gap-4 mb-4">
      <div className="w-12 h-12 bg-slate-200 rounded-xl"></div>
      <div className="flex-1 space-y-2"><div className="h-4 bg-slate-200 rounded w-3/4"></div><div className="h-3 bg-slate-100 rounded w-1/2"></div></div>
    </div>
    <div className="space-y-3"><div className="h-3 bg-slate-100 rounded"></div><div className="h-3 bg-slate-100 rounded w-5/6"></div></div>
  </div>
);

export const TableLoader = ({ rows = 5 }) => (
  <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
    <div className="p-4 border-b border-slate-200 animate-pulse"><div className="h-6 bg-slate-200 rounded w-48"></div></div>
    <div className="divide-y divide-slate-100">{[...Array(rows)].map((_, i) => (<div key={i} className="p-4 animate-pulse" style={{ animationDelay: `${i*100}ms` }}><div className="h-4 bg-slate-200 rounded w-full"></div></div>))}</div>
  </div>
);

export const DashboardSkeleton = () => (
  <div className="p-6 space-y-6 animate-in fade-in duration-500">
    <div className="grid grid-cols-4 gap-4">{[1,2,3,4].map(i => <div key={i} className="bg-white rounded-2xl h-32 animate-pulse border border-slate-200"></div>)}</div>
    <div className="grid grid-cols-3 gap-6"><div className="col-span-2 h-96 bg-white rounded-2xl animate-pulse border border-slate-200"></div><div className="h-96 bg-white rounded-2xl animate-pulse border border-slate-200"></div></div>
  </div>
);

// ... (Keep SuccessAnimation, ErrorAnimation, StepIndicator, ProgressBar) ...
export const SuccessAnimation = ({ message = "Success!" }) => (
  <div className="flex flex-col items-center justify-center py-12 animate-in zoom-in duration-500">
    <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-4 animate-bounce"><Shield size={40} className="text-green-600" /></div>
    <h3 className="text-xl font-bold text-slate-900 mb-2">{message}</h3>
  </div>
);

export const ErrorAnimation = ({ message = "Something went wrong" }) => (
  <div className="flex flex-col items-center justify-center py-12 animate-in zoom-in duration-500">
    <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mb-4"><span className="text-4xl">⚠️</span></div>
    <h3 className="text-xl font-bold text-slate-900 mb-2">{message}</h3>
  </div>
);