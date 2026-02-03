// frontend/src/screens/cases/CasePackViewer.jsx
import React, { useState, useEffect, useMemo } from 'react';
import apiClient from "@services/api";

// ✅ Correct Layout Import
import PageContainer from "@investigation-layout/PageContainer";
// ✅ Import Manual Component
import CasePackManual from "@investigation/components/guide/CasePackManual";

// ✅ Import Sub-Screens
import AiExplainPanel from './AiExplainPanel';
import AiReviewPanel from './AiReviewPanel';
import CaseJsonViewer from './CaseJsonViewer';

import {
  Box, Paper, Typography, Button, Stack, Chip, CircularProgress, 
  Tabs, Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TextField, Divider, Drawer, IconButton, InputAdornment, Tooltip
} from '@mui/material';

import {
  NetworkCheck as NetworkIcon, Timeline as ActivityIcon, 
  AttachMoney as DollarSignIcon, Download as DownloadIcon, 
  Search as SearchIcon, ChevronRight as ChevronRightIcon, 
  AutoAwesome as SparklesIcon, HelpOutline as QuestionIcon, 
  Notes as NotesIcon, Code as CodeIcon,
  Person as UserIcon, Work as BriefcaseIcon, AccessTime as ClockIcon,
  Menu as MenuIcon, FilterList as FilterIcon, Close as CloseIcon,
  InfoOutlined // Used for the manual trigger
} from '@mui/icons-material';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';

// --- Visual Graph Component ---
const VisualGraph = ({ network }) => {
  if (!network || !network.top_counterparties || network.top_counterparties.length === 0) {
    return (
      <Box sx={{ height: 300, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: '1px solid #e0e0e0', borderRadius: 2, bgcolor: '#fafafa' }}>
        <NetworkIcon sx={{ fontSize: 48, color: '#bdbdbd', mb: 2, opacity: 0.3 }} />
        <Typography variant="body2" fontWeight="500" color="text.secondary">No Link Analysis Data</Typography>
      </Box>
    );
  }

  const cx = 300, cy = 150;
  const nodes = [];
  const links = [];

  nodes.push({ x: cx, y: cy, color: '#2563eb', label: 'Subject', r: 25 });

  network.top_counterparties.forEach((cp, i) => {
    const angle = (i / network.top_counterparties.length) * Math.PI * 2;
    const radius = 120;
    const nx = cx + Math.cos(angle) * radius;
    const ny = cy + Math.sin(angle) * radius;
    
    nodes.push({ 
      x: nx, y: ny, 
      color: '#64748b',
      label: (cp.name || 'Unknown').substring(0, 12), 
      r: 15, 
      vol: cp.volume || 0 
    });
    links.push({ x1: cx, y1: cy, x2: nx, y2: ny, vol: cp.volume || 0 });
  });

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
      <svg width="100%" height="300" viewBox="0 0 600 300">
        {links.map((l, i) => (
          <g key={`link-${i}`}>
            <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="#e0e0e0" strokeWidth={2} />
            <text x={(l.x1 + l.x2) / 2} y={(l.y1 + l.y2) / 2 + 4} textAnchor="middle" fontSize="9" fill="#757575" fontWeight="600">
              ${(l.vol / 1000).toFixed(0)}k
            </text>
          </g>
        ))}
        {nodes.map((n, i) => (
          <g key={`node-${i}`}>
            <circle cx={n.x} cy={n.y} r={n.r} fill={n.color} stroke="white" strokeWidth="3" />
            <text x={n.x} y={n.y + n.r + 16} textAnchor="middle" fontSize="11" fontWeight="600" fill="#424242">
              {n.label}
            </text>
          </g>
        ))}
      </svg>
    </Paper>
  );
};

const StatCard = ({ label, value, icon }) => (
  <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
    <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
      <Typography variant="caption" fontWeight="bold" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 1 }}>{label}</Typography>
      {icon}
    </Stack>
    <Typography variant="h5" fontWeight="bold" color="text.primary">{value}</Typography>
  </Paper>
);

// --- MAIN PAGE COMPONENT ---
const CasePackViewer = () => {
  const [cases, setCases] = useState([]);
  const [selectedCase, setSelectedCase] = useState(null);
  const [casePack, setCasePack] = useState(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const [notes, setNotes] = useState("");
  
  // ✅ New States for Drawer & Search & Manual
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [showManual, setShowManual] = useState(false);

  useEffect(() => { fetchCases(); }, []);

  const fetchCases = async () => {
    try {
      const res = await apiClient.get('/api/v2/case-list');
      if (Array.isArray(res)) setCases(res);
    } catch (e) { console.error("Fetch Error", e); }
  };

  const loadCase = async (caseId) => {
    setDrawerOpen(false); // Close menu on select to reduce lag
    if (loading && selectedCase === caseId) return;
    
    setLoading(true);
    try {
      const encoded = encodeURIComponent(caseId);
      const res = await apiClient.get(`/api/v2/case-pack/${encoded}`);
      if (res) {
        setCasePack(res);
        setSelectedCase(caseId);
        setNotes("");
      }
    } catch (e) { alert("Failed to load case data."); }
    finally { setLoading(false); }
  };

  // ✅ Filter Logic for Performance
  const filteredCases = useMemo(() => {
    if (!searchTerm) return cases;
    const lower = searchTerm.toLowerCase();
    return cases.filter(c => 
      c.case_id.toLowerCase().includes(lower) || 
      (c.status && c.status.toLowerCase().includes(lower))
    );
  }, [cases, searchTerm]);

  const handleStatusChange = async (newStatus) => {
    if (!selectedCase) return;
    try {
      const encoded = encodeURIComponent(selectedCase);
      await apiClient.post(`/api/v2/case/${encoded}/update-status`, { status: newStatus });
      setCases(prev => prev.map(c => c.case_id === selectedCase ? { ...c, status: newStatus } : c));
    } catch (e) { alert("Status update failed"); }
  };

  // --- RENDERERS ---

  // ✅ New Drawer Menu Implementation
  const renderCaseDrawer = () => (
    <Drawer
      anchor="left"
      open={drawerOpen}
      onClose={() => setDrawerOpen(false)}
      PaperProps={{ sx: { width: 340, display: 'flex', flexDirection: 'column' } }}
    >
      <Box sx={{ p: 2, borderBottom: '1px solid #e0e0e0', bgcolor: '#fafafa' }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" mb={2}>
            <Typography variant="h6" fontWeight="bold">Select Case</Typography>
            <IconButton size="small" onClick={() => setDrawerOpen(false)}>
                <CloseIcon />
            </IconButton>
        </Stack>
        <TextField
          fullWidth
          size="small"
          placeholder="Search Case ID..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          InputProps={{
            startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>,
          }}
        />
      </Box>

      <Box sx={{ flexGrow: 1, overflowY: 'auto' }}>
        {filteredCases.slice(0, 100).map(c => ( // Limit rendering to 100 at a time for speed
          <Box
            key={c.case_id}
            onClick={() => loadCase(c.case_id)}
            sx={{
              p: 2,
              borderBottom: '1px solid #f5f5f5',
              borderLeft: selectedCase === c.case_id ? '4px solid #1976d2' : '4px solid transparent',
              bgcolor: selectedCase === c.case_id ? '#e3f2fd' : 'transparent',
              cursor: 'pointer',
              '&:hover': { bgcolor: '#f5f5f5' }
            }}
          >
            <Stack direction="row" justifyContent="space-between" mb={0.5}>
              <Typography variant="body2" fontWeight="bold" color={selectedCase === c.case_id ? 'primary.main' : 'text.primary'}>
                {c.case_id}
              </Typography>
              <Chip label={c.priority} size="small" color={c.priority === 'High' ? 'error' : 'default'} sx={{ height: 20, fontSize: '0.65rem' }} />
            </Stack>
            <Typography variant="caption" color="text.secondary">Status: {c.status}</Typography>
          </Box>
        ))}
        {filteredCases.length > 100 && (
            <Typography variant="caption" sx={{ display: 'block', textAlign: 'center', p: 2, color: 'text.secondary' }}>
                Use search to see more results...
            </Typography>
        )}
      </Box>
    </Drawer>
  );

  const renderOverview = () => {
    if (!casePack) return <Box sx={{ p: 4 }}>Loading...</Box>;
    const fps = casePack.financial_profile || {};
    const kyc = (casePack.customers && casePack.customers[0]) ? casePack.customers[0] : {};
    return (
      <Box sx={{ p: 4, pb: 10 }}> {/* Added padding bottom for scroll space */}
        <Stack spacing={3}>
          <Paper variant="outlined" sx={{ p: 3, borderRadius: 2, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
            <Stack direction="row" spacing={2} alignItems="center">
              <Box sx={{ width: 64, height: 64, bgcolor: '#e3f2fd', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <UserIcon sx={{ fontSize: 32, color: 'primary.main' }} />
              </Box>
              <Box>
                <Typography variant="h6" fontWeight="bold">{kyc.name || selectedCase}</Typography>
                <Typography variant="body2" color="text.secondary">ID: {kyc.customer_id || 'Unknown'}</Typography>
              </Box>
            </Stack>
            <Box sx={{ textAlign: 'right' }}>
              <Typography variant="caption" fontWeight="bold" color="text.disabled">RISK SCORE</Typography>
              <Typography variant="h4" fontWeight="bold" color={casePack.risk_score > 75 ? 'error.main' : 'warning.main'}>{casePack.risk_score}</Typography>
            </Box>
          </Paper>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 2 }}>
            <StatCard label="Total Volume" value={`$${(fps.total_volume || 0).toLocaleString()}`} icon={<ActivityIcon color="primary" />} />
            <StatCard label="Max Transaction" value={`$${(fps.max_transaction || 0).toLocaleString()}`} icon={<DollarSignIcon color="success" />} />
            <StatCard label="Alerts" value={casePack.alerts ? casePack.alerts.length : 0} icon={<NetworkIcon color="secondary" />} />
          </Box>

          <Paper variant="outlined" sx={{ p: 3, borderRadius: 2, height: 320 }}>
            <Typography variant="caption" fontWeight="bold" color="text.secondary" mb={2}>Velocity Trend</Typography>
            <ResponsiveContainer width="100%" height="90%">
              <BarChart data={fps.monthly_trend || []}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" fontSize={10} />
                <YAxis fontSize={10} />
                <RechartsTooltip />
                <Bar dataKey="volume" fill="#1976d2" barSize={40} radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </Paper>
        </Stack>
      </Box>
    );
  };

  return (
    <PageContainer 
      title="Investigation Workbench" 
      subtitle="Case Management & Intelligence" 
      breadcrumbs={['Investigation', 'Case Packs']}
      actions={
          <Button 
              startIcon={<InfoOutlined />} 
              onClick={() => setShowManual(true)}
              variant="outlined" 
              size="small"
              sx={{ textTransform: 'none', fontWeight: 600 }}
          >
              Guide
          </Button>
      }
    >
      {/* Manual Component */}
      <CasePackManual open={showManual} onClose={() => setShowManual(false)} />
      
      {/* Drawer */}
      {renderCaseDrawer()}

      {/* Main Content Area - Fills the PageContainer */}
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', bgcolor: '#fafafa', borderRadius: 2, border: '1px solid #e0e0e0' }}>
        
        {/* Case Header Bar */}
        <Paper elevation={0} sx={{ px: 3, py: 2, borderBottom: '1px solid #e0e0e0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 1 }}>
            <Stack direction="row" spacing={2} alignItems="center">
                <Button 
                    variant="contained" 
                    startIcon={<MenuIcon />} 
                    onClick={() => setDrawerOpen(true)}
                    sx={{ bgcolor: '#263238', '&:hover': { bgcolor: '#37474f' } }}
                >
                    Case Menu ({cases.length})
                </Button>
                
                {selectedCase && (
                    <Box>
                        <Typography variant="subtitle1" fontWeight="bold">Case {selectedCase}</Typography>
                        <Chip label="Active" size="small" color="primary" variant="outlined" sx={{ height: 20, fontSize: '0.65rem' }} />
                    </Box>
                )}
            </Stack>
            
            {selectedCase && (
                <Button variant="outlined" color="error" size="small" onClick={() => handleStatusChange('Closed')}>Close Case</Button>
            )}
        </Paper>

        {/* Tabs Bar */}
        {selectedCase && (
            <Box sx={{ px: 3, borderBottom: '1px solid #e0e0e0', bgcolor: 'white' }}>
            <Tabs 
                value={activeTab} 
                onChange={(e, v) => setActiveTab(v)}
                variant="scrollable"
                scrollButtons="auto"
            >
                <Tab icon={<ActivityIcon fontSize="small" />} iconPosition="start" label="Overview" />
                <Tab icon={<NetworkIcon fontSize="small" />} iconPosition="start" label="Evidence" />
                <Tab icon={<DollarSignIcon fontSize="small" />} iconPosition="start" label="Ledger" />
                <Tab icon={<SparklesIcon fontSize="small" />} iconPosition="start" label="AI Explain" />
                <Tab icon={<QuestionIcon fontSize="small" />} iconPosition="start" label="AI Review" />
                <Tab icon={<NotesIcon fontSize="small" />} iconPosition="start" label="Notes" />
                <Tab icon={<CodeIcon fontSize="small" />} iconPosition="start" label="JSON Source" />
            </Tabs>
            </Box>
        )}

        {/* Scrollable Content Area */}
        <Box sx={{ flex: 1, overflowY: 'auto', position: 'relative' }}>
          {!selectedCase ? (
             <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'text.secondary' }}>
                <SearchIcon sx={{ fontSize: 64, opacity: 0.2, mb: 2 }} />
                <Typography variant="h6">No Case Selected</Typography>
                <Button sx={{ mt: 2 }} variant="outlined" onClick={() => setDrawerOpen(true)}>Open Case Menu</Button>
             </Box>
          ) : loading ? (
             <Box sx={{ display: 'flex', justifyContent: 'center', pt: 10 }}>
                <CircularProgress />
             </Box>
          ) : (
             <Box sx={{ height: '100%' }}>
                {activeTab === 0 && renderOverview()}
                {activeTab === 1 && <Box sx={{ p: 4 }}><Typography variant="h6" fontWeight="bold" mb={2}>Link Analysis</Typography><VisualGraph network={casePack?.network_profile} /></Box>}
                {activeTab === 2 && (
                    <Box sx={{ p: 4 }}>
                        <TableContainer component={Paper} variant="outlined">
                        <Table size="small">
                            <TableHead><TableRow><TableCell>Date</TableCell><TableCell align="right">Amount</TableCell><TableCell>Type</TableCell><TableCell>Reference</TableCell></TableRow></TableHead>
                            <TableBody>
                            {(casePack?.transactions || []).map((tx, i) => (
                                <TableRow key={i}><TableCell>{tx.date}</TableCell><TableCell align="right">${tx.amount}</TableCell><TableCell>{tx.type}</TableCell><TableCell>{tx.reference}</TableCell></TableRow>
                            ))}
                            </TableBody>
                        </Table>
                        </TableContainer>
                    </Box>
                )}
                {activeTab === 3 && <AiExplainPanel caseId={selectedCase} />}
                {activeTab === 4 && <AiReviewPanel caseId={selectedCase} />}
                {activeTab === 5 && (
                    <Box sx={{ p: 4 }}>
                        <TextField fullWidth multiline rows={12} placeholder="Notes..." value={notes} onChange={e => setNotes(e.target.value)} sx={{ bgcolor: 'white' }} />
                    </Box>
                )}
                {activeTab === 6 && <CaseJsonViewer casePack={casePack} />}
             </Box>
          )}
        </Box>
      </Box>
    </PageContainer>
  );
};

export default CasePackViewer;