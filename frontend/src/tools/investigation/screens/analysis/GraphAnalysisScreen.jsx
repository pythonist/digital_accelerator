// src/tools/investigation/screens/analysis/GraphAnalysisScreen.jsx
import React, { useState, useEffect, useRef } from 'react';
import {
  Box, Button, Card, CardContent, FormControl, IconButton, InputLabel, MenuItem, Paper, Select, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography, Chip, CircularProgress, TextField, Tabs, Tab, Divider, Alert, List, ListItem, ListItemText, ListItemButton, Collapse, Tooltip, Grid
} from '@mui/material';

import {
  Search as SearchIcon, HelpOutline, FilterList as FilterIcon, Description as FileTextIcon, Download as DownloadIcon, Error as AlertCircleIcon, ExpandMore as ChevronDownIcon, ExpandLess as ChevronUpIcon, Close as CloseIcon, Add as PlusIcon, Remove as MinusIcon, Refresh as RotateCcwIcon, ZoomOutMap as MaximizeIcon, Storage as DatabaseIcon, AccessTime as ClockIcon, TrendingUp, People as UsersIcon, Business as BuildingIcon, ArrowForward as ArrowRightIcon, FiberManualRecord as CircleIcon, AccountTree as NetworkIcon, Timeline as TimelineIcon, GridOn as MatrixIcon, Notes as NotesIcon, Visibility as EyeIcon
} from '@mui/icons-material';

import PageContainer from "@investigation-layout/PageContainer";
import NetworkGraphManual from "@investigation/components/guide/NetworkGraphManual";

// Physics Engine Hook
const useForceGraph = (canvasRef, data, onNodeClick, useFlowLayout, isVisible) => {
  const nodesRef = useRef([]);
  const linksRef = useRef([]);
  const animationRef = useRef();
  const transformRef = useRef({ x: 0, y: 0, k: 0.8 });
  const draggingRef = useRef(null);
  const hoverNodeRef = useRef(null);
  const particlesRef = useRef([]);

  const REPULSION = 1200; 
  const SPRING_LENGTH = 150;
  const SPRING_STRENGTH = 0.05;
  const DAMPING = 0.85;
  const CENTER_STRENGTH = 0.02;

  const LAYOUT_X_BIAS = {
    'case': -400,
    'customer': -200,
    'account': 0,
    'counterparty': 300,
    'alert': 0 
  };

  useEffect(() => {
    if (!canvasRef.current || !data || !data.nodes || !data.nodes.length || !isVisible) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvasRef.current.parentElement.getBoundingClientRect();
    canvasRef.current.width = rect.width * dpr;
    canvasRef.current.height = rect.height * dpr;
    canvasRef.current.style.width = `${rect.width}px`;
    canvasRef.current.style.height = `${rect.height}px`;

    const width = rect.width;
    const height = rect.height;
    const center = { x: width / 2, y: height / 2 };
    
    nodesRef.current = data.nodes.map(n => ({
      ...n,
      x: n.x || center.x + (Math.random() - 0.5) * 100,
      y: n.y || center.y + (Math.random() - 0.5) * 100,
      vx: 0, vy: 0
    }));

    const nodeMap = new Map(nodesRef.current.map(n => [n.id, n]));
    linksRef.current = data.links.map(l => ({
      ...l,
      source: typeof l.source === 'object' ? l.source : nodeMap.get(l.source),
      target: typeof l.target === 'object' ? l.target : nodeMap.get(l.target)
    })).filter(l => l.source && l.target);

    particlesRef.current = [];
    linksRef.current.forEach(link => {
      const pCount = Math.min(5, Math.ceil((link.volume || 0) / 10000) + 1);
      for(let i=0; i<pCount; i++) {
        particlesRef.current.push({ 
          link, 
          progress: Math.random(), 
          speed: 0.002 + Math.random() * 0.005 
        });
      }
    });

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    const tick = () => {
      nodesRef.current.forEach(node => {
        let fx = 0, fy = 0;
        nodesRef.current.forEach(other => {
          if (node === other) return;
          const dx = node.x - other.x;
          const dy = node.y - other.y;
          const distSq = dx * dx + dy * dy || 1;
          const force = REPULSION / distSq;
          const angle = Math.atan2(dy, dx);
          fx += Math.cos(angle) * force;
          fy += Math.sin(angle) * force;
        });

        if (useFlowLayout) {
          const targetBiasX = LAYOUT_X_BIAS[node.type] || 0;
          const targetX = center.x + targetBiasX;
          fx += (targetX - node.x) * 0.08;
          fy += (center.y - node.y) * 0.03;
        } else {
          fx += (center.x - node.x) * CENTER_STRENGTH;
          fy += (center.y - node.y) * CENTER_STRENGTH;
        }

        node.vx = (node.vx + fx) * DAMPING;
        node.vy = (node.vy + fy) * DAMPING;
      });

      linksRef.current.forEach(link => {
        const dx = link.target.x - link.source.x;
        const dy = link.target.y - link.source.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (dist - SPRING_LENGTH) * SPRING_STRENGTH;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        link.source.vx += fx; link.source.vy += fy;
        link.target.vx -= fx; link.target.vy -= fy;
      });

      nodesRef.current.forEach(node => {
        if (draggingRef.current !== node) {
          node.x += node.vx;
          node.y += node.vy;
        }
      });

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.translate(transformRef.current.x, transformRef.current.y);
      ctx.scale(transformRef.current.k, transformRef.current.k);

      linksRef.current.forEach(link => {
        ctx.beginPath();
        ctx.moveTo(link.source.x, link.source.y);
        ctx.lineTo(link.target.x, link.target.y);
        ctx.strokeStyle = '#d1d5db';
        ctx.lineWidth = Math.min(link.width || 1, 5);
        ctx.stroke();
        drawArrow(ctx, link.source.x, link.source.y, link.target.x, link.target.y, link.target.val || 5);
      });

      particlesRef.current.forEach(p => {
        p.progress += p.speed;
        if (p.progress >= 1) p.progress = 0;
        const x = p.link.source.x + (p.link.target.x - p.link.source.x) * p.progress;
        const y = p.link.source.y + (p.link.target.y - p.link.source.y) * p.progress;
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, 2 * Math.PI);
        ctx.fillStyle = '#6b7280';
        ctx.fill();
      });

      nodesRef.current.forEach(node => {
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.val || 5, 0, 2 * Math.PI);
        ctx.fillStyle = node.color || '#6b7280';
        ctx.fill();
        
        if (node.risk_score > 50) {
          ctx.shadowColor = node.color;
          ctx.shadowBlur = 15;
          ctx.stroke();
          ctx.shadowBlur = 0;
        } else {
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        if (node.val > 8 || hoverNodeRef.current === node || node.type === 'case') {
          ctx.fillStyle = '#1f2937';
          ctx.font = node.type === 'case' ? '600 13px system-ui' : '500 11px system-ui';
          ctx.fillText(node.label || node.id, node.x + (node.val || 5) + 6, node.y + 4);
        }
      });

      ctx.restore();
      animationRef.current = requestAnimationFrame(tick);
    };

    tick();
    return () => { if (animationRef.current) cancelAnimationFrame(animationRef.current); };
  }, [data, useFlowLayout, isVisible]); 

  const drawArrow = (ctx, x1, y1, x2, y2, targetRadius) => {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const arrowLength = 12;
    const endX = x2 - (targetRadius + 6) * Math.cos(angle);
    const endY = y2 - (targetRadius + 6) * Math.sin(angle);
    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(endX - arrowLength * Math.cos(angle - Math.PI / 6), endY - arrowLength * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(endX - arrowLength * Math.cos(angle + Math.PI / 6), endY - arrowLength * Math.sin(angle + Math.PI / 6));
    ctx.lineTo(endX, endY);
    ctx.fillStyle = '#9ca3af';
    ctx.fill();
  };

  const getEventPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const rawX = e.clientX - rect.left;
    const rawY = e.clientY - rect.top;
    const worldX = (rawX - transformRef.current.x) / transformRef.current.k;
    const worldY = (rawY - transformRef.current.y) / transformRef.current.k;
    return { rawX, rawY, worldX, worldY };
  };

  const findNode = (x, y) => {
    return nodesRef.current.find(n => {
      const dist = Math.sqrt(Math.pow(n.x - x, 2) + Math.pow(n.y - y, 2));
      return dist < (n.val || 5) + 5;
    });
  };

  const handleMouseDown = (e) => {
    const { worldX, worldY, rawX, rawY } = getEventPos(e);
    const node = findNode(worldX, worldY);
    if (node) {
      draggingRef.current = node;
      onNodeClick(node);
    } else {
      draggingRef.current = { type: 'pan', startX: rawX, startY: rawY, initialTx: transformRef.current.x, initialTy: transformRef.current.y };
    }
  };

  const handleMouseMove = (e) => {
    const { worldX, worldY, rawX, rawY } = getEventPos(e);
    const node = findNode(worldX, worldY);
    hoverNodeRef.current = node;
    if (canvasRef.current) {
      canvasRef.current.style.cursor = node ? 'pointer' : (draggingRef.current?.type === 'pan' ? 'grabbing' : 'default');
    }

    if (draggingRef.current) {
      if (draggingRef.current.type === 'pan') {
        const dx = rawX - draggingRef.current.startX;
        const dy = rawY - draggingRef.current.startY;
        transformRef.current.x = draggingRef.current.initialTx + dx;
        transformRef.current.y = draggingRef.current.initialTy + dy;
      } else {
        draggingRef.current.x = worldX;
        draggingRef.current.y = worldY;
        draggingRef.current.vx = 0;
        draggingRef.current.vy = 0;
      }
    }
  };

  const handleMouseUp = () => { draggingRef.current = null; };
  const handleWheel = (e) => {
    e.preventDefault();
    const factor = 1 + (0.1 * (e.deltaY > 0 ? -1 : 1));
    transformRef.current.k = Math.max(0.1, Math.min(transformRef.current.k * factor, 5));
  };

  return { handleMouseDown, handleMouseMove, handleMouseUp, handleWheel, hoverNodeRef };
};

const GraphAnalysisScreen = ({ caseId: propCaseId }) => {
  const [priorityQueue, setPriorityQueue] = useState([]);
  const [activeCase, setActiveCase] = useState(null);
  const [graphData, setGraphData] = useState({ nodes: [], links: [] });
  const [evidence, setEvidence] = useState([]);
  const [loading, setLoading] = useState(false);
  const [narrative, setNarrative] = useState("Select a case to begin investigation");
  const [hoveredNode, setHoveredNode] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [useFlowLayout, setUseFlowLayout] = useState(true);
  const [filterRisk, setFilterRisk] = useState('all');
  const [sortBy, setSortBy] = useState('risk');
  const [viewMode, setViewMode] = useState('graph'); 
  const [rightPanel, setRightPanel] = useState(0); 
  const [investigatorNotes, setInvestigatorNotes] = useState('');
  const [expandedEvidence, setExpandedEvidence] = useState({});
  const [showManual, setShowManual] = useState(false);
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  
  const handleNodeClick = (node) => {
    setSelectedNode(node);
    setRightPanel(1);
  };
  
  const { handleMouseDown, handleMouseMove, handleMouseUp, handleWheel, hoverNodeRef } = 
    useForceGraph(canvasRef, graphData, handleNodeClick, useFlowLayout, viewMode === 'graph');

  useEffect(() => {
    loadPriorityQueue();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (hoverNodeRef.current !== hoveredNode) setHoveredNode(hoverNodeRef.current);
    }, 50);
    return () => clearInterval(interval);
  }, [hoveredNode]);

  useEffect(() => {
    const resize = () => {
      if (containerRef.current && canvasRef.current && viewMode === 'graph') {
        const { width, height } = containerRef.current.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        canvasRef.current.width = width * dpr;
        canvasRef.current.height = height * dpr;
        canvasRef.current.style.width = `${width}px`;
        canvasRef.current.style.height = `${height}px`;
      }
    };
    window.addEventListener('resize', resize);
    resize();
    return () => window.removeEventListener('resize', resize);
  }, [viewMode]);

  const loadPriorityQueue = async () => {
    try {
      const res = await fetch('/api/v2/analysis/dashboard/priority-queue');
      const data = await res.json();
      if (data.success && data.queue.length > 0) {
        setPriorityQueue(data.queue);
        // Don't auto-load first case
      } else {
        setNarrative("No priority cases in queue");
      }
    } catch (e) {
      console.error("Queue load failed", e);
    }
  };

  const loadCase = async (id) => {
    setLoading(true);
    setActiveCase(id);
    setSelectedNode(null);
    try {
      const response = await fetch('/api/v2/analysis/graph/build-full-case', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ case_id: id })
      });
      const data = await response.json();
      
      if (data.success) { 
        setGraphData(data.graph || { nodes: [], links: [] }); 
        setEvidence(data.graph?.evidence || []);
        setNarrative(data.narrative); 
      } else { 
        setGraphData({ nodes: [], links: [] });
        setNarrative("No data available for this case"); 
      }
    } catch (error) {
      setGraphData({ nodes: [], links: [] });
      setNarrative("Failed to load case data");
    } finally { setLoading(false); }
  };

  const filteredQueue = priorityQueue
    .filter(c => filterRisk === 'all' || 
      (filterRisk === 'critical' && c.risk_score >= 75) ||
      (filterRisk === 'high' && c.risk_score >= 50 && c.risk_score < 75) ||
      (filterRisk === 'medium' && c.risk_score < 50))
    .sort((a, b) => {
      if (sortBy === 'risk') return b.risk_score - a.risk_score;
      if (sortBy === 'alerts') return b.alert_count - a.alert_count;
      return 0;
    });

  const exportCase = () => {
    const exportData = {
      case_id: activeCase,
      narrative,
      evidence,
      network: {
        entities: graphData.nodes.length,
        relationships: graphData.links.length
      },
      notes: investigatorNotes,
      timestamp: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `case_${activeCase}_export.json`;
    a.click();
  };

  return (
    <>
      <NetworkGraphManual open={showManual} onClose={() => setShowManual(false)} />
      
      <PageContainer
        title="Network Investigation"
        subtitle={activeCase ? `Case ${activeCase}` : 'Select a case to begin'}
        breadcrumbs={['Analysis', 'Network Graph']}
        actions={
          <Stack direction="row" spacing={1.5}>
            <Button 
              variant="text" 
              startIcon={<HelpOutline />} 
              onClick={() => setShowManual(true)}
              size="small"
              sx={{ color: 'text.secondary', fontWeight: 600, mr: 1 }}
            >
              Graph Guide
            </Button>
            <Tooltip title="Toggle Layout">
              <span>
                <IconButton 
                  size="small" 
                  onClick={() => setUseFlowLayout(!useFlowLayout)}
                  disabled={viewMode !== 'graph'}
                  sx={{ border: '1px solid', borderColor: 'divider' }}
                >
                  <DatabaseIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Reset View">
              <span>
                <IconButton 
                  size="small"
                  disabled={viewMode !== 'graph'}
                  sx={{ border: '1px solid', borderColor: 'divider' }}
                >
                  <MaximizeIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Button 
              variant="outlined" 
              size="small" 
              startIcon={<DownloadIcon />} 
              onClick={exportCase}
              disabled={!activeCase}
            >
              Export
            </Button>
            <Button 
              variant="contained" 
              size="small" 
              disableElevation 
              color="primary" 
              startIcon={<FileTextIcon />}
              disabled={!activeCase}
              sx={{ fontWeight: '600' }}
            >
              Generate SAR
            </Button>
          </Stack>
        }
      >
        {/* MAIN CONTENT AREA */}
        <Box sx={{ display: 'flex', overflow: 'hidden', height: 'calc(100vh - 180px)' }}>
          
          {/* LEFT SIDEBAR: Case Selector (Dropdown Style) */}
          <Paper 
            elevation={0} 
            sx={{ 
              width: 320, 
              flexShrink: 0, 
              borderRight: '1px solid #e0e0e0',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden'
            }}
          >
            <Box sx={{ p: 2, borderBottom: '1px solid #e0e0e0', bgcolor: '#fafafa' }}>
              <Typography variant="subtitle2" fontWeight="bold" color="text.secondary" sx={{ textTransform: 'uppercase', fontSize: '0.7rem', mb: 2 }}>
                Case Selection
              </Typography>
              
              <Stack spacing={2}>
                <FormControl size="small" fullWidth>
                  <InputLabel>Active Case</InputLabel>
                  <Select 
                    value={activeCase || ''} 
                    onChange={(e) => loadCase(e.target.value)}
                    label="Active Case"
                    displayEmpty
                  >
                    <MenuItem value="">
                      <em>Select a case...</em>
                    </MenuItem>
                    {filteredQueue.map((c) => (
                      <MenuItem key={c.case_id} value={c.case_id}>
                        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ width: '100%' }}>
                          <Typography variant="body2">{c.case_id}</Typography>
                          <Chip 
                            label={c.risk_score} 
                            size="small" 
                            color={c.risk_score >= 75 ? 'error' : c.risk_score >= 50 ? 'warning' : 'success'}
                            sx={{ height: 20, fontSize: '0.7rem', fontWeight: 'bold', ml: 1 }}
                          />
                        </Stack>
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <FormControl size="small" fullWidth>
                  <InputLabel>Risk Filter</InputLabel>
                  <Select 
                    value={filterRisk} 
                    onChange={(e) => setFilterRisk(e.target.value)}
                    label="Risk Filter"
                  >
                    <MenuItem value="all">All Risk Levels</MenuItem>
                    <MenuItem value="critical">Critical (75+)</MenuItem>
                    <MenuItem value="high">High (50-74)</MenuItem>
                    <MenuItem value="medium">Medium (&lt;50)</MenuItem>
                  </Select>
                </FormControl>
                
                <FormControl size="small" fullWidth>
                  <InputLabel>Sort By</InputLabel>
                  <Select 
                    value={sortBy} 
                    onChange={(e) => setSortBy(e.target.value)}
                    label="Sort By"
                  >
                    <MenuItem value="risk">Risk Score</MenuItem>
                    <MenuItem value="alerts">Alert Count</MenuItem>
                  </Select>
                </FormControl>
              </Stack>
            </Box>

            {/* Case Queue Summary */}
            <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 2 }}>
              <Typography variant="subtitle2" fontWeight="bold" color="text.secondary" sx={{ textTransform: 'uppercase', fontSize: '0.7rem', mb: 2 }}>
                Queue Summary ({filteredQueue.length} cases)
              </Typography>
              
              <Stack spacing={1.5}>
                {filteredQueue.slice(0, 10).map((c) => (
                  <Card 
                    key={c.case_id}
                    variant="outlined"
                    sx={{ 
                      cursor: 'pointer',
                      border: activeCase === c.case_id ? '2px solid' : '1px solid',
                      borderColor: activeCase === c.case_id ? 'primary.main' : 'divider',
                      bgcolor: activeCase === c.case_id ? '#f5f5f5' : 'white',
                      '&:hover': { bgcolor: '#fafafa' }
                    }}
                    onClick={() => loadCase(c.case_id)}
                  >
                    <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                        <Box sx={{ flexGrow: 1 }}>
                          <Typography variant="body2" fontWeight="600">
                            {c.case_id}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                            {c.reason}
                          </Typography>
                          <Stack direction="row" spacing={1.5}>
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontSize: '0.7rem' }}>
                              <AlertCircleIcon sx={{ fontSize: 10 }} />
                              {c.alert_count}
                            </Typography>
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontSize: '0.7rem' }}>
                              <CircleIcon sx={{ fontSize: 6, color: c.status === 'New' ? '#4caf50' : '#9e9e9e' }} />
                              {c.status}
                            </Typography>
                          </Stack>
                        </Box>
                        <Chip 
                          label={c.risk_score} 
                          color={c.risk_score >= 75 ? 'error' : c.risk_score >= 50 ? 'warning' : 'success'}
                          size="small"
                          sx={{ height: 22, fontSize: '0.7rem', fontWeight: 'bold' }}
                        />
                      </Stack>
                    </CardContent>
                  </Card>
                ))}
              </Stack>
            </Box>
          </Paper>

          {/* CENTER: Graph Canvas & Views */}
          <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            
            {/* View Mode Tabs */}
            <Box sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: '#fff', px: 2 }}>
              <Tabs value={viewMode} onChange={(e, v) => setViewMode(v)} sx={{ minHeight: 42 }}>
                <Tab 
                  label="Network Graph" 
                  value="graph" 
                  icon={<NetworkIcon fontSize="small" />} 
                  iconPosition="start"
                  sx={{ minHeight: 42, textTransform: 'none', fontWeight: 600, fontSize: '0.85rem' }}
                />
                <Tab 
                  label="Timeline" 
                  value="timeline" 
                  icon={<TimelineIcon fontSize="small" />} 
                  iconPosition="start"
                  sx={{ minHeight: 42, textTransform: 'none', fontWeight: 600, fontSize: '0.85rem' }}
                />
                <Tab 
                  label="Relationship Matrix" 
                  value="matrix" 
                  icon={<MatrixIcon fontSize="small" />} 
                  iconPosition="start"
                  sx={{ minHeight: 42, textTransform: 'none', fontWeight: 600, fontSize: '0.85rem' }}
                />
              </Tabs>
              
              {activeCase && (
                <Box sx={{ py: 1, display: 'flex', gap: 3, alignItems: 'center', borderTop: '1px solid #f5f5f5' }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <UsersIcon sx={{ fontSize: 14 }} />
                    {graphData.nodes.length} entities
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <TrendingUp sx={{ fontSize: 14 }} />
                    {graphData.links.length} flows
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    Max Risk: <strong>{Math.max(...graphData.nodes.map(n=>n.risk_score || 0)).toFixed(0)}</strong>
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    Total Volume: <strong>${graphData.links.reduce((sum, l) => sum + (l.volume || 0), 0).toLocaleString()}</strong>
                  </Typography>
                </Box>
              )}
            </Box>

            {/* Canvas/View Container */}
            <Box ref={containerRef} sx={{ flexGrow: 1, position: 'relative', bgcolor: '#fafafa', overflow: 'hidden' }}>
              {loading && (
                <Box sx={{ position: 'absolute', inset: 0, bgcolor: 'rgba(255,255,255,0.95)', zIndex: 30, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  <CircularProgress size={40} sx={{ mb: 2 }} />
                  <Typography variant="body2" fontWeight="600" color="text.secondary">
                    Loading investigation data...
                  </Typography>
                </Box>
              )}
              
              {viewMode === 'graph' && (
                <>
                  <canvas 
                    ref={canvasRef}
                    style={{ width: '100%', height: '100%', display: 'block' }}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                    onWheel={handleWheel}
                  />
                  
                  {hoveredNode && (
                    <Card 
                      elevation={6}
                      sx={{ 
                        position: 'absolute', 
                        left: 20, 
                        bottom: 20, 
                        minWidth: 240,
                        bgcolor: 'grey.900',
                        color: 'white',
                        pointerEvents: 'none'
                      }}
                    >
                      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                        <Typography variant="subtitle2" fontWeight="bold" mb={0.5}>
                          {hoveredNode.label}
                        </Typography>
                        <Typography variant="caption" color="grey.400" sx={{ textTransform: 'uppercase', fontSize: '0.65rem', display: 'block', mb: 1.5 }}>
                          {hoveredNode.type}
                        </Typography>
                        <Stack spacing={0.75} sx={{ fontSize: '0.75rem' }}>
                          <Stack direction="row" justifyContent="space-between">
                            <Typography variant="caption" color="grey.400">Risk Score:</Typography>
                            <Typography variant="caption" color={hoveredNode.risk_score > 50 ? 'error.light' : 'success.light'} fontWeight="600">
                              {hoveredNode.risk_score}
                            </Typography>
                          </Stack>
                          <Stack direction="row" justifyContent="space-between">
                            <Typography variant="caption" color="grey.400">Volume:</Typography>
                            <Typography variant="caption" fontWeight="600">
                              ${parseInt(hoveredNode.volume || 0).toLocaleString()}
                            </Typography>
                          </Stack>
                          <Stack direction="row" justifyContent="space-between">
                            <Typography variant="caption" color="grey.400">Alerts:</Typography>
                            <Typography variant="caption" fontWeight="600">
                              {hoveredNode.alert_count || 0}
                            </Typography>
                          </Stack>
                        </Stack>
                      </CardContent>
                    </Card>
                  )}
                </>
              )}
              
              {viewMode === 'timeline' && (
                <Box sx={{ p: 3, overflowY: 'auto', height: '100%' }}>
                  <Box sx={{ maxWidth: 900, mx: 'auto' }}>
                    <Typography variant="h6" fontWeight="bold" gutterBottom>
                      Transaction Timeline
                    </Typography>
                    <Stack spacing={2} sx={{ mt: 3 }}>
                      {graphData.links.slice(0, 15).map((link, i) => (
                        <Card key={i} variant="outlined">
                          <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
                            <Stack direction="row" spacing={2} alignItems="flex-start">
                              <Box sx={{ minWidth: 80, pt: 0.5 }}>
                                <Typography variant="caption" color="text.secondary">
                                  {link.transactions?.[0]?.date || 'N/A'}
                                </Typography>
                              </Box>
                              <Box sx={{ flexGrow: 1 }}>
                                <Stack direction="row" spacing={1} alignItems="center" mb={0.5}>
                                  <BuildingIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
                                  <Typography variant="body2" fontWeight="600">
                                    {link.source}
                                  </Typography>
                                  <ArrowRightIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
                                  <Typography variant="body2" fontWeight="600">
                                    {link.target}
                                  </Typography>
                                </Stack>
                                <Typography variant="caption" color="text.secondary">
                                  Volume: ${parseInt(link.volume || 0).toLocaleString()} • {link.transactions?.length || 0} transactions
                                </Typography>
                              </Box>
                            </Stack>
                          </CardContent>
                        </Card>
                      ))}
                    </Stack>
                  </Box>
                </Box>
              )}
              
              {viewMode === 'matrix' && (
                <Box sx={{ p: 3, overflowY: 'auto', height: '100%' }}>
                  <Box sx={{ maxWidth: 1200, mx: 'auto' }}>
                    <Typography variant="h6" fontWeight="bold" gutterBottom>
                      Entity Relationship Matrix
                    </Typography>
                    <TableContainer component={Paper} variant="outlined" sx={{ mt: 3 }}>
                      <Table size="small">
                        <TableHead>
                          <TableRow sx={{ bgcolor: '#fafafa' }}>
                            <TableCell sx={{ fontWeight: 'bold' }}>Source Entity</TableCell>
                            <TableCell sx={{ fontWeight: 'bold' }}>Target Entity</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 'bold' }}>Volume</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 'bold' }}>Tx Count</TableCell>
                            <TableCell align="center" sx={{ fontWeight: 'bold' }}>Avg Risk</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {graphData.links.map((link, i) => {
                            const sourceNode = graphData.nodes.find(n => n.id === link.source);
                            const targetNode = graphData.nodes.find(n => n.id === link.target);
                            const avgRisk = ((sourceNode?.risk_score || 0) + (targetNode?.risk_score || 0)) / 2;
                            
                            return (
                              <TableRow key={i} hover>
                                <TableCell>{sourceNode?.label || link.source}</TableCell>
                                <TableCell>{targetNode?.label || link.target}</TableCell>
                                <TableCell align="right">${parseInt(link.volume || 0).toLocaleString()}</TableCell>
                                <TableCell align="right">{link.transactions?.length || 1}</TableCell>
                                <TableCell align="center">
                                  <Chip 
                                    label={avgRisk.toFixed(0)} 
                                    size="small" 
                                    color={avgRisk >= 50 ? 'error' : avgRisk >= 25 ? 'warning' : 'success'}
                                    sx={{ fontSize: '0.75rem', fontWeight: 'bold', height: 22 }}
                                  />
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Box>
                </Box>
              )}
            </Box>

            {/* Status Bar */}
            <Paper 
              elevation={0} 
              sx={{ 
                px: 3, 
                py: 1, 
                borderTop: '1px solid #e0e0e0', 
                bgcolor: '#fafafa',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <Typography variant="caption" color="text.secondary">
                {narrative}
              </Typography>
            </Paper>
          </Box>

          {/* RIGHT SIDEBAR: Intelligence Panel */}
          <Paper 
            elevation={0} 
            sx={{ 
              width: 360, 
              flexShrink: 0, 
              borderLeft: '1px solid #e0e0e0',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden'
            }}
          >
            <Box sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: '#fafafa' }}>
              <Tabs value={rightPanel} onChange={(e, v) => setRightPanel(v)} variant="fullWidth" sx={{ minHeight: 42 }}>
                <Tab label="Evidence" sx={{ minHeight: 42, fontSize: '0.8rem', fontWeight: 600, textTransform: 'none' }} />
                <Tab label="Details" sx={{ minHeight: 42, fontSize: '0.8rem', fontWeight: 600, textTransform: 'none' }} />
                <Tab label="Notes" sx={{ minHeight: 42, fontSize: '0.8rem', fontWeight: 600, textTransform: 'none' }} />
              </Tabs>
            </Box>
            
            <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 2 }}>
              {rightPanel === 0 && (
                <Stack spacing={3}>
                  <Box>
                    <Typography variant="subtitle2" fontWeight="bold" color="text.secondary" sx={{ textTransform: 'uppercase', fontSize: '0.7rem', mb: 2 }}>
                      Detected Typologies
                    </Typography>
                    
                    {evidence.length > 0 ? (
                      <Stack spacing={1.5}>
                        {evidence.map((ev, i) => (
                          <Card key={i} variant="outlined">
                            <CardContent 
                              onClick={() => setExpandedEvidence(prev => ({...prev, [i]: !prev[i]}))}
                              sx={{ p: 1.5, cursor: 'pointer', '&:last-child': { pb: 1.5 } }}
                            >
                              <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                                <Stack direction="row" spacing={1} alignItems="flex-start" sx={{ flexGrow: 1 }}>
                                  <AlertCircleIcon 
                                    sx={{ 
                                      fontSize: 16, 
                                      mt: 0.25,
                                      color: ev.severity === 'Critical' ? 'error.main' : ev.severity === 'High' ? 'warning.main' : 'info.main'
                                    }} 
                                  />
                                  <Box sx={{ flexGrow: 1 }}>
                                    <Typography variant="body2" fontWeight="600" mb={0.5}>
                                      {ev.typology}
                                    </Typography>
                                    <Collapse in={expandedEvidence[i]}>
                                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1, lineHeight: 1.5 }}>
                                        {ev.description}
                                      </Typography>
                                    </Collapse>
                                    <Chip 
                                      label={`${ev.severity} Severity`} 
                                      size="small" 
                                      color={ev.severity === 'Critical' ? 'error' : ev.severity === 'High' ? 'warning' : 'info'}
                                      sx={{ height: 20, fontSize: '0.65rem', fontWeight: 'bold' }}
                                    />
                                  </Box>
                                </Stack>
                                <IconButton size="small">
                                  {expandedEvidence[i] ? <ChevronUpIcon fontSize="small" /> : <ChevronDownIcon fontSize="small" />}
                                </IconButton>
                              </Stack>
                            </CardContent>
                          </Card>
                        ))}
                      </Stack>
                    ) : (
                      <Alert severity="info" variant="outlined" sx={{ fontSize: '0.8rem' }}>
                        {loading ? 'Analyzing...' : activeCase ? 'No automated typologies detected' : 'Select a case to view evidence'}
                      </Alert>
                    )}
                  </Box>

                  {graphData.nodes.length > 0 && (
                    <Box>
                      <Typography variant="subtitle2" fontWeight="bold" color="text.secondary" sx={{ textTransform: 'uppercase', fontSize: '0.7rem', mb: 2 }}>
                        Network Metrics
                      </Typography>
                      <Grid container spacing={1.5}>
                        <Grid item xs={6}>
                          <Card variant="outlined">
                            <CardContent sx={{ p: 1.5, textAlign: 'center', '&:last-child': { pb: 1.5 } }}>
                              <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
                                Total Entities
                              </Typography>
                              <Typography variant="h6" fontWeight="bold">
                                {graphData.nodes.length}
                              </Typography>
                            </CardContent>
                          </Card>
                        </Grid>
                        <Grid item xs={6}>
                          <Card variant="outlined">
                            <CardContent sx={{ p: 1.5, textAlign: 'center', '&:last-child': { pb: 1.5 } }}>
                              <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
                                Relationships
                              </Typography>
                              <Typography variant="h6" fontWeight="bold">
                                {graphData.links.length}
                              </Typography>
                            </CardContent>
                          </Card>
                        </Grid>
                        <Grid item xs={6}>
                          <Card variant="outlined">
                            <CardContent sx={{ p: 1.5, textAlign: 'center', '&:last-child': { pb: 1.5 } }}>
                              <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
                                Max Risk
                              </Typography>
                              <Typography variant="h6" fontWeight="bold" color="error.main">
                                {Math.max(...graphData.nodes.map(n=>n.risk_score || 0)).toFixed(0)}
                              </Typography>
                            </CardContent>
                          </Card>
                        </Grid>
                        <Grid item xs={6}>
                          <Card variant="outlined">
                            <CardContent sx={{ p: 1.5, textAlign: 'center', '&:last-child': { pb: 1.5 } }}>
                              <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
                                High Risk
                              </Typography>
                              <Typography variant="h6" fontWeight="bold" color="warning.main">
                                {graphData.nodes.filter(n => n.risk_score >= 50).length}
                              </Typography>
                            </CardContent>
                          </Card>
                        </Grid>
                      </Grid>
                    </Box>
                  )}
                </Stack>
              )}

              {rightPanel === 1 && (
                <Stack spacing={3}>
                  {selectedNode ? (
                    <>
                      <Box>
                        <Typography variant="subtitle2" fontWeight="bold" color="text.secondary" sx={{ textTransform: 'uppercase', fontSize: '0.7rem', mb: 2 }}>
                          Entity Details
                        </Typography>
                        <Card variant="outlined">
                          <CardContent sx={{ p: 2 }}>
                            <Typography variant="h6" fontWeight="bold" mb={0.5}>
                              {selectedNode.label}
                            </Typography>
                            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', display: 'block', mb: 2 }}>
                              {selectedNode.type}
                            </Typography>
                            
                            <Stack spacing={1.5}>
                              <Stack direction="row" justifyContent="space-between" sx={{ pb: 1, borderBottom: '1px solid #f0f0f0' }}>
                                <Typography variant="caption" color="text.secondary">Risk Score</Typography>
                                <Typography variant="body2" fontWeight="bold" color={selectedNode.risk_score >= 50 ? 'error.main' : 'success.main'}>
                                  {selectedNode.risk_score}
                                </Typography>
                              </Stack>
                              <Stack direction="row" justifyContent="space-between" sx={{ pb: 1, borderBottom: '1px solid #f0f0f0' }}>
                                <Typography variant="caption" color="text.secondary">Transaction Volume</Typography>
                                <Typography variant="body2" fontWeight="bold">
                                  ${parseInt(selectedNode.volume || 0).toLocaleString()}
                                </Typography>
                              </Stack>
                              <Stack direction="row" justifyContent="space-between" sx={{ pb: 1, borderBottom: '1px solid #f0f0f0' }}>
                                <Typography variant="caption" color="text.secondary">Alert Count</Typography>
                                <Typography variant="body2" fontWeight="bold">
                                  {selectedNode.alert_count || 0}
                                </Typography>
                              </Stack>
                            </Stack>
                          </CardContent>
                        </Card>
                      </Box>

                      <Box>
                        <Typography variant="subtitle2" fontWeight="bold" color="text.secondary" sx={{ textTransform: 'uppercase', fontSize: '0.7rem', mb: 2 }}>
                          Connected Entities
                        </Typography>
                        <Stack spacing={1.5}>
                          {graphData.links
                            .filter(l => l.source === selectedNode.id || l.target === selectedNode.id)
                            .slice(0, 6)
                            .map((link, i) => {
                              const otherId = link.source === selectedNode.id ? link.target : link.source;
                              const otherNode = graphData.nodes.find(n => n.id === otherId);
                              return (
                                <Card key={i} variant="outlined">
                                  <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                                    <Typography variant="body2" fontWeight="600" mb={0.5}>
                                      {otherNode?.label || otherId}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary">
                                      ${parseInt(link.volume || 0).toLocaleString()} • {link.transactions?.length || 0} txns
                                    </Typography>
                                  </CardContent>
                                </Card>
                              );
                            })}
                        </Stack>
                      </Box>
                    </>
                  ) : (
                    <Alert severity="info" variant="outlined" sx={{ fontSize: '0.8rem' }}>
                      Click on a node in the graph to view detailed information
                    </Alert>
                  )}
                </Stack>
              )}

              {rightPanel === 2 && (
                <Stack spacing={3}>
                  <Box>
                    <Typography variant="subtitle2" fontWeight="bold" color="text.secondary" sx={{ textTransform: 'uppercase', fontSize: '0.7rem', mb: 2 }}>
                      Investigator Notes
                    </Typography>
                    <TextField
                      fullWidth
                      multiline
                      rows={10}
                      value={investigatorNotes}
                      onChange={(e) => setInvestigatorNotes(e.target.value)}
                      placeholder="Document your findings, observations, and next steps..."
                      variant="outlined"
                      size="small"
                      sx={{ 
                        '& textarea': { fontSize: '0.85rem' },
                        bgcolor: '#fafafa'
                      }}
                    />
                  </Box>

                  <Box>
                    <Typography variant="subtitle2" fontWeight="bold" color="text.secondary" sx={{ textTransform: 'uppercase', fontSize: '0.7rem', mb: 2 }}>
                      Quick Actions
                    </Typography>
                    <Stack spacing={1}>
                      <Button 
                        variant="outlined" 
                        fullWidth 
                        size="small"
                        sx={{ justifyContent: 'flex-start', textTransform: 'none', fontSize: '0.85rem' }}
                      >
                        Request Additional Documentation
                      </Button>
                      <Button 
                        variant="outlined" 
                        fullWidth 
                        size="small"
                        sx={{ justifyContent: 'flex-start', textTransform: 'none', fontSize: '0.85rem' }}
                      >
                        Flag for Senior Review
                      </Button>
                      <Button 
                        variant="outlined" 
                        fullWidth 
                        size="small"
                        sx={{ justifyContent: 'flex-start', textTransform: 'none', fontSize: '0.85rem' }}
                      >
                        Schedule Customer Interview
                      </Button>
                    </Stack>
                  </Box>
                </Stack>
              )}
            </Box>
          </Paper>

        </Box>

      </PageContainer>
    </>
  );
};

export default GraphAnalysisScreen;