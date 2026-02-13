import React from 'react';
import {
  Box,
  Button,
  Stack,
  Typography,
  LinearProgress,
  Grid,
  Tabs,
  Tab,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  TableContainer,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField
} from '@mui/material';
import {
  BarChart,
  Bar,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip as ReTooltip,
  Cell,
  CartesianGrid
} from 'recharts';

const FeatureDiagnosticsLabScreen = ({
  T,
  card,
  cellSx,
  headCellSx,
  SectionHeader,
  MetricPill,
  StatusBadge,
  formatNum,
  formatPct,
  ivLevel,
  psiLevel,
  lifecycleLevel,
  featureMode,
  selectedFeature,
  selectedCatalogRow,
  labTab,
  setLabTab,
  labLoading,
  originInfo,
  profile,
  drift,
  leakage,
  compare,
  lineage,
  correlations,
  extremes,
  governanceHistory,
  approvalStatus,
  approvalComment,
  approvalOwner,
  setApprovalStatus,
  setApprovalComment,
  setApprovalOwner,
  approveFeature,
  leftRun,
  rightRun,
  setLeftRun,
  setRightRun,
  runOptions,
  simulateRemovalImpact,
  impact,
  impactLoading,
  readiness,
  monitoring,
  setMonitoring,
  story,
  openExplanationFor,
  validationRef
}) => (
  <Box ref={validationRef} sx={{ ...card, borderTop: 'none', borderLeft: 'none', borderRight: 'none' }}>
    <SectionHeader
      title="Feature Diagnostic Lab"
      subtitle={selectedFeature ? `Analysing: ${selectedFeature}` : 'Select a feature from the registry above'}
      right={
        selectedFeature && (
          <Stack direction="row" spacing={0.75} alignItems="center">
            <MetricPill label="Feature" value={selectedFeature?.slice(0, 24)} />
            {lineage?.latest_run_id && <MetricPill label="Run" value={String(lineage.latest_run_id).slice(0, 14)} />}
            {lineage?.dataset_version && <MetricPill label="Dataset" value={String(lineage.dataset_version).slice(0, 16)} />}
            <Button size="small" variant="outlined" onClick={() => openExplanationFor(selectedFeature)}
              sx={{ borderColor: T.border, color: T.textDim, borderRadius: 0, fontSize: 11, fontWeight: 900, px: 1.25, py: 0.55 }}>
              EXPLAIN
            </Button>
            <Box sx={{
              px: 1.5, py: 0.4, background: readiness.ok ? T.greenDim : T.redDim,
              border: `1px solid ${readiness.ok ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)'}`,
            }}>
              <Typography sx={{ fontSize: 10, fontWeight: 800, color: readiness.ok ? T.green : T.red, fontFamily: T.mono, letterSpacing: '0.1em' }}>
                {readiness.ok ? '✓ PRODUCTION READY' : '✗ NOT READY'}
              </Typography>
            </Box>
          </Stack>
        )
      }
    />

    {!selectedFeature ? (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <Typography sx={{ fontSize: 12, color: T.textMuted, fontFamily: T.mono }}>
          Select a feature from the Asset Registry above to open its diagnostic lab.
        </Typography>
      </Box>
    ) : (
      <>
        {!readiness.ok && (
          <Box sx={{ px: 2, py: 1, background: T.redDim, borderBottom: `1px solid rgba(239,68,68,0.25)`, display: 'flex', alignItems: 'center', gap: 2 }}>
            <Typography sx={{ fontSize: 10, fontWeight: 700, color: T.red, fontFamily: T.mono, letterSpacing: '0.08em' }}>ISSUES BLOCKING PROMOTION:</Typography>
            <Typography sx={{ fontSize: 11, color: T.red, fontFamily: T.mono }}>{readiness.reasons.join(' · ')}</Typography>
          </Box>
        )}

        <Box sx={{ borderBottom: `1px solid ${T.border}`, background: '#ffffff' }}>
          <Tabs value={labTab} onChange={(_e, v) => setLabTab(v)} variant="scrollable" scrollButtons="auto"
            sx={{
              minHeight: 36,
              '& .MuiTab-root': { fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: T.textMuted, fontFamily: T.sans, minHeight: 36, py: 0, textTransform: 'uppercase', px: 2 },
              '& .Mui-selected': { color: T.accent },
              '& .MuiTabs-indicator': { background: T.accent, height: 2 },
            }}>
            <Tab value="origin" label="⓪ Origin & Construction" />
            <Tab value="definition" label="① Definition & Lineage" />
            <Tab value="behavior" label="② Behavior & Distribution" />
            <Tab value="predictive" label="③ Outcome Validation" />
            <Tab value="stability" label="④ Risk & Stability" />
            <Tab value="governance" label="⑤ Leakage & Governance" />
          </Tabs>
        </Box>

        {labLoading && <LinearProgress sx={{ height: 2, bgcolor: T.border, '& .MuiLinearProgress-bar': { bgcolor: T.accent } }} />}

        {labTab === 'origin' && (
          <Box sx={{ p: 2 }}>
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <Box sx={{ border: `1px solid ${T.border}`, background: '#ffffff' }}>
                  <Box sx={{ px: 1.5, py: 1, borderBottom: `1px solid ${T.border}` }}>
                    <Typography sx={{ fontSize: 10, fontWeight: 900, color: T.textMuted, fontFamily: T.mono, letterSpacing: '0.08em' }}>
                      SIGNAL IDENTITY CARD
                    </Typography>
                  </Box>
                  <Box sx={{ p: 1.5 }}>
                    <Grid container spacing={1}>
                      {[
                        ['Feature Name', originInfo?.feature_name || selectedFeature || '—'],
                        ['Type', originInfo?.type || '—'],
                        ['Family', originInfo?.family || selectedCatalogRow?.category || '—'],
                        ['Entity', originInfo?.entity_level || selectedCatalogRow?.entity_level || 'account'],
                        ['Source', originInfo?.data_source || selectedCatalogRow?.data_source || '—'],
                        ['Window', originInfo?.window || selectedCatalogRow?.window || '—'],
                        ['Aggregation', originInfo?.aggregation || selectedCatalogRow?.aggregation || '—'],
                        ['Typology intent', originInfo?.typology_intent || selectedCatalogRow?.typology || '—'],
                        ['Built By', originInfo?.built_by || '—'],
                      ].map(([k, v]) => (
                        <Grid item xs={12} sm={6} key={k}>
                          <Typography sx={{ fontSize: 9, color: T.textMuted, fontFamily: T.mono, letterSpacing: '0.08em' }}>{k}</Typography>
                          <Typography sx={{ fontSize: 12, color: T.text, fontFamily: T.mono, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {String(v ?? '—')}
                          </Typography>
                        </Grid>
                      ))}
                    </Grid>
                  </Box>
                </Box>
              </Grid>

              <Grid item xs={12} md={6}>
                <Box sx={{ border: `1px solid ${T.border}`, background: '#ffffff' }}>
                  <Box sx={{ px: 1.5, py: 1, borderBottom: `1px solid ${T.border}` }}>
                    <Typography sx={{ fontSize: 10, fontWeight: 900, color: T.textMuted, fontFamily: T.mono, letterSpacing: '0.08em' }}>
                      CODE LOCATION
                    </Typography>
                  </Box>
                  <Box sx={{ p: 1.5 }}>
                    <Typography sx={{ fontSize: 11, color: T.textDim, fontFamily: T.mono, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                      {originInfo?.code_location
                        ? JSON.stringify(originInfo.code_location, null, 2)
                        : 'No code location available for this feature.'}
                    </Typography>
                  </Box>
                </Box>
              </Grid>

              <Grid item xs={12}>
                <Box sx={{ border: `1px solid ${T.border}`, background: '#ffffff' }}>
                  <Box sx={{ px: 1.5, py: 1, borderBottom: `1px solid ${T.border}` }}>
                    <Typography sx={{ fontSize: 10, fontWeight: 900, color: T.textMuted, fontFamily: T.mono, letterSpacing: '0.08em' }}>
                      CONSTRUCTION LOGIC
                    </Typography>
                  </Box>
                  <Box sx={{ p: 1.5 }}>
                    <Typography sx={{ fontSize: 12, color: T.textDim, fontFamily: T.sans, lineHeight: 1.7 }}>
                      {originInfo?.construction_logic || originInfo?.business_meaning || selectedCatalogRow?.description || '—'}
                    </Typography>
                  </Box>
                </Box>
              </Grid>

              <Grid item xs={12}>
                <Box sx={{ border: `1px solid ${T.border}`, background: '#ffffff' }}>
                  <Box sx={{ px: 1.5, py: 1, borderBottom: `1px solid ${T.border}` }}>
                    <Typography sx={{ fontSize: 10, fontWeight: 900, color: T.textMuted, fontFamily: T.mono, letterSpacing: '0.08em' }}>
                      TRANSFORMATION / FORMULA
                    </Typography>
                  </Box>
                  <Box sx={{ p: 1.5 }}>
                    {originInfo?.transformation?.body ? (
                      <Typography component="pre" sx={{ m: 0, fontSize: 11, fontFamily: T.mono, color: T.text, whiteSpace: 'pre-wrap' }}>
                        {originInfo.transformation.body}
                      </Typography>
                    ) : (
                      <Typography sx={{ fontSize: 11, color: T.textMuted, fontFamily: T.mono }}>
                        No transformation recorded. This feature may be computed inline inside the Python engineer.
                      </Typography>
                    )}
                  </Box>
                </Box>
              </Grid>
            </Grid>
          </Box>
        )}

        {labTab === 'definition' && (
          <Box sx={{ p: 2 }}>
            <Grid container spacing={2}>
              <Grid item xs={12} md={8}>
                <Typography sx={{ fontSize: 10, fontWeight: 700, color: T.textMuted, letterSpacing: '0.1em', fontFamily: T.sans, textTransform: 'uppercase', mb: 1 }}>Pipeline / Lineage</Typography>
                <Stack direction="row" spacing={0.75} flexWrap="wrap" sx={{ mb: 1.5 }}>
                  {(lineage?.source_tables || ['mule_accounts_raw', 'mule_transactions_raw']).map((t) => (
                    <Box key={t} sx={{ px: 1, py: 0.3, background: T.goldDim, border: `1px solid rgba(201,162,39,0.3)` }}>
                      <Typography sx={{ fontSize: 10, color: T.gold, fontFamily: T.mono }}>TBL: {t}</Typography>
                    </Box>
                  ))}
                  {(lineage?.pipeline || []).map((p) => (
                    <Box key={p} sx={{ px: 1, py: 0.3, background: 'rgba(59,130,246,0.1)', border: `1px solid rgba(59,130,246,0.3)` }}>
                      <Typography sx={{ fontSize: 10, color: T.blue, fontFamily: T.mono }}>{p}</Typography>
                    </Box>
                  ))}
                  {lineage?.output_table && (
                    <Box sx={{ px: 1, py: 0.3, background: T.greenDim, border: `1px solid rgba(34,197,94,0.3)` }}>
                      <Typography sx={{ fontSize: 10, color: T.green, fontFamily: T.mono }}>OUT: {lineage.output_table}</Typography>
                    </Box>
                  )}
                </Stack>

                <Typography sx={{ fontSize: 10, fontWeight: 700, color: T.textMuted, letterSpacing: '0.1em', fontFamily: T.sans, textTransform: 'uppercase', mb: 0.75 }}>Business Intent</Typography>
                <Typography sx={{ fontSize: 12, color: T.textDim, fontFamily: T.sans, mb: 2, lineHeight: 1.6 }}>
                  {selectedCatalogRow?.description || 'No description available. Add via governance panel.'}
                </Typography>

                <Typography sx={{ fontSize: 10, fontWeight: 700, color: T.textMuted, letterSpacing: '0.1em', fontFamily: T.sans, textTransform: 'uppercase', mb: 0.75 }}>Reproducible Definition / SQL</Typography>
                <Box sx={{ background: '#ffffff', border: `1px solid ${T.border}`, p: 1.5, overflowX: 'auto' }}>
                  <Typography component="pre" sx={{ m: 0, fontSize: 11, fontFamily: T.mono, color: T.text, whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
                    {selectedCatalogRow?.formula || lineage?.definition_sql || `-- No SQL definition stored for ${selectedFeature}\n-- Run feature engineering pipeline to populate lineage`}
                  </Typography>
                </Box>
              </Grid>

              <Grid item xs={12} md={4}>
                <Typography sx={{ fontSize: 10, fontWeight: 700, color: T.textMuted, letterSpacing: '0.1em', fontFamily: T.sans, textTransform: 'uppercase', mb: 1 }}>Feature Metadata</Typography>
                {[
                  ['Feature name', selectedFeature],
                  ['Category', selectedCatalogRow?.category || '—'],
                  ['Owner', selectedCatalogRow?.owner || '—'],
                  ['Lifecycle', selectedCatalogRow?.lifecycle_state || 'Draft'],
                  ['Version / Run', selectedCatalogRow?.version?.slice(0, 18) || '—'],
                  ['Created', selectedCatalogRow?.created_at ? String(selectedCatalogRow.created_at).slice(0, 16) : '—'],
                  ['Last refresh', selectedCatalogRow?.last_refresh ? String(selectedCatalogRow.last_refresh).slice(0, 16) : '—'],
                  ['Production live', selectedCatalogRow?.production_live ? 'YES' : 'NO'],
                ].map(([k, v]) => (
                  <Box key={k} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.6, borderBottom: `1px solid ${T.border}` }}>
                    <Typography sx={{ fontSize: 10, color: T.textMuted, fontFamily: T.sans, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{k}</Typography>
                    <Typography sx={{ fontSize: 11, color: T.textDim, fontFamily: T.mono }}>{v}</Typography>
                  </Box>
                ))}

                <Box sx={{ mt: 2 }}>
                  <Typography sx={{ fontSize: 10, fontWeight: 700, color: T.textMuted, letterSpacing: '0.1em', fontFamily: T.sans, textTransform: 'uppercase', mb: 1 }}>Top Correlated Features</Typography>
                  {correlations?.has_results ? (
                    (correlations.correlations || []).slice(0, 8).map((c) => (
                      <Box key={c.feature_name} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.5, borderBottom: `1px solid ${T.border}` }}>
                        <Typography sx={{ fontSize: 10, color: T.textDim, fontFamily: T.mono, overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '75%' }}>{c.feature_name}</Typography>
                        <Typography sx={{ fontSize: 10, fontWeight: 700, color: Math.abs(Number(c.corr)) > 0.7 ? T.red : Math.abs(Number(c.corr)) > 0.4 ? T.amber : T.green, fontFamily: T.mono }}>{formatNum(c.corr, 3)}</Typography>
                      </Box>
                    ))
                  ) : <Typography sx={{ fontSize: 11, color: T.textMuted, fontFamily: T.mono }}>No correlation data.</Typography>}
                </Box>
              </Grid>
            </Grid>
          </Box>
        )}

        {labTab === 'behavior' && (
          <Box sx={{ p: 2 }}>
            <Grid container spacing={2}>
              <Grid item xs={12} md={7}>
                <Typography sx={{ fontSize: 10, fontWeight: 700, color: T.textMuted, letterSpacing: '0.1em', fontFamily: T.sans, textTransform: 'uppercase', mb: 1 }}>Value Distribution</Typography>
                {profile?.bins?.length ? (
                  <Box sx={{ height: 220 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={profile.bins} margin={{ top: 0, right: 8, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={T.border} />
                        <XAxis dataKey="start" tickFormatter={(v) => Number(v).toFixed(2)} tick={{ fontSize: 9, fill: T.textMuted, fontFamily: T.mono }} />
                        <YAxis tick={{ fontSize: 9, fill: T.textMuted, fontFamily: T.mono }} />
                        <ReTooltip contentStyle={{ background: '#111827', border: `1px solid ${T.border}`, fontSize: 11, fontFamily: T.mono }} labelStyle={{ color: T.textDim }} />
                        <Bar dataKey="count" fill={T.accent} radius={0} />
                      </BarChart>
                    </ResponsiveContainer>
                  </Box>
                ) : (
                  <Box sx={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${T.border}` }}>
                    <Typography sx={{ fontSize: 11, color: T.textMuted, fontFamily: T.mono }}>Distribution data requires feature profile computation.</Typography>
                  </Box>
                )}
                <Stack direction="row" spacing={0.75} flexWrap="wrap" sx={{ mt: 1.5 }}>
                  <MetricPill label="Missing" value={formatPct(profile?.missing_pct ?? selectedCatalogRow?.missing_pct, 2)} color={profile?.missing_pct > 0.2 ? T.red : T.green} />
                  <MetricPill label="P25" value={formatNum(profile?.p25, 3)} />
                  <MetricPill label="P50" value={formatNum(profile?.p50, 3)} />
                  <MetricPill label="P75" value={formatNum(profile?.p75, 3)} />
                  <MetricPill label="P95" value={formatNum(profile?.p95, 3)} />
                  <MetricPill label="Max" value={formatNum(profile?.max, 3)} />
                  <MetricPill label="Mean" value={formatNum(profile?.mean, 3)} />
                  <MetricPill label="Std" value={formatNum(profile?.std, 3)} />
                </Stack>
              </Grid>

              <Grid item xs={12} md={5}>
                <Typography sx={{ fontSize: 10, fontWeight: 700, color: T.textMuted, letterSpacing: '0.1em', fontFamily: T.sans, textTransform: 'uppercase', mb: 1 }}>Extreme Accounts</Typography>
                {extremes?.has_results ? (
                  <>
                    <Typography sx={{ fontSize: 9, color: T.textMuted, fontFamily: T.mono, mb: 0.5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>High Value</Typography>
                    <TableContainer sx={{ maxHeight: 180, mb: 1.5 }}>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            {['Account', 'Customer', 'Value', 'Mule'].map((h) => (
                              <TableCell key={h} sx={headCellSx}>{h}</TableCell>
                            ))}
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {(extremes.top_high || []).slice(0, 6).map((r) => (
                            <TableRow key={`hi-${r.account_id}`} sx={{ '&:hover': { background: 'rgba(255,255,255,0.02)' } }}>
                              <TableCell sx={{ ...cellSx, color: T.accent }}>{r.account_id}</TableCell>
                              <TableCell sx={cellSx}>{r.customer_id || '—'}</TableCell>
                              <TableCell sx={{ ...cellSx, color: T.gold, fontWeight: 700, textAlign: 'right' }}>{formatNum(r.value, 3)}</TableCell>
                              <TableCell sx={{ ...cellSx, color: r.is_mule ? T.red : T.green, textAlign: 'right' }}>{r.is_mule != null ? (r.is_mule ? '✓' : '✗') : '—'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                    <Typography sx={{ fontSize: 9, color: T.textMuted, fontFamily: T.mono, mb: 0.5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Low Value</Typography>
                    <TableContainer sx={{ maxHeight: 180 }}>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            {['Account', 'Customer', 'Value', 'Mule'].map((h) => (
                              <TableCell key={h} sx={headCellSx}>{h}</TableCell>
                            ))}
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {(extremes.top_low || []).slice(0, 6).map((r) => (
                            <TableRow key={`lo-${r.account_id}`} sx={{ '&:hover': { background: 'rgba(255,255,255,0.02)' } }}>
                              <TableCell sx={{ ...cellSx, color: T.accent }}>{r.account_id}</TableCell>
                              <TableCell sx={cellSx}>{r.customer_id || '—'}</TableCell>
                              <TableCell sx={{ ...cellSx, color: T.textDim, fontWeight: 700, textAlign: 'right' }}>{formatNum(r.value, 3)}</TableCell>
                              <TableCell sx={{ ...cellSx, color: r.is_mule ? T.red : T.green, textAlign: 'right' }}>{r.is_mule != null ? (r.is_mule ? '✓' : '✗') : '—'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </>
                ) : (
                  <Box sx={{ p: 2, border: `1px solid ${T.border}` }}>
                    <Typography sx={{ fontSize: 11, color: T.textMuted, fontFamily: T.mono }}>
                      Extreme accounts require feature profile data. Run feature engineering pipeline first.
                    </Typography>
                  </Box>
                )}
              </Grid>
            </Grid>
          </Box>
        )}

        {labTab === 'predictive' && (
          <Box sx={{ p: 2 }}>
            {!(featureMode === 'outcome' && selectedCatalogRow?.label_available) ? (
              <Box sx={{ p: 2, border: `1px solid ${T.border}`, background: '#ffffff' }}>
                <Typography sx={{ fontSize: 11, fontWeight: 900, color: T.text, fontFamily: T.sans, mb: 0.5 }}>
                  Outcome validation unavailable.
                </Typography>
                <Typography sx={{ fontSize: 11, color: T.textMuted, fontFamily: T.mono, lineHeight: 1.7 }}>
                  Feature approved based on behavioral evidence. Switch to Outcome Linked Mode automatically when labels are available.
                </Typography>
              </Box>
            ) : (
              <>
                <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 2 }}>
                  <MetricPill label="IV" value={formatNum(profile?.iv ?? selectedCatalogRow?.iv, 3)}
                    color={ivLevel(profile?.iv ?? selectedCatalogRow?.iv)} border={T.accentDimBorder} />
                  <MetricPill label="Correlated features" value={correlations?.has_results ? (correlations.correlations || []).length : '—'} />
                  <MetricPill label="WOE bins" value={profile?.woe_bins?.length || '—'} />
                  <MetricPill label="IV strength" value={
                    (profile?.iv ?? selectedCatalogRow?.iv) != null
                      ? Number(profile?.iv ?? selectedCatalogRow?.iv) >= 0.3 ? 'STRONG'
                        : Number(profile?.iv ?? selectedCatalogRow?.iv) >= 0.1 ? 'MODERATE' : 'WEAK'
                      : '—'
                  } color={(profile?.iv ?? selectedCatalogRow?.iv) != null ? ivLevel(profile?.iv ?? selectedCatalogRow?.iv) : T.textMuted} />
                </Stack>

                <Grid container spacing={2}>
                  <Grid item xs={12} md={8}>
                    <Typography sx={{ fontSize: 10, fontWeight: 700, color: T.textMuted, letterSpacing: '0.1em', fontFamily: T.sans, textTransform: 'uppercase', mb: 1 }}>
                      WOE Bins · Information Value
                    </Typography>
                    {Array.isArray(profile?.woe_bins) && profile.woe_bins.length > 0 ? (
                      <>
                        <TableContainer sx={{ maxHeight: 260, mb: 2 }}>
                          <Table size="small" stickyHeader>
                            <TableHead>
                              <TableRow>
                                {['Bin Range', 'Count', 'Bad', 'Good', 'Bad Rate', 'WOE'].map((h) => (
                                  <TableCell key={h} sx={headCellSx}>{h}</TableCell>
                                ))}
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {profile.woe_bins.map((b, idx) => (
                                <TableRow key={`woe-${idx}`} sx={{ '&:hover': { background: 'rgba(255,255,255,0.02)' } }}>
                                  <TableCell sx={{ ...cellSx, color: T.gold }}>{`${formatNum(b.start, 3)} → ${formatNum(b.end, 3)}`}</TableCell>
                                  <TableCell sx={{ ...cellSx, textAlign: 'right' }}>{b.count?.toLocaleString()}</TableCell>
                                  <TableCell sx={{ ...cellSx, textAlign: 'right', color: T.red }}>{b.bad?.toLocaleString()}</TableCell>
                                  <TableCell sx={{ ...cellSx, textAlign: 'right', color: T.green }}>{b.good?.toLocaleString()}</TableCell>
                                  <TableCell sx={{ ...cellSx, textAlign: 'right', color: Number(b.bad_rate) > 0.2 ? T.red : Number(b.bad_rate) > 0.05 ? T.amber : T.textDim }}>
                                    {formatPct(b.bad_rate, 2)}
                                  </TableCell>
                                  <TableCell sx={{ ...cellSx, textAlign: 'right', color: b.woe > 0 ? T.red : T.blue, fontWeight: 700 }}>
                                    {formatNum(b.woe, 4)}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </TableContainer>

                        <Typography sx={{ fontSize: 10, fontWeight: 700, color: T.textMuted, letterSpacing: '0.1em', fontFamily: T.sans, textTransform: 'uppercase', mb: 1 }}>
                          WOE Monotonicity
                        </Typography>
                        <Box sx={{ height: 160 }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={profile.woe_bins} margin={{ top: 0, right: 8, left: -20, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke={T.border} />
                              <XAxis dataKey="start" tickFormatter={(v) => Number(v).toFixed(2)} tick={{ fontSize: 8, fill: T.textMuted, fontFamily: T.mono }} />
                              <YAxis tick={{ fontSize: 8, fill: T.textMuted, fontFamily: T.mono }} />
                              <ReTooltip contentStyle={{ background: '#111827', border: `1px solid ${T.border}`, fontSize: 11, fontFamily: T.mono }} />
                              <Bar dataKey="woe" radius={0}>
                                {profile.woe_bins.map((entry, index) => (
                                  <Cell key={`cell-${index}`} fill={entry.woe > 0 ? T.red : T.blue} />
                                ))}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </Box>
                      </>
                    ) : (
                      <Box sx={{ p: 3, border: `1px solid ${T.border}`, textAlign: 'center' }}>
                        <Typography sx={{ fontSize: 11, color: T.textMuted, fontFamily: T.mono }}>
                          IV / WOE requires: numeric feature · binary label · ≥50 samples · both label classes present.
                        </Typography>
                      </Box>
                    )}
                  </Grid>

                  <Grid item xs={12} md={4}>
                    <Typography sx={{ fontSize: 10, fontWeight: 700, color: T.textMuted, letterSpacing: '0.1em', fontFamily: T.sans, textTransform: 'uppercase', mb: 1 }}>Top Correlations</Typography>
                    {correlations?.has_results ? (
                      <TableContainer sx={{ maxHeight: 400 }}>
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell sx={headCellSx}>Feature</TableCell>
                              <TableCell sx={{ ...headCellSx, textAlign: 'right' }}>Corr</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {(correlations.correlations || []).slice(0, 15).map((c) => (
                              <TableRow key={c.feature_name} sx={{ '&:hover': { background: 'rgba(255,255,255,0.02)' } }}>
                                <TableCell sx={{ ...cellSx, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160 }}>{c.feature_name}</TableCell>
                                <TableCell sx={{ ...cellSx, textAlign: 'right', fontWeight: 700, color: Math.abs(Number(c.corr)) > 0.7 ? T.red : Math.abs(Number(c.corr)) > 0.4 ? T.amber : T.textDim }}>
                                  {formatNum(c.corr, 3)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    ) : (
                      <Typography sx={{ fontSize: 11, color: T.textMuted, fontFamily: T.mono }}>No correlation data available.</Typography>
                    )}
                  </Grid>
                </Grid>
              </>
            )}
          </Box>
        )}

        {labTab === 'stability' && (
          <Box sx={{ p: 2 }}>
            <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 2 }}>
              <MetricPill label="PSI" value={formatNum(selectedCatalogRow?.psi, 3)} color={psiLevel(selectedCatalogRow?.psi)} border={T.borderBright} />
              <MetricPill label="Stability score" value={(selectedCatalogRow?.stability_score ?? selectedCatalogRow?.stability) != null ? formatNum((selectedCatalogRow?.stability_score ?? selectedCatalogRow?.stability), 3) : '—'}
                color={(selectedCatalogRow?.stability_score ?? selectedCatalogRow?.stability) != null ? (Number((selectedCatalogRow?.stability_score ?? selectedCatalogRow?.stability)) > 0.8 ? T.green : Number((selectedCatalogRow?.stability_score ?? selectedCatalogRow?.stability)) > 0.6 ? T.amber : T.red) : T.textMuted} />
              <MetricPill label="Drift status" value={drift?.has_results ? drift.drift_score?.toFixed(3) : '—'} color={T.textDim} />
              <MetricPill label="Verdict"
                value={selectedCatalogRow?.psi == null ? '—' : Number(selectedCatalogRow.psi) < 0.1 ? 'STABLE' : Number(selectedCatalogRow.psi) < 0.25 ? 'MODERATE' : 'UNSTABLE'}
                color={selectedCatalogRow?.psi == null ? T.textMuted : Number(selectedCatalogRow.psi) < 0.1 ? T.green : Number(selectedCatalogRow.psi) < 0.25 ? T.amber : T.red} />
            </Stack>

            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <Typography sx={{ fontSize: 10, fontWeight: 700, color: T.textMuted, letterSpacing: '0.1em', fontFamily: T.sans, textTransform: 'uppercase', mb: 1 }}>Run-Over-Run Statistics</Typography>
                {drift?.has_results ? (
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          {['Period', 'Mean', 'Std', 'P50', 'Missing'].map((h) => (
                            <TableCell key={h} sx={headCellSx}>{h}</TableCell>
                          ))}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {[['Previous', drift.previous], ['Current', drift.current]].map(([label, d]) => (
                          <TableRow key={label} sx={{ '&:hover': { background: 'rgba(255,255,255,0.02)' } }}>
                            <TableCell sx={{ ...cellSx, color: label === 'Current' ? T.accent : T.textDim, fontWeight: label === 'Current' ? 700 : 400 }}>{label}</TableCell>
                            <TableCell sx={{ ...cellSx, textAlign: 'right' }}>{formatNum(d?.mean, 4)}</TableCell>
                            <TableCell sx={{ ...cellSx, textAlign: 'right' }}>{formatNum(d?.std, 4)}</TableCell>
                            <TableCell sx={{ ...cellSx, textAlign: 'right' }}>{formatNum(d?.p50, 4)}</TableCell>
                            <TableCell sx={{ ...cellSx, textAlign: 'right' }}>{formatPct(d?.missing_pct)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                ) : (
                  <Box sx={{ p: 2, border: `1px solid ${T.border}` }}>
                    <Typography sx={{ fontSize: 11, color: T.textMuted, fontFamily: T.mono }}>
                      Drift computation requires at least two feature engineering runs. Run the pipeline again after the next data refresh.
                    </Typography>
                  </Box>
                )}

                <Box sx={{ mt: 2 }}>
                  <Typography sx={{ fontSize: 10, fontWeight: 700, color: T.textMuted, letterSpacing: '0.1em', fontFamily: T.sans, textTransform: 'uppercase', mb: 1 }}>Monitoring Thresholds</Typography>
                  <Grid container spacing={1}>
                    {[['PSI max', 'psi_max'], ['IV min', 'iv_min'], ['Missing max', 'missing_max']].map(([label, key]) => (
                      <Grid item xs={4} key={key}>
                        <TextField size="small" label={label} value={monitoring[key]}
                          onChange={(e) => setMonitoring({ ...monitoring, [key]: e.target.value })} fullWidth
                          InputProps={{ sx: { borderRadius: 0, fontSize: 12, fontFamily: T.mono, background: '#ffffff', color: T.text } }}
                          InputLabelProps={{ sx: { fontSize: 10, fontFamily: T.sans } }}
                          sx={{ '& .MuiOutlinedInput-notchedOutline': { borderColor: T.border } }} />
                      </Grid>
                    ))}
                  </Grid>
                </Box>
              </Grid>

              <Grid item xs={12} md={6}>
                <Typography sx={{ fontSize: 10, fontWeight: 700, color: T.textMuted, letterSpacing: '0.1em', fontFamily: T.sans, textTransform: 'uppercase', mb: 1 }}>Impact If Feature Removed</Typography>
                <Box sx={{ p: 2, border: `1px solid ${T.border}`, mb: 2 }}>
                  <Typography sx={{ fontSize: 11, color: T.textDim, fontFamily: T.sans, lineHeight: 1.6, mb: 1.5 }}>
                    Runs two training jobs (baseline vs feature excluded) and compares holdout AUC to quantify this feature's contribution to model performance.
                  </Typography>
                  <Button variant="outlined" size="small" onClick={simulateRemovalImpact} disabled={impactLoading}
                    sx={{ borderColor: T.accent, color: T.accent, borderRadius: 0, fontSize: 11, fontFamily: T.mono, fontWeight: 700 }}>
                    {impactLoading ? 'Simulating…' : 'SIMULATE REMOVAL'}
                  </Button>
                  {impact && (
                    <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mt: 1.5 }}>
                      <MetricPill label="Baseline AUC" value={formatNum(impact.baseline?.metrics?.roc_auc, 4)} color={T.green} />
                      <MetricPill label="Without AUC" value={formatNum(impact.removed?.metrics?.roc_auc, 4)} color={T.amber} />
                      <MetricPill label="ΔAUC" value={impact.auc_delta != null ? formatNum(impact.auc_delta, 4) : '—'} color={impact.auc_delta < 0 ? T.red : T.green} border={impact.auc_delta < 0 ? 'rgba(239,68,68,0.4)' : 'rgba(34,197,94,0.4)'} />
                    </Stack>
                  )}
                </Box>

                <Typography sx={{ fontSize: 10, fontWeight: 700, color: T.textMuted, letterSpacing: '0.1em', fontFamily: T.sans, textTransform: 'uppercase', mb: 1 }}>Run Comparison</Typography>
                <Grid container spacing={1}>
                  <Grid item xs={6}>
                    <FormControl fullWidth size="small">
                      <InputLabel sx={{ fontSize: 10 }}>Left run</InputLabel>
                      <Select value={leftRun} label="Left run" onChange={(e) => setLeftRun(e.target.value)}
                        sx={{ borderRadius: 0, fontSize: 11, fontFamily: T.mono, background: '#ffffff', color: T.text, '& .MuiOutlinedInput-notchedOutline': { borderColor: T.border } }}>
                        <MenuItem value=""><em style={{ fontSize: 11 }}>Default</em></MenuItem>
                        {runOptions.map((r) => <MenuItem key={r} value={r} sx={{ fontSize: 10, fontFamily: T.mono }}>{r.slice(0, 20)}</MenuItem>)}
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={6}>
                    <FormControl fullWidth size="small">
                      <InputLabel sx={{ fontSize: 10 }}>Right run</InputLabel>
                      <Select value={rightRun} label="Right run" onChange={(e) => setRightRun(e.target.value)}
                        sx={{ borderRadius: 0, fontSize: 11, fontFamily: T.mono, background: '#ffffff', color: T.text, '& .MuiOutlinedInput-notchedOutline': { borderColor: T.border } }}>
                        <MenuItem value=""><em style={{ fontSize: 11 }}>Default</em></MenuItem>
                        {runOptions.map((r) => <MenuItem key={r} value={r} sx={{ fontSize: 10, fontFamily: T.mono }}>{r.slice(0, 20)}</MenuItem>)}
                      </Select>
                    </FormControl>
                  </Grid>
                </Grid>
                {compare?.has_results && (
                  <Box sx={{ mt: 1.5 }}>
                    <Stack direction="row" spacing={1} flexWrap="wrap">
                      {['mean', 'std', 'p50', 'iv', 'missing_pct'].map((k) => (
                        compare.left?.[k] != null && compare.right?.[k] != null && (
                          <Box key={k} sx={{ px: 1, py: 0.5, border: `1px solid ${T.border}`, background: '#ffffff' }}>
                            <Typography sx={{ fontSize: 9, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: T.sans }}>{k}</Typography>
                            <Typography sx={{ fontSize: 10, fontFamily: T.mono, color: T.textDim }}>
                              <span style={{ color: T.blue }}>{formatNum(compare.left?.[k], 3)}</span>
                              {' → '}
                              <span style={{ color: T.accent }}>{formatNum(compare.right?.[k], 3)}</span>
                            </Typography>
                          </Box>
                        )
                      ))}
                    </Stack>
                  </Box>
                )}
              </Grid>
            </Grid>
          </Box>
        )}

        {labTab === 'governance' && (
          <Box sx={{ p: 2 }}>
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <Typography sx={{ fontSize: 10, fontWeight: 700, color: T.textMuted, letterSpacing: '0.1em', fontFamily: T.sans, textTransform: 'uppercase', mb: 1 }}>Leakage Assessment</Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 2 }}>
                  <MetricPill label="Leakage score" value={leakage?.has_results ? formatNum(leakage.leakage_score, 3) : '—'}
                    color={leakage?.has_results ? (Number(leakage.leakage_score) >= 1 ? T.red : T.green) : T.textMuted} />
                  <MetricPill label="Status" value={selectedCatalogRow?.leakage_status || '—'}
                    color={String(selectedCatalogRow?.leakage_status || '').toUpperCase() === 'LEAKING' ? T.red : String(selectedCatalogRow?.leakage_status || '').toUpperCase() === 'AT_RISK' ? T.amber : T.green} />
                  <MetricPill label="Leakage score (registry)" value={(selectedCatalogRow?.leakage_score ?? selectedCatalogRow?.leakage_risk) != null ? formatNum((selectedCatalogRow?.leakage_score ?? selectedCatalogRow?.leakage_risk), 3) : '—'} />
                </Stack>

                <Box sx={{ border: `1px solid ${String(selectedCatalogRow?.leakage_status || '').toUpperCase() === 'LEAKING' ? 'rgba(239,68,68,0.4)' : String(selectedCatalogRow?.leakage_status || '').toUpperCase() === 'AT_RISK' ? 'rgba(245,158,11,0.35)' : 'rgba(34,197,94,0.3)'}`, p: 1.5, mb: 2, background: String(selectedCatalogRow?.leakage_status || '').toUpperCase() === 'LEAKING' ? T.redDim : String(selectedCatalogRow?.leakage_status || '').toUpperCase() === 'AT_RISK' ? T.amberDim : T.greenDim }}>
                  <Typography sx={{ fontSize: 10, fontWeight: 800, color: String(selectedCatalogRow?.leakage_status || '').toUpperCase() === 'LEAKING' ? T.red : String(selectedCatalogRow?.leakage_status || '').toUpperCase() === 'AT_RISK' ? T.amber : T.green, fontFamily: T.mono, letterSpacing: '0.1em', mb: 0.5 }}>
                    {String(selectedCatalogRow?.leakage_status || '').toUpperCase() === 'LEAKING' ? '⚠ SUSPECT — REVIEW REQUIRED' : String(selectedCatalogRow?.leakage_status || '').toUpperCase() === 'AT_RISK' ? '⚠ AT RISK — VALIDATE TIMING' : '✓ CLEAR — No temporal contamination detected'}
                  </Typography>
                  <Box sx={{ mt: 1 }}>
                    {[
                      ['Feature time > alert time?', leakage?.checks?.time_ordering],
                      ['Post-event information?', leakage?.checks?.post_event],
                      ['Derived from label?', leakage?.checks?.label_derived],
                      ['Unrealistic predictive spike?', leakage?.checks?.iv_spike],
                    ].map(([check, result]) => (
                      <Box key={check} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.4, borderBottom: `1px solid rgba(255,255,255,0.05)` }}>
                        <Typography sx={{ fontSize: 10, color: T.textDim, fontFamily: T.sans }}>{check}</Typography>
                        <Typography sx={{ fontSize: 10, fontFamily: T.mono, fontWeight: 700, color: result === true ? T.red : result === false ? T.green : T.textMuted }}>
                          {result === true ? 'FLAGGED' : result === false ? 'CLEAR' : '—'}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                </Box>

                <Typography sx={{ fontSize: 10, fontWeight: 700, color: T.textMuted, letterSpacing: '0.1em', fontFamily: T.sans, textTransform: 'uppercase', mb: 1 }}>Lifecycle Management</Typography>
                <Stack direction="column" spacing={1.5}>
                  <Grid container spacing={1}>
                    <Grid item xs={6}>
                      <FormControl fullWidth size="small">
                        <InputLabel sx={{ fontSize: 10 }}>Lifecycle stage</InputLabel>
                        <Select value={approvalStatus} label="Lifecycle stage" onChange={(e) => setApprovalStatus(e.target.value)}
                          sx={{ borderRadius: 0, fontSize: 11, fontFamily: T.mono, background: '#ffffff', color: T.text, '& .MuiOutlinedInput-notchedOutline': { borderColor: T.border } }}>
                          {['Draft', 'Validating', 'Approved', 'Production', 'Watchlist', 'Retired'].map((s) => (
                            <MenuItem key={s} value={s} sx={{ fontSize: 11, fontFamily: T.mono }}>{s}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid item xs={6}>
                      <TextField size="small" label="Owner" value={approvalOwner} onChange={(e) => setApprovalOwner(e.target.value)} fullWidth
                        InputProps={{ sx: { borderRadius: 0, fontSize: 12, fontFamily: T.mono, background: '#ffffff', color: T.text } }}
                        InputLabelProps={{ sx: { fontSize: 10 } }}
                        sx={{ '& .MuiOutlinedInput-notchedOutline': { borderColor: T.border } }} />
                    </Grid>
                    <Grid item xs={12}>
                      <TextField size="small" label="Comment / rationale" value={approvalComment} onChange={(e) => setApprovalComment(e.target.value)} fullWidth multiline rows={2}
                        InputProps={{ sx: { borderRadius: 0, fontSize: 11, fontFamily: T.mono, background: '#ffffff', color: T.text } }}
                        InputLabelProps={{ sx: { fontSize: 10 } }}
                        sx={{ '& .MuiOutlinedInput-notchedOutline': { borderColor: T.border } }} />
                    </Grid>
                    <Grid item xs={12}>
                      <Button variant="contained" size="small" onClick={() => {
                        const payload = { comment: approvalComment || null, monitoring: { enabled: Boolean(monitoring.enabled), psi_max: Number(monitoring.psi_max), iv_min: Number(monitoring.iv_min), missing_max: Number(monitoring.missing_max) } };
                        approveFeature(approvalStatus, { commentOverride: JSON.stringify(payload) });
                      }}
                        sx={{ bgcolor: T.accent, color: '#fff', borderRadius: 0, fontSize: 11, fontWeight: 700, fontFamily: T.mono, '&:hover': { bgcolor: '#c9461a' } }}>
                        PERSIST GOVERNANCE
                      </Button>
                    </Grid>
                  </Grid>
                </Stack>
              </Grid>

              <Grid item xs={12} md={6}>
                <Typography sx={{ fontSize: 10, fontWeight: 700, color: T.textMuted, letterSpacing: '0.1em', fontFamily: T.sans, textTransform: 'uppercase', mb: 1 }}>Governance Audit Trail</Typography>
                {(governanceHistory || []).length === 0 ? (
                  <Box sx={{ p: 2, border: `1px solid ${T.border}` }}>
                    <Typography sx={{ fontSize: 11, color: T.textMuted, fontFamily: T.mono }}>No governance history. Persisting governance above will start the audit trail.</Typography>
                  </Box>
                ) : (
                  <TableContainer sx={{ maxHeight: 420 }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          {['Timestamp', 'Status', 'Owner', 'Version', 'Comment'].map((h) => (
                            <TableCell key={h} sx={headCellSx}>{h}</TableCell>
                          ))}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {(governanceHistory || []).slice(0, 20).map((g, idx) => (
                          <TableRow key={`gov-${idx}`} sx={{ '&:hover': { background: 'rgba(255,255,255,0.02)' } }}>
                            <TableCell sx={{ ...cellSx, fontSize: 10, color: T.textMuted }}>{String(g.updated_at || '—').slice(0, 16)}</TableCell>
                            <TableCell sx={cellSx}><StatusBadge label={g.status || '—'} level={lifecycleLevel(g.status)} /></TableCell>
                            <TableCell sx={cellSx}>{g.owner || '—'}</TableCell>
                            <TableCell sx={{ ...cellSx, fontSize: 10 }}>{String(g.version || '—').slice(0, 14)}</TableCell>
                            <TableCell sx={{ ...cellSx, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', color: T.textMuted }}>
                              {g.comment ? (() => { try { return JSON.parse(g.comment)?.comment || g.comment; } catch { return g.comment; } })() : '—'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </Grid>
            </Grid>
          </Box>
        )}

        {story && (
          <Box sx={{ mx: 2, mb: 2, p: 1.5, background: T.accentDim, border: `1px solid ${T.accentDimBorder}` }}>
            <Typography sx={{ fontSize: 9, fontWeight: 700, color: T.accent, letterSpacing: '0.12em', fontFamily: T.sans, textTransform: 'uppercase', mb: 0.5 }}>
              Regulator Narrative · Auto-generated
            </Typography>
            <Typography sx={{ fontSize: 12, color: T.textDim, fontFamily: T.sans, lineHeight: 1.7 }}>
              {story}
            </Typography>
          </Box>
        )}
      </>
    )}
  </Box>
);

export default FeatureDiagnosticsLabScreen;
