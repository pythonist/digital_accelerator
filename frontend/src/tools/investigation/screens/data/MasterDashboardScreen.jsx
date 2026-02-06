import React, { useState, useEffect, useMemo } from 'react';
import apiClient from "@services/api";

// ✅ Layout Components
import PageContainer from "@investigation-layout/PageContainer";
import { formatCompact } from "@investigation/utils/format";

import {
  Box, Paper, Typography, Stack, Chip, IconButton, TextField, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Grid, Card, CardContent, LinearProgress, Tooltip
} from '@mui/material';

import {
  Visibility as VisibilityIcon,
  TrendingUp as TrendingUpIcon,
  People as PeopleIcon,
  Assessment as AssessmentIcon,
  AttachMoney as MoneyIcon,
  Schedule as ScheduleIcon,
  ChevronLeft,
  ChevronRight,
  Search as SearchIcon,
  Download as DownloadIcon,
  CheckCircle as CheckCircleIcon,
  TableChart as TableChartIcon,
  Storage as StorageIcon
} from '@mui/icons-material';

const MasterDashboardScreen = () => {
  const [activeTable, setActiveTable] = useState(null);
  const [stats, setStats] = useState(null);
  const [summary, setSummary] = useState(null);
  const [columns, setColumns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [datasetInfo, setDatasetInfo] = useState(null);

  const [tableData, setTableData] = useState([]);
  const [page, setPage] = useState(1);
  const [rowsPerPage] = useState(50);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    initDashboard();
  }, []);

  const initDashboard = async () => {
    setLoading(true);
    try {
      let target = 'master_cleaned_data';
      let meta = await fetchMetadata(target);

      if (!meta) {
        target = 'master_view';
        meta = await fetchMetadata(target);
      }

      if (!meta) {
        setIsLocked(true);
        setLoading(false);
        return;
      }

      setActiveTable(target);
      setColumns(meta.columns);

      try {
        const regRes = await apiClient.get('/api/v2/merge/registry');
        const info = regRes.find(r => r.table_name === target);
        if (info) setDatasetInfo(info);
      } catch (e) {
        console.warn("Could not fetch registry info");
      }

      const totalCells = meta.total_rows * meta.columns.length;
      const totalNulls = meta.columns.reduce((acc, col) => acc + (col.missing_count || 0), 0);
      const qualityScore =
        totalCells > 0 ? ((totalCells - totalNulls) / totalCells) * 100 : 0;

      setStats({
        total_rows: meta.total_rows,
        column_count: meta.columns.length,
        quality_score: qualityScore.toFixed(1)
      });

      fetchSummary(target);
    } catch (e) {
      console.error("Dashboard Init Failed", e);
    } finally {
      setLoading(false);
    }
  };

  const fetchMetadata = async (table) => {
    try {
      const res = await apiClient.post('/api/v2/clean/columns', { table });
      if (res.columns && res.columns.length > 0) return res;
      return null;
    } catch {
      return null;
    }
  };

  const fetchSummary = async (table) => {
    setSummaryLoading(true);
    try {
      const res = await apiClient.get(`/api/v2/master/summary?table=${table}`);
      setSummary(res);
    } catch (e) {
      console.warn("Summary fetch failed", e);
      setSummary(null);
    } finally {
      setSummaryLoading(false);
    }
  };

  useEffect(() => {
    if (!activeTable) return;
    const fetchData = async () => {
      try {
        const res = await apiClient.post('/api/v2/db/query-table', {
          table: activeTable,
          page,
          rowsPerPage
        });
        if (res.success) setTableData(res.data);
      } catch (e) {
        console.error(e);
      }
    };
    fetchData();
  }, [activeTable, page, rowsPerPage]);

  const filteredData = useMemo(() => {
    if (!searchTerm) return tableData;
    const lower = searchTerm.toLowerCase();
    return tableData.filter(row =>
      Object.values(row).some(v => String(v).toLowerCase().includes(lower))
    );
  }, [tableData, searchTerm]);

  /* ===================== LOADING ===================== */
  if (loading) {
    return (
      <PageContainer
        title="Master Data Overview"
        subtitle="Unified View & Data Quality Metrics"
        breadcrumbs={['System', 'Master Data']}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
          <Stack alignItems="center" spacing={2}>
            <StorageIcon sx={{ fontSize: 48, color: '#ccc' }} />
            <Typography color="text.secondary">
              Initializing Data Grid...
            </Typography>
          </Stack>
        </Box>
      </PageContainer>
    );
  }

  /* ===================== LOCKED ===================== */
  if (isLocked) {
    return (
      <PageContainer
        title="Master Data Overview"
        subtitle="Unified View & Data Quality Metrics"
        breadcrumbs={['System', 'Master Data']}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
          <Paper sx={{ p: 6, maxWidth: 500, textAlign: 'center' }}>
            <StorageIcon sx={{ fontSize: 40, mb: 2 }} />
            <Typography variant="h6" fontWeight="bold">
              No Master Data Found
            </Typography>
            <Typography color="text.secondary">
              Please complete Smart Merge and Data Cleaning.
            </Typography>
          </Paper>
        </Box>
      </PageContainer>
    );
  }

  /* ===================== MAIN ===================== */
  return (
    <PageContainer
      title="Master Data Overview"
      subtitle="Unified View & Data Quality Metrics"
      breadcrumbs={['System', 'Master Data']}
      actions={
        <Stack direction="row" spacing={1.5}>
          <Chip
            icon={<CheckCircleIcon />}
            label="Live Connection"
            color="success"
            size="small"
            variant="outlined"
          />
          <IconButton size="small">
            <DownloadIcon fontSize="small" />
          </IconButton>
        </Stack>
      }
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        
        {/* Summary Section */}
        {summaryLoading && (
          <Paper variant="outlined" sx={{ p: 3 }}>
            <LinearProgress />
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>Loading summary...</Typography>
          </Paper>
        )}

        {summary && !summaryLoading && (
          <Grid container spacing={2}>
            <Grid item xs={12} md={6} lg={3}>
              <Card variant="outlined" sx={{ height: '100%' }}>
                <CardContent>
                  <Stack direction="row" alignItems="center" spacing={1} mb={1}>
                    <StorageIcon fontSize="small" color="primary" />
                    <Typography variant="caption" fontWeight="bold" color="text.secondary">TOTAL RECORDS</Typography>
                  </Stack>
                  <Typography variant="h4" fontWeight="bold">{summary.counts?.total_records?.toLocaleString() || '-'}</Typography>
                  <Stack direction="row" spacing={2} mt={1}>
                    <Typography variant="caption" color="text.secondary">Cases: <strong>{summary.counts?.unique_cases?.toLocaleString() || '-'}</strong></Typography>
                    <Typography variant="caption" color="text.secondary">Customers: <strong>{summary.counts?.unique_customers?.toLocaleString() || '-'}</strong></Typography>
                  </Stack>
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12} md={6} lg={3}>
              <Card variant="outlined" sx={{ height: '100%' }}>
                <CardContent>
                  <Stack direction="row" alignItems="center" spacing={1} mb={1}>
                    <AssessmentIcon fontSize="small" color="error" />
                    <Typography variant="caption" fontWeight="bold" color="text.secondary">CASE RISK</Typography>
                  </Stack>
                  <Stack spacing={0.5}>
                    {summary.risk?.case_risk && Object.entries(summary.risk.case_risk).map(([level, count]) => (
                      <Stack key={level} direction="row" justifyContent="space-between" alignItems="center">
                        <Chip 
                          label={level} 
                          size="small" 
                          color={level === 'CRITICAL' ? 'error' : level === 'HIGH' ? 'warning' : 'default'}
                          sx={{ minWidth: 80, fontSize: '0.65rem', height: 20 }}
                        />
                        <Typography variant="body2" fontWeight="bold">{count}</Typography>
                      </Stack>
                    ))}
                  </Stack>
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12} md={6} lg={3}>
              <Card variant="outlined" sx={{ height: '100%' }}>
                <CardContent>
                  <Stack direction="row" alignItems="center" spacing={1} mb={1}>
                    <MoneyIcon fontSize="small" sx={{ color: '#4caf50' }} />
                    <Typography variant="caption" fontWeight="bold" color="text.secondary">TRANSACTIONS</Typography>
                  </Stack>
                  <Typography variant="h5" fontWeight="bold" color="success.main">
                    {formatCompact(summary.transactions?.total_value, { decimals: 1 })}
                  </Typography>
                  <Stack spacing={0.5} mt={1}>
                    <Typography variant="caption" color="text.secondary">P95: {formatCompact(summary.transactions?.p95_amount, { decimals: 0 })}</Typography>
                    <Typography variant="caption" color="text.secondary">Max: {formatCompact(summary.transactions?.max_amount, { decimals: 1 })}</Typography>
                  </Stack>
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12} md={6} lg={3}>
              <Card variant="outlined" sx={{ height: '100%' }}>
                <CardContent>
                  <Stack direction="row" alignItems="center" spacing={1} mb={1}>
                    <ScheduleIcon fontSize="small" color="action" />
                    <Typography variant="caption" fontWeight="bold" color="text.secondary">DATA FRESHNESS</Typography>
                  </Stack>
                  <Typography variant="body2" fontWeight="bold">{summary.freshness?.latest_alert_date || 'N/A'}</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                    Last 90 days: <strong>{summary.freshness?.records_last_90_days || 0}</strong> records
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        )}

        {/* Metrics Cards */}
        <Grid container spacing={2}>
          <Grid item xs={12} md={6} lg={3}>
            <Card variant="outlined">
              <CardContent>
                <Stack direction="row" alignItems="center" spacing={1} mb={1}>
                  <PeopleIcon fontSize="small" color="primary" />
                  <Typography variant="caption" fontWeight="bold" color="text.secondary">TOTAL RECORDS</Typography>
                </Stack>
                <Typography variant="h4" fontWeight="bold">{stats?.total_rows?.toLocaleString() || '-'}</Typography>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={6} lg={3}>
            <Card variant="outlined">
              <CardContent>
                <Stack direction="row" alignItems="center" spacing={1} mb={1}>
                  <StorageIcon fontSize="small" sx={{ color: '#9c27b0' }} />
                  <Typography variant="caption" fontWeight="bold" color="text.secondary">SCHEMA COLUMNS</Typography>
                </Stack>
                <Typography variant="h4" fontWeight="bold">{stats?.column_count || '-'}</Typography>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={6} lg={3}>
            <Card variant="outlined">
              <CardContent>
                <Stack direction="row" alignItems="center" spacing={1} mb={1}>
                  <TrendingUpIcon fontSize="small" color={stats?.quality_score > 90 ? 'success' : 'warning'} />
                  <Typography variant="caption" fontWeight="bold" color="text.secondary">QUALITY SCORE</Typography>
                </Stack>
                <Typography variant="h4" fontWeight="bold" color={stats?.quality_score > 90 ? 'success.main' : 'warning.main'}>
                  {stats?.quality_score ? `${stats.quality_score}%` : '-'}
                </Typography>
                <Typography variant="caption" color="text.secondary">Completeness Ratio</Typography>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={6} lg={3}>
            <Card variant="outlined">
              <CardContent>
                <Stack direction="row" alignItems="center" spacing={1} mb={1}>
                  <TableChartIcon fontSize="small" color="action" />
                  <Typography variant="caption" fontWeight="bold" color="text.secondary">ACTIVE DATASET</Typography>
                </Stack>
                <Typography variant="body2" fontWeight="bold" noWrap sx={{ mb: 0.5 }}>{activeTable}</Typography>
                {datasetInfo && (
                  <Typography variant="caption" color="text.secondary">
                    {datasetInfo.type} • {new Date(datasetInfo.created_at).toLocaleDateString()}
                  </Typography>
                )}
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* Data Grid */}
        <Paper variant="outlined" sx={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: 2 }}>
          
          {/* Toolbar */}
          <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid #e0e0e0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', bgcolor: '#fafafa' }}>
            <Typography variant="subtitle2" fontWeight="bold" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <TableChartIcon fontSize="small" /> DATASET PREVIEW
            </Typography>
            <Box sx={{ position: 'relative', width: 300 }}>
              <SearchIcon sx={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'text.secondary', fontSize: 18 }} />
              <TextField 
                size="small" 
                placeholder="Filter visible rows..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                sx={{ 
                  width: '100%',
                  '& .MuiOutlinedInput-root': { 
                    pl: 5,
                    fontSize: '0.85rem',
                    bgcolor: '#fff'
                  }
                }}
              />
            </Box>
            <Chip label={`${filteredData.length} visible`} size="small" variant="outlined" />
          </Box>

          {/* Table */}
          <TableContainer sx={{ maxHeight: 500 }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  {columns.map(col => (
                    <TableCell key={col.name} sx={{ bgcolor: '#fafafa', fontWeight: 'bold', fontSize: '0.75rem', whiteSpace: 'nowrap', minWidth: 150 }}>
                      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                        <span>{col.name}</span>
                        <Chip 
                          label={col.type} 
                          size="small" 
                          sx={{ 
                            height: 18, 
                            fontSize: '0.65rem', 
                            bgcolor: col.type.includes('INT') || col.type.includes('FLOAT') ? '#e3f2fd' : col.type.includes('DATE') ? '#fff3e0' : '#f5f5f5',
                            color: col.type.includes('INT') || col.type.includes('FLOAT') ? '#1976d2' : col.type.includes('DATE') ? '#ff9800' : '#616161'
                          }}
                        />
                      </Stack>
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredData.map((row, i) => (
                  <TableRow key={i} hover>
                    {columns.map(col => (
                      <TableCell key={col.name} sx={{ whiteSpace: 'nowrap', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '0.8rem' }}>
                        <Tooltip title={row[col.name] || ''} arrow>
                          <span>
                            {row[col.name] === null || row[col.name] === '' 
                              ? <Typography variant="caption" sx={{ fontStyle: 'italic', color: '#ccc' }}>null</Typography>
                              : typeof row[col.name] === 'boolean' 
                                ? (row[col.name] ? 'True' : 'False') 
                                : row[col.name]
                            }
                          </span>
                        </Tooltip>
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
                {filteredData.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={columns.length} align="center" sx={{ py: 6, color: 'text.disabled' }}>
                      <SearchIcon sx={{ fontSize: 32, mb: 1, opacity: 0.3 }} />
                      <Typography variant="body2">No matching records found.</Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>

          {/* Pagination */}
          <Box sx={{ px: 2, py: 1.5, borderTop: '1px solid #e0e0e0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', bgcolor: '#fff' }}>
            <Typography variant="caption" color="text.secondary">
              Showing page {page} • {rowsPerPage} rows/page
            </Typography>
            <Stack direction="row" spacing={1}>
              <IconButton size="small" disabled={page === 1} onClick={() => setPage(p => Math.max(1, p - 1))} sx={{ border: '1px solid #e0e0e0' }}>
                <ChevronLeft fontSize="small" />
              </IconButton>
              <IconButton size="small" disabled={tableData.length < rowsPerPage} onClick={() => setPage(p => p + 1)} sx={{ border: '1px solid #e0e0e0' }}>
                <ChevronRight fontSize="small" />
              </IconButton>
            </Stack>
          </Box>

        </Paper>
      </Box>
    </PageContainer>
  );
};

export default MasterDashboardScreen;
