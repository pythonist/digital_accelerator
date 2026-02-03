import React from 'react';
import { useAppContext } from "@context/AppContext";
// Note: Assuming PageContainer is in 'src/components/layout/' based on your relative path
// If you move it to a tool folder, update this alias accordingly (e.g., @investigation/layout/PageContainer)
import PageContainer from "../../components/layout/PageContainer"; 
import { CheckCircle, AlertTriangle, Info, XCircle, Clock, Trash2, CheckSquare } from 'lucide-react';

const ActivityLogScreen = () => {
  const { notifications, markAllRead, clearHistory } = useAppContext();

  // Helper to get icons
  const getIcon = (type) => {
    switch(type) {
      case 'success': return <CheckCircle size={18} color="#16a34a"/>;
      case 'error': return <XCircle size={18} color="#dc2626"/>;
      case 'warning': return <AlertTriangle size={18} color="#ca8a04"/>;
      default: return <Info size={18} color="#3b82f6"/>;
    }
  };

  const getStyle = (type) => {
    switch(type) {
      case 'success': return { bg: '#f0fdf4', border: '#bbf7d0' };
      case 'error': return { bg: '#fef2f2', border: '#fecaca' };
      case 'warning': return { bg: '#fefce8', border: '#fde047' };
      default: return { bg: '#eff6ff', border: '#bfdbfe' };
    }
  };

  return (
    <PageContainer 
        title="System Activity Log" 
        subtitle="Audit trail of all user actions and system events"
        actions={
            <div style={{display:'flex', gap:'10px'}}>
                <button onClick={markAllRead} style={s.btn}><CheckSquare size={16}/> Mark Read</button>
                <button onClick={clearHistory} style={{...s.btn, color:'#dc2626'}}><Trash2 size={16}/> Clear Log</button>
            </div>
        }
    >
      <div style={{ maxWidth: '800px', margin: '0 auto' }}>
        {notifications.length === 0 && (
            <div style={{padding:'40px', textAlign:'center', color:'#94a3b8', border:'2px dashed #e2e8f0', borderRadius:'12px'}}>
                <Clock size={40} style={{opacity:0.2, marginBottom:'10px'}}/>
                <div>No activity recorded yet.</div>
            </div>
        )}

        {notifications.map(log => (
            <div key={log.id} style={{...s.card, borderLeft: `4px solid ${getIcon(log.type).props.color}`}}>
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'start', marginBottom:'4px'}}>
                    <div style={{display:'flex', alignItems:'center', gap:'8px'}}>
                        {getIcon(log.type)}
                        <span style={{fontWeight:'600', color:'#1e293b'}}>{log.title}</span>
                        {!log.read && <span style={s.newBadge}>NEW</span>}
                    </div>
                    <span style={{fontSize:'0.75rem', color:'#94a3b8'}}>{log.timestamp}</span>
                </div>
                <div style={{paddingLeft:'26px', color:'#64748b', fontSize:'0.9rem'}}>
                    {log.message}
                </div>
            </div>
        ))}
      </div>
    </PageContainer>
  );
};

const s = {
    card: { background:'white', padding:'16px', borderRadius:'8px', border:'1px solid #e2e8f0', marginBottom:'12px', boxShadow:'0 1px 2px rgba(0,0,0,0.02)' },
    newBadge: { fontSize:'0.6rem', background:'#3b82f6', color:'white', padding:'1px 6px', borderRadius:'4px', fontWeight:'bold' },
    btn: { display:'flex', alignItems:'center', gap:'6px', padding:'6px 12px', background:'white', border:'1px solid #cbd5e1', borderRadius:'6px', cursor:'pointer', color:'#475569', fontSize:'0.85rem' }
};

export default ActivityLogScreen;