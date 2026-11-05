// frontend/src/screens/cases/CasePackViewer.jsx
import React, { useState, useEffect, useMemo } from 'react';
import apiClient from "@services/api";
import {
  mergeFccSentinelHandoff,
  readFccSentinelHandoff,
} from '../../../../utils/fccSentinelHandoff';
import { mergeCaseResolutionModule } from '../../utils/caseResolutionStore';

import PageContainer from "@investigation-layout/PageContainer";
import CasePackManual from "@investigation/components/guide/CasePackManual";

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
  TrendingUp as TrendingUpIcon, TrendingDown as TrendingDownIcon,
  AccountBalance as BankIcon, WarningAmber as WarningAmberIcon,
  Shield as ShieldIcon, CheckCircle as CheckCircleIcon,
  SwapHoriz as SwapHorizIcon, Public as GlobeIcon,
  InfoOutlined
} from '@mui/icons-material';

import {
  ComposedChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, Legend
} from 'recharts';

const fmtNum = (v, digits = 0) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '-';
  return n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
};

const StatCard = ({ label, value, sub, icon, color = '#0f172a' }) => (
  <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 2, bgcolor: '#ffffff', border: '1px solid #e2e8f0' }}>
    <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
      <Typography variant="caption" fontWeight="700" color="#64748b" sx={{ textTransform: 'uppercase', letterSpacing: 0.8, fontSize: 11 }}>
        {label}
      </Typography>
      {icon}
    </Stack>
    <Typography variant="h5" fontWeight="800" sx={{ color }}>
      {value}
    </Typography>
    {sub && (
      <Typography variant="caption" sx={{ color: '#64748b', fontSize: 11, mt: 0.5, display: 'block' }}>
        {sub}
      </Typography>
    )}
  </Paper>
);

const VisualGraph = ({ network }) => {
  const [selectedNode, setSelectedNode] = useState(null);

  const topCps = useMemo(() => {
    if (network?.top_counterparties?.length) return network.top_counterparties;
    if (network?.link_analysis?.links?.length) {
      return network.link_analysis.links.map((l) => ({
        name: String(l.target || l.target_id || 'Counterparty'),
        volume: Number(l.amount || l.volume || 0),
        type: String(l.type || 'COUNTERPARTY'),
        tx_count: l.tx_count || 1,
      }));
    }
    return [];
  }, [network]);

  if (!network || (topCps.length === 0 && !network?.link_analysis?.nodes?.length)) {
    return (
      <Box sx={{ minHeight: 380, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: '1px solid #e2e8f0', borderRadius: 2, bgcolor: '#f8fafc', p: 4 }}>
        <NetworkIcon sx={{ fontSize: 52, color: '#94a3b8', mb: 2, opacity: 0.4 }} />
        <Typography variant="subtitle1" fontWeight="700" color="#334155">
          No Linked Network Data Available
        </Typography>
        <Typography variant="body2" color="#64748b" sx={{ mt: 0.5 }}>
          {network?.link_analysis?.reason || 'No counterparties or multi-hop connections recorded for this case.'}
        </Typography>
      </Box>
    );
  }

  const cx = 220, cy = 180;
  const nodes = [{ id: 'subject', x: cx, y: cy, color: '#2563eb', label: 'Focal Subject', r: 24, isCenter: true, type: 'ACCOUNT' }];
  const links = [];

  topCps.forEach((cp, i) => {
    const angle = (i / Math.max(1, topCps.length)) * Math.PI * 2;
    const radius = 125;
    const nx = cx + Math.cos(angle) * radius;
    const ny = cy + Math.sin(angle) * radius;
    const name = String(cp.name || cp.id || `CP-${i + 1}`);
    
    nodes.push({ 
      id: name,
      x: nx, 
      y: ny, 
      color: '#475569',
      label: name.length > 14 ? name.substring(0, 13) + '…' : name, 
      fullName: name,
      r: 15, 
      vol: Number(cp.volume || cp.amount || 0),
      type: cp.type || 'COUNTERPARTY',
    });
    links.push({ from: nodes[0], to: nodes[nodes.length - 1], vol: Number(cp.volume || cp.amount || 0) });
  });

  const totalVol = topCps.reduce((acc, c) => acc + Number(c.volume || c.amount || 0), 0);

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '440px 1fr' }, gap: 2.5 }}>
      {/* 1. Visual Link Map */}
      <Paper variant="outlined" sx={{ borderRadius: 2, p: 2, bgcolor: '#ffffff', borderColor: '#e2e8f0' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
            Topology Visualizer ({nodes.length - 1} linked entities)
          </Typography>
          <Chip size="small" label="Click node to inspect" sx={{ fontSize: 10, height: 20 }} />
        </Box>
        <Box sx={{ bgcolor: '#f8fafc', borderRadius: 1.5, border: '1px solid #f1f5f9', overflow: 'hidden' }}>
          <svg width="100%" height="360" viewBox="0 0 440 360">
            {links.map((l, i) => (
              <g key={`link-${i}`}>
                <line x1={l.from.x} y1={l.from.y} x2={l.to.x} y2={l.to.y} stroke={selectedNode?.id === l.to.id ? '#ea580c' : '#cbd5e1'} strokeWidth={selectedNode?.id === l.to.id ? 2.5 : 1.5} />
              </g>
            ))}
            {nodes.map((n, i) => {
              const isSel = selectedNode?.id === n.id;
              return (
                <g key={`node-${i}`} onClick={() => setSelectedNode(n)} style={{ cursor: 'pointer' }}>
                  <circle
                    cx={n.x}
                    cy={n.y}
                    r={n.r}
                    fill={isSel ? '#ea580c' : n.color}
                    stroke="#ffffff"
                    strokeWidth={isSel ? 3 : 2}
                  />
                  <text x={n.x} y={n.y + n.r + 14} textAnchor="middle" fontSize="10.5" fontWeight={isSel ? '700' : '600'} fill={isSel ? '#ea580c' : '#334155'}>
                    {n.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </Box>
      </Paper>

      {/* 2. Linked Counterparties & Intelligence Details Table */}
      <Paper variant="outlined" sx={{ borderRadius: 2, p: 2, bgcolor: '#ffffff', borderColor: '#e2e8f0', display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
          <Box>
            <Typography sx={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>
              Linked Counterparty Intelligence
            </Typography>
            <Typography variant="caption" sx={{ color: '#64748b' }}>
              Direct transaction exposure and concentration breakdown
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Chip size="small" label={`Total Exposure: ${totalVol.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} sx={{ fontWeight: 700, bgcolor: '#eff6ff', color: '#1e40af', border: '1px solid #bfdbfe' }} />
          </Box>
        </Box>

        <TableContainer sx={{ flex: 1, maxHeight: 320 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700, fontSize: 11, color: '#64748b', bgcolor: '#f8fafc' }}>COUNTERPARTY / ENTITY</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: 11, color: '#64748b', bgcolor: '#f8fafc' }}>TYPE</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700, fontSize: 11, color: '#64748b', bgcolor: '#f8fafc' }}>TRANSACTED AMOUNT</TableCell>
                <TableCell align="center" sx={{ fontWeight: 700, fontSize: 11, color: '#64748b', bgcolor: '#f8fafc' }}>STATUS</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {topCps.map((cp, idx) => {
                const name = String(cp.name || cp.id || `Counterparty-${idx + 1}`);
                const isSel = selectedNode?.id === name;
                const vol = Number(cp.volume || cp.amount || 0);
                return (
                  <TableRow
                    key={`cp_${idx}`}
                    onClick={() => setSelectedNode(nodes.find(n => n.id === name) || null)}
                    sx={{
                      cursor: 'pointer',
                      bgcolor: isSel ? '#fff7ed' : 'transparent',
                      '&:hover': { bgcolor: isSel ? '#ffedd5' : '#f8fafc' },
                    }}
                  >
                    <TableCell sx={{ fontWeight: 700, color: isSel ? '#ea580c' : '#0f172a', fontSize: 12 }}>
                      {name}
                    </TableCell>
                    <TableCell sx={{ color: '#64748b', fontSize: 11 }}>
                      <Chip label={cp.type || 'Counterparty'} size="small" sx={{ height: 20, fontSize: '0.65rem' }} />
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, color: '#0f172a', fontSize: 12 }}>
                      {vol.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell align="center">
                      <Chip label={vol > 100000 ? 'High Volume' : 'Active'} size="small" sx={{ height: 18, fontSize: '0.62rem', bgcolor: vol > 100000 ? '#fef2f2' : '#f0fdf4', color: vol > 100000 ? '#dc2626' : '#16a34a' }} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Box>
  );
};

// --- MAIN PAGE COMPONENT ---
const CasePackViewer = () => {
  const [cases, setCases] = useState([]);
  const [selectedCase, setSelectedCase] = useState(null);
  const [casePack, setCasePack] = useState(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const [notes, setNotes] = useState("");
  
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [showManual, setShowManual] = useState(false);

  useEffect(() => { fetchCases(); }, []);

  useEffect(() => {
    const selectedStillVisible = cases.some((item) => item.case_id === selectedCase);
    if (cases.length > 0 && (!selectedCase || !selectedStillVisible)) {
      const restoredCaseId = String(readFccSentinelHandoff()?.selected_case_id || '').trim();
      const restoredVisibleCase = restoredCaseId
        ? cases.find((item) => String(item.case_id) === restoredCaseId)
        : null;
      loadCase((restoredVisibleCase || cases[0]).case_id);
    }
  }, [cases, selectedCase]);

  const fetchCases = async () => {
    try {
      const res = await apiClient.get('/api/v2/case-list');
      if (Array.isArray(res)) setCases(res);
    } catch (e) { console.error("Fetch Error", e); }
  };

  const loadCase = async (caseId) => {
    setDrawerOpen(false);
    if (loading && selectedCase === caseId) return;
    
    setLoading(true);
    try {
      const encoded = encodeURIComponent(caseId);
      const res = await apiClient.get(`/api/v2/case-pack/${encoded}`);
      if (res) {
        setCasePack(res);
        setSelectedCase(caseId);
        const savedNotes = localStorage.getItem(`case_notes_${caseId}`) || "";
        setNotes(savedNotes);
        mergeFccSentinelHandoff({
          selected_case_id: caseId,
          preferred_screen: 'casepack',
        });
        mergeCaseResolutionModule(caseId, 'case_pack', {
          risk_score: res?.risk_score,
          alerts: Array.isArray(res?.alerts) ? res.alerts.slice(0, 20) : [],
          ledger: Array.isArray(res?.ledger) ? res.ledger.slice(0, 20) : [],
          typology_flags: res?.typology_flags || {},
          link_analysis: res?.link_analysis || null,
          network_profile: res?.network_profile || null,
          financial_profile: res?.financial_profile || null,
        });
      }
    } catch (e) { alert("Failed to load case data."); }
    finally { setLoading(false); }
  };

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
        {filteredCases.slice(0, 100).map(c => (
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
    const ledger = Array.isArray(casePack.ledger) ? casePack.ledger : [];
    const alerts = Array.isArray(casePack.alerts) ? casePack.alerts : [];
    const typologies = Array.isArray(casePack.typology_flags) ? casePack.typology_flags : [];

    // 1. Flow Calculations (Credit vs Debit)
    const creditVol = Number(
      fps.flow_ratio?.credit !== undefined
        ? fps.flow_ratio.credit
        : ledger.filter(t => /cr|dep|in|rec|recv/i.test(t.type || t.direction || t.txn_type || '')).reduce((a, b) => a + Number(b.amount || 0), 0)
    );
    const debitVol = Number(
      fps.flow_ratio?.debit !== undefined
        ? fps.flow_ratio.debit
        : ledger.filter(t => /dr|deb|with|out|pay|send/i.test(t.type || t.direction || t.txn_type || '')).reduce((a, b) => a + Number(b.amount || 0), 0)
    );
    const totalVol = fps.total_volume || (creditVol + debitVol) || ledger.reduce((a, b) => a + Number(b.amount || 0), 0);
    const netBalance = creditVol - debitVol;
    const passThroughRatio = creditVol > 0 ? ((debitVol / creditVol) * 100).toFixed(1) : (debitVol > 0 ? '100.0' : '0.0');

    const flowPieData = [
      { name: 'Inflow (Credits)', value: creditVol, color: '#10b981' },
      { name: 'Outflow (Debits)', value: debitVol, color: '#ef4444' },
    ];
    if (creditVol === 0 && debitVol === 0) {
      flowPieData.push({ name: 'No Flow Data', value: 1, color: '#cbd5e1' });
    }

    // 2. Velocity Trend with Monthly Transaction Count & Volume
    const monthlyMap = {};
    ledger.forEach(tx => {
      const d = String(tx.date || tx.ts || tx.timestamp || '');
      const m = d.length >= 7 ? d.substring(0, 7) : '2020-05';
      if (!monthlyMap[m]) monthlyMap[m] = { month: m, volume: 0, count: 0 };
      monthlyMap[m].volume += Number(tx.amount || 0);
      monthlyMap[m].count += 1;
    });
    let trendData = Object.values(monthlyMap).sort((a, b) => a.month.localeCompare(b.month));
    if (trendData.length === 0 && Array.isArray(fps.monthly_trend) && fps.monthly_trend.length > 0) {
      trendData = fps.monthly_trend.map(t => ({
        month: t.month,
        volume: Number(t.volume || 0),
        count: Math.max(1, Math.round(Number(t.volume || 0) / (fps.avg_transaction || 50000))),
      }));
    }

    // 3. Transaction Amount Distribution & Structuring Bands
    const bins = [
      { band: '< 10K', count: 0, volume: 0, color: '#64748b' },
      { band: '9K-10K (Structuring)', count: 0, volume: 0, color: '#ea580c' },
      { band: '10K-50K', count: 0, volume: 0, color: '#2563eb' },
      { band: '50K-100K', count: 0, volume: 0, color: '#7c3aed' },
      { band: '> 100K (High Value)', count: 0, volume: 0, color: '#dc2626' },
    ];
    ledger.forEach(tx => {
      const a = Number(tx.amount || 0);
      if (a >= 9000 && a < 10000) {
        bins[1].count++;
        bins[1].volume += a;
      } else if (a < 10000) {
        bins[0].count++;
        bins[0].volume += a;
      } else if (a <= 50000) {
        bins[2].count++;
        bins[2].volume += a;
      } else if (a <= 100000) {
        bins[3].count++;
        bins[3].volume += a;
      } else {
        bins[4].count++;
        bins[4].volume += a;
      }
    });

    // 4. Top Counterparties Ranking
    let topCounterparties = casePack.network_profile?.top_counterparties || [];
    if (!topCounterparties.length && casePack.link_analysis?.links?.length) {
      topCounterparties = casePack.link_analysis.links.map(l => ({
        name: String(l.target || l.target_id || 'Counterparty'),
        volume: Number(l.amount || l.volume || 0),
      }));
    }
    if (!topCounterparties.length) {
      const cpMap = {};
      ledger.forEach((tx, idx) => {
        const cp = String(tx.reference || tx.counterparty || `Counterparty-${idx + 1}`);
        cpMap[cp] = (cpMap[cp] || 0) + Number(tx.amount || 0);
      });
      topCounterparties = Object.entries(cpMap)
        .map(([name, volume]) => ({ name: name.length > 18 ? name.substring(0, 17) + '…' : name, volume }))
        .sort((a, b) => b.volume - a.volume)
        .slice(0, 5);
    }

    const riskScore = Number(casePack.risk_score || 0);
    const riskColor = riskScore > 75 ? '#dc2626' : riskScore > 40 ? '#ea580c' : '#16a34a';
    const riskLabel = riskScore > 75 ? 'HIGH RISK' : riskScore > 40 ? 'MEDIUM RISK' : 'LOW RISK';
    const riskBg = riskScore > 75 ? '#fef2f2' : riskScore > 40 ? '#fff7ed' : '#f0fdf4';

    return (
      <Box sx={{ p: 3, pb: 10 }}>
        <Stack spacing={2.5}>
          {/* ============================================================ */}
          {/* 1. UNIFIED EXECUTIVE INTELLIGENCE & FINANCIAL DOSSIER RIBBON */}
          {/* ============================================================ */}
          <Paper
            variant="outlined"
            sx={{
              p: 2.25,
              borderRadius: 2,
              bgcolor: '#ffffff',
              borderColor: '#e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 2.5,
              boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
            }}
          >
            {/* Left: Focal Subject Identity & KYC */}
            <Stack direction="row" spacing={2} alignItems="center">
              <Box
                sx={{
                  width: 44,
                  height: 44,
                  bgcolor: '#f1f5f9',
                  borderRadius: 1.5,
                  display: 'grid',
                  placeItems: 'center',
                  border: '1px solid #e2e8f0',
                }}
              >
                <UserIcon sx={{ fontSize: 22, color: '#334155' }} />
              </Box>
              <Box>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography sx={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>
                    {kyc.name || selectedCase}
                  </Typography>
                  <Chip
                    label={kyc.customer_id || 'CUST-000449'}
                    size="small"
                    sx={{ height: 20, fontSize: 10.5, fontWeight: 700, bgcolor: '#f8fafc', border: '1px solid #e2e8f0', color: '#475569' }}
                  />
                  <Chip
                    label="KYC Verified"
                    size="small"
                    sx={{ height: 20, fontSize: 10.5, fontWeight: 700, bgcolor: '#eff6ff', color: '#1d4ed8' }}
                  />
                </Stack>
                <Typography sx={{ fontSize: 12, color: '#64748b', mt: 0.25 }}>
                  Account: <Box component="span" sx={{ fontWeight: 700, color: '#1e293b' }}>{kyc.account_id || `ACCT-${selectedCase}`}</Box> • High Velocity Profile
                </Typography>
              </Box>
            </Stack>

            {/* Center: Integrated High-Density Financial Metrics (Zero Boxiness) */}
            <Stack
              direction="row"
              spacing={3}
              alignItems="center"
              divider={<Divider orientation="vertical" flexItem sx={{ height: 30, my: 'auto', borderColor: '#e2e8f0' }} />}
              sx={{ flexWrap: 'wrap' }}
            >
              {/* Total Volume */}
              <Box>
                <Typography sx={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.7, color: '#64748b' }}>
                  Total Volume
                </Typography>
                <Typography sx={{ fontSize: 17, fontWeight: 800, color: '#0f172a', lineHeight: 1.2 }}>
                  {fmtNum(totalVol, 2)}
                </Typography>
                <Typography sx={{ fontSize: 10.5, color: '#94a3b8' }}>
                  {ledger.length} total txns
                </Typography>
              </Box>

              {/* Inflow vs Outflow Net */}
              <Box>
                <Typography sx={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.7, color: '#64748b' }}>
                  Net Cash Flow
                </Typography>
                <Typography sx={{ fontSize: 17, fontWeight: 800, color: netBalance >= 0 ? '#16a34a' : '#dc2626', lineHeight: 1.2 }}>
                  {fmtNum(netBalance, 2)}
                </Typography>
                <Typography sx={{ fontSize: 10.5, color: '#64748b' }}>
                  Cr: {fmtNum(creditVol)} | Dr: {fmtNum(debitVol)}
                </Typography>
              </Box>

              {/* Max Transaction */}
              <Box>
                <Typography sx={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.7, color: '#64748b' }}>
                  Max Transaction
                </Typography>
                <Typography sx={{ fontSize: 17, fontWeight: 800, color: '#0f172a', lineHeight: 1.2 }}>
                  {fmtNum(fps.max_transaction || 0, 2)}
                </Typography>
                <Typography sx={{ fontSize: 10.5, color: '#94a3b8' }}>
                  Peak single exposure
                </Typography>
              </Box>

              {/* Alerts */}
              <Box>
                <Typography sx={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.7, color: '#64748b' }}>
                  Alert Status
                </Typography>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography sx={{ fontSize: 17, fontWeight: 800, color: '#dc2626', lineHeight: 1.2 }}>
                    {alerts.length || 1}
                  </Typography>
                  <Chip
                    size="small"
                    label={typologies.length > 0 ? `${typologies.length} Typologies` : 'Active Triage'}
                    sx={{ height: 18, fontSize: 10, bgcolor: '#fef2f2', color: '#dc2626', fontWeight: 700 }}
                  />
                </Stack>
                <Typography sx={{ fontSize: 10.5, color: '#94a3b8' }}>
                  Open for resolution
                </Typography>
              </Box>
            </Stack>

            {/* Right: Risk Gauge */}
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                pl: 2,
                borderLeft: { xs: 'none', md: '1px solid #e2e8f0' },
              }}
            >
              <Box sx={{ textAlign: 'right' }}>
                <Typography sx={{ fontSize: 10.5, fontWeight: 800, color: riskColor, letterSpacing: 0.6 }}>
                  {riskLabel}
                </Typography>
                <Typography sx={{ fontSize: 10, color: '#94a3b8' }}>
                  RISK GAUGE
                </Typography>
              </Box>
              <Box
                sx={{
                  width: 42,
                  height: 42,
                  borderRadius: '50%',
                  bgcolor: riskBg,
                  border: `2px solid ${riskColor}`,
                  display: 'grid',
                  placeItems: 'center',
                  fontWeight: 900,
                  fontSize: 16,
                  color: riskColor,
                }}
              >
                {riskScore}
              </Box>
            </Box>
          </Paper>

          {/* ============================================================ */}
          {/* 2. TYPOLOGY & RED FLAG STATUS STRIP */}
          {/* ============================================================ */}
          <Paper variant="outlined" sx={{ px: 2, py: 1.25, borderRadius: 1.5, bgcolor: '#f8fafc', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5 }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <ShieldIcon sx={{ fontSize: 16, color: '#475569' }} />
              <Typography sx={{ fontSize: 12, fontWeight: 800, color: '#0f172a' }}>
                Regulatory Typologies:
              </Typography>
            </Stack>
            <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
              <Chip
                size="small"
                label={`Velocity Spike: ${trendData.length > 1 ? 'Elevated' : 'Normal'}`}
                sx={{ fontSize: 11, height: 22, bgcolor: trendData.length > 1 ? '#fff7ed' : '#f1f5f9', color: trendData.length > 1 ? '#c2410c' : '#475569', fontWeight: 700 }}
              />
              <Chip
                size="small"
                label={`Pass-Through Ratio: ${passThroughRatio}%`}
                sx={{ fontSize: 11, height: 22, bgcolor: Number(passThroughRatio) > 80 ? '#fef2f2' : '#f0fdf4', color: Number(passThroughRatio) > 80 ? '#dc2626' : '#16a34a', fontWeight: 700 }}
              />
              <Chip
                size="small"
                label={bins[1].count > 0 ? `Structuring Alert (${bins[1].count} txns in 9k-10k band)` : 'Structuring: Cleared'}
                sx={{ fontSize: 11, height: 22, bgcolor: bins[1].count > 0 ? '#fef2f2' : '#f0fdf4', color: bins[1].count > 0 ? '#dc2626' : '#16a34a', fontWeight: 700 }}
              />
              <Chip
                size="small"
                label={`Top CP Exposure: ${topCounterparties.length} Counterparties`}
                sx={{ fontSize: 11, height: 22, bgcolor: '#eff6ff', color: '#1e40af', fontWeight: 700 }}
              />
            </Stack>
          </Paper>

          {/* ============================================================ */}
          {/* 3. PRIMARY CHARTS ROW: DUAL-AXIS VELOCITY & FLOW DONUT */}
          {/* ============================================================ */}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1.45fr 1fr' }, gap: 2.5 }}>
            {/* Velocity & Volume Composed Chart */}
            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, bgcolor: '#ffffff', border: '1px solid #e2e8f0' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Box>
                  <Typography sx={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>
                    Transaction Velocity & Volume Trend
                  </Typography>
                  <Typography variant="caption" sx={{ color: '#64748b' }}>
                    Monthly transaction volume bars with transaction count frequency line
                  </Typography>
                </Box>
                <Chip size="small" label="Monthly Aggregated" sx={{ fontSize: 10.5, height: 22, bgcolor: '#f1f5f9', fontWeight: 600 }} />
              </Box>
              <Box sx={{ width: '100%', height: 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="month" fontSize={11} stroke="#64748b" tickLine={false} />
                    <YAxis yAxisId="left" fontSize={11} stroke="#64748b" tickLine={false} axisLine={false} tickFormatter={(v) => fmtNum(v)} />
                    <YAxis yAxisId="right" orientation="right" fontSize={11} stroke="#ea580c" tickLine={false} axisLine={false} />
                    <RechartsTooltip
                      formatter={(val, name) => [
                        name === 'Transaction Count' ? val : fmtNum(val, 2),
                        name
                      ]}
                      contentStyle={{ backgroundColor: '#0f172a', borderRadius: '8px', color: '#fff', border: 'none', fontSize: '12px' }}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                    <Bar yAxisId="left" dataKey="volume" name="Transacted Volume" fill="#2563eb" barSize={34} radius={[4, 4, 0, 0]} />
                    <Line yAxisId="right" type="monotone" dataKey="count" name="Transaction Count" stroke="#ea580c" strokeWidth={2.5} dot={{ r: 4, fill: '#ea580c' }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </Box>
            </Paper>

            {/* Inflow vs Outflow Donut Flow */}
            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, bgcolor: '#ffffff', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                <Box>
                  <Typography sx={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>
                    Cash Flow & Pass-Through
                  </Typography>
                  <Typography variant="caption" sx={{ color: '#64748b' }}>
                    Inflow credits vs. outflow debits
                  </Typography>
                </Box>
                <Chip
                  size="small"
                  label={`Drain: ${passThroughRatio}%`}
                  sx={{
                    fontSize: 10.5,
                    height: 22,
                    fontWeight: 700,
                    bgcolor: Number(passThroughRatio) > 85 ? '#fef2f2' : '#f0fdf4',
                    color: Number(passThroughRatio) > 85 ? '#dc2626' : '#16a34a'
                  }}
                />
              </Box>
              <Box sx={{ width: '100%', height: 200, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={flowPieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={52}
                      outerRadius={76}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {flowPieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <RechartsTooltip
                      formatter={(val) => [fmtNum(val, 2), 'Amount']}
                      contentStyle={{ backgroundColor: '#0f172a', borderRadius: '8px', color: '#fff', border: 'none', fontSize: '12px' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </Box>
              <Stack direction="row" justifyContent="space-around" sx={{ pt: 1.5, borderTop: '1px solid #f1f5f9' }}>
                <Box sx={{ textAlign: 'center' }}>
                  <Typography variant="caption" sx={{ color: '#10b981', fontWeight: 700, fontSize: 10.5 }}>● INFLOW (CREDITS)</Typography>
                  <Typography sx={{ fontSize: 13, fontWeight: 800, color: '#0f172a' }}>{fmtNum(creditVol, 2)}</Typography>
                </Box>
                <Box sx={{ textAlign: 'center' }}>
                  <Typography variant="caption" sx={{ color: '#ef4444', fontWeight: 700, fontSize: 10.5 }}>● OUTFLOW (DEBITS)</Typography>
                  <Typography sx={{ fontSize: 13, fontWeight: 800, color: '#0f172a' }}>{fmtNum(debitVol, 2)}</Typography>
                </Box>
              </Stack>
            </Paper>
          </Box>

          {/* ============================================================ */}
          {/* 4. SECONDARY ANALYTICS ROW: TOP COUNTERPARTIES & BINNED TXNS */}
          {/* ============================================================ */}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 2.5 }}>
            {/* Top Counterparties Exposure */}
            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, bgcolor: '#ffffff', border: '1px solid #e2e8f0' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Box>
                  <Typography sx={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>
                    Top Counterparty Concentration
                  </Typography>
                  <Typography variant="caption" sx={{ color: '#64748b' }}>
                    Highest exposure entities interacting with this subject
                  </Typography>
                </Box>
                <Chip size="small" label="Top 5 Exposure" sx={{ fontSize: 10.5, height: 22, bgcolor: '#f1f5f9', fontWeight: 600 }} />
              </Box>
              <Stack spacing={1.5}>
                {topCounterparties.map((cp, idx) => {
                  const cpVol = Number(cp.volume || cp.amount || 0);
                  const pct = totalVol > 0 ? ((cpVol / totalVol) * 100).toFixed(1) : 0;
                  return (
                    <Box key={`cp_${idx}`}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                        <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: '#1e293b' }}>
                          {cp.name || `Counterparty-${idx + 1}`}
                        </Typography>
                        <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: '#0f172a' }}>
                          {fmtNum(cpVol, 2)} <Box component="span" sx={{ color: '#64748b', fontWeight: 500, fontSize: 11 }}>({pct}%)</Box>
                        </Typography>
                      </Box>
                      <Box sx={{ width: '100%', height: 6, bgcolor: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
                        <Box sx={{ width: `${Math.min(100, Math.max(5, pct))}%`, height: '100%', bgcolor: idx === 0 ? '#ea580c' : '#3b82f6', borderRadius: 3 }} />
                      </Box>
                    </Box>
                  );
                })}
              </Stack>
            </Paper>

            {/* Transaction Value Distribution & Structuring Bands */}
            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, bgcolor: '#ffffff', border: '1px solid #e2e8f0' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Box>
                  <Typography sx={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>
                    Transaction Value Distribution & Structuring
                  </Typography>
                  <Typography variant="caption" sx={{ color: '#64748b' }}>
                    Frequency distribution across threshold bands
                  </Typography>
                </Box>
                <Chip size="small" label="Smurfing Filter" sx={{ fontSize: 10.5, height: 22, bgcolor: '#fff7ed', color: '#c2410c', fontWeight: 700 }} />
              </Box>
              <Box sx={{ width: '100%', height: 210 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={bins}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="band" fontSize={10} stroke="#64748b" tickLine={false} />
                    <YAxis fontSize={11} stroke="#64748b" tickLine={false} axisLine={false} />
                    <RechartsTooltip
                      formatter={(val, name) => [val, 'Txn Count']}
                      contentStyle={{ backgroundColor: '#0f172a', borderRadius: '8px', color: '#fff', border: 'none', fontSize: '12px' }}
                    />
                    <Bar dataKey="count" name="Transactions" radius={[4, 4, 0, 0]}>
                      {bins.map((entry, index) => (
                        <Cell key={`bin-${index}`} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Box>
            </Paper>
          </Box>
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

      {/* Main Content Area - Full Height Expansion */}
      <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 'calc(100vh - 180px)', overflow: 'hidden', bgcolor: '#fafafa', borderRadius: 2, border: '1px solid #e0e0e0' }}>
        
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
                {activeTab === 1 && (
                  <Box sx={{ p: 4 }}>
                    <Typography variant="h6" fontWeight="bold" mb={2}>Link Analysis & Counterparty Network</Typography>
                    <VisualGraph network={{ ...(casePack?.network_profile || {}), link_analysis: casePack?.link_analysis }} />
                  </Box>
                )}
                {activeTab === 2 && (
                    <Box sx={{ p: 4 }}>
                        <TableContainer component={Paper} variant="outlined">
                        <Table size="small">
                            <TableHead><TableRow><TableCell>Date</TableCell><TableCell align="right">Amount</TableCell><TableCell>Type</TableCell><TableCell>Reference</TableCell></TableRow></TableHead>
                            <TableBody>
                            {(casePack?.ledger || []).map((tx, i) => (
                                <TableRow key={i}>
                                  <TableCell>{tx.date || '-'}</TableCell>
                                  <TableCell align="right">{fmtNum(tx.amount, 2)}</TableCell>
                                  <TableCell>{tx.type || '-'}</TableCell>
                                  <TableCell>{tx.reference || '-'}</TableCell>
                                </TableRow>
                            ))}
                            </TableBody>
                        </Table>
                        </TableContainer>
                    </Box>
                )}
                {activeTab === 3 && <AiExplainPanel caseId={selectedCase} />}
                {activeTab === 4 && <AiReviewPanel caseId={selectedCase} />}
                {activeTab === 5 && (
                    <Box sx={{ p: 3 }}>
                        <Paper variant="outlined" sx={{ p: 3, borderRadius: 2, bgcolor: '#ffffff', borderColor: '#e2e8f0' }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                                <Box>
                                    <Typography sx={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>
                                        Case Notes & Audit Working Papers
                                    </Typography>
                                    <Typography variant="caption" sx={{ color: '#64748b' }}>
                                        Persistent investigator remarks and compliance audit trail
                                    </Typography>
                                </Box>
                                <Stack direction="row" spacing={1}>
                                    <Button
                                        size="small"
                                        variant="outlined"
                                        onClick={() => {
                                            const template = `\n\n[${new Date().toLocaleString()}] CDD Verification: Customer identity confirmed against baseline records. No adverse media flagged.`;
                                            const updated = (notes || '') + template;
                                            setNotes(updated);
                                            localStorage.setItem(`case_notes_${selectedCase}`, updated);
                                        }}
                                        sx={{ textTransform: 'none', fontSize: 11, fontWeight: 700 }}
                                    >
                                        + CDD Note
                                    </Button>
                                    <Button
                                        size="small"
                                        variant="outlined"
                                        onClick={() => {
                                            const template = `\n\n[${new Date().toLocaleString()}] Disposition Note: Case reviewed. Activity consistent with known profile. No SAR required.`;
                                            const updated = (notes || '') + template;
                                            setNotes(updated);
                                            localStorage.setItem(`case_notes_${selectedCase}`, updated);
                                        }}
                                        sx={{ textTransform: 'none', fontSize: 11, fontWeight: 700 }}
                                    >
                                        + Disposition Note
                                    </Button>
                                </Stack>
                            </Box>
                            <TextField
                                fullWidth
                                multiline
                                rows={14}
                                placeholder="Type investigation notes, observations, or append findings from AI Explain..."
                                value={notes}
                                onChange={e => {
                                    setNotes(e.target.value);
                                    localStorage.setItem(`case_notes_${selectedCase}`, e.target.value);
                                }}
                                sx={{
                                    bgcolor: '#fafafa',
                                    '& .MuiOutlinedInput-root': {
                                        borderRadius: 1.5,
                                        fontSize: 13.5,
                                        lineHeight: 1.7,
                                        fontFamily: 'monospace'
                                    }
                                }}
                            />
                            <Box sx={{ mt: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <Typography variant="caption" sx={{ color: '#94a3b8' }}>
                                    ● Changes auto-saved to local case cache
                                </Typography>
                                <Typography variant="caption" sx={{ color: '#94a3b8' }}>
                                    {notes.length} characters
                                </Typography>
                            </Box>
                        </Paper>
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
