import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography
} from '@mui/material';
import muleApi from '../services/muleApi';
import { pwcColors } from '../theme';
import { useMuleStore } from '../store/muleStore';
import AccountSelector from '../components/AccountSelector';
import { formatInteger, formatNumber, formatProbability } from '../utils/formatters';

const COLOR = {
  RED: '#ef4444',
  ORANGE: pwcColors.primary,
  YELLOW: '#f59e0b',
  GREEN: '#22c55e',
  BLUE: '#0ea5e9',
  GRAY: '#94a3b8'
};

const toColor = (c) => COLOR[String(c || 'GRAY').toUpperCase()] || COLOR.GRAY;

const downloadJson = (name, obj) => {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
};

const formatDays = (days) => {
  const n = Number(days);
  if (!Number.isFinite(n)) return '-';
  if (n < 1) return '<1 day';
  return `${Math.round(n)} days`;
};

const buildApplyLabel = (availability, maxHops, circularOnly) => {
  const total = availability?.candidate_paths;
  if (!total && total !== 0) return 'Apply filters';
  const hopImpact = Array.isArray(availability?.hop_impact) ? availability.hop_impact : [];
  const target = hopImpact.find((h) => Number(h.max_hops) === Number(maxHops));
  let estimate = Number(target?.path_count ?? total);
  if (circularOnly) {
    const c = Number(availability?.circular_candidates ?? estimate);
    estimate = Math.min(estimate, c);
  }
  return `Apply filters (will narrow ${formatInteger(total)} → ~${formatInteger(Math.max(0, estimate))})`;
};

const ContextPanel = ({ summary }) => {
  if (!summary) return null;
  const top = Array.isArray(summary.top_counterparties) ? summary.top_counterparties : [];
  return (
    <Card variant="outlined" sx={{ mb: 2 }}>
      <CardHeader title="Pre-filter Context" subheader="Baseline transaction availability before any suspicion filters" />
      <CardContent>
        <Grid container spacing={2} sx={{ mb: 1 }}>
          <Grid item xs={12} sm={6} md={2.4}>
            <Typography variant="caption">Total transactions</Typography>
            <Typography variant="h6">{formatInteger(summary.total_transactions ?? '-')}</Typography>
          </Grid>
          <Grid item xs={12} sm={6} md={2.4}>
            <Typography variant="caption">Inbound vs outbound</Typography>
            <Typography variant="h6">{formatInteger(summary.inbound_count ?? '-')} / {formatInteger(summary.outbound_count ?? '-')}</Typography>
          </Grid>
          <Grid item xs={12} sm={6} md={2.4}>
            <Typography variant="caption">Unique counterparties</Typography>
            <Typography variant="h6">{formatInteger(summary.unique_counterparties ?? '-')}</Typography>
          </Grid>
          <Grid item xs={12} sm={6} md={2.4}>
            <Typography variant="caption">Max observed hops</Typography>
            <Typography variant="h6">{formatInteger(summary.max_observed_hops ?? '-')}</Typography>
          </Grid>
          <Grid item xs={12} sm={6} md={2.4}>
            <Typography variant="caption">Data available</Typography>
            <Typography variant="h6">{formatDays(summary.time_range?.days)}</Typography>
          </Grid>
        </Grid>
        <Stack direction="row" spacing={1} flexWrap="wrap">
          {top.length ? (
            top.map((cp) => (
              <Chip
                key={cp.counterparty}
                label={`${cp.counterparty} • ${formatNumber(cp.total_amount, { minFractionDigits: 0, maxFractionDigits: 0 })}`}
                variant="outlined"
              />
            ))
          ) : (
            <Chip label="No counterparties found" variant="outlined" />
          )}
        </Stack>
      </CardContent>
    </Card>
  );
};

const AvailabilityPanel = ({ availability }) => {
  if (!availability) return null;
  const items = [
    { label: 'Circular flows', count: availability.circular_candidates },
    { label: 'Pass-through windows', count: availability.pass_through_candidates },
    { label: 'Multi-hop (>2)', count: availability.multi_hop_candidates },
    { label: 'Bursts', count: availability.burst_candidates }
  ];
  const hopImpact = Array.isArray(availability.hop_impact) ? availability.hop_impact : [];
  const timeWindows = Array.isArray(availability.time_window_activity) ? availability.time_window_activity : [];
  return (
    <Card variant="outlined" sx={{ mb: 2 }}>
      <CardHeader title="Pattern Availability" subheader="Filters are questions. These are the available answers." />
      <CardContent>
        <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 2 }}>
          {items.map((i) => (
            <Chip
              key={i.label}
              label={`${i.label}: ${formatInteger(Number(i.count) || 0)} candidate`}
              color={Number(i.count) > 0 ? 'primary' : 'default'}
              variant={Number(i.count) > 0 ? 'filled' : 'outlined'}
            />
          ))}
        </Stack>
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Max hops impact</Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap">
              {hopImpact.length ? hopImpact.map((h) => (
                <Chip key={`hop-${h.max_hops}`} label={`${formatInteger(h.max_hops)} hops → ${formatInteger(h.path_count)}`} variant="outlined" />
              )) : <Chip label="No path estimates" variant="outlined" />}
            </Stack>
          </Grid>
          <Grid item xs={12} md={6}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Time window availability</Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap">
              {timeWindows.length ? timeWindows.map((w) => (
                <Chip key={`win-${w.days}`} label={`${formatInteger(w.days)} days → ${formatInteger(w.transactions)} tx`} variant="outlined" />
              )) : <Chip label="No time window data" variant="outlined" />}
            </Stack>
          </Grid>
        </Grid>
      </CardContent>
    </Card>
  );
};

const MultiAccountPanel = ({ accountIds, contexts }) => {
  if (!Array.isArray(accountIds) || accountIds.length <= 1) return null;
  const list = accountIds.map((id) => contexts[id]).filter(Boolean);
  if (!list.length) return null;
  const accountsWithPaths = list.filter((c) => (c.availability?.candidate_paths || 0) > 0).length;
  const circularAccounts = list.filter((c) => (c.availability?.circular_candidates || 0) > 0).length;
  const onlyOneHop = list.filter((c) => (c.context_summary?.max_observed_hops || 0) <= 1).length;
  const ranked = [...list].sort((a, b) => {
    const ca = Number(a.availability?.circular_candidates || 0);
    const cb = Number(b.availability?.circular_candidates || 0);
    if (cb !== ca) return cb - ca;
    return Number(b.availability?.candidate_paths || 0) - Number(a.availability?.candidate_paths || 0);
  }).slice(0, 5);
  return (
    <Card variant="outlined" sx={{ mb: 2 }}>
      <CardHeader title="Multi-account Context" subheader="Aggregate signals before filters" />
      <CardContent>
        <Stack direction="row" spacing={2} flexWrap="wrap" sx={{ mb: 1 }}>
          <Chip label={`Accounts with any paths: ${accountsWithPaths} / ${accountIds.length}`} />
          <Chip label={`Circular candidates: ${circularAccounts} / ${accountIds.length}`} />
          <Chip label={`Only 1-hop activity: ${onlyOneHop} / ${accountIds.length}`} />
        </Stack>
        <Stack direction="row" spacing={1} flexWrap="wrap">
          {ranked.map((c) => (
            <Chip
              key={`rank-${c.context_summary?.account_id}`}
              label={`${c.context_summary?.account_id} • paths ${c.availability?.candidate_paths || 0}`}
              color={(c.availability?.circular_candidates || 0) > 0 ? 'primary' : 'default'}
            />
          ))}
        </Stack>
      </CardContent>
    </Card>
  );
};

const NoResultsPanel = ({ filters, availability }) => {
  const suggestions = [];
  if (filters?.circularOnly && Number(availability?.circular_candidates || 0) === 0) {
    suggestions.push('Disable circular-only filter');
  }
  if (Number(availability?.candidate_paths || 0) === 0) {
    suggestions.push('Increase time window or remove time bounds');
  }
  if (Number(filters?.maxHops || 0) <= 2 && Number(availability?.multi_hop_candidates || 0) > 0) {
    suggestions.push('Increase max hops');
  }
  if (!suggestions.length) {
    suggestions.push('Increase time window');
    suggestions.push('Increase amount tolerance');
  }
  return (
    <Alert severity="warning" variant="outlined">
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        No paths matched the current filters.
      </Typography>
      <Stack direction="row" spacing={1} flexWrap="wrap">
        {suggestions.map((s) => (
          <Chip key={s} label={s} variant="outlined" />
        ))}
      </Stack>
    </Alert>
  );
};

const NetworkGraphScreen = () => {
  const { selectedAccountId, selectedAccountIds, openInvestigation } = useMuleStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [graphJson, setGraphJson] = useState(null);
  const [pathIndex, setPathIndex] = useState(0);
  const [circularOnly, setCircularOnly] = useState(false);
  const [windowHours, setWindowHours] = useState(48);
  const [maxHops, setMaxHops] = useState(4);
  const [maxPaths, setMaxPaths] = useState(25);
  const [amountTolerance, setAmountTolerance] = useState(0.12);
  const [passThroughWindowMinutes, setPassThroughWindowMinutes] = useState(60);
  const [startTs, setStartTs] = useState('');
  const [endTs, setEndTs] = useState('');
  const [selectedNode, setSelectedNode] = useState(null);
  const [selectedEdge, setSelectedEdge] = useState(null);
  const [expandOpen, setExpandOpen] = useState(false);
  const [expandDirection, setExpandDirection] = useState('outbound');
  const [filtersApplied, setFiltersApplied] = useState(false);
  const [contextByAccount, setContextByAccount] = useState({});
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState(null);

  const containerRef = useRef(null);
  const svgRef = useRef(null);

  const paths = Array.isArray(graphJson?.paths) ? graphJson.paths : [];
  const activePath = paths[pathIndex] || null;
  const contextSummary = graphJson?.context_summary || contextByAccount?.[selectedAccountId]?.context_summary;
  const availability = graphJson?.availability || contextByAccount?.[selectedAccountId]?.availability;
  const baselinePath = graphJson?.baseline?.path || contextByAccount?.[selectedAccountId]?.baseline?.path;
  const displayPath = filtersApplied ? (activePath || baselinePath) : (baselinePath || activePath);
  const applyLabel = buildApplyLabel(availability, maxHops, circularOnly);

  const fetchGraph = async (accountId, opts = {}, applied = false) => {
    if (!accountId) return;
    setLoading(true);
    setError(null);
    try {
      const params = {
        window_hours: Number(opts.window_hours ?? windowHours),
        max_hops: Number(opts.max_hops ?? maxHops),
        max_paths: Number(opts.max_paths ?? maxPaths),
        amount_tolerance: Number(opts.amount_tolerance ?? amountTolerance),
        pass_through_window_minutes: Number(opts.pass_through_window_minutes ?? passThroughWindowMinutes),
        circular_only: Boolean(opts.circular_only ?? circularOnly)
      };
      if (opts.start_ts ?? startTs) params.start_ts = (opts.start_ts ?? startTs) || undefined;
      if (opts.end_ts ?? endTs) params.end_ts = (opts.end_ts ?? endTs) || undefined;
      Object.keys(params).forEach((k) => {
        if (params[k] === undefined || params[k] === '') delete params[k];
      });

      const res = await muleApi.getFlowWorkbenchGraph(accountId, params);
      if (!res?.success) {
        setGraphJson(res || null);
        setPathIndex(0);
        setFiltersApplied(applied);
        return;
      }
      setGraphJson(res);
      setPathIndex(0);
      setSelectedNode(null);
      setSelectedEdge(null);
      setFiltersApplied(applied);
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Failed to load workbench graph');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setFiltersApplied(false);
    fetchGraph(selectedAccountId, {}, false);
  }, [selectedAccountId]);

  const fetchContext = async (accountIds) => {
    if (!Array.isArray(accountIds) || !accountIds.length) return;
    setContextLoading(true);
    setContextError(null);
    try {
      const res = await muleApi.getFlowContext({ account_ids: accountIds });
      const results = Array.isArray(res?.results) ? res.results : [];
      const map = {};
      results.forEach((r) => {
        if (r?.account_id) {
          map[String(r.account_id)] = r;
        }
      });
      setContextByAccount(map);
    } catch (e) {
      setContextError(e?.response?.data?.error || e?.message || 'Failed to load context');
    } finally {
      setContextLoading(false);
    }
  };

  useEffect(() => {
    fetchContext(selectedAccountIds);
  }, [selectedAccountIds]);

  const exportCurrentPath = () => {
    if (!graphJson || !activePath) return;
    downloadJson(`flow_path_${graphJson.account_id}_${activePath.path_id}.json`, {
      graph_id: graphJson.graph_id,
      account_id: graphJson.account_id,
      context: graphJson.context,
      summary: graphJson.summary,
      path: activePath
    });
  };

  const exportFullGraph = () => {
    if (!graphJson) return;
    downloadJson(`flow_graph_${graphJson.account_id}.json`, graphJson);
  };

  const renderPath = (path) => {
    const el = svgRef.current;
    const box = containerRef.current;
    if (!el || !box) return;

    const width = box.clientWidth || 800;
    const height = box.clientHeight || 500;

    const svg = d3.select(el);
    svg.selectAll('*').remove();
    svg.attr('width', width).attr('height', height);

    const defs = svg.append('defs');
    defs
      .append('marker')
      .attr('id', 'arrow')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 10)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#334155');

    const root = svg.append('g');
    svg.call(
      d3
        .zoom()
        .scaleExtent([0.4, 3])
        .on('zoom', (ev) => {
          root.attr('transform', ev.transform);
        })
    );

    if (!path) return;

    const nodes = Array.isArray(path.nodes) ? path.nodes : [];
    const edges = Array.isArray(path.edges) ? path.edges : [];
    const cycles = Array.isArray(path.cycles) ? path.cycles : [];

    const padX = 80;
    const padY = 70;
    const laneY = height / 2;
    const dx = nodes.length <= 1 ? 0 : (width - padX * 2) / (nodes.length - 1);

    const pos = new Map();
    nodes.forEach((n, i) => {
      pos.set(String(n.node_id), { x: padX + dx * i, y: laneY });
    });

    const linkLayer = root.append('g');
    const nodeLayer = root.append('g');
    const cycleLayer = root.append('g');

    const edgeSel = linkLayer
      .selectAll('path.edge')
      .data(edges, (d) => String(d.edge_id))
      .enter()
      .append('path')
      .attr('class', 'edge')
      .attr('fill', 'none')
      .attr('stroke', (d) => toColor(d?.visual?.color))
      .attr('stroke-width', (d) => Math.max(1, Number(d?.visual?.thickness || 1)))
      .attr('marker-end', 'url(#arrow)')
      .attr('opacity', 0.9)
      .attr('d', (d) => {
        const a = pos.get(String(d.from));
        const b = pos.get(String(d.to));
        if (!a || !b) return '';
        const midX = (a.x + b.x) / 2;
        const curve = Math.abs(b.x - a.x) > 200 ? 40 : 20;
        return `M${a.x},${a.y} Q${midX},${a.y - curve} ${b.x},${b.y}`;
      })
      .on('mouseenter', (ev, d) => {
        setSelectedEdge(d);
        const tx = d?.transaction || {};
        const explain = Array.isArray(d?.explain) ? d.explain : [];
        const title = `TXN ${tx.txn_id || d.edge_id}`;
        const lines = [
          `Time: ${String(tx.timestamp || '-')}`,
          `Amount: ${formatNumber(tx.amount, { minFractionDigits: 2, maxFractionDigits: 2 })} ${tx.currency || ''}`.trim(),
          `Channel: ${tx.channel || '-'}`,
          ...explain
        ];
        setTooltip({ open: true, x: ev.clientX, y: ev.clientY, title, lines });
      })
      .on('mouseleave', () => {
        setTooltip({ open: false, x: 0, y: 0, title: '', lines: [] });
      })
      .on('click', (_ev, d) => {
        setSelectedEdge(d);
      });

    edgeSel.each(function applyAnim(d) {
      const anim = String(d?.visual?.animation || '').toUpperCase();
      if (anim !== 'FAST_FLOW') return;
      const p = d3.select(this);
      const len = this.getTotalLength();
      p.attr('stroke-dasharray', `${len} ${len}`).attr('stroke-dashoffset', len);
      const loop = () => {
        p.attr('stroke-dashoffset', len)
          .transition()
          .duration(1200)
          .ease(d3.easeLinear)
          .attr('stroke-dashoffset', 0)
          .on('end', loop);
      };
      loop();
    });

    cycleLayer
      .selectAll('path.cycle')
      .data(cycles, (d) => String(d.cycle_id))
      .enter()
      .append('path')
      .attr('class', 'cycle')
      .attr('fill', 'none')
      .attr('stroke', '#ef4444')
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '6 4')
      .attr('opacity', 0.9)
      .attr('d', (c) => {
        const ns = Array.isArray(c.nodes) ? c.nodes : [];
        const pts = ns.map((nid) => pos.get(String(nid))).filter(Boolean);
        if (pts.length < 3) return '';
        const p0 = pts[0];
        const p1 = pts[Math.floor(pts.length / 2)];
        const p2 = pts[pts.length - 1];
        const cx = (p0.x + p2.x) / 2;
        const cy = Math.min(p0.y, p2.y) - 120;
        return `M${p0.x},${p0.y} Q${cx},${cy} ${p2.x},${p2.y}`;
      });

    const nodeG = nodeLayer
      .selectAll('g.node')
      .data(nodes, (d) => String(d.node_id))
      .enter()
      .append('g')
      .attr('class', 'node')
      .attr('transform', (d) => {
        const p = pos.get(String(d.node_id));
        return p ? `translate(${p.x},${p.y})` : 'translate(0,0)';
      })
      .style('cursor', 'pointer')
      .on('mouseenter', (ev, d) => {
        setSelectedNode(d);
        const explain = Array.isArray(d?.explain) ? d.explain : [];
        const attrs = d?.attributes || {};
        const lines = [
          `Role: ${d.role_in_path || '-'}`,
          `Risk Rating: ${attrs.risk_rating || '-'}`,
          `Accounts/Device: ${attrs.accounts_per_device ?? '-'}`,
          `Accounts/IP: ${attrs.accounts_per_ip ?? '-'}`,
          `Geo: ${attrs.geo_location || '-'}`,
          ...explain
        ];
        setTooltip({ open: true, x: ev.clientX, y: ev.clientY, title: String(d.node_id), lines });
      })
      .on('mouseleave', () => {
        setTooltip({ open: false, x: 0, y: 0, title: '', lines: [] });
      })
      .on('click', (_ev, d) => {
        setSelectedNode(d);
      });

    nodeG
      .append('circle')
      .attr('r', (d) => 14 * Number(d?.visual?.size || 1.0))
      .attr('fill', (d) => toColor(d?.visual?.color))
      .attr('stroke', '#ffffff')
      .attr('stroke-width', 2);

    nodeG
      .append('text')
      .text((d) => String(d.node_id))
      .attr('y', 32)
      .attr('text-anchor', 'middle')
      .attr('fill', '#0f172a')
      .attr('font-size', 12);

    nodeG
      .append('text')
      .text((d) => String(d.role_in_path || ''))
      .attr('y', -22)
      .attr('text-anchor', 'middle')
      .attr('fill', '#64748b')
      .attr('font-size', 11);
  };

  const [tooltip, setTooltip] = useState({ open: false, x: 0, y: 0, title: '', lines: [] });

  useEffect(() => {
    renderPath(displayPath);
  }, [displayPath, selectedAccountId, loading, filtersApplied]);

  useEffect(() => {
    const onResize = () => renderPath(displayPath);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [displayPath]);

  return (
    <Box sx={{ p: 2 }}>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {contextError && <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setContextError(null)}>{contextError}</Alert>}
      <Card sx={{ mb: 2 }} elevation={0}>
        <CardContent>
          <Stack direction="row" spacing={2} alignItems="center" justifyContent="space-between" flexWrap="wrap">
            <Box sx={{ minWidth: 320 }}>
              <AccountSelector dense multiple />
            </Box>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
              <Button variant="contained" disabled={!selectedAccountId || loading} onClick={() => fetchGraph(selectedAccountId)}>
                {loading ? 'Building…' : 'Build Flow Graph'}
              </Button>
              <Button variant="outlined" disabled={!graphJson?.success} onClick={exportCurrentPath}>
                Export Path
              </Button>
              <Button variant="outlined" disabled={!graphJson?.success} onClick={exportFullGraph}>
                Export Graph
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>
      <MultiAccountPanel accountIds={selectedAccountIds} contexts={contextByAccount} />
      {contextLoading ? (
        <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>
          Loading pre-filter context…
        </Alert>
      ) : null}
      <ContextPanel summary={contextSummary} />
      <AvailabilityPanel availability={availability} />
      <Card>
        <CardHeader
          title="Money Flow Graph Workbench"
          subheader="Baseline first. Filters narrow what already exists."
          action={
            filtersApplied ? (
              <Stack direction="row" spacing={1} alignItems="center">
                <Button size="small" variant="outlined" disabled={!paths.length || pathIndex <= 0} onClick={() => setPathIndex((i) => Math.max(0, i - 1))}>
                  Prev
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={!paths.length || pathIndex >= paths.length - 1}
                  onClick={() => setPathIndex((i) => Math.min(paths.length - 1, i + 1))}
                >
                  Next
                </Button>
              </Stack>
            ) : null
          }
        />
        <CardContent>
          <Stack spacing={2}>
            <Stack direction="row" spacing={2} flexWrap="wrap" alignItems="center">
              <FormControlLabel
                control={<Switch checked={circularOnly} onChange={(e) => setCircularOnly(e.target.checked)} />}
                label="Circular only"
              />
              <TextField
                label="Start time"
                type="datetime-local"
                size="small"
                value={startTs}
                onChange={(e) => setStartTs(e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                label="End time"
                type="datetime-local"
                size="small"
                value={endTs}
                onChange={(e) => setEndTs(e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
              <TextField label="Window (hours)" size="small" value={windowHours} onChange={(e) => setWindowHours(e.target.value)} sx={{ width: 150 }} />
              <FormControl size="small" sx={{ width: 140 }}>
                <InputLabel>Max hops</InputLabel>
                <Select value={maxHops} label="Max hops" onChange={(e) => setMaxHops(e.target.value)}>
                  {[2, 3, 4, 5, 6].map((n) => (
                    <MenuItem key={n} value={n}>
                      {n}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField
                label="Max paths"
                size="small"
                value={maxPaths}
                onChange={(e) => setMaxPaths(e.target.value)}
                sx={{ width: 130 }}
              />
              <TextField
                label="Amt tolerance"
                size="small"
                value={amountTolerance}
                onChange={(e) => setAmountTolerance(e.target.value)}
                sx={{ width: 140 }}
              />
              <TextField
                label="Pass-through (min)"
                size="small"
                value={passThroughWindowMinutes}
                onChange={(e) => setPassThroughWindowMinutes(e.target.value)}
                sx={{ width: 170 }}
              />
              <Button
                variant="outlined"
                disabled={!selectedAccountId || loading}
                onClick={() =>
                  fetchGraph(
                    selectedAccountId,
                    {
                      circular_only: circularOnly,
                      start_ts: startTs || undefined,
                      end_ts: endTs || undefined,
                      window_hours: windowHours,
                      max_hops: maxHops,
                      max_paths: maxPaths,
                      amount_tolerance: amountTolerance,
                      pass_through_window_minutes: passThroughWindowMinutes
                    },
                    true
                  )
                }
              >
                {applyLabel}
              </Button>
              {filtersApplied && activePath ? (
                <Stack direction="row" spacing={1} alignItems="center">
                  <Chip label={`${activePath.path_type} • risk ${formatProbability(activePath.risk_score, 2)}`} />
                  <Chip label={`hops ${formatInteger(activePath.metrics?.hop_count ?? '-')}`} />
                  <Chip label={`duration ${formatInteger(activePath.metrics?.total_duration_minutes ?? '-')} min`} />
                </Stack>
              ) : null}
            </Stack>

            <Divider />

            {!graphJson ? (
              <Alert severity="info" variant="outlined">
                Select an account and build a flow graph.
              </Alert>
            ) : graphJson.success !== true ? (
              <Alert severity="warning" variant="outlined">
                {graphJson.error || 'No graph available'}
              </Alert>
            ) : !displayPath ? (
              <Alert severity="info" variant="outlined">
                No baseline data available for the selected account.
              </Alert>
            ) : (
              <Stack spacing={1}>
                {!filtersApplied ? (
                  <Alert severity="info" variant="outlined">
                    {graphJson?.baseline?.label || 'Baseline Transaction Network (no suspicion filters applied)'}
                  </Alert>
                ) : null}
                {filtersApplied && !activePath ? (
                  <NoResultsPanel
                    filters={{ circularOnly, maxHops, windowHours, amountTolerance }}
                    availability={availability}
                  />
                ) : null}
                <Box
                  ref={containerRef}
                  sx={{
                    height: '70vh',
                    position: 'relative',
                    bgcolor: 'white',
                    border: '1px solid',
                    borderColor: 'divider'
                  }}
                >
                  <svg ref={svgRef} style={{ display: 'block', background: 'white' }} />
                  {tooltip.open ? (
                    <Box
                      sx={{
                        position: 'fixed',
                        left: tooltip.x + 12,
                        top: tooltip.y + 12,
                        bgcolor: 'rgba(255,255,255,0.98)',
                        border: '1px solid #e2e8f0',
                        borderRadius: 1,
                        p: 1,
                        maxWidth: 420,
                        zIndex: 2000,
                        pointerEvents: 'none'
                      }}
                    >
                      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                        {tooltip.title}
                      </Typography>
                      {(tooltip.lines || []).map((l, i) => (
                        <Typography key={`${tooltip.title}-${i}`} variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          {l}
                        </Typography>
                      ))}
                    </Box>
                  ) : null}
                </Box>
              </Stack>
            )}

            {activePath ? (
              <Card variant="outlined">
                <CardHeader
                  title="Path Reasons"
                  subheader={`${activePath.path_id} • rank ${activePath.path_rank}`}
                  action={
                    <Button size="small" variant="contained" disabled={!selectedAccountId} onClick={() => openInvestigation(selectedAccountId)}>
                      Investigate Account
                    </Button>
                  }
                />
                <CardContent>
                  <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 1 }}>
                    {(activePath.risk_reasons || []).map((r) => (
                      <Chip key={r} label={r} />
                    ))}
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    Total amount: {formatNumber(activePath.metrics?.total_amount, { minFractionDigits: 2, maxFractionDigits: 2 })} • Retention: {formatProbability(activePath.metrics?.amount_retention_ratio, 2)}
                  </Typography>
                </CardContent>
              </Card>
            ) : null}
          </Stack>
        </CardContent>
      </Card>

      <Dialog open={expandOpen} onClose={() => setExpandOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Expand Node</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Node: {selectedNode?.node_id || '-'}
            </Typography>
            <FormControl size="small" fullWidth>
              <InputLabel>Direction</InputLabel>
              <Select value={expandDirection} label="Direction" onChange={(e) => setExpandDirection(e.target.value)}>
                <MenuItem value="outbound">Outbound</MenuItem>
                <MenuItem value="inbound">Inbound</MenuItem>
                <MenuItem value="same_day">Same-day</MenuItem>
              </Select>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setExpandOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!selectedAccountId || !selectedNode?.node_id}
            onClick={async () => {
              try {
                setLoading(true);
                const res = await muleApi.expandFlowWorkbenchGraph(selectedAccountId, {
                  node_id: selectedNode.node_id,
                  direction: expandDirection,
                  start_ts: startTs || null,
                  end_ts: endTs || null,
                  window_hours: Number(windowHours),
                  max_hops: Number(maxHops),
                  max_paths: Number(maxPaths),
                  amount_tolerance: Number(amountTolerance),
                  pass_through_window_minutes: Number(passThroughWindowMinutes),
                  circular_only: Boolean(circularOnly)
                });
                setGraphJson(res);
                setPathIndex(0);
                setExpandOpen(false);
              } catch (e) {
                setError(e?.response?.data?.error || e?.message || 'Expand failed');
              } finally {
                setLoading(false);
              }
            }}
          >
            Expand
          </Button>
        </DialogActions>
      </Dialog>

      {selectedNode ? (
        <Card sx={{ mt: 2 }} variant="outlined">
          <CardHeader
            title="Selected Node"
            subheader={selectedNode.node_id}
            action={
              <Button size="small" variant="outlined" onClick={() => setExpandOpen(true)}>
                Expand
              </Button>
            }
          />
          <CardContent>
            <Stack direction="row" spacing={1} flexWrap="wrap">
              <Chip label={`Role: ${selectedNode.role_in_path || '-'}`} />
              <Chip label={`Risk: ${selectedNode.attributes?.risk_rating || '-'}`} />
              <Chip label={`Geo: ${selectedNode.attributes?.geo_location || '-'}`} />
              <Chip label={`Accounts/Device: ${selectedNode.attributes?.accounts_per_device ?? '-'}`} />
              <Chip label={`Accounts/IP: ${selectedNode.attributes?.accounts_per_ip ?? '-'}`} />
            </Stack>
            {Array.isArray(selectedNode.explain) && selectedNode.explain.length ? (
              <Box sx={{ mt: 1 }}>
                {selectedNode.explain.map((t) => (
                  <Typography key={t} variant="body2" color="text.secondary">
                    {t}
                  </Typography>
                ))}
              </Box>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {selectedEdge ? (
        <Card sx={{ mt: 2 }} variant="outlined">
          <CardHeader title="Selected Transaction" subheader={selectedEdge.edge_id} />
          <CardContent>
            <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 1 }}>
              <Chip label={`${selectedEdge.from} → ${selectedEdge.to}`} />
              <Chip label={`Time: ${selectedEdge.transaction?.timestamp || '-'}`} />
              <Chip label={`Amount: ${formatNumber(selectedEdge.transaction?.amount, { minFractionDigits: 2, maxFractionDigits: 2 })}`} />
              <Chip label={`Channel: ${selectedEdge.transaction?.channel || '-'}`} />
            </Stack>
            {Array.isArray(selectedEdge.explain) && selectedEdge.explain.length ? (
              <Box>
                {selectedEdge.explain.map((t) => (
                  <Typography key={t} variant="body2" color="text.secondary">
                    {t}
                  </Typography>
                ))}
              </Box>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </Box>
  );
};

export default NetworkGraphScreen;
