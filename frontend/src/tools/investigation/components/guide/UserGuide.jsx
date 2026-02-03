import React, { useState } from 'react';
import { 
  BookOpen, X, ChevronRight, 
  Activity, Database, GitMerge, Shield, Search,
  Layers, BarChart2, FileText, Brain, Network, Scale 
} from 'lucide-react';

// -------------------------------------------------------
// ADDED MISSING "schema" SECTION
// -------------------------------------------------------
const guideContent = {
  'load': {
    title: 'Data Ingestion & Management',
    icon: <Database size={20} />,
    description: 'The foundational layer of the investigation platform. This module handles the secure upload, validation, and storage of raw financial data.',
    sections: [
      {
        title: 'Purpose',
        content: 'To populate the secure investigation environment with case-specific data (CSVs) while ensuring schema consistency and data integrity.'
      },
      {
        title: 'Required Files',
        content: (
          <ul style={{ paddingLeft: '20px', margin: '8px 0' }}>
            <li><strong>alerts.csv (Mandatory):</strong> Must have alert_id and case_id.</li>
            <li><strong>transactions.csv:</strong> Full transaction history.</li>
            <li><strong>cases.csv:</strong> Metadata about the case.</li>
            <li><strong>accounts.csv:</strong> Account-level data.</li>
            <li><strong>customers.csv:</strong> KYC & customer profile details.</li>
          </ul>
        )
      },
      {
        title: 'How it Works (Functional)',
        content: 'System auto-detects column names, maps them to internal schema, creates SQLite DB, indexes for fast lookup.'
      }
    ],
    outcome: 'A fully populated investigation database ready for analysis.'
  },

  // -------------------------------------------------------
  // NEW — SCHEMA INSPECTOR
  // -------------------------------------------------------
  'schema': {
    title: 'Schema Inspector',
    icon: <Layers size={20} />,
    description: 'View the live database schema generated after loading data. Helps users understand exact column names and relationships.',
    sections: [
      {
        title: 'Why It Matters',
        content: 'Knowing the final schema is essential for writing SQL, debugging joins, and validating ingestion.'
      },
      {
        title: 'Features',
        content: (
          <ul style={{ paddingLeft: '20px', margin: '8px 0' }}>
            <li>View all tables and columns.</li>
            <li>Auto-detects primary keys.</li>
            <li>Shows foreign key relationships if available.</li>
            <li>Useful for LLM-assisted SQL generation.</li>
          </ul>
        )
      }
    ],
    outcome: 'A clear understanding of database structure after ingestion.'
  },

  'table': {
    title: 'Data Explorer',
    icon: <FileText size={20} />,
    description: 'Raw SQL/table view for inspecting underlying data.',
    sections: [
      { title: 'Key Features', content: 'Sorting, pagination, row count, quick filters.' },
      { title: 'Usage', content: 'Verify record correctness, column formats, missing data.' }
    ],
    outcome: 'Quick data validation & debugging.'
  },

  'merge': {
    title: 'Smart Merge (Unified View)',
    icon: <GitMerge size={20} />,
    description: 'Joins all tables into a single master_unified dataset.',
    sections: [
      { title: 'Problem', content: 'Data is split across 5 tables.' },
      { title: 'Solution', content: 'Sequential Left Join: Alerts → Cases → Txns → Accounts → Customers' },
      { title: 'AI Auto-Join', content: 'LLM suggests best join keys automatically.' }
    ],
    outcome: 'Creation of master_unified for AI.'
  },

  'clean': {
    title: 'Data Cleaning Studio',
    icon: <Shield size={20} />,
    description: 'Fill nulls, standardize text, drop useless columns, auto-fix types.',
    sections: [
      {
        title: 'Tools',
        content: (
          <ul style={{ paddingLeft: '20px', margin: '8px 0' }}>
            <li>Fill Nulls</li>
            <li>Standardize Text</li>
            <li>Drop Columns</li>
            <li>Auto-Type Correction</li>
          </ul>
        )
      },
      { title: 'Commit Process', content: 'Creates master_cleaned_data snapshot.' }
    ],
    outcome: 'Clean dataset ready for ML.'
  },

  'rules': {
    title: 'Rule Engine',
    icon: <Scale size={20} />,
    description: 'Deterministic binary rules (velocity, structuring, watchlist).',
    sections: [
      { title: 'How It Works', content: 'Runs IF/THEN checks for each case.' },
      { title: 'Examples', content: 'High velocity, structuring, watchlist match.' }
    ],
    outcome: 'Quick risk scoring.'
  },

  'typology': {
    title: 'Typology Detector',
    icon: <Activity size={20} />,
    description: 'Behavioral ML patterns such as structuring, mule, round amounts.',
    sections: [
      { title: 'What is a Typology?', content: 'Complex laundering pattern.' },
      { title: 'Detection Logic', content: 'Clusters, velocity, round amounts.' }
    ],
    outcome: 'High-fidelity alerts.'
  },

  'baseline': {
    title: 'Baseline Analysis',
    icon: <BarChart2 size={20} />,
    description: 'Compares current behavior vs historical baseline.',
    sections: [
      { title: 'Method', content: 'Z-score comparison for volume/velocity anomalies.' }
    ],
    outcome: 'Detect takeover/bust-out scenarios.'
  },

  'graph': {
    title: 'Graph Analysis',
    icon: <Network size={20} />,
    description: 'Network visualization of customers/accounts/transactions.',
    sections: [
      { title: 'Visualization', content: 'Nodes = entities, edges = transactions.' }
    ],
    outcome: 'Identify rings, funnels, shared links.'
  },

  'vector': {
    title: 'Vector Search (RAG)',
    icon: <Brain size={20} />,
    description: 'Find similar cases using embeddings + FAISS.',
    sections: [
      { title: 'How It Works', content: 'Embeds case narratives and compares similarity.' }
    ],
    outcome: 'Faster investigations using history.'
  },

  'chat': {
    title: 'AI Investigator',
    icon: <Search size={20} />,
    description: 'LLM-powered contextual chat for SQL, case summaries, and explanations.',
    sections: [
      { title: 'Context', content: 'Knows your schema + codebase + data.' }
    ],
    outcome: 'Reduced manual effort.'
  }
};

// -------------------------------------------------------
// MAIN COMPONENT
// -------------------------------------------------------
const UserGuide = ({ isOpen, onClose, activeTab }) => {
  const [selectedGuide, setSelectedGuide] = useState(activeTab || 'load');

  React.useEffect(() => {
    let key = activeTab;

    if (key === 'casepack' || key === 'tree' || key === 'compare') key = 'table';

    if (isOpen && key && guideContent[key]) {
      setSelectedGuide(key);
    }
  }, [activeTab, isOpen]);

  if (!isOpen) return null;

  const content = guideContent[selectedGuide] || guideContent['load'];

  return (
    <div style={s.overlay}>
      <div style={s.panel}>

        <div style={s.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={s.iconBox}><BookOpen size={20} color="white" /></div>
            <div>
              <h2 style={s.title}>Investigator's Manual</h2>
              <p style={s.subtitle}>Interactive Platform Guide</p>
            </div>
          </div>
          <button onClick={onClose} style={s.closeBtn}><X size={24} /></button>
        </div>

        <div style={s.body}>

          {/* Left Navigation */}
          <div style={s.nav}>
            <div style={s.navHeader}>Data Pipeline</div>
            {['load', 'table', 'schema', 'merge', 'clean'].map(key => (
              <NavItem key={key} id={key} item={guideContent[key]} selected={selectedGuide} onClick={setSelectedGuide} />
            ))}

            <div style={s.navHeader}>Analysis Engines</div>
            {['rules', 'typology', 'baseline', 'graph', 'vector'].map(key => (
              <NavItem key={key} id={key} item={guideContent[key]} selected={selectedGuide} onClick={setSelectedGuide} />
            ))}

            <div style={s.navHeader}>AI Assistant</div>
            <NavItem id="chat" item={guideContent['chat']} selected={selectedGuide} onClick={setSelectedGuide} />
          </div>

          {/* Content */}
          <div style={s.content}>
            <div style={s.contentHeader}>
              <div style={{ ...s.contentIcon, color: '#3b82f6', background: '#eff6ff' }}>
                {content.icon}
              </div>
              <h1 style={s.contentTitle}>{content.title}</h1>
            </div>

            <p style={s.description}>{content.description}</p>

            {content.sections.map((section, idx) => (
              <div key={idx} style={s.section}>
                <h3 style={s.sectionTitle}>{section.title}</h3>
                <div style={s.sectionText}>{section.content}</div>
              </div>
            ))}

            <div style={s.outcomeBox}>
              <h4 style={s.outcomeTitle}>Outcome</h4>
              <p style={s.outcomeText}>{content.outcome}</p>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
};

// -------------------------------------------------------
// Navigation item
// -------------------------------------------------------
const NavItem = ({ id, item, selected, onClick }) => (
  <div
    onClick={() => onClick(id)}
    style={{
      ...s.navItem,
      backgroundColor: selected === id ? '#eff6ff' : 'transparent',
      color: selected === id ? '#2563eb' : '#475569',
      borderRight: selected === id ? '3px solid #2563eb' : '3px solid transparent'
    }}
  >
    {React.cloneElement(item.icon, { size: 16 })}
    <span>{item.title}</span>
    {selected === id && <ChevronRight size={14} style={{ marginLeft: 'auto' }} />}
  </div>
);

// -------------------------------------------------------
// Styles
// -------------------------------------------------------
const s = {
  overlay: {
    position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
    background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(4px)', zIndex: 2000,
    display: 'flex', justifyContent: 'center', alignItems: 'center'
  },
  panel: {
    width: '1000px', height: '85vh', background: 'white', borderRadius: '20px',
    boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)', overflow: 'hidden',
    display: 'flex', flexDirection: 'column', border: '1px solid #e2e8f0'
  },
  header: {
    padding: '20px 32px', borderBottom: '1px solid #e2e8f0',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
  },
  iconBox: {
    width: '40px', height: '40px', borderRadius: '10px', background: '#3b82f6',
    display: 'flex', alignItems: 'center', justifyContent: 'center'
  },
  title: { margin: 0, fontSize: '1.25rem', fontWeight: 700 },
  subtitle: { margin: 0, fontSize: '0.85rem', color: '#64748b' },
  closeBtn: { background: 'transparent', border: 'none', cursor: 'pointer', padding: '8px' },

  body: { display: 'flex', flex: 1 },

  nav: {
    width: '280px', background: '#f8fafc', borderRight: '1px solid #e2e8f0',
    overflowY: 'auto', padding: '24px 0'
  },
  navHeader: {
    fontSize: '0.75rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase',
    padding: '0 24px', marginBottom: '8px', marginTop: '16px'
  },
  navItem: {
    display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 24px',
    cursor: 'pointer', fontSize: '0.9rem', fontWeight: 500
  },

  content: { flex: 1, padding: '40px 48px', overflowY: 'auto' },
  contentHeader: { display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' },
  contentIcon: { width: '48px', height: '48px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  contentTitle: { margin: 0, fontSize: '2rem', fontWeight: 800 },

  description: { fontSize: '1.1rem', color: '#475569', lineHeight: 1.6, marginBottom: '40px', borderLeft: '4px solid #cbd5e1', paddingLeft: '20px' },

  section: { marginBottom: '32px' },
  sectionTitle: { fontSize: '1.1rem', fontWeight: 700 },
  sectionText: { fontSize: '0.95rem', lineHeight: 1.6 },

  outcomeBox: {
    marginTop: '40px', background: '#f0fdf4', border: '1px solid #bbf7d0',
    borderRadius: '16px', padding: '24px'
  },
  outcomeTitle: { margin: '0 0 8px 0', color: '#15803d', fontSize: '0.9rem', fontWeight: 700 },
  outcomeText: { margin: 0, fontWeight: 500 }
};

export default UserGuide;
