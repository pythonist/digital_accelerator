import React from 'react';
import {
  Box,
  Stack,
  TextField,
  FormControl,
  Select,
  MenuItem,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  TableContainer,
  Typography,
  Grid
} from '@mui/material';

const FeatureStoreScreen = ({
  T,
  card,
  cellSx,
  headCellSx,
  SectionHeader,
  StatusBadge,
  lifecycleLevel,
  windowHint,
  healthFor,
  formatNum,
  formatPct,
  ivLevel,
  psiLevel,
  filteredCatalog,
  catalog,
  catalogSearch,
  setCatalogSearch,
  catalogStage,
  setCatalogStage,
  catalogTag,
  setCatalogTag,
  toggleCatalogSort,
  sortArrow,
  selectFeature,
  selectedFeature,
  typologyMapping,
  selectedTypology,
  setSelectedTypology
}) => (
  <>
    <Box sx={{ ...card, borderTop: 'none', borderLeft: 'none', borderRight: 'none' }}>
      <SectionHeader
        title="Asset Registry"
        subtitle={`${filteredCatalog.length} of ${catalog.length} features · click row to open diagnostic lab`}
        right={
          <Stack direction="row" spacing={0.75} alignItems="center">
            <TextField size="small" placeholder="Search…" value={catalogSearch}
              onChange={(e) => setCatalogSearch(e.target.value)}
              InputProps={{ sx: { borderRadius: 0, fontSize: 11, fontFamily: T.mono, background: '#ffffff', color: T.text, height: 28 } }}
              sx={{ width: 160, '& .MuiOutlinedInput-notchedOutline': { borderColor: T.border } }}
            />
            <FormControl size="small" sx={{ minWidth: 110 }}>
              <Select value={catalogStage} displayEmpty onChange={(e) => setCatalogStage(e.target.value)}
                sx={{ borderRadius: 0, fontSize: 11, fontFamily: T.mono, background: '#ffffff', color: T.text, height: 28, '& .MuiOutlinedInput-notchedOutline': { borderColor: T.border } }}>
                <MenuItem value=""><em style={{ fontSize: 11 }}>Lifecycle: all</em></MenuItem>
                {['Draft', 'Testing', 'Validated', 'Approved', 'Production', 'Watchlist', 'Retired'].map((s) => (
                  <MenuItem key={s} value={s.toLowerCase()} sx={{ fontSize: 11, fontFamily: T.mono }}>{s}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField size="small" placeholder="Tag…" value={catalogTag}
              onChange={(e) => setCatalogTag(e.target.value)}
              InputProps={{ sx: { borderRadius: 0, fontSize: 11, fontFamily: T.mono, background: '#ffffff', color: T.text, height: 28 } }}
              sx={{ width: 90, '& .MuiOutlinedInput-notchedOutline': { borderColor: T.border } }}
            />
          </Stack>
        }
      />

      <TableContainer sx={{ maxHeight: 480, background: T.surface }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              {[
                ['Feature', 'feature_name', 180],
                ['Typology', 'typology', 170],
                ['Business Intent', 'description', 220],
                ['Owner', 'owner', 90],
                ['Source', 'data_source', 110],
                ['Window', 'window', 90],
                ['Last Refresh', 'last_refresh', 120],
                ['IV', 'iv', 60],
                ['Strength', 'predictive_strength', 85],
                ['PSI', 'psi', 60],
                ['Missing', 'missing_pct', 70],
                ['Leakage', 'leakage_status', 80],
                ['Stability', 'drift_status', 80],
                ['Lifecycle', 'lifecycle_state', 95],
                ['Ready', 'production_ready', 75],
                ['Health', null, 80],
              ].map(([label, sortKey, w]) => (
                <TableCell key={label} sx={{ ...headCellSx, minWidth: w, maxWidth: w }}
                  onClick={() => sortKey && toggleCatalogSort(sortKey)}>
                  {label}{sortKey ? sortArrow(sortKey) : ''}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredCatalog.length === 0 ? (
              <TableRow>
                <TableCell colSpan={15} sx={{ ...cellSx, textAlign: 'center', py: 3, color: T.textMuted }}>
                  {catalog.length === 0 ? 'No features engineered yet. Run the pipeline to populate the registry.' : 'No features match the current filters.'}
                </TableCell>
              </TableRow>
            ) : filteredCatalog.map((f) => {
              const h = healthFor(f);
              const sel = f.feature_name === selectedFeature;
              const strength = (f.predictive_strength || (
                f.iv != null ? (Number(f.iv) >= 0.3 ? 'HIGH' : Number(f.iv) >= 0.1 ? 'MEDIUM' : 'LOW') : null
              ));
              const leak = String(f.leakage_status || '').toUpperCase();
              const leakColor = leak === 'LEAKING' ? T.red : leak === 'AT_RISK' ? T.amber : T.green;
              const leakBg = leak === 'LEAKING' ? T.redDim : leak === 'AT_RISK' ? T.amberDim : T.greenDim;
              return (
                <TableRow key={f.feature_name} hover onClick={() => selectFeature(f.feature_name)}
                  sx={{
                    cursor: 'pointer',
                    background: sel ? 'rgba(232,83,26,0.07)' : 'transparent',
                    borderLeft: sel ? `2px solid ${T.accent}` : '2px solid transparent',
                    '&:hover': { background: sel ? 'rgba(232,83,26,0.1)' : 'rgba(255,255,255,0.025)' },
                  }}>
                  <TableCell sx={{ ...cellSx, color: sel ? T.accent : T.text, fontWeight: sel ? 700 : 400, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {f.feature_name}
                  </TableCell>
                  <TableCell sx={{ ...cellSx, maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', color: T.textDim }}>
                    {f.typology || <span style={{ color: T.textMuted }}>—</span>}
                  </TableCell>
                  <TableCell sx={{ ...cellSx, fontFamily: T.sans, fontSize: 11, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', color: T.textDim }}>
                    {f.description || <span style={{ color: T.textMuted }}>—</span>}
                  </TableCell>
                  <TableCell sx={cellSx}>{f.owner || <span style={{ color: T.textMuted }}>—</span>}</TableCell>
                  <TableCell sx={{ ...cellSx, color: T.textMuted, maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {f.data_source || 'TXN/ACCT'}
                  </TableCell>
                  <TableCell sx={cellSx}>{f.window || windowHint(f.feature_name)}</TableCell>
                  <TableCell sx={{ ...cellSx, fontSize: 10, color: T.textMuted }}>
                    {f.last_refresh ? String(f.last_refresh).slice(0, 16) : <span style={{ color: T.textMuted }}>—</span>}
                  </TableCell>
                  <TableCell sx={{ ...cellSx, color: f.iv != null ? ivLevel(f.iv) : T.textMuted, fontWeight: 700 }}>
                    {f.iv != null ? formatNum(f.iv, 3) : '—'}
                  </TableCell>
                  <TableCell sx={{ ...cellSx, color: strength ? (strength === 'HIGH' ? T.green : strength === 'MEDIUM' ? T.amber : T.red) : T.textMuted, fontWeight: 800 }}>
                    {strength || '—'}
                  </TableCell>
                  <TableCell sx={{ ...cellSx, color: f.psi != null ? psiLevel(f.psi) : T.textMuted, fontWeight: 700 }}>
                    {f.psi != null ? formatNum(f.psi, 3) : '—'}
                  </TableCell>
                  <TableCell sx={{ ...cellSx, color: f.missing_pct != null ? (Number(f.missing_pct) > 0.2 ? T.red : Number(f.missing_pct) > 0.05 ? T.amber : T.green) : T.textMuted }}>
                    {f.missing_pct != null ? formatPct(f.missing_pct, 1) : '—'}
                  </TableCell>
                  <TableCell sx={{ ...cellSx }}>
                    {f.leakage_status ? (
                      <Box sx={{ display: 'inline-block', px: 0.75, py: 0.25, background: leakBg, border: `1px solid ${leak === 'LEAKING' ? 'rgba(239,68,68,0.3)' : leak === 'AT_RISK' ? 'rgba(245,158,11,0.3)' : 'rgba(34,197,94,0.3)'}` }}>
                        <Typography sx={{ fontSize: 9, fontWeight: 700, color: leakColor, fontFamily: T.mono, letterSpacing: '0.06em' }}>
                          {leak}
                        </Typography>
                      </Box>
                    ) : <span style={{ color: T.textMuted }}>—</span>}
                  </TableCell>
                  <TableCell sx={{ ...cellSx }}>
                    {f.drift_status ? (
                      <Box sx={{ display: 'inline-block', px: 0.75, py: 0.25, background: f.drift_status === 'DRIFT' ? T.amberDim : T.greenDim, border: `1px solid ${f.drift_status === 'DRIFT' ? 'rgba(245,158,11,0.3)' : 'rgba(34,197,94,0.3)'}` }}>
                        <Typography sx={{ fontSize: 9, fontWeight: 700, color: f.drift_status === 'DRIFT' ? T.amber : T.green, fontFamily: T.mono, letterSpacing: '0.06em' }}>
                          {f.drift_status === 'DRIFT' ? 'DRIFT' : 'STABLE'}
                        </Typography>
                      </Box>
                    ) : <span style={{ color: T.textMuted }}>—</span>}
                  </TableCell>
                  <TableCell sx={cellSx}>
                    <StatusBadge label={f.lifecycle_state || 'DRAFT'} level={lifecycleLevel(f.lifecycle_state)} />
                  </TableCell>
                  <TableCell sx={cellSx}>
                    <StatusBadge label={f.production_ready ? 'YES' : 'NO'} level={f.production_ready ? 'approved' : 'danger'} />
                  </TableCell>
                  <TableCell sx={cellSx}>
                    <StatusBadge label={h.label} level={h.level} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>

    <Box sx={{ ...card, borderTop: 'none', borderLeft: 'none', borderRight: 'none' }}>
      <SectionHeader
        title="Typology → Feature Mapping"
        subtitle="AML typologies mapped to governed feature assets"
        right={<Typography sx={{ fontSize: 10, color: T.textMuted, fontFamily: T.mono }}>{typologyMapping.length} typologies</Typography>}
      />
      <Box sx={{ p: 2 }}>
        <Grid container spacing={2}>
          <Grid item xs={12} md={4}>
            <Box sx={{ border: `1px solid ${T.border}`, background: '#ffffff' }}>
              <Box sx={{ px: 1.5, py: 1, borderBottom: `1px solid ${T.border}` }}>
                <Typography sx={{ fontSize: 10, fontWeight: 800, color: T.textMuted, fontFamily: T.mono, letterSpacing: '0.08em' }}>TYPOLOGIES</Typography>
              </Box>
              <Box sx={{ maxHeight: 320, overflow: 'auto' }}>
                {(typologyMapping || []).length === 0 ? (
                  <Box sx={{ p: 2 }}>
                    <Typography sx={{ fontSize: 11, color: T.textMuted, fontFamily: T.mono }}>No typology mappings available.</Typography>
                  </Box>
                ) : (typologyMapping || []).map((t) => {
                  const isSel = t.typology === selectedTypology;
                  return (
                    <Box
                      key={t.typology}
                      onClick={() => setSelectedTypology(t.typology)}
                      sx={{
                        px: 1.5,
                        py: 1,
                        cursor: 'pointer',
                        borderBottom: `1px solid ${T.border}`,
                        background: isSel ? 'rgba(232,83,26,0.07)' : 'transparent',
                        borderLeft: isSel ? `2px solid ${T.accent}` : '2px solid transparent',
                        '&:hover': { background: isSel ? 'rgba(232,83,26,0.1)' : 'rgba(15,23,42,0.03)' }
                      }}
                    >
                      <Typography sx={{ fontSize: 11, fontWeight: 800, color: isSel ? T.accent : T.text, fontFamily: T.sans, mb: 0.25 }}>
                        {t.typology}
                      </Typography>
                      <Typography sx={{ fontSize: 10, color: T.textMuted, fontFamily: T.sans, lineHeight: 1.5 }}>
                        {t.description || '—'}
                      </Typography>
                    </Box>
                  );
                })}
              </Box>
            </Box>
          </Grid>
          <Grid item xs={12} md={8}>
            <Box sx={{ border: `1px solid ${T.border}`, background: '#ffffff' }}>
              <Box sx={{ px: 1.5, py: 1, borderBottom: `1px solid ${T.border}`, display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                <Typography sx={{ fontSize: 10, fontWeight: 800, color: T.textMuted, fontFamily: T.mono, letterSpacing: '0.08em' }}>FEATURES</Typography>
                <Typography sx={{ fontSize: 10, color: T.textMuted, fontFamily: T.mono }}>
                  {(() => {
                    const row = (typologyMapping || []).find((x) => x.typology === selectedTypology);
                    return row?.features?.length ? `${row.features.length} linked` : '0 linked';
                  })()}
                </Typography>
              </Box>
              <Box sx={{ maxHeight: 320, overflow: 'auto' }}>
                {(() => {
                  const row = (typologyMapping || []).find((x) => x.typology === selectedTypology);
                  if (!row || !row.features || row.features.length === 0) {
                    return (
                      <Box sx={{ p: 2 }}>
                        <Typography sx={{ fontSize: 11, color: T.textMuted, fontFamily: T.mono }}>No linked features.</Typography>
                      </Box>
                    );
                  }
                  return row.features.map((f) => (
                    <Box key={f} sx={{ px: 1.5, py: 0.75, borderBottom: `1px solid ${T.border}` }}>
                      <Typography sx={{ fontSize: 11, color: T.text, fontFamily: T.mono }}>{f}</Typography>
                    </Box>
                  ));
                })()}
              </Box>
            </Box>
          </Grid>
        </Grid>
      </Box>
    </Box>
  </>
);

export default FeatureStoreScreen;
