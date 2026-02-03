import React, { useState, useEffect } from 'react';
// Go up 4 levels to reach 'src'
import apiClient from "@services/api";

// PageContainer is inside 'tools/investigation/components', so we go up 3 levels
// from 'data' -> 'screens' -> 'investigation' -> 'components'
import PageContainer from "@investigation/layout/PageContainer";
import { Database, Play, Download, Layers, CheckCircle } from 'lucide-react';

const MasterViewScreen = () => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [building, setBuilding] = useState(false);
  const [lastBuilt, setLastBuilt] = useState(null);

  useEffect(() => {
    loadMasterData();
  }, []);

  const loadMasterData = async () => {
    setLoading(true);
    try {
      const res = await apiClient.post('/api/v2/db/query-table', {
        table: 'master_case_summary',
        page: 1,
        rowsPerPage: 100
      });
      if (res.success) setData(res.data);
    } catch (e) {
      console.log("Master table doesn't exist yet.");
    } finally {
      setLoading(false);
    }
  };

  const handleBuild = async () => {
    setBuilding(true);
    try {
      const res = await apiClient.post('/api/v2/merge/build-aml-master', {});
      if (res.success) {
        setLastBuilt(new Date().toLocaleTimeString());
        loadMasterData(); 
      } else {
        alert("Build Failed: " + res.error);
      }
    } catch (e) {
      alert("Error triggering build");
    } finally {
      setBuilding(false);
    }
  };

  const handleExport = () => {
    window.open('/api/v2/merge/export?table=master_case_summary', '_blank');
  };

  return (
    <PageContainer title="Master Data Management" subtitle="Aggregated Entity-Centric View (One Row Per Case)">
      
      {/* Control Panel */}
      <div className="bg-white p-6 rounded-lg border border-slate-200 mb-6 flex justify-between items-center shadow-sm">
        <div>
          <h3 className="m-0 flex items-center gap-2 text-lg font-bold text-slate-800">
            <Layers size={20} className="text-blue-500" /> AML Golden Record
          </h3>
          <p className="text-slate-500 mt-2 text-sm">
             Aggregates Alerts and Transactions into a single case row to prevent data explosion.
          </p>
        </div>
        <div className="flex gap-4 items-center">
          {lastBuilt && (
            <span className="text-xs text-emerald-500 flex items-center gap-1 font-medium bg-emerald-50 px-2 py-1 rounded border border-emerald-100">
              <CheckCircle size={12}/> Built at {lastBuilt}
            </span>
          )}
          
          <button 
            onClick={handleBuild} 
            disabled={building} 
            className={`
              flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-md font-semibold text-sm transition-all shadow-sm
              ${building ? 'opacity-70 cursor-not-allowed' : 'hover:bg-blue-700 hover:shadow-md'}
            `}
          >
            {building ? 'Aggregating...' : 'Build Master Dataset'} <Play size={16} />
          </button>
          
          {data.length > 0 && (
            <button 
              onClick={handleExport} 
              className="p-3 bg-white border border-slate-300 rounded-md hover:bg-slate-50 text-slate-600 transition-colors shadow-sm"
              title="Export CSV"
            >
              <Download size={18} />
            </button>
          )}
        </div>
      </div>

      {/* Data Grid */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-sm flex flex-col min-h-[400px]">
        {data.length === 0 ? (
           <div className="p-16 text-center text-slate-400 flex flex-col items-center justify-center h-full">
             <Database size={48} className="opacity-20 mb-4" />
             <p>No Master Data found. Click "Build Master Dataset" to generate.</p>
           </div>
        ) : (
           <div className="overflow-x-auto">
             <table className="w-full border-collapse text-sm">
               <thead>
                 <tr className="bg-slate-50 border-b-2 border-slate-200">
                   {['Case ID', 'Customer', 'Occupation', 'Alerts', 'Risk Score', 'Txn Volume', 'Max Txn', 'Primary Alert'].map(h => (
                     <th key={h} className="p-4 text-left font-semibold text-slate-600 whitespace-nowrap uppercase text-xs tracking-wider">{h}</th>
                   ))}
                 </tr>
               </thead>
               <tbody>
                 {data.map((row, i) => (
                   <tr key={i} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                     <td className="p-4 text-slate-700 font-bold whitespace-nowrap">{row.case_id}</td>
                     <td className="p-4 text-slate-600 whitespace-nowrap">{row.customer_name || row.customer_id}</td>
                     <td className="p-4 text-slate-600 whitespace-nowrap">{row.occupation}</td>
                     <td className="p-4 text-slate-600 whitespace-nowrap">{row.total_alerts}</td>
                     <td className="p-4 whitespace-nowrap">
                        <span className={`
                          px-2 py-0.5 rounded-full text-xs font-bold
                          ${row.total_risk_score > 50 ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-800'}
                        `}>
                          {row.total_risk_score}
                        </span>
                     </td>
                     <td className="p-4 text-slate-600 whitespace-nowrap">₹{row.total_volume?.toLocaleString()}</td>
                     <td className="p-4 text-slate-600 whitespace-nowrap">₹{row.max_txn_amt?.toLocaleString()}</td>
                     <td className="p-4 text-slate-600 whitespace-nowrap">{row.primary_alert_type}</td>
                   </tr>
                 ))}
               </tbody>
             </table>
           </div>
        )}
      </div>

    </PageContainer>
  );
};

export default MasterViewScreen;