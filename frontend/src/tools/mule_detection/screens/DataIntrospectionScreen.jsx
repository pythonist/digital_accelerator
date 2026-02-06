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

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, p, tx, acc] = await Promise.all([
        muleApi.getDataSchema(),
        muleApi.getDataProfile(),
        muleApi.getDataSample('transactions', 25),
        muleApi.getDataSample('accounts', 25),
      ]);
      setSchema(s);
      setProfile(p);
      setTxnSample(tx?.rows || []);
      setAccSample(acc?.rows || []);
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
              <TableContainer component={Paper} variant="outlined" sx={{ mb: 4 }}>
                <Table size="small">
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
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
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
      </Grid>
    </Box>
  );
};

export default DataIntrospectionScreen;