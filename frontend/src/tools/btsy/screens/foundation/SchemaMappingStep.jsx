// frontend/src/tools/btsy/screens/foundation/SchemaMappingStep.jsx
/**
 * ATLAS PROJECT: Anti Money Laundering Tactical Analytics System
 * MODULE: Data Foundation - Schema Mapping Engine
 * * DESCRIPTION:
 * Comprehensive engine for establishing Data Contracts. 
 * Supports Transactions, Extended Accounts, and Extended Customers.
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Box, Typography, Paper, Button, Alert, Chip, CircularProgress, TextField,
  Stack, Tabs, Tab, Grid, Table, TableBody, TableCell, 
  TableContainer, TableHead, TableRow, Tooltip, FormControl, Select, MenuItem, 
  LinearProgress, Divider, Fade
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Info as InfoIcon,
  Lock as LockIcon,
  Autorenew as AutorenewIcon,
  Warning as WarningIcon,
  Check as CheckIcon,
  Close as CloseIcon,
  ArrowForward as ArrowForwardIcon
} from '@mui/icons-material';

import btsyApi from '../../services/btsyApi';
import { useSnapshot } from '../../context/SnapshotContext';

// --- SYSTEM CONSTANTS ---
const DOMAINS = [
  { key: 'transactions', label: 'Transactions' },
  { key: 'accounts', label: 'Accounts' },
  { key: 'customers', label: 'Customers' },
  { key: 'str', label: 'STR' }
];

const COLORS = {
  border: '#e0e0e0',
  headerBg: '#f8f9fa',
  critical: '#d32f2f',
  standard: '#455a64',
  success: '#2e7d32',
  warning: '#ed6c02',
  textSecondary: '#5f6368',
  atlasOrange: '#D04A02'
};

// --- LOGIC UTILITIES ---

const getTypeCompatibility = (expectedType, sourceType) => {
  if (!sourceType || !expectedType) return { status: 'MISSING', color: 'default', icon: <InfoIcon fontSize="inherit" /> };
  
  const expected = String(expectedType).toUpperCase();
  const source = String(sourceType).toUpperCase();
  
  if (expected === source) return { status: 'COMPATIBLE', color: 'success', icon: <CheckIcon fontSize="inherit" /> };
  
  // Date/Timestamp coercion logic for bank data
  if (expected.includes('TIMESTAMP') && (source.includes('DATE') || source.includes('VARCHAR'))) 
    return { status: 'PARSEABLE', color: 'warning', icon: <AutorenewIcon fontSize="inherit" /> };
  
  if ((expected.includes('FLOAT') || expected.includes('DOUBLE')) && (source.includes('INT') || source.includes('VARCHAR')))
    return { status: 'PARSEABLE', color: 'warning', icon: <AutorenewIcon fontSize="inherit" /> };
  
  if (expected.includes('STRING') || source.includes('STRING') || source.includes('VARCHAR'))
    return { status: 'COMPATIBLE', color: 'success', icon: <CheckIcon fontSize="inherit" /> };
  
  return { status: 'MISMATCH', color: 'error', icon: <CloseIcon fontSize="inherit" /> };
};

// --- COMPONENTS ---

/**
 * MANDATORY COMPONENT: Zero-Leakage Policy Manager
 * Ensures account_type, dormancy_flag, and other bank-specific columns are accounted for.
 */
const UnmappedColumnsManager = ({ domainKey, mappingState, profileColumns, extensionAttrs, onPromote, onIgnore, onRestore, isDeclared }) => {
  if (isDeclared) return null;
  const [displayEdits, setDisplayEdits] = useState({});
  const bankInfo = mappingState?.bank_column_info || {};
  const canonicalFields = mappingState?.canonical_fields || [];
  const mapped = new Set(
    canonicalFields
      .filter((f) => f?.status === 'mapped' && f?.mapped_column)
      .map((f) => f.mapped_column)
  );
  const ignored = new Set(mappingState?.ignored_columns || []);
  const unmapped = Object.keys(bankInfo).filter((c) => !mapped.has(c) && !ignored.has(c));
  const extByCol = new Map((extensionAttrs || []).map((a) => [a.source_column_name, a]));
  const profileByCol = new Map((profileColumns || []).map((c) => [c.name, c]));

  if (unmapped.length === 0 && ignored.size === 0) return null

  return (
    <Paper variant="outlined" sx={{ p: 2, mt: 3, bgcolor: '#fafafa', borderStyle: 'dashed' }}>
      <Stack spacing={2}>
        {unmapped.length > 0 && (
          <Box>
            <Typography variant="subtitle2" sx={{ color: COLORS.standard, fontWeight: 700, mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
              <InfoIcon fontSize="small" /> Unmapped Source Fields
            </Typography>
            <Typography variant="caption" color="text.secondary">
              New/unknown bank fields are preserved as extensions. You can promote, ignore, or rename them anytime.
            </Typography>

            <TableContainer component={Paper} variant="outlined" sx={{ mt: 2, borderRadius: 1, borderColor: COLORS.border }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ bgcolor: COLORS.headerBg, fontWeight: 800, color: COLORS.standard, fontSize: '0.75rem' }}>SOURCE COLUMN</TableCell>
                    <TableCell sx={{ bgcolor: COLORS.headerBg, fontWeight: 800, color: COLORS.standard, fontSize: '0.75rem' }}>TYPE</TableCell>
                    <TableCell sx={{ bgcolor: COLORS.headerBg, fontWeight: 800, color: COLORS.standard, fontSize: '0.75rem' }}>SAMPLES</TableCell>
                    <TableCell sx={{ bgcolor: COLORS.headerBg, fontWeight: 800, color: COLORS.standard, fontSize: '0.75rem' }}>CARDINALITY</TableCell>
                    <TableCell sx={{ bgcolor: COLORS.headerBg, fontWeight: 800, color: COLORS.standard, fontSize: '0.75rem' }}>DISPLAY NAME</TableCell>
                    <TableCell sx={{ bgcolor: COLORS.headerBg, fontWeight: 800, color: COLORS.standard, fontSize: '0.75rem' }}>STATUS</TableCell>
                    <TableCell sx={{ bgcolor: COLORS.headerBg, fontWeight: 800, color: COLORS.standard, fontSize: '0.75rem' }} align="right">ACTIONS</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {unmapped.map((col) => {
                    const info = bankInfo[col] || {};
                    const ext = extByCol.get(col);
                    const prof = profileByCol.get(col);
                    const status = (ext?.status || 'pending').toUpperCase();
                    const distinct = prof?.stats?.distinct_count;
                    const displayValue = displayEdits[col] ?? (ext?.display_name || '');
                    return (
                      <TableRow key={col} hover>
                        <TableCell sx={{ fontFamily: 'Roboto Mono', fontSize: '0.78rem', fontWeight: 700 }}>{col}</TableCell>
                        <TableCell sx={{ fontFamily: 'Roboto Mono', fontSize: '0.75rem' }}>{info.datatype || '—'}</TableCell>
                        <TableCell sx={{ fontFamily: 'Roboto Mono', fontSize: '0.72rem', color: COLORS.textSecondary }}>
                          {(info.sample_values || []).slice(0, 3).join(', ') || '—'}
                        </TableCell>
                        <TableCell sx={{ fontFamily: 'Roboto Mono', fontSize: '0.75rem' }}>
                          {typeof distinct === 'number' ? distinct.toLocaleString() : '—'}
                        </TableCell>
                        <TableCell sx={{ minWidth: 220 }}>
                          <TextField
                            size="small"
                            value={displayValue}
                            onChange={(e) => setDisplayEdits((p) => ({ ...p, [col]: e.target.value }))}
                            placeholder="Optional"
                          />
                        </TableCell>
                        <TableCell>
                          <Chip label={status} size="small" variant="outlined" sx={{ fontWeight: 800, fontSize: '0.65rem' }} />
                        </TableCell>
                        <TableCell align="right">
                          <Stack direction="row" spacing={1} justifyContent="flex-end">
                            <Button
                              size="small"
                              variant="contained"
                              onClick={() => onPromote?.(domainKey, col, { displayName: displayValue })}
                              sx={{ textTransform: 'none', fontWeight: 700 }}
                            >
                              Promote
                            </Button>
                            <Button
                              size="small"
                              variant="outlined"
                              color="error"
                              onClick={() => onIgnore?.(domainKey, col)}
                              sx={{ textTransform: 'none', fontWeight: 700 }}
                            >
                              Ignore
                            </Button>
                          </Stack>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}

        {ignored.size > 0 && (
          <Box>
            <Typography variant="caption" sx={{ fontWeight: 700, color: COLORS.textSecondary }}>EXCLUDED FROM CONTRACT (IGNORED)</Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 1 }} useFlexGap flexWrap="wrap">
              {Array.from(ignored).map(col => (
                <Chip 
                  key={col} label={col} size="small" variant="outlined"
                  onClick={() => onRestore(col)}
                  sx={{ fontFamily: 'Roboto Mono', fontSize: '0.7rem', opacity: 0.6 }}
                />
              ))}
            </Stack>
          </Box>
        )}
      </Stack>
    </Paper>
  );
};

/**
 * High-Density Mapping Table
 */
const MappingTable = ({ fields, bankColumns, onUpdate, isDeclared }) => {
  return (
    <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1, borderColor: COLORS.border, mb: 2 }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell sx={{ bgcolor: COLORS.headerBg, fontWeight: 700, fontSize: '0.75rem', color: COLORS.standard }}>CANONICAL FIELD</TableCell>
            <TableCell sx={{ bgcolor: COLORS.headerBg, fontWeight: 700, fontSize: '0.75rem', color: COLORS.standard }}>EXPECTED TYPE</TableCell>
            <TableCell sx={{ bgcolor: COLORS.headerBg, fontWeight: 700, fontSize: '0.75rem', color: COLORS.standard }}>BANK SOURCE COLUMN</TableCell>
            <TableCell sx={{ bgcolor: COLORS.headerBg, fontWeight: 700, fontSize: '0.75rem', color: COLORS.standard }}>SOURCE TYPE</TableCell>
            <TableCell sx={{ bgcolor: COLORS.headerBg, fontWeight: 700, fontSize: '0.75rem', color: COLORS.standard, textAlign: 'center' }}>COMPATIBILITY</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {fields.map((field, idx) => {
            const compatibility = field.mapped_column 
              ? getTypeCompatibility(field.expected_type, field.source_datatype)
              : { status: 'NOT MAPPED', color: 'default', icon: null };

            return (
              <TableRow key={idx} hover sx={{ '&:last-child td, &:last-child th': { border: 0 } }}>
                <TableCell>
                  <Stack spacing={0.5}>
                    <Typography variant="body2" sx={{ fontWeight: 600, fontFamily: 'Roboto Mono', fontSize: '0.75rem' }}>{field.canonical_name}</Typography>
                    <Chip 
                      label={field.requirement} size="small" variant={field.requirement === 'CRITICAL' ? "filled" : "outlined"}
                      sx={{ height: 14, fontSize: '0.55rem', width: 'fit-content', bgcolor: field.requirement === 'CRITICAL' ? COLORS.critical : 'transparent', color: field.requirement === 'CRITICAL' ? 'white' : COLORS.textSecondary, fontWeight: 700 }}
                    />
                  </Stack>
                </TableCell>
                <TableCell><Typography variant="caption" sx={{ fontFamily: 'Roboto Mono', fontSize: '0.7rem' }}>{field.expected_type}</Typography></TableCell>
                <TableCell>
                  {isDeclared ? (
                    <Typography variant="body2" sx={{ fontFamily: 'Roboto Mono', fontSize: '0.8rem', fontWeight: 500 }}>{field.mapped_column || '--'}</Typography>
                  ) : (
                    <FormControl fullWidth size="small">
                      <Select
                        value={field.mapped_column || ''}
                        onChange={(e) => onUpdate(field.canonical_name, e.target.value === '__not_present__' ? null : e.target.value, e.target.value === '__not_present__' ? 'not_present' : 'mapped')}
                        displayEmpty sx={{ fontSize: '0.8rem', fontFamily: 'Roboto Mono' }}
                      >
                        <MenuItem value=""><em>-- Unmapped --</em></MenuItem>
                        {bankColumns.map(col => <MenuItem key={col.name} value={col.name} sx={{ fontSize: '0.8rem' }}>{col.name}</MenuItem>)}
                        <Divider />
                        <MenuItem value="__not_present__" sx={{ color: COLORS.critical }}>✗ Not present in source</MenuItem>
                      </Select>
                    </FormControl>
                  )}
                </TableCell>
                <TableCell><Typography variant="caption" sx={{ fontFamily: 'Roboto Mono', fontSize: '0.7rem' }}>{field.source_datatype || '--'}</Typography></TableCell>
                <TableCell align="center">
                  <Tooltip title={compatibility.status} arrow>
                    <Chip icon={compatibility.icon} label={compatibility.status} color={compatibility.color} size="small" variant="outlined" sx={{ fontSize: '0.6rem', fontWeight: 800, minWidth: 90 }} />
                  </Tooltip>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

/**
 * MAIN CONTROLLER
 */
const SchemaMappingStep = ({ onComplete }) => {
  const { activeSnapshot } = useSnapshot();
  const snapshotId = activeSnapshot?.snapshot_id;
  const [activeTab, setActiveTab] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncProgress, setSyncProgress] = useState(0);
  const [actionLoading, setActionLoading] = useState(false);
  const [mappings, setMappings] = useState({});
  const [profiles, setProfiles] = useState({});
  const [validations, setValidations] = useState({});
  const [extensions, setExtensions] = useState({});
  const [extensionsBusy, setExtensionsBusy] = useState(false);
  const [uploadStatus, setUploadStatus] = useState({});
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const loadData = async () => {
    try {
      setLoading(true);
      setSyncProgress(8);
      const statusRes = await btsyApi.upload.getStatus();
      if (!statusRes.success) return;
      setUploadStatus(statusRes.data.domains);

      const mappingData = {}, validationData = {}, profileData = {};
      for (const domain of DOMAINS) {
        if (statusRes.data.domains[domain.key]?.uploaded) {
          const [m, v, p] = await Promise.allSettled([
            btsyApi.mapping.getMappingState(domain.key),
            btsyApi.mapping.validateMapping(domain.key),
            btsyApi.profiling.profileDomain(domain.key)
          ]);
          if (m.status === 'fulfilled') mappingData[domain.key] = m.value.data;
          if (v.status === 'fulfilled') validationData[domain.key] = v.value.data;
          if (p.status === 'fulfilled') profileData[domain.key] = p.value.data;
        }
      }
      setMappings(mappingData); setValidations(validationData); setProfiles(profileData);
      if (snapshotId) {
        setExtensionsBusy(true);
        const extData = {};
        for (const domain of DOMAINS) {
          if (statusRes.data.domains[domain.key]?.uploaded) {
            const res = await btsyApi.extensions.list(snapshotId, domain.key);
            if (res?.success) extData[domain.key] = res.data || [];
          }
        }
        setExtensions(extData);
        setExtensionsBusy(false);
      }
    } catch (err) { setError(`Sync Error: ${err.message}`); } finally { setLoading(false); }
  };

  useEffect(() => {
    if (!loading) {
      setSyncProgress(100);
      return;
    }
    const id = setInterval(() => {
      setSyncProgress((p) => {
        const cur = Number(p || 0);
        const next = cur + Math.max(1, Math.round((95 - cur) * 0.08));
        return next >= 95 ? 95 : next;
      });
    }, 450);
    return () => clearInterval(id);
  }, [loading]);

  useEffect(() => { loadData(); }, []);

  const handleUpdate = async (domain, field, col, status) => {
    try {
      await btsyApi.mapping.updateFieldMapping(domain, { canonical_field: field, mapped_column: col, status });
      await loadData();
    } catch (err) { setError(err.message); }
  };

  const handleIgnore = async (domain, col) => {
    try {
      await btsyApi.mapping.setColumnDisposition(domain, col, 'ignored');
      if (snapshotId) {
        await btsyApi.extensions.update(snapshotId, domain, col, { status: 'ignored' });
      }
      await loadData();
    } catch (err) { setError(err.message); }
  };

  const handlePromoteExtension = async (domain, col, { displayName } = {}) => {
    if (!snapshotId) return;
    try {
      setExtensionsBusy(true);
      await btsyApi.extensions.update(snapshotId, domain, col, {
        status: 'active',
        display_name: (displayName || '').trim() || null
      });
      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setExtensionsBusy(false);
    }
  };

  const handleVerify = async (domainKey) => {
    try {
      setActionLoading(true);
      const res = await btsyApi.mapping.confirmVerification(domainKey);
      if (res.success) { setSuccess(`Verification locked for ${domainKey.toUpperCase()}`); await loadData(); }
    } catch (err) { setError(err.message); } finally { setActionLoading(false); }
  };

  const handleDeclare = async (domainKey) => {
    try {
      setActionLoading(true);
      const res = await btsyApi.mapping.finalizeMapping(domainKey);
      if (res.success) { setSuccess(`Contract for ${domainKey.toUpperCase()} DECLARED.`); await loadData(); }
    } catch (err) { setError(err.message); } finally { setActionLoading(false); }
  };

  const isDomainDeclared = (key) => mappings[key]?.status === 'confirmed';
  const allTablesLocked = useMemo(() => {
    const uploaded = DOMAINS.filter(d => uploadStatus[d.key]?.uploaded);
    return uploaded.length > 0 && uploaded.every(d => isDomainDeclared(d.key));
  }, [mappings, uploadStatus]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mt: 15, gap: 1.5 }}>
        <Box sx={{ width: 360 }}>
          <Typography variant="caption" sx={{ fontWeight: 700 }}>SYNCHRONIZING CANONICAL STATE… {syncProgress.toFixed(0)}% (estimated)</Typography>
          <LinearProgress variant="determinate" value={syncProgress} sx={{ mt: 1 }} />
        </Box>
      </Box>
    );
  }

  const currentDomainKey = DOMAINS[activeTab]?.key;
  const currentMapping = mappings[currentDomainKey];
  const isLocked = isDomainDeclared(currentDomainKey);

  return (
    <Box sx={{ p: 1 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 4 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 800, color: COLORS.standard }}>Data Foundation — Schema Mapping</Typography>
          <Typography variant="body2" color="text.secondary">Establish valid Data Contracts between raw bank files and ATLAS engine.</Typography>
        </Box>
        <Fade in={allTablesLocked}>
          <Button variant="contained" onClick={onComplete} endIcon={<ArrowForwardIcon />} sx={{ bgcolor: COLORS.atlasOrange, px: 4, fontWeight: 800 }}>
            Continue to Calibration
          </Button>
        </Fade>
      </Stack>

      {(error || success) && (
        <Alert severity={error ? "error" : "success"} onClose={() => {setError(null); setSuccess(null);}} sx={{ mb: 3 }}>
          {error || success}
        </Alert>
      )}

      <Tabs value={activeTab} onChange={(e, v) => setActiveTab(v)} sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}>
        {DOMAINS.map(d => uploadStatus[d.key]?.uploaded && (
          <Tab key={d.key} label={d.label.toUpperCase()} icon={isDomainDeclared(d.key) ? <LockIcon style={{ fontSize: 14 }} /> : null} iconPosition="end" sx={{ fontWeight: 800, fontSize: '0.7rem' }} />
        ))}
      </Tabs>

      {currentDomainKey && currentMapping && (
        <Box>
          <Alert severity={validations[currentDomainKey]?.valid ? "success" : "error"} sx={{ mb: 2 }}>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              {validations[currentDomainKey]?.valid ? "Schema Integrity Verified." : `Critical Mapping Issues: ${validations[currentDomainKey]?.blocking_issues?.join(', ')}`}
            </Typography>
          </Alert>

          {Boolean((extensions[currentDomainKey] || []).some((a) => String(a.status || '').toLowerCase() === 'pending')) && (
            <Alert severity="info" sx={{ mb: 2 }}>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                New source fields detected in this snapshot. Review and register as extensions if required.
              </Typography>
            </Alert>
          )}

          <MappingTable 
            fields={currentMapping.canonical_fields || []} 
            bankColumns={profiles[currentDomainKey]?.columns || []} 
            onUpdate={(f, c, s) => handleUpdate(currentDomainKey, f, c, s)}
            isDeclared={isLocked}
          />

          <UnmappedColumnsManager 
            domainKey={currentDomainKey}
            mappingState={currentMapping}
            profileColumns={profiles[currentDomainKey]?.columns || []}
            extensionAttrs={extensions[currentDomainKey] || []}
            onPromote={handlePromoteExtension}
            onIgnore={handleIgnore}
            onRestore={async (c) => {
              await btsyApi.mapping.setColumnDisposition(currentDomainKey, c, 'available');
              if (snapshotId) {
                await btsyApi.extensions.update(snapshotId, currentDomainKey, c, { status: 'pending' });
              }
              loadData();
            }}
            isDeclared={isLocked}
          />

          {!isLocked ? (
            <Paper variant="outlined" sx={{ p: 2, mt: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center', bgcolor: '#fafafa' }}>
              <Button variant="outlined" startIcon={<AutorenewIcon />} onClick={async () => { await btsyApi.mapping.detectMapping(currentDomainKey); loadData(); }}>Auto-Detect</Button>
              <Stack direction="row" spacing={2}>
                {!currentMapping.verification_confirmed ? (
                  <Button variant="contained" onClick={() => handleVerify(currentDomainKey)} disabled={!validations[currentDomainKey]?.valid || actionLoading} sx={{ fontWeight: 700 }}>
                    Confirm Review & Verify
                  </Button>
                ) : (
                  <Button variant="contained" startIcon={<LockIcon />} onClick={() => handleDeclare(currentDomainKey)} sx={{ bgcolor: COLORS.atlasOrange, fontWeight: 700 }} disabled={actionLoading}>
                    Declare Contract
                  </Button>
                )}
              </Stack>
            </Paper>
          ) : (
            <Alert severity="info" icon={<LockIcon />} sx={{ mt: 2 }}>Contract is Declared. Environment must be reset to modify mappings.</Alert>
          )}
        </Box>
      )}
    </Box>
  );
};

export default SchemaMappingStep;
