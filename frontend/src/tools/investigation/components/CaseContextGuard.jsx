// src/tools/investigation/components/CaseContextGuard.jsx (NEW FILE)
// Guards screens that require an active case
import React, { useEffect } from 'react';
import { useAppContext } from '@context/AppContext';
import { AlertTriangle, Inbox } from 'lucide-react';

const CaseContextGuard = ({ children, setActiveTab }) => {
  const { activeCaseId, activeCaseData, clearActiveCase } = useAppContext();

  useEffect(() => {
    // If no active case, redirect to Priority Inbox
    if (!activeCaseId) {
      console.warn('🚫 AIC Guard: No active case, redirecting to Priority Inbox');
      if (setActiveTab) {
        setActiveTab('priority');
      }
    }
  }, [activeCaseId, setActiveTab]);

  // If no active case, show placeholder
  if (!activeCaseId) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="max-w-md text-center p-8">
          <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="text-orange-600" size={32} />
          </div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">
            No Active Investigation
          </h2>
          <p className="text-slate-600 mb-6">
            This screen requires an active case. Please select a case from the Priority Inbox or use the global search.
          </p>
          <button
            onClick={() => setActiveTab && setActiveTab('priority')}
            className="inline-flex items-center gap-2 px-6 py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 font-medium"
          >
            <Inbox size={18} />
            Open Priority Inbox
          </button>
        </div>
      </div>
    );
  }

  // If case exists, render the protected screen
  return children;
};

export default CaseContextGuard;