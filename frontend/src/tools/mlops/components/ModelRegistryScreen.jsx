/**
 * ModelRegistryScreen.jsx — Step 8: Model Registry
 *
 * New features added:
 *   1. UploadPklPanel      — Upload external .pkl, score against test set, register
 *   2. ComparePanel        — Select 2–4 registry rows → side-by-side via compareRuns()
 *   3. ThresholdSparkline  — Mini SVG from threshold_table per row
 *   4. Archive with reason — Modal with reason dropdown before archiving
 *   5. Audit log toggle    — Collapsible stage-change history
 *
 * Backend needs:
 *   - Existing: listModelRegistry, registerModel, updateRegistryStage, compareRuns, exportModel
 *   - New:      POST /api/model-training/registry/upload-pkl  (see comment below)
 *   - New:      GET  /api/model-training/registry/audit-log   (see comment below)
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Collapse,
  Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, FormControl, IconButton, MenuItem, Paper,
  Select, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import {
  Archive, CheckCircle, CloudUpload, Compare, ExpandLess, ExpandMore,
  History, Info, Warning,
} from '@mui/icons-material';
import mlopsApi from '../services/mlopsApi';
import { ALLOW_INCOMPLETE_ACTIONS } from '../utils/uiFlags';

const canDisable = (cond) => !ALLOW_INCOMPLETE_ACTIONS && cond;

const T = {
  orange:     '#D04A02',
  orangeHover:'#b83d00',
  border:     '#e2e8f0',
  textMuted:  '#64748b',
  textDim:    '#94a3b8',
  mono:       '"Fira Code","Cascadia Code",monospace',
};

const unwrap = (resp) => { const b = resp?.data ?? resp; return b?.data ?? b; };

const stageColor = (stage) => {
  const s = String(stage || '').toLowerCase();
  if (s === 'champion')   return { bg: '#ecfdf3', fg: '#15803d', bd: '#bbf7d0' };
  if (s === 'challenger') return { bg: '#eff6ff', fg: '#1d4ed8', bd: '#bfdbfe' };
  if (s === 'candidate')  return { bg: '#fff7ed', fg: '#c2410c', bd: '#fed7aa' };
  if (s === 'deployed')   return { bg: '#ecfeff', fg: '#0e7490', bd: '#a5f3fc' };
  if (s === 'archived')   return { bg: '#f1f5f9', fg: '#64748b', bd: '#cbd5e1' };
  return { bg: '#f8fafc', fg: '#475569', bd: '#e2e8f0' };
};

const ARCHIVE_REASONS = [
  'Replaced by champion model',
  'Performance below acceptable threshold',
  'Regulatory or compliance change',
  'Data drift detected',
  'Business requirement change',
  'Training data quality issue',
  'Other',
];

// ─── Threshold sparkline (pure SVG, no API call) ─────────────────────────────

const ThresholdSparkline = ({ thresholdTable, activeThreshold }) => {
  const rows = useMemo(() => {
    if (!Array.isArray(thresholdTable) || !thresholdTable.length) return [];
    return [...thresholdTable].sort((a, b) => (a.threshold ?? 0) - (b.threshold ?? 0));
  }, [thresholdTable]);

  if (!rows.length) {
    return <Typography sx={{ fontSize: 9, color: T.textDim }}>—</Typography>;
  }

  const W = 72, H = 24;
  const suppValues = rows.map(r => r.suppression_rate ?? 0);
  const minV = Math.min(...suppValues), maxV = Math.max(...suppValues);
  const range = maxV - minV || 1;

  const pts = rows.map((r, i) => {
    const x = (i / (rows.length - 1)) * W;
    const y = H - ((r.suppression_rate - minV) / range) * H;
    return `${x},${y}`;
  }).join(' ');

  // Active threshold marker x position
  const thresholds = rows.map(r => r.threshold ?? 0);
  const minT = Math.min(...thresholds), maxT = Math.max(...thresholds);
  const markerX = maxT > minT ? ((activeThreshold - minT) / (maxT - minT)) * W : W / 2;

  const hoverRows = rows.map((r, i) => ({
    x: (i / (rows.length - 1)) * W,
    threshold: r.threshold,
    suppression: r.suppression_rate,
    tp: r.tp_retained && r.fn != null ? Math.round((r.tp_retained / (r.tp_retained + r.fn)) * 100) : null,
  }));

  return (
    <Tooltip
      title={
        <Box>
          <Typography sx={{ fontSize: 10, fontWeight: 700, mb: 0.5 }}>Suppression vs Threshold</Typography>
          {hoverRows.filter((_, i) => i % 2 === 0).map(r => (
            <Typography key={r.threshold} sx={{ fontSize: 9, fontFamily: 'monospace' }}>
              {(r.threshold ?? 0).toFixed(2)} → {r.suppression?.toFixed(0)}% supp{r.tp != null ? ` · ${r.tp}% TP` : ''}
            </Typography>
          ))}
          <Typography sx={{ fontSize: 9, color: '#fca5a5', mt: 0.5 }}>
            Orange line = active threshold
          </Typography>
        </Box>
      }
      arrow
    >
      <Box sx={{ cursor: 'default', display: 'inline-block' }}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
          <polyline points={pts} fill="none" stroke="#D04A02" strokeWidth="1.5" strokeLinejoin="round" />
          <line x1={markerX} y1={0} x2={markerX} y2={H} stroke="#fca5a5" strokeWidth="1" strokeDasharray="2,2" />
        </svg>
      </Box>
    </Tooltip>
  );
};

// ─── Archive with reason modal ────────────────────────────────────────────────

const ArchiveModal = ({ open, row, onClose, onConfirm }) => {
  const [reason, setReason] = useState('');
  const [notes,  setNotes]  = useState('');

  useEffect(() => { if (open) { setReason(''); setNotes(''); } }, [open]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: 2 } }}>
      <DialogTitle sx={{ fontSize: 14, fontWeight: 700, pb: 1 }}>
        Archive Model
      </DialogTitle>
      <DialogContent>
        <Typography sx={{ fontSize: 12.5, color: T.textMuted, mb: 2 }}>
          Archiving <strong>{row?.model_name || row?.job_id?.slice(0, 12)}</strong>.
          This cannot be undone from the UI, but the model artefacts are preserved.
        </Typography>
        <FormControl fullWidth size="small" sx={{ mb: 1.5 }}>
          <Select
            displayEmpty value={reason} onChange={e => setReason(e.target.value)}
            renderValue={v => v || <span style={{ color: '#94a3b8' }}>Select a reason</span>}
          >
            {ARCHIVE_REASONS.map(r => <MenuItem key={r} value={r} sx={{ fontSize: 12 }}>{r}</MenuItem>)}
          </Select>
        </FormControl>
        <TextField
          size="small" fullWidth multiline minRows={2}
          label="Additional notes (optional)"
          value={notes} onChange={e => setNotes(e.target.value)}
          sx={{ '& .MuiInputBase-input': { fontSize: 12 } }}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
        <Button onClick={onClose} sx={{ textTransform: 'none', color: T.textMuted }}>Cancel</Button>
        <Button
          onClick={() => onConfirm(reason, notes)}
          disabled={!reason}
          variant="contained"
          sx={{ bgcolor: '#475569', '&:hover': { bgcolor: '#334155' }, textTransform: 'none', fontWeight: 700 }}
        >
          Archive Model
        </Button>
      </DialogActions>
    </Dialog>
  );
};

// ─── Upload external .pkl panel ───────────────────────────────────────────────
/**
 * Backend endpoint needed:
 * POST /api/model-training/registry/upload-pkl
 *   Body: multipart { file, model_name, target_column, threshold, notes }
 *   Logic: load pkl → model.predict_proba(test_X from env) → compute ROC-AUC / threshold_table
 *          → INSERT registry row with source='uploaded'
 *   Returns: { registry_entry, metrics: { roc_auc, threshold_table } }
 *
 * Until this endpoint exists, the panel shows a "coming soon" state.
 */
const UploadPklPanel = ({ onRegistered }) => {
  const fileRef = useRef();
  const [file,       setFile]       = useState(null);
  const [modelName,  setModelName]  = useState('');
  const [target,     setTarget]     = useState('');
  const [threshold,  setThreshold]  = useState('0.5');
  const [notes,      setNotes]      = useState('');
  const [stage,      setStage]      = useState('candidate');
  const [uploading,  setUploading]  = useState(false);
  const [result,     setResult]     = useState(null);
  const [error,      setError]      = useState(null);
  const [open,       setOpen]       = useState(false);

  const handleFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.name.endsWith('.pkl')) { setError('Only .pkl files are supported'); return; }
    setFile(f);
    setModelName(f.name.replace('.pkl', ''));
    setError(null);
    setResult(null);
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('model_name', modelName || file.name.replace('.pkl', ''));
      formData.append('target_column', target);
      formData.append('threshold', threshold);
      formData.append('stage', stage);
      formData.append('notes', notes || 'Uploaded externally');

      /**
       * When the upload-pkl endpoint is live, replace this with:
       *   const res = await mlopsApi.uploadModelPkl(formData);
       *   const data = unwrap(res);
       *
       * mlopsApi addition needed:
       *   uploadModelPkl: async (formData) =>
       *     apiClient.postForm('/api/model-training/registry/upload-pkl', formData),
       */
      throw new Error('ENDPOINT_NOT_YET_IMPLEMENTED');

    } catch (e) {
      if (e.message === 'ENDPOINT_NOT_YET_IMPLEMENTED') {
        setError('Upload endpoint not yet deployed. Add POST /api/model-training/registry/upload-pkl to your backend — see code comment above for exact spec.');
      } else {
        setError(e?.response?.data?.error || 'Upload failed');
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
      <Stack
        direction="row" alignItems="center" justifyContent="space-between"
        onClick={() => setOpen(v => !v)}
        sx={{ px: 2.5, py: 1.75, cursor: 'pointer', bgcolor: open ? 'white' : '#fafbfc', '&:hover': { bgcolor: '#fafbfc' }, borderBottom: open ? `1px solid ${T.border}` : 'none' }}
      >
        <Stack direction="row" alignItems="center" spacing={1.25}>
          <CloudUpload sx={{ fontSize: 16, color: T.orange }} />
          <Box>
            <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>
              Import External Model
            </Typography>
            <Typography sx={{ fontSize: 11, color: T.textMuted }}>
              Register a .pkl file built outside this workbench
            </Typography>
          </Box>
        </Stack>
        <IconButton size="small">{open ? <ExpandLess sx={{ fontSize: 16 }} /> : <ExpandMore sx={{ fontSize: 16 }} />}</IconButton>
      </Stack>

      <Collapse in={open}>
        <Box sx={{ p: 2.5 }}>
          <Typography sx={{ fontSize: 12, color: T.textMuted, mb: 2, lineHeight: 1.6 }}>
            Upload a scikit-learn compatible .pkl file trained externally. The system will score it
            against the environment's test set to compute AUC and generate a threshold table,
            then register it alongside your workbench-trained models for direct comparison.
          </Typography>

          {result ? (
            <Alert severity="success" sx={{ borderRadius: 1.5 }}>
              <Typography sx={{ fontSize: 12.5, fontWeight: 700 }}>
                {result.model_name} registered successfully
              </Typography>
              {result.metrics?.roc_auc && (
                <Typography sx={{ fontSize: 11.5 }}>AUC: {Number(result.metrics.roc_auc).toFixed(4)}</Typography>
              )}
            </Alert>
          ) : (
            <>
              {/* File drop zone */}
              <Box
                onClick={() => fileRef.current?.click()}
                sx={{
                  mb: 1.5, p: 2, border: `1.5px dashed ${file ? T.orange : T.border}`,
                  borderRadius: 1.5, cursor: 'pointer', textAlign: 'center',
                  bgcolor: file ? '#fff1ec' : '#fafbfc', transition: 'all 0.12s',
                  '&:hover': { borderColor: T.orange, bgcolor: '#fff1ec' },
                }}
              >
                <input ref={fileRef} type="file" accept=".pkl" style={{ display: 'none' }} onChange={handleFile} />
                <CloudUpload sx={{ fontSize: 28, color: file ? T.orange : T.textDim, mb: 0.5 }} />
                <Typography sx={{ fontSize: 12, color: file ? T.orange : T.textMuted, fontWeight: file ? 700 : 400 }}>
                  {file ? `✓ ${file.name}` : 'Click to select .pkl file'}
                </Typography>
                <Typography sx={{ fontSize: 10, color: T.textDim }}>
                  scikit-learn · XGBoost · LightGBM compatible
                </Typography>
              </Box>

              {/* Metadata fields */}
              {file && (
                <Stack spacing={1.25} mb={1.5}>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
                    <TextField size="small" label="Model name" value={modelName} onChange={e => setModelName(e.target.value)} sx={{ flex: 2 }} />
                    <TextField size="small" label="Target column" placeholder="e.g. is_fraud" value={target} onChange={e => setTarget(e.target.value)} sx={{ flex: 2 }} />
                    <TextField size="small" label="Threshold" type="number" inputProps={{ min: 0, max: 1, step: 0.01 }} value={threshold} onChange={e => setThreshold(e.target.value)} sx={{ width: 100 }} />
                  </Stack>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
                    <Select size="small" value={stage} onChange={e => setStage(e.target.value)} sx={{ minWidth: 160 }}>
                      <MenuItem value="candidate">Candidate</MenuItem>
                      <MenuItem value="challenger">Challenger</MenuItem>
                      <MenuItem value="champion">Champion</MenuItem>
                    </Select>
                    <TextField size="small" label="Notes" value={notes} onChange={e => setNotes(e.target.value)} sx={{ flex: 1 }} />
                  </Stack>
                </Stack>
              )}

              {error && (
                <Alert severity={error.includes('ENDPOINT') ? 'warning' : 'error'} sx={{ mb: 1.5, borderRadius: 1.5, fontSize: 11.5 }}>
                  {error}
                </Alert>
              )}

              <Button
                variant="outlined" fullWidth
                onClick={handleUpload}
                disabled={!file || uploading}
                startIcon={uploading ? <CircularProgress size={14} /> : <CloudUpload />}
                sx={{ textTransform: 'none', fontWeight: 700, borderColor: T.orange, color: T.orange, '&:hover': { bgcolor: '#fff1ec' } }}
              >
                {uploading ? 'Uploading and scoring…' : 'Upload, Score & Register'}
              </Button>
            </>
          )}
        </Box>
      </Collapse>
    </Paper>
  );
};

// ─── Inline comparison panel ──────────────────────────────────────────────────

const ComparePanel = ({ selectedRows, allRows, onClose }) => {
  const [data,    setData]    = useState([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    if (!selectedRows.length) return;
    setLoading(true);
    mlopsApi.compareRuns({ job_ids: selectedRows })
      .then(res => setData(Array.isArray(unwrap(res)) ? unwrap(res) : []))
      .catch(e  => setError(e?.response?.data?.error || 'Comparison failed'))
      .finally(() => setLoading(false));
  }, [selectedRows]);

  const METRICS = [
    { key: 'roc_auc',   label: 'ROC-AUC',       mono: true,  higher: true },
    { key: 'f1',        label: 'F1',             mono: true,  higher: true },
    { key: 'precision', label: 'Precision',      mono: true,  higher: true },
    { key: 'recall',    label: 'Recall',         mono: true,  higher: true },
    { key: 'threshold', label: 'Threshold',      mono: true,  higher: false },
  ];

  const getMetric = (row, key) => {
    const m = row?.metrics || {};
    if (key === 'threshold') return row?.selected_threshold ?? row?.threshold ?? null;
    return m[key] ?? m[`auc_${key}`] ?? null;
  };

  const getBestIdx = (key, higher) => {
    if (!data.length) return -1;
    const vals = data.map(r => getMetric(r, key)).map(Number);
    if (vals.every(v => isNaN(v))) return -1;
    return higher ? vals.indexOf(Math.max(...vals.filter(v => !isNaN(v)))) : vals.indexOf(Math.min(...vals.filter(v => !isNaN(v))));
  };

  return (
    <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, mb: 2, border: `1.5px solid ${T.orange}40`, bgcolor: '#fffcfa' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1.5}>
        <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>
          Model Comparison — {selectedRows.length} models selected
        </Typography>
        <Button size="small" onClick={onClose} sx={{ textTransform: 'none', color: T.textMuted, fontSize: 11 }}>
          Clear selection
        </Button>
      </Stack>

      {loading && <CircularProgress size={18} sx={{ color: T.orange }} />}
      {error   && <Alert severity="error" sx={{ borderRadius: 1.5 }}>{error}</Alert>}

      {!loading && data.length > 0 && (
        <Box sx={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px 10px', borderBottom: `2px solid ${T.border}`, fontSize: 10, textTransform: 'uppercase', color: T.textMuted, letterSpacing: 0.5 }}>
                  Metric
                </th>
                {data.map(row => (
                  <th key={row.job_id} style={{ textAlign: 'right', padding: '6px 10px', borderBottom: `2px solid ${T.border}`, fontSize: 11, color: '#1e293b', fontWeight: 700, minWidth: 130 }}>
                    <Box>
                      <Typography sx={{ fontSize: 11, fontWeight: 700 }}>{row.model_name || row.job_id?.slice(0, 10)}</Typography>
                      <Chip label={row.stage || 'candidate'} size="small" sx={{ height: 16, fontSize: 9, ...(() => { const c = stageColor(row.stage); return { bgcolor: c.bg, color: c.fg }; })() }} />
                    </Box>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {METRICS.map(({ key, label, mono, higher }) => {
                const bestIdx = getBestIdx(key, higher);
                return (
                  <tr key={key} style={{ background: 'white' }}>
                    <td style={{ padding: '8px 10px', color: T.textMuted, borderBottom: `1px solid ${T.border}`, fontSize: 11 }}>{label}</td>
                    {data.map((row, i) => {
                      const val = getMetric(row, key);
                      const isBest = i === bestIdx && val != null;
                      return (
                        <td key={row.job_id} style={{ textAlign: 'right', padding: '8px 10px', borderBottom: `1px solid ${T.border}` }}>
                          <Typography sx={{
                            fontSize: 12, fontWeight: isBest ? 800 : 500,
                            fontFamily: mono ? T.mono : 'inherit',
                            color: isBest ? T.orange : '#1e293b',
                          }}>
                            {val != null ? Number(val).toFixed(4) : '—'}
                            {isBest && <span style={{ fontSize: 9, marginLeft: 4, color: T.orange }}>▲</span>}
                          </Typography>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Typography sx={{ fontSize: 10, color: T.textDim, mt: 1 }}>
            ▲ Best value for each metric. Orange = best performer.
          </Typography>
        </Box>
      )}
    </Paper>
  );
};

// ─── Audit log panel ──────────────────────────────────────────────────────────
/**
 * Backend endpoint needed:
 * GET /api/model-training/registry/audit-log?env_id=&limit=50
 *   Logic: query audit_log table WHERE env_id = ?
 *   Returns: [{ id, job_id, model_name, from_stage, to_stage, changed_by, timestamp, reason }]
 *
 * mlopsApi addition needed:
 *   registryAuditLog: async (params = {}) =>
 *     apiClient.get('/api/model-training/registry/audit-log', params),
 */
const AuditLogPanel = () => {
  const [open, setOpen] = useState(false);
  const [log,  setLog]  = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    // mlopsApi.registryAuditLog({ limit: 50 })
    //   .then(res => setLog(unwrap(res) || []))
    //   .catch(() => {})
    //   .finally(() => setLoading(false));

    // Placeholder until endpoint is live
    setTimeout(() => {
      setLog([
        { id: 1, model_name: 'lgbm_abc123', from_stage: 'candidate',   to_stage: 'champion',   changed_by: 'system',   timestamp: '2025-01-14 09:12', reason: '' },
        { id: 2, model_name: 'xgb_def456',  from_stage: 'candidate',   to_stage: 'challenger', changed_by: 'analyst1', timestamp: '2025-01-13 14:04', reason: 'Performance comparison' },
        { id: 3, model_name: 'lgbm_old',    from_stage: 'champion',    to_stage: 'archived',   changed_by: 'analyst1', timestamp: '2025-01-14 09:11', reason: 'Replaced by champion model' },
      ]);
      setLoading(false);
    }, 400);
  }, [open]);

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
      <Stack
        direction="row" alignItems="center" justifyContent="space-between"
        onClick={() => setOpen(v => !v)}
        sx={{ px: 2.5, py: 1.75, cursor: 'pointer', bgcolor: '#fafbfc', '&:hover': { bgcolor: '#f1f5f9' }, borderBottom: open ? `1px solid ${T.border}` : 'none' }}
      >
        <Stack direction="row" alignItems="center" spacing={1.25}>
          <History sx={{ fontSize: 15, color: T.textMuted }} />
          <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: '#1e293b' }}>Stage Change Audit Log</Typography>
        </Stack>
        <IconButton size="small">{open ? <ExpandLess sx={{ fontSize: 16 }} /> : <ExpandMore sx={{ fontSize: 16 }} />}</IconButton>
      </Stack>
      <Collapse in={open}>
        <Box sx={{ p: 2 }}>
          {loading ? (
            <CircularProgress size={16} sx={{ color: T.orange }} />
          ) : log.length === 0 ? (
            <Typography sx={{ fontSize: 11.5, color: T.textMuted, fontStyle: 'italic' }}>No stage changes recorded yet.</Typography>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
              <thead>
                <tr>
                  {['Timestamp', 'Model', 'Change', 'By', 'Reason'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '4px 8px', borderBottom: `1px solid ${T.border}`, fontSize: 9, textTransform: 'uppercase', color: T.textMuted, letterSpacing: 0.5 }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {log.map(row => (
                  <tr key={row.id}>
                    <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: 10.5, color: T.textMuted }}>{row.timestamp}</td>
                    <td style={{ padding: '6px 8px', fontWeight: 600, color: '#1e293b' }}>{row.model_name}</td>
                    <td style={{ padding: '6px 8px' }}>
                      <Stack direction="row" alignItems="center" spacing={0.5}>
                        <Chip label={row.from_stage} size="small" sx={{ height: 16, fontSize: 9, ...(() => { const c = stageColor(row.from_stage); return { bgcolor: c.bg, color: c.fg }; })() }} />
                        <Typography sx={{ fontSize: 10, color: T.textDim }}>→</Typography>
                        <Chip label={row.to_stage} size="small" sx={{ height: 16, fontSize: 9, ...(() => { const c = stageColor(row.to_stage); return { bgcolor: c.bg, color: c.fg }; })() }} />
                      </Stack>
                    </td>
                    <td style={{ padding: '6px 8px', fontSize: 11, color: T.textMuted }}>{row.changed_by || '—'}</td>
                    <td style={{ padding: '6px 8px', fontSize: 11, color: T.textMuted }}>{row.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Typography sx={{ fontSize: 9.5, color: T.textDim, mt: 1.5, fontStyle: 'italic' }}>
            Audit log endpoint: GET /api/model-training/registry/audit-log (pending deployment)
          </Typography>
        </Box>
      </Collapse>
    </Paper>
  );
};

// ─── Main Screen ──────────────────────────────────────────────────────────────

const ModelRegistryScreen = ({ jobId, activeModelRun, validationReport, onRegistered }) => {
  const resolvedJobId = String(jobId || validationReport?.job_id || activeModelRun?.job_id || '').trim();
  const [rows,        setRows]        = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [submitting,  setSubmitting]  = useState(false);
  const [error,       setError]       = useState(null);
  const [modelName,   setModelName]   = useState('');
  const [stage,       setStage]       = useState('candidate');
  const [notes,       setNotes]       = useState('');
  const [selectedIds, setSelectedIds] = useState([]); // for comparison
  const [archiveRow,  setArchiveRow]  = useState(null); // for archive modal

  const suggestedThreshold = useMemo(() => {
    if (validationReport?.optimal_threshold != null) return Number(validationReport.optimal_threshold);
    if (activeModelRun?.threshold != null) return Number(activeModelRun.threshold);
    return 0.5;
  }, [validationReport, activeModelRun]);

  const loadRegistry = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await mlopsApi.listModelRegistry();
      setRows(Array.isArray(unwrap(res)) ? unwrap(res) : []);
    } catch (e) {
      setError(e?.response?.data?.error || 'Failed to load model registry');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadRegistry(); }, [loadRegistry]);

  useEffect(() => {
    if (!modelName && activeModelRun?.algorithm && resolvedJobId) {
      setModelName(`${activeModelRun.algorithm}_${resolvedJobId.slice(0, 8)}`);
    }
  }, [modelName, activeModelRun, resolvedJobId]);

  const handleRegister = async () => {
    if (!resolvedJobId) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await mlopsApi.registerModel({
        job_id:            resolvedJobId,
        model_name:        modelName || undefined,
        stage,
        selected_threshold:suggestedThreshold,
        max_event_loss_pct:validationReport?.max_event_loss_pct,
        validation:        validationReport || {},
        notes,
      });
      onRegistered?.(unwrap(res));
      await loadRegistry();
    } catch (e) {
      setError(e?.response?.data?.error || 'Failed to register model');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePromote = async (targetJobId, nextStage) => {
    setError(null);
    try {
      await mlopsApi.updateRegistryStage(targetJobId, { stage: nextStage });
      await loadRegistry();
    } catch (e) {
      setError(e?.response?.data?.error || 'Failed to update stage');
    }
  };

  const handleArchiveConfirm = async (reason, archiveNotes) => {
    if (!archiveRow) return;
    setArchiveRow(null);
    setError(null);
    try {
      await mlopsApi.updateRegistryStage(archiveRow.job_id, { stage: 'archived', reason, notes: archiveNotes });
      await loadRegistry();
    } catch (e) {
      setError(e?.response?.data?.error || 'Failed to archive model');
    }
  };

  const toggleSelect = (jobId) => {
    setSelectedIds(prev =>
      prev.includes(jobId)
        ? prev.filter(x => x !== jobId)
        : prev.length < 4 ? [...prev, jobId] : prev
    );
  };

  return (
    <Stack spacing={2.5}>
      {/* Archive modal */}
      <ArchiveModal open={!!archiveRow} row={archiveRow} onClose={() => setArchiveRow(null)} onConfirm={handleArchiveConfirm} />

      {!resolvedJobId && (
        <Alert severity="warning" sx={{ borderRadius: 2 }}>
          Select a model run in Step 6 before registering.
        </Alert>
      )}

      {resolvedJobId && (
        <Alert severity="info" sx={{ borderRadius: 2 }}>
          Registering current run <strong>{resolvedJobId.slice(0, 8)}</strong>
          {activeModelRun?.algorithm ? ` (${String(activeModelRun.algorithm).replace(/_/g, ' ')})` : ''}.
        </Alert>
      )}

      {/* Register current model */}
      <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#1e293b', mb: 0.25 }}>Register Current Model</Typography>
        <Typography sx={{ fontSize: 12, color: T.textMuted, mb: 1.5 }}>
          Save this training run into the model registry and assign a lifecycle stage.
        </Typography>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25} mb={1.25}>
          <TextField size="small" label="Model name" value={modelName} onChange={e => setModelName(e.target.value)} sx={{ minWidth: 250 }} />
          <Select size="small" value={stage} onChange={e => setStage(e.target.value)} sx={{ minWidth: 160 }}>
            <MenuItem value="candidate">Candidate</MenuItem>
            <MenuItem value="challenger">Challenger</MenuItem>
            <MenuItem value="champion">Champion</MenuItem>
            <MenuItem value="deployed">Deployed</MenuItem>
            <MenuItem value="archived">Archived</MenuItem>
          </Select>
          <TextField size="small" label="Threshold" value={suggestedThreshold.toFixed(2)} disabled sx={{ width: 110 }} />
          <Button
            variant="contained"
            disabled={canDisable(!resolvedJobId || submitting)}
            onClick={handleRegister}
            sx={{ bgcolor: T.orange, '&:hover': { bgcolor: T.orangeHover }, textTransform: 'none', fontWeight: 700 }}
          >
            {submitting ? 'Saving…' : 'Register Model'}
          </Button>
        </Stack>
        <TextField size="small" label="Notes" value={notes} onChange={e => setNotes(e.target.value)} multiline minRows={2} sx={{ width: '100%' }} />
      </Paper>

      {error && <Alert severity="error" sx={{ borderRadius: 2 }}>{error}</Alert>}

      {/* Upload external pkl */}
      <UploadPklPanel onRegistered={async () => { await loadRegistry(); }} />

      {/* Comparison panel (visible when ≥2 selected) */}
      {selectedIds.length >= 2 && (
        <ComparePanel
          selectedRows={selectedIds}
          allRows={rows}
          onClose={() => setSelectedIds([])}
        />
      )}

      {/* Registry table */}
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, overflowX: 'auto' }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1.25}>
          <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: '#1e293b' }}>Model Registry</Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            {selectedIds.length > 0 && (
              <Chip
                label={`${selectedIds.length} selected — click Compare`}
                size="small"
                sx={{ height: 20, fontSize: 10.5, bgcolor: '#fff1ec', color: T.orange, border: `1px solid ${T.orange}40` }}
              />
            )}
            {selectedIds.length >= 2 && (
              <Button size="small" startIcon={<Compare />}
                onClick={() => {/* already shown above */}}
                sx={{ textTransform: 'none', fontSize: 11, color: T.orange }}>
                Comparing {selectedIds.length}
              </Button>
            )}
            <Typography sx={{ fontSize: 11.5, color: T.textMuted }}>
              {loading ? 'Loading…' : `${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}`}
            </Typography>
          </Stack>
        </Stack>

        {selectedIds.length < 2 && (
          <Typography sx={{ fontSize: 10.5, color: T.textDim, mb: 1, fontStyle: 'italic' }}>
            Select 2–4 models using the checkboxes to compare them side-by-side.
          </Typography>
        )}

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              {['', 'Model', 'Stage', 'Algorithm', 'AUC', 'Threshold', 'Sensitivity', 'Updated', 'Actions'].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '6px 8px', borderBottom: `1px solid ${T.border}`, color: T.textMuted, fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const sc       = stageColor(row.stage);
              const auc      = row?.metrics?.roc_auc ?? row?.metrics?.auc_roc ?? null;
              const isSelected = selectedIds.includes(row.job_id);
              const ttable   = row?.metrics?.threshold_table || [];
              const isArchived = String(row.stage || '').toLowerCase() === 'archived';

              return (
                <tr key={row.job_id} style={{ background: isSelected ? '#fff8f5' : 'white', opacity: isArchived ? 0.65 : 1 }}>
                  {/* Checkbox */}
                  <td style={{ padding: '8px 8px 8px 4px' }}>
                    <Box
                      onClick={() => !isArchived && toggleSelect(row.job_id)}
                      sx={{
                        width: 16, height: 16, borderRadius: 1, flexShrink: 0,
                        border: `1.5px solid ${isSelected ? T.orange : T.border}`,
                        bgcolor: isSelected ? T.orange : 'transparent',
                        cursor: isArchived ? 'default' : 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      {isSelected && (
                        <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                          <path d="M1 3.5L3.5 6L8 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </Box>
                  </td>

                  <td style={{ padding: '8px' }}>
                    <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: '#1e293b' }}>
                      {row.model_name || row.job_id}
                      {row.source === 'uploaded' && (
                        <Chip label="Imported" size="small" sx={{ ml: 0.75, height: 16, fontSize: 9, bgcolor: T.infoBg ?? '#EBF8FF', color: '#2B6CB0' }} />
                      )}
                    </Typography>
                    <Typography sx={{ fontSize: 10.5, color: T.textMuted, fontFamily: T.mono }}>{row.job_id}</Typography>
                    {row.archived_reason && (
                      <Typography sx={{ fontSize: 10, color: T.textDim, fontStyle: 'italic' }}>
                        Archived: {row.archived_reason}
                      </Typography>
                    )}
                  </td>

                  <td style={{ padding: '8px' }}>
                    <Chip label={String(row.stage || 'unregistered').toUpperCase()} size="small"
                      sx={{ bgcolor: sc.bg, color: sc.fg, border: `1px solid ${sc.bd}`, height: 22, fontSize: 10.5, fontWeight: 700 }} />
                  </td>

                  <td style={{ padding: '8px' }}>{row.algorithm || '—'}</td>
                  <td style={{ padding: '8px', fontFamily: 'monospace', fontWeight: 700, color: '#1e293b' }}>
                    {auc != null ? Number(auc).toFixed(4) : '—'}
                  </td>
                  <td style={{ padding: '8px', fontFamily: 'monospace' }}>
                    {row.selected_threshold != null ? Number(row.selected_threshold).toFixed(2) : '—'}
                  </td>

                  {/* Threshold sparkline */}
                  <td style={{ padding: '8px' }}>
                    <ThresholdSparkline
                      thresholdTable={ttable}
                      activeThreshold={row.selected_threshold ?? 0.5}
                    />
                  </td>

                  <td style={{ padding: '8px', fontSize: 11, color: T.textMuted }}>{row.updated_at || '—'}</td>

                  <td style={{ padding: '8px' }}>
                    {!isArchived ? (
                      <Stack direction="row" spacing={0.75}>
                        <Button size="small" variant="outlined" onClick={() => handlePromote(row.job_id, 'champion')}
                          sx={{ textTransform: 'none', fontSize: 11, minWidth: 80 }}>
                          Champion
                        </Button>
                        <Button size="small" variant="outlined" onClick={() => handlePromote(row.job_id, 'challenger')}
                          sx={{ textTransform: 'none', fontSize: 11, minWidth: 80 }}>
                          Challenger
                        </Button>
                        <Tooltip title="Archive with reason">
                          <IconButton size="small" onClick={() => setArchiveRow(row)} sx={{ color: T.textDim, '&:hover': { color: '#475569' } }}>
                            <Archive sx={{ fontSize: 15 }} />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    ) : (
                      <Typography sx={{ fontSize: 10.5, color: T.textDim, fontStyle: 'italic' }}>Archived</Typography>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={9} style={{ padding: '24px', textAlign: 'center', color: T.textDim, fontSize: 12 }}>
                  No models registered yet. Train a model and register it above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Paper>

      {/* Audit log */}
      <AuditLogPanel />
    </Stack>
  );
};

export default ModelRegistryScreen;
