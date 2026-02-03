import React, { useState } from 'react';
import { useAppContext } from "@context/AppContext";
import apiClient from "@services/api";

// ✅ Correct Layout Import
import PageContainer from "@investigation-layout/PageContainer";

import { 
  Sparkles, 
  ArrowRight, 
  CheckCircle, 
  Database, 
  RefreshCw, 
  Lock, 
  AlertCircle, 
  Cpu, 
  Play, 
  Download, 
  FileText, 
  Settings, 
  Clock 
} from 'lucide-react';

/**
 * AutoBuildScreen
 * Enterprise-grade ETL interface.
 * Matches Brand Blue (#2563EB / #1D4ED8) and fixes layout overflow.
 */
const AutoBuildScreen = () => {
  // Global Context
  const { masterDataBuilt, datasetLoaded, refreshSystemState, ollamaModels } = useAppContext();
  
  // Local State Machine
  const [status, setStatus] = useState('init'); 
  const [strategy, setStrategy] = useState(null);
  const [buildResult, setBuildResult] = useState(null);
  const [selectedModel, setSelectedModel] = useState('tinyllama');
  const [error, setError] = useState(null);

  // --- API HANDLERS ---

  const handleAnalyze = async () => {
    setStatus('analyzing'); 
    setError(null);
    try {
      const data = await apiClient.post('/api/v2/auto-build/generate-strategy', { 
        model: selectedModel 
      });
      setStrategy(data); 
      setStatus('review');
    } catch (err) { 
      setError("AI Analysis Failed: " + (err.message || "Unknown Error")); 
      setStatus('init'); 
    }
  };

  const handleExecute = async () => {
    setStatus('building');
    try {
      const data = await apiClient.post('/api/v2/auto-build/execute', { 
        chain: strategy.chain 
      });
      
      if (data.success) { 
          setBuildResult(data); 
          setStatus('complete'); 
          refreshSystemState();
      } else { 
          setError(data.error || "Build execution returned failure status"); 
          setStatus('review'); 
      }
    } catch (err) { 
      setError("Build Failed: " + (err.message || "Network Error")); 
      setStatus('review'); 
    }
  };
  
  const handleDownload = () => window.open('/api/v2/merge/export', '_blank');

  // --- RENDER STATES ---

  // 1. STATE: PRE-REQUISITE CHECK (Data Not Loaded)
  if (!datasetLoaded) {
      return (
          <PageContainer 
            title="Master View Builder" 
            subtitle="Automated Schema Unification"
            breadcrumbs={['System', 'Auto Builder']}
          >
            {/* ✅ Added h-full to center content vertically in the container */}
            <div className="flex items-center justify-center h-full">
              <div className="bg-white p-8 rounded-lg border border-slate-200 shadow-sm max-w-md text-center">
                  <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-6 border border-slate-100">
                      <Lock size={32} className="text-slate-400"/>
                  </div>
                  <h3 className="text-lg font-bold text-slate-800 mb-2">Data Source Required</h3>
                  <p className="text-slate-500 text-sm mb-6 leading-relaxed">
                      The automated builder requires raw CSV inputs. Please navigate to the 
                      <strong className="text-slate-700"> Data Load</strong> module to upload source files.
                  </p>
                  <button disabled className="px-6 py-2 bg-slate-100 text-slate-400 rounded-md font-medium text-sm cursor-not-allowed w-full border border-slate-200">
                      Awaiting Data Upload
                  </button>
              </div>
            </div>
          </PageContainer>
      );
  }

  // 2. STATE: EXISTING MASTER DATA (With Fixed Layout & Brand Blue)
  if (masterDataBuilt && status === 'init') {
      return (
        <PageContainer 
            title="Master View Builder" 
            subtitle="Automated Schema Unification"
            breadcrumbs={['System', 'Auto Builder']}
        >
            {/* ✅ Removed 'py-8' to avoid double padding with PageContainer */}
            <div className="max-w-4xl mx-auto h-full flex flex-col justify-start pt-4">
                
                {/* Active Status Card */}
                <div className="bg-white p-8 rounded-lg border border-slate-200 shadow-sm mb-10">
                    <div className="flex items-start gap-6">
                        <div className="bg-emerald-50 w-16 h-16 rounded-lg flex-shrink-0 flex items-center justify-center border border-emerald-100">
                            <CheckCircle size={32} className="text-emerald-600" />
                        </div>
                        
                        <div className="flex-1">
                            <h2 className="text-lg font-bold text-slate-900 mb-2">Master Dataset Active</h2>
                            <p className="text-slate-500 text-sm leading-relaxed mb-6">
                                A unified <span className="font-mono text-slate-700 bg-slate-100 px-1 py-0.5 rounded">master_view</span> 
                                is currently populated in the warehouse. You may proceed to data cleaning, 
                                or rebuild the view if the underlying source files have changed.
                            </p>
                            
                            <div className="flex gap-3">
                                <button 
                                    onClick={() => window.location.hash = '#/clean'} 
                                    className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 transition-all shadow-sm"
                                >
                                    Proceed to Data Cleaning <ArrowRight size={16} />
                                </button>
                                <button 
                                    onClick={() => setStatus('analyzing')} 
                                    className="flex items-center gap-2 px-5 py-2.5 bg-white border border-slate-300 text-slate-700 rounded-md text-sm font-medium hover:bg-slate-50 transition-colors"
                                >
                                    <RefreshCw size={16} /> 
                                    Rebuild Master View
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* History Section */}
                <div>
                   <div className="flex items-center gap-2 mb-2">
                       <Clock size={20} className="text-slate-900"/>
                       <h3 className="text-lg font-bold text-slate-900">Saved Master Datasets</h3>
                   </div>
                   <p className="text-slate-500 text-sm mb-4">
                       These versions are available for Data Cleaning and Analysis.
                   </p>

                   {/* History Card */}
                   <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm hover:shadow-md transition-shadow cursor-pointer group">
                        
                        {/* Header Row: Title & Badge */}
                        <div className="flex items-center gap-3 mb-1">
                            <h4 className="font-bold text-slate-800 text-base">INVESTIGATION Master</h4>
                            <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wide">
                                UNIFIED
                            </span>
                        </div>

                        {/* Time Row */}
                        <div className="text-sm text-slate-900 font-medium mb-3">
                            (16:14)
                        </div>

                        {/* Filename Row */}
                        <div className="flex items-center gap-2 text-slate-500 mb-4 pb-4 border-b border-slate-100">
                             <FileText size={14} className="text-slate-400 group-hover:text-blue-600 transition-colors"/>
                             <span className="text-xs font-mono">investigation_unified_20251231_1614.csv</span>
                        </div>

                        {/* Footer Metadata */}
                        <div className="flex items-center gap-2 text-xs text-slate-400 font-medium">
                            <span className="text-slate-600 font-bold">100 rows</span>
                            <span>•</span>
                            <span>2025-12-31 16:14:23</span>
                        </div>
                   </div>
                </div>
            </div>
        </PageContainer>
      );
  }

  // 3. STATE: BUILD WORKFLOW
  return (
    <PageContainer 
        title="Master View Builder" 
        subtitle="AI-Driven ETL Orchestration"
        breadcrumbs={['System', 'Auto Builder']}
    >
        {/* ✅ Removed 'py-8' to prevent double padding. Using flex to fill height. */}
        <div className="flex justify-center h-full pt-4">
            <div className="w-full max-w-3xl flex flex-col h-full">
                
                {/* STEP INDICATOR */}
                <div className="flex items-center justify-between mb-8 px-4 flex-shrink-0">
                    <StepItem number="01" label="Configuration" active={status === 'init' || status === 'analyzing'} completed={status !== 'init' && status !== 'analyzing'} />
                    <StepConnector />
                    <StepItem number="02" label="Strategy Review" active={status === 'review' || status === 'building'} completed={status === 'complete'} />
                    <StepConnector />
                    <StepItem number="03" label="Finalization" active={status === 'complete'} completed={false} />
                </div>

                {/* CARD CONTAINER - Flex grow to fill space */}
                <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden flex flex-col relative mb-4 flex-1">
                    
                    {/* --- VIEW: INIT --- */}
                    {status === 'init' && (
                        <div className="p-8 flex flex-col h-full">
                            <div className="mb-6">
                                <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                                    <Settings size={20} className="text-blue-600"/>
                                    Build Configuration
                                </h2>
                                <p className="text-sm text-slate-500 mt-1">
                                    Select the Large Language Model to interpret your CSV schema headers.
                                </p>
                            </div>
                            
                            <div className="bg-slate-50 p-6 rounded-lg border border-slate-200 mb-8">
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                                    Inference Model
                                </label>
                                <div className="flex gap-3">
                                    <div className="relative flex-1">
                                        <select 
                                            value={selectedModel} 
                                            onChange={e=>setSelectedModel(e.target.value)} 
                                            className="w-full pl-10 pr-4 py-2.5 rounded-md border border-slate-300 bg-white text-slate-900 text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none appearance-none"
                                        >
                                            {ollamaModels.map(m => <option key={m} value={m}>{m}</option>)}
                                            <option value="tinyllama">tinyllama (Local Optimized)</option>
                                        </select>
                                        <Cpu size={16} className="absolute left-3 top-3 text-slate-400 pointer-events-none"/>
                                    </div>
                                    <button 
                                        onClick={handleAnalyze} 
                                        className="px-6 py-2.5 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 shadow-sm flex items-center gap-2 transition-all whitespace-nowrap"
                                    >
                                        <Sparkles size={16}/> 
                                        Analyze Schema
                                    </button>
                                </div>
                                <p className="text-xs text-slate-400 mt-2 flex items-center gap-1">
                                    <AlertCircle size={12}/>
                                    Local execution ensures data privacy. No external API calls.
                                </p>
                            </div>

                            {error && (
                                <div className="mt-auto bg-rose-50 border border-rose-200 text-rose-800 px-4 py-3 rounded-md text-sm flex items-start gap-2">
                                    <AlertCircle size={16} className="mt-0.5 flex-shrink-0"/>
                                    {error}
                                </div>
                            )}
                        </div>
                    )}

                    {/* --- VIEW: LOADING (Analyzing/Building) --- */}
                    {(status === 'analyzing' || status === 'building') && (
                        <div className="flex flex-col items-center justify-center h-full py-16 px-8 text-center">
                            <div className="relative mb-6">
                                <div className="w-16 h-16 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin"></div>
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <Database size={24} className="text-blue-600"/>
                                </div>
                            </div>
                            <h3 className="text-lg font-bold text-slate-900 mb-2">
                                {status === 'analyzing' ? 'Analyzing Data Structure...' : 'Executing Merge Operations...'}
                            </h3>
                            <p className="text-slate-500 text-sm max-w-sm mx-auto">
                                {status === 'analyzing' 
                                    ? 'The AI is examining column headers to infer relationships and merge keys.' 
                                    : 'Processing data transformation pipeline. This may take a moment.'}
                            </p>
                        </div>
                    )}

                    {/* --- VIEW: REVIEW STRATEGY --- */}
                    {status === 'review' && strategy && (
                        <div className="p-8 flex flex-col h-full animate-in fade-in duration-300">
                            <div className="mb-6 flex justify-between items-start">
                                <div>
                                    <h2 className="text-lg font-bold text-slate-900">Merge Strategy Proposal</h2>
                                    <p className="text-sm text-slate-500 mt-1">Review the AI-generated logic before execution.</p>
                                </div>
                                <span className="px-2 py-1 bg-blue-50 text-blue-700 border border-blue-100 rounded text-xs font-mono">
                                    Confidence: High
                                </span>
                            </div>

                            <div className="bg-slate-50 border border-slate-200 rounded-md p-5 mb-8 flex-1 overflow-y-auto">
                                <div className="flex gap-3 mb-4">
                                    <div className="w-1 bg-blue-500 rounded-full"></div>
                                    <div>
                                        <h4 className="text-sm font-bold text-slate-800">Reasoning Engine</h4>
                                        <p className="text-xs text-slate-500 font-mono mt-1">model: {selectedModel}</p>
                                    </div>
                                </div>
                                <p className="text-sm text-slate-700 italic leading-relaxed border-l-2 border-slate-200 pl-4 py-1">
                                    "{strategy.reasoning}"
                                </p>
                            </div>

                            <div className="flex justify-end gap-3 border-t border-slate-100 pt-6 flex-shrink-0">
                                <button 
                                    onClick={() => setStatus('init')} 
                                    className="px-4 py-2 bg-white border border-slate-300 rounded-md text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors"
                                >
                                    Discard & Retry
                                </button>
                                <button 
                                    onClick={handleExecute} 
                                    className="px-6 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 shadow-sm flex items-center gap-2 transition-colors"
                                >
                                    <Play size={16} fill="currentColor"/> 
                                    Execute Build
                                </button>
                            </div>
                            
                            {error && (
                                <div className="mt-4 bg-rose-50 border border-rose-200 text-rose-800 px-4 py-3 rounded-md text-sm">
                                    Error: {error}
                                </div>
                            )}
                        </div>
                    )}

                    {/* --- VIEW: COMPLETE --- */}
                    {status === 'complete' && buildResult && (
                        <div className="p-8 flex flex-col items-center justify-center h-full animate-in fade-in zoom-in-95 duration-300">
                             <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center mb-6 border border-emerald-100">
                                <CheckCircle size={40} className="text-emerald-500" />
                             </div>
                             
                             <h3 className="text-xl font-bold text-slate-900 mb-2">Build Successful</h3>
                             <p className="text-slate-500 text-sm mb-8">
                                Master view has been generated and indexed in the warehouse.
                             </p>

                             <div className="grid grid-cols-2 gap-4 w-full max-w-sm mb-8">
                                <div className="bg-slate-50 p-4 rounded border border-slate-200 text-center">
                                    <div className="text-xs font-bold text-slate-400 uppercase">Total Rows</div>
                                    <div className="text-xl font-mono font-bold text-slate-800">
                                        {buildResult.row_count?.toLocaleString() || 'N/A'}
                                    </div>
                                </div>
                                <div className="bg-slate-50 p-4 rounded border border-slate-200 text-center">
                                    <div className="text-xs font-bold text-slate-400 uppercase">Status</div>
                                    <div className="text-xl font-bold text-emerald-600">Active</div>
                                </div>
                             </div>

                             <div className="flex gap-3">
                                <button 
                                    onClick={handleDownload} 
                                    className="px-5 py-2 bg-white border border-slate-300 text-slate-700 rounded-md text-sm font-medium hover:bg-slate-50 shadow-sm flex items-center gap-2 transition-colors"
                                >
                                    <Download size={16}/>
                                    Export CSV
                                </button>
                                <button 
                                    onClick={() => refreshSystemState()} 
                                    className="px-6 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 shadow-sm transition-colors"
                                >
                                    Return to Dashboard
                                </button>
                             </div>
                        </div>
                    )}

                </div>
            </div>
        </div>
    </PageContainer>
  );
};

// --- SUB-COMPONENTS for Visual Consistency ---

const StepItem = ({ number, label, active, completed }) => {
    let circleClass = "bg-slate-100 text-slate-400 border-slate-200";
    let textClass = "text-slate-400";
    
    if (completed) {
        circleClass = "bg-emerald-500 text-white border-emerald-500";
        textClass = "text-emerald-600 font-medium";
    } else if (active) {
        // Changed to Brand Blue (blue-600)
        circleClass = "bg-blue-600 text-white border-blue-600 shadow-md ring-2 ring-blue-100";
        textClass = "text-blue-700 font-bold";
    }

    return (
        <div className="flex flex-col items-center gap-2">
            <div className={`w-8 h-8 rounded-full border flex items-center justify-center text-xs font-bold transition-all ${circleClass}`}>
                {completed ? <CheckCircle size={14} /> : number}
            </div>
            <span className={`text-xs uppercase tracking-wide transition-all ${textClass}`}>
                {label}
            </span>
        </div>
    );
};

const StepConnector = () => (
    <div className="flex-1 h-px bg-slate-200 mx-4 mt-[-20px]"></div>
);

export default AutoBuildScreen;