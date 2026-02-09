import React, { useEffect, useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  CardHeader,
  Alert,
  Grid,
  Typography,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Button,
  Stack,
  Chip,
  Paper,
  TableContainer,
  Skeleton,
  Divider,
  IconButton,
  Tooltip
} from '@mui/material';
import {
  Storage as StorageIcon,
  TableChart as TableChartIcon,
  AccountTree as AccountTreeIcon,
  Refresh as RefreshIcon,
  Info as InfoIcon,
  CalendarToday as CalendarIcon,
  Assessment as AssessmentIcon
} from '@mui/icons-material';
import muleApi from '../services/muleApi';

const DataIntrospectionScreen = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [schema, setSchema] = useState(null);
  const [profile, setProfile] = useState(null);
  const [txnSample, setTxnSample] = useState([]);
  const [accSample, setAccSample] = useState([]);
  const [forensics, setForensics] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, p, tx, acc, fr] = await Promise.all([
        muleApi.getDataSchema(),
        muleApi.getDataProfile(),
        muleApi.getDataSample('transactions', 25),
        muleApi.getDataSample('accounts', 25),
        muleApi.getDataForensicsReport(),
      ]);
      setSchema(s);
      setProfile(p);
      setTxnSample(tx?.rows || []);
      setAccSample(acc?.rows || []);
      setForensics(fr?.report || null);
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Failed to load introspection');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const txnCols = (schema?.transactions || []).map((c) => c.name);
  const accCols = (schema?.accounts || []).map((c) => c.name);

  return (
    <Box sx={{ p: 3 }}>
      {error && (
        <Alert 
          severity="error" 
          sx={{ mb: 3 }} 
          onClose={() => setError(null)}
        >
          {error}
        </Alert>
      )}

      {/* Header Stats */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12}>
          <Card 
            elevation={0}
            sx={{ 
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              color: 'white'
            }}
          >
            <CardHeader
              avatar={<StorageIcon sx={{ fontSize: 40 }} />}
              title={
                <Typography variant="h5" fontWeight={700}>
                  Data Introspection
                </Typography>
              }
              subheader={
                <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.9)' }}>
                  Schema, profiling, and sample data from DuckDB
                </Typography>
              }
              action={
                <Button
                  variant="contained"
                  onClick={load}
                  disabled={loading}
                  startIcon={<RefreshIcon />}
                  sx={{ 
                    bgcolor: 'rgba(255,255,255,0.2)',
                    '&:hover': { bgcolor: 'rgba(255,255,255,0.3)' }
                  }}
                >
                  {loading ? 'Loading…' : 'Refresh'}
                </Button>
              }
            />
            <CardContent>
              {loading ? (
                <Stack direction="row" spacing={2}>
                  <Skeleton variant="rectangular" width={150} height={40} />
                  <Skeleton variant="rectangular" width={150} height={40} />
                  <Skeleton variant="rectangular" width={200} height={40} />
                  <Skeleton variant="rectangular" width={200} height={40} />
                </Stack>
              ) : profile?.success ? (
                <Stack direction="row" spacing={2} flexWrap="wrap">
                  <Chip
                    icon={<TableChartIcon />}
                    label={`Transactions: ${profile.transactions?.row_count?.toLocaleString() ?? 0}`}
                    sx={{ 
                      bgcolor: 'rgba(255,255,255,0.2)',
                      color: 'white',
                      fontWeight: 600
                    }}
                  />
                  <Chip
                    icon={<AccountTreeIcon />}
                    label={`Accounts: ${profile.accounts?.row_count?.toLocaleString() ?? 0}`}
                    sx={{ 
                      bgcolor: 'rgba(255,255,255,0.2)',
                      color: 'white',
                      fontWeight: 600
                    }}
                  />
                  <Chip
                    icon={<CalendarIcon />}
                    label={`Start: ${profile.transactions?.timestamp_range?.start ?? '-'}`}
                    sx={{ 
                      bgcolor: 'rgba(255,255,255,0.2)',
                      color: 'white',
                      fontWeight: 600
                    }}
                  />
                  <Chip
                    icon={<CalendarIcon />}
                    label={`End: ${profile.transactions?.timestamp_range?.end ?? '-'}`}
                    sx={{ 
                      bgcolor: 'rgba(255,255,255,0.2)',
                      color: 'white',
                      fontWeight: 600
                    }}
                  />
                </Stack>
              ) : (
                <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.9)' }}>
                  Upload data to view schema and profiling.
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Schema Cards */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} md={6}>
          <Card elevation={2}>
            <CardHeader
              avatar={<TableChartIcon color="primary" />}
              title="Transactions Schema"
              titleTypographyProps={{ fontWeight: 600 }}
            />
            <Divider />
            <CardContent sx={{ p: 0 }}>
              <TableContainer sx={{ maxHeight: 400 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700, bgcolor: '#f5f5f5' }}>Column</TableCell>
                      <TableCell sx={{ fontWeight: 700, bgcolor: '#f5f5f5' }}>Type</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700, bgcolor: '#f5f5f5' }}>Nulls</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {loading ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell><Skeleton /></TableCell>
                          <TableCell><Skeleton /></TableCell>
                          <TableCell><Skeleton /></TableCell>
                        </TableRow>
                      ))
                    ) : (
                      (schema?.transactions || []).map((c) => (
                        <TableRow key={c.name} hover>
                          <TableCell sx={{ fontWeight: 500 }}>{c.name}</TableCell>
                          <TableCell>
                            <Chip 
                              label={c.type} 
                              size="small" 
                              variant="outlined"
                              sx={{ fontSize: '0.75rem' }}
                            />
                          </TableCell>
                          <TableCell align="right">
                            {profile?.transactions?.nulls?.[c.name] ?? '-'}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card elevation={2}>
            <CardHeader
              avatar={<AccountTreeIcon color="secondary" />}
              title="Accounts Schema"
              titleTypographyProps={{ fontWeight: 600 }}
            />
            <Divider />
            <CardContent sx={{ p: 0 }}>
              <TableContainer sx={{ maxHeight: 400 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700, bgcolor: '#f5f5f5' }}>Column</TableCell>
                      <TableCell sx={{ fontWeight: 700, bgcolor: '#f5f5f5' }}>Type</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700, bgcolor: '#f5f5f5' }}>Nulls</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {loading ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell><Skeleton /></TableCell>
                          <TableCell><Skeleton /></TableCell>
                          <TableCell><Skeleton /></TableCell>
                        </TableRow>
                      ))
                    ) : (
                      (schema?.accounts || []).map((c) => (
                        <TableRow key={c.name} hover>
                          <TableCell sx={{ fontWeight: 500 }}>{c.name}</TableCell>
                          <TableCell>
                            <Chip 
                              label={c.type} 
                              size="small" 
                              variant="outlined"
                              sx={{ fontSize: '0.75rem' }}
                            />
                          </TableCell>
                          <TableCell align="right">
                            {profile?.accounts?.nulls?.[c.name] ?? '-'}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Sample Data */}
      <Grid container spacing={3}>
        <Grid item xs={12}>
          <Card elevation={2}>
            <CardHeader
              avatar={<AssessmentIcon color="info" />}
              title="Sample Rows"
              subheader="First 25 rows per table"
              titleTypographyProps={{ fontWeight: 600 }}
            />
            <Divider />
            <CardContent>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2 }}>
                Transactions Sample
              </Typography>
              <TableContainer component={Paper} variant="outlined" sx={{ mb: 4, maxHeight: 320 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow sx={{ bgcolor: '#fafafa' }}>
                      {txnCols.map((c) => (
                        <TableCell key={c} sx={{ fontWeight: 600 }}>{c}</TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {loading ? (
                      Array.from({ length: 3 }).map((_, i) => (
                        <TableRow key={i}>
                          {txnCols.map((c) => (
                            <TableCell key={c}><Skeleton /></TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : txnSample.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={txnCols.length} align="center">
                          <Typography variant="body2" color="text.secondary">
                            No transaction data available
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ) : (
                      txnSample.map((r, idx) => (
                        <TableRow key={idx} hover>
                          {txnCols.map((c) => (
                            <TableCell key={c}>{String(r?.[c] ?? '')}</TableCell>
                          ))}
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>

              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2 }}>
                Accounts Sample
              </Typography>
              <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 320 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow sx={{ bgcolor: '#fafafa' }}>
                      {accCols.map((c) => (
                        <TableCell key={c} sx={{ fontWeight: 600 }}>{c}</TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {loading ? (
                      Array.from({ length: 3 }).map((_, i) => (
                        <TableRow key={i}>
                          {accCols.map((c) => (
                            <TableCell key={c}><Skeleton /></TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : accSample.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={accCols.length} align="center">
                          <Typography variant="body2" color="text.secondary">
                            No account data available
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ) : (
                      accSample.map((r, idx) => (
                        <TableRow key={idx} hover>
                          {accCols.map((c) => (
                            <TableCell key={c}>{String(r?.[c] ?? '')}</TableCell>
                          ))}
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12}>
          <Card elevation={2}>
            <CardHeader
              avatar={<AssessmentIcon color="warning" />}
              title="Data Forensics Lab"
              subheader="Missingness, cardinality, rare categories, correlations, extremes"
              titleTypographyProps={{ fontWeight: 600 }}
            />
            <Divider />
            <CardContent>
              {!forensics ? (
                <Typography variant="body2" color="text.secondary">No forensic report available.</Typography>
              ) : (
                <Grid container spacing={2}>
                  <Grid item xs={12} md={6}>
                    <Card elevation={0}>
                      <CardHeader title="Missingness (Transactions)" />
                      <CardContent>
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>Column</TableCell>
                              <TableCell align="right">Nulls</TableCell>
                              <TableCell align="right">%</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {(forensics.transactions?.missingness || []).slice(0, 12).map((r) => (
                              <TableRow key={r.column}>
                                <TableCell>{r.column}</TableCell>
                                <TableCell align="right">{r.nulls}</TableCell>
                                <TableCell align="right">{(Number(r.pct || 0) * 100).toFixed(1)}%</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Card elevation={0}>
                      <CardHeader title="Missingness (Accounts)" />
                      <CardContent>
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>Column</TableCell>
                              <TableCell align="right">Nulls</TableCell>
                              <TableCell align="right">%</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {(forensics.accounts?.missingness || []).slice(0, 12).map((r) => (
                              <TableRow key={r.column}>
                                <TableCell>{r.column}</TableCell>
                                <TableCell align="right">{r.nulls}</TableCell>
                                <TableCell align="right">{(Number(r.pct || 0) * 100).toFixed(1)}%</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Card elevation={0}>
                      <CardHeader title="Cardinality Explorer" />
                      <CardContent>
                        {(forensics.transactions?.cardinality || []).map((c) => (
                          <Box key={c.column} sx={{ mb: 2 }}>
                            <Typography variant="subtitle2" fontWeight={700}>{c.column} · {c.distinct}</Typography>
                            <Stack direction="row" spacing={1} flexWrap="wrap">
                              {(c.top || []).slice(0, 6).map((t, i) => (
                                <Chip key={`${c.column}-${i}`} label={`${t.value}: ${t.count}`} size="small" />
                              ))}
                            </Stack>
                          </Box>
                        ))}
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Card elevation={0}>
                      <CardHeader title="Correlation Hints" />
                      <CardContent>
                        {(forensics.transactions?.correlation_hints || []).length === 0 ? (
                          <Typography variant="body2" color="text.secondary">No strong correlations found.</Typography>
                        ) : (
                          <Table size="small">
                            <TableHead>
                              <TableRow>
                                <TableCell>Feature A</TableCell>
                                <TableCell>Feature B</TableCell>
                                <TableCell align="right">Corr</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {(forensics.transactions?.correlation_hints || []).map((r, i) => (
                                <TableRow key={`corr-${i}`}>
                                  <TableCell>{r.a}</TableCell>
                                  <TableCell>{r.b}</TableCell>
                                  <TableCell align="right">{Number(r.corr || 0).toFixed(2)}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        )}
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Card elevation={0}>
                      <CardHeader title="Rare Categories" />
                      <CardContent>
                        {(forensics.transactions?.rare_categories || []).length === 0 ? (
                          <Typography variant="body2" color="text.secondary">No rare categories detected.</Typography>
                        ) : (
                          (forensics.transactions?.rare_categories || []).slice(0, 6).map((c) => (
                            <Box key={c.column} sx={{ mb: 2 }}>
                              <Typography variant="subtitle2" fontWeight={700}>{c.column}</Typography>
                              <Stack direction="row" spacing={1} flexWrap="wrap">
                                {(c.rare || []).slice(0, 6).map((t, i) => (
                                  <Chip key={`${c.column}-${i}`} label={`${t.value}: ${t.count}`} size="small" />
                                ))}
                              </Stack>
                            </Box>
                          ))
                        )}
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Card elevation={0}>
                      <CardHeader title="Extreme Value Detection" />
                      <CardContent>
                        {!forensics.transactions?.extreme_values ? (
                          <Typography variant="body2" color="text.secondary">No amount field detected.</Typography>
                        ) : (
                          <Stack direction="row" spacing={2} flexWrap="wrap">
                            <Chip label={`p1: ${Number(forensics.transactions.extreme_values.p1 || 0).toFixed(2)}`} />
                            <Chip label={`p99: ${Number(forensics.transactions.extreme_values.p99 || 0).toFixed(2)}`} />
                            <Chip label={`Low outliers: ${forensics.transactions.extreme_values.low_outliers || 0}`} />
                            <Chip label={`High outliers: ${forensics.transactions.extreme_values.high_outliers || 0}`} />
                          </Stack>
                        )}
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Card elevation={0}>
                      <CardHeader title="Imbalance View" />
                      <CardContent>
                        <Stack spacing={1}>
                          <Typography variant="subtitle2" fontWeight={700}>is_mule</Typography>
                          <Stack direction="row" spacing={1} flexWrap="wrap">
                            {Object.entries(forensics.imbalance?.is_mule || {}).map(([k, v]) => (
                              <Chip key={`mule-${k}`} label={`${k}: ${v}`} size="small" />
                            ))}
                          </Stack>
                          <Typography variant="subtitle2" fontWeight={700}>is_suspicious</Typography>
                          <Stack direction="row" spacing={1} flexWrap="wrap">
                            {Object.entries(forensics.imbalance?.is_suspicious || {}).map(([k, v]) => (
                              <Chip key={`susp-${k}`} label={`${k}: ${v}`} size="small" />
                            ))}
                          </Stack>
                        </Stack>
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Card elevation={0}>
                      <CardHeader title="Leakage Warnings" />
                      <CardContent>
                        {(forensics.leakage?.accounts || []).length === 0 ? (
                          <Typography variant="body2" color="text.secondary">No label leakage detected.</Typography>
                        ) : (
                          <Stack direction="row" spacing={1} flexWrap="wrap">
                            {(forensics.leakage?.accounts || []).slice(0, 8).map((l) => (
                              <Chip key={l.feature} label={`${l.feature} · ${Number(l.separation).toFixed(2)}`} />
                            ))}
                          </Stack>
                        )}
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid item xs={12}>
                    <Card elevation={0}>
                      <CardHeader title="Type Correction Suggestions" />
                      <CardContent>
                        <Stack direction="row" spacing={1} flexWrap="wrap">
                          {(forensics.type_suggestions?.transactions || []).slice(0, 12).map((s, i) => (
                            <Chip key={`ts-${i}`} label={`${s.column} → ${s.suggest} (${Number(s.confidence || 0).toFixed(2)})`} />
                          ))}
                        </Stack>
                      </CardContent>
                    </Card>
                  </Grid>
                </Grid>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default DataIntrospectionScreen;
