// frontend/src/tools/btsy/screens/calibration/transaction_universe/components/UniverseFilterBuilder.jsx
// COMPLETE FIX - Shows BOTH transaction_type (CREDIT/DEBIT) AND transaction_category (RTGS/NEFT/etc)

import React, { useState, useEffect, useRef } from 'react';
import {
  Box, Card, Typography, TextField, Button, Grid, Alert, Chip,
  LinearProgress, Paper, Select, MenuItem, FormControl, InputLabel, Stack,
  Checkbox, ListItemText
} from '@mui/material';
import {
  FilterList as FilterListIcon, PlayArrow as PlayArrowIcon,
  CalendarToday as CalendarIcon, Category as CategoryIcon,
  AttachMoney as MoneyIcon, TrendingUp as TrendingUpIcon
} from '@mui/icons-material';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import btsyApi from '../../../../services/btsyApi';
import { useCalibrationRun } from '../../../../context/CalibrationRunContext';

const UniverseFilterBuilder = ({ onPreview, loading, snapshotId, preset }) => {
  const [universeName, setUniverseName] = useState('My Transaction Universe');  // DEFAULT NAME
  const [description, setDescription] = useState('');
  
  // BOTH filters now
  const [selectedTypes, setSelectedTypes] = useState([]);  // NEW: CREDIT/DEBIT
  const [selectedCategories, setSelectedCategories] = useState([]);  // RTGS/NEFT/etc
  
  const [amountMin, setAmountMin] = useState('');
  const [amountMax, setAmountMax] = useState('');
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  
  const [dataStats, setDataStats] = useState(null);
  const [availableTypes, setAvailableTypes] = useState([]);  // NEW
  const [availableCategories, setAvailableCategories] = useState([]);
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState(null);
  const lastAppliedPresetKeyRef = useRef('');
  const { activeRunLogic } = useCalibrationRun();

  useEffect(() => {
    if (!preset) return;
    if (typeof preset.universe_name === 'string' && preset.universe_name.trim()) {
      setUniverseName(preset.universe_name);
    }
    if (typeof preset.description === 'string') {
      setDescription(preset.description);
    }
  }, [preset]);

  useEffect(() => {
    if (!preset) return;
    if (!dataStats) return;
    const key = JSON.stringify(preset);
    if (key && key === lastAppliedPresetKeyRef.current) return;
    if (Array.isArray(preset.types) && preset.types.length > 0 && availableTypes.length > 0) {
      const wanted = preset.types.filter((t) => availableTypes.includes(t));
      if (wanted.length > 0) setSelectedTypes(wanted);
    }
    if (Array.isArray(preset.categories) && preset.categories.length > 0 && availableCategories.length > 0) {
      const wanted = preset.categories.filter((c) => availableCategories.includes(c));
      if (wanted.length > 0) setSelectedCategories(wanted);
    }
    if (preset.date_start) setDateStart(preset.date_start);
    if (preset.date_end) setDateEnd(preset.date_end);
    if (preset.amount_min !== undefined && preset.amount_min !== null) setAmountMin(String(preset.amount_min));
    if (preset.amount_max !== undefined && preset.amount_max !== null) setAmountMax(String(preset.amount_max));
    lastAppliedPresetKeyRef.current = key;
  }, [preset, dataStats, availableTypes, availableCategories]);

  useEffect(() => {
    if (snapshotId) {
      loadDataStatistics();
    }
  }, [snapshotId]);

  const loadDataStatistics = async () => {
    try {
      setLoadingData(true);
      setError(null);
      
      console.log('[FILTER] Loading stats for snapshot:', snapshotId);
      const statsResponse = await btsyApi.universe.getDataStatistics(snapshotId);
      
      console.log('[FILTER] Stats response:', statsResponse);
      
      if (!statsResponse.success || !statsResponse.data) {
        throw new Error('Failed to load data statistics');
      }
      
      const stats = statsResponse.data;
      
      const transformedStats = {
        totalTransactions: stats.total_transactions || 0,
        dateRange: {
          minDate: stats.date_range?.min_date || null,
          maxDate: stats.date_range?.max_date || null
        },
        amountRange: {
          min: stats.amount_range?.min ?? null,
          max: stats.amount_range?.max ?? null,
          avg: stats.amount_range?.avg ?? null,
          median: stats.amount_range?.median ?? null
        },
        typeDistribution: stats.type_distribution || {},  // NEW: CREDIT/DEBIT
        categoryDistribution: stats.category_distribution || {},  // RTGS/NEFT/etc
        monthlyDistribution: stats.monthly_distribution || []
      };
      
      console.log('[FILTER] Type distribution:', transformedStats.typeDistribution);
      console.log('[FILTER] Category distribution:', transformedStats.categoryDistribution);
      
      if (!transformedStats.dateRange.minDate || !transformedStats.dateRange.maxDate) {
        throw new Error('No date range available in data');
      }
      
      setDataStats(transformedStats);
      
      // Get transaction types (CREDIT, DEBIT)
      const types = Object.keys(transformedStats.typeDistribution).sort();
      console.log('[FILTER] Available types:', types);
      if (types.length > 0) {
        setAvailableTypes(types);
        setSelectedTypes(types); // Default: all selected
      }
      
      // Get transaction categories (RTGS, NEFT, CHEQUE, etc.)
      const categories = Object.keys(transformedStats.categoryDistribution).sort();
      console.log('[FILTER] Available categories:', categories);
      if (categories.length > 0) {
        setAvailableCategories(categories);
        setSelectedCategories(categories); // Default: all selected
      } else {
        console.warn('[FILTER] No categories found!');
      }
      
      // Auto-populate dates to enable button
      setDateStart(transformedStats.dateRange.minDate);
      setDateEnd(transformedStats.dateRange.maxDate);

      if (preset) {
        if (Array.isArray(preset.types) && preset.types.length > 0 && types.length > 0) {
          const wanted = preset.types.filter((t) => types.includes(t));
          if (wanted.length > 0) setSelectedTypes(wanted);
        }
        if (Array.isArray(preset.categories) && preset.categories.length > 0 && categories.length > 0) {
          const wanted = preset.categories.filter((c) => categories.includes(c));
          if (wanted.length > 0) setSelectedCategories(wanted);
        }
        if (preset.date_start) setDateStart(preset.date_start);
        if (preset.date_end) setDateEnd(preset.date_end);
        if (preset.amount_min !== undefined && preset.amount_min !== null) setAmountMin(String(preset.amount_min));
        if (preset.amount_max !== undefined && preset.amount_max !== null) setAmountMax(String(preset.amount_max));
      }
      
    } catch (error) {
      console.error('[FILTER] Load failed:', error);
      setError(error.message || 'Failed to load transaction data');
    } finally {
      setLoadingData(false);
    }
  };

  const calculateCoverage = () => {
    if (!dataStats) return { percentage: 0, estimatedCount: 0 };
    
    let multiplier = 1.0;
    const totalTxns = dataStats.totalTransactions;
    
    // Transaction type filter impact (CREDIT/DEBIT)
    if (selectedTypes.length < availableTypes.length && availableTypes.length > 0) {
      const selectedTypeCount = selectedTypes.reduce((sum, type) => 
        sum + (dataStats.typeDistribution[type] || 0), 0
      );
      multiplier *= (selectedTypeCount / totalTxns);
    }
    
    // Transaction category filter impact (RTGS/NEFT/etc)
    if (selectedCategories.length < availableCategories.length && availableCategories.length > 0) {
      const selectedCategoryCount = selectedCategories.reduce((sum, cat) => 
        sum + (dataStats.categoryDistribution[cat] || 0), 0
      );
      multiplier *= (selectedCategoryCount / totalTxns);
    }
    
    // Date filter impact
    if (dateStart && dateEnd && dataStats.monthlyDistribution.length > 0) {
      const selectedMonths = dataStats.monthlyDistribution.filter(d => 
        d.month >= dateStart.substring(0, 7) && d.month <= dateEnd.substring(0, 7)
      );
      const dateRatio = selectedMonths.reduce((sum, m) => sum + m.count, 0) / 
                        dataStats.monthlyDistribution.reduce((sum, m) => sum + m.count, 0);
      multiplier *= dateRatio;
    }
    
    if (amountMin) multiplier *= 0.9;
    if (amountMax) multiplier *= 0.9;
    
    const percentage = Math.round(multiplier * 100);
    const estimatedCount = Math.round(totalTxns * multiplier);
    
    return { percentage, estimatedCount };
  };

  const handleSubmit = () => {
    if (!universeName.trim()) {
      alert('Please enter a universe name');
      return;
    }

    if (!dateStart || !dateEnd) {
      alert('Please select start and end dates');
      return;
    }

    const filterSpec = {
      // Include BOTH filters
      types: selectedTypes.length > 0 && selectedTypes.length < availableTypes.length 
        ? selectedTypes : null,
      categories: selectedCategories.length > 0 && selectedCategories.length < availableCategories.length 
        ? selectedCategories : null,
      amount_min: amountMin ? parseFloat(amountMin) : null,
      amount_max: amountMax ? parseFloat(amountMax) : null,
      date_start: dateStart || null,
      date_end: dateEnd || null,
      aggregation_level: activeRunLogic?.aggregation_level || undefined,
      lookback_days: activeRunLogic?.lookback_days ?? undefined
    };

    console.log('[FILTER] Creating universe with spec:', filterSpec);

    onPreview({
      universe_name: universeName,
      description: description || null,
      filter_spec: filterSpec,
      created_by: 'user'
    });
  };

  if (loadingData) {
    return (
      <Card sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
        <Box sx={{ textAlign: 'center', p: 4 }}>
          <LinearProgress sx={{ mb: 2 }} />
          <Typography variant="body2" color="text.secondary">
            Loading transaction data...
          </Typography>
        </Box>
      </Card>
    );
  }

  if (error) {
    return (
      <Card sx={{ height: '100%', p: 3, minHeight: 400 }}>
        <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
        <Button variant="outlined" onClick={loadDataStatistics}>Retry</Button>
      </Card>
    );
  }

  if (!dataStats) {
    return (
      <Card sx={{ height: '100%', p: 3, minHeight: 400 }}>
        <Alert severity="warning">No data statistics available.</Alert>
      </Card>
    );
  }

  const { percentage: coverage, estimatedCount } = calculateCoverage();
  
  const chartData = dataStats.monthlyDistribution.map(item => ({
    month: new Date(item.month + '-01').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
    count: item.count,
    isSelected: dateStart && dateEnd && 
                item.month >= dateStart.substring(0, 7) && 
                item.month <= dateEnd.substring(0, 7)
  }));

  return (
    <Card sx={{ height: '100%' }}>
      <Box sx={{ p: 2.5, borderBottom: '1px solid #e2e8f0', bgcolor: '#fafafa' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <FilterListIcon color="primary" />
          <Typography variant="h6" sx={{ fontWeight: 600, color: '#1e293b' }}>
            Build Transaction Universe
          </Typography>
          <Chip
            label={`${dataStats.totalTransactions.toLocaleString()} total transactions`}
            size="small"
            sx={{ ml: 'auto', bgcolor: 'background.default', color: 'text.primary', fontWeight: 600, border: '1px solid', borderColor: 'divider' }}
          />
          {activeRunLogic?.aggregation_level && (
            <Chip
              label={`Aggregation: ${activeRunLogic.aggregation_level}`}
              size="small"
              sx={{ ml: 1, bgcolor: '#e0f2fe', color: '#0369a1', fontWeight: 600, border: '1px solid', borderColor: 'divider' }}
            />
          )}
          {activeRunLogic?.transaction_type && (
            <Chip
              label={`Type: ${String(activeRunLogic.transaction_type).toUpperCase()}`}
              size="small"
              sx={{ ml: 1, bgcolor: '#f1f5f9', color: '#0f172a', fontWeight: 600, border: '1px solid', borderColor: 'divider' }}
            />
          )}
        </Box>
      </Box>

      <Box sx={{ p: 2.5 }}>
        <Grid container spacing={2.5}>
          {/* Name and Description */}
          <Grid item xs={12}>
            <TextField
              fullWidth
              label="Universe Name"
              value={universeName}
              onChange={(e) => setUniverseName(e.target.value)}
              placeholder="e.g., High Value RTGS Transactions"
              size="small"
              required
              sx={{ mb: 1.5 }}
            />
            <TextField
              fullWidth
              label="Description (Optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what this universe represents..."
              multiline
              rows={2}
              size="small"
            />
          </Grid>

          {/* Monthly Distribution Chart */}
          <Grid item xs={12}>
            <Paper elevation={0} sx={{ p: 2, bgcolor: '#f8fafc', border: '1px solid #e2e8f0' }}>
              <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600, color: '#1e293b' }}>
                Transaction Volume Over Time
              </Typography>
              <ResponsiveContainer width="100%" height={150}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis 
                    dataKey="month" 
                    tick={{ fontSize: 11 }}
                    stroke="#64748b"
                  />
                  <YAxis 
                    tick={{ fontSize: 11 }}
                    stroke="#64748b"
                    tickFormatter={(value) => value.toLocaleString()}
                  />
                  <Tooltip 
                    formatter={(value) => value.toLocaleString()}
                    labelStyle={{ color: '#1e293b' }}
                    contentStyle={{ 
                      borderRadius: 8, 
                      border: '1px solid #e2e8f0',
                      fontSize: 12
                    }}
                  />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {chartData.map((entry, index) => (
                      <Cell 
                        key={`cell-${index}`} 
                        fill={entry.isSelected ? '#0f172a' : '#cbd5e1'} 
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Paper>
          </Grid>

          {/* Date Range */}
          <Grid item xs={12}>
            <Box sx={{ mb: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <CalendarIcon color="primary" sx={{ fontSize: 20 }} />
                <Typography variant="subtitle2" sx={{ fontWeight: 600, color: '#1e293b' }}>
                  Date Range
                </Typography>
                <Chip 
                  label={`${new Date(dataStats.dateRange.minDate).toLocaleDateString()} - ${new Date(dataStats.dateRange.maxDate).toLocaleDateString()}`}
                  size="small"
                  sx={{ ml: 'auto', bgcolor: 'background.default', color: 'text.primary', fontSize: '0.7rem', border: '1px solid', borderColor: 'divider' }}
                />
              </Box>
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <TextField
                    fullWidth
                    label="Start Date"
                    type="date"
                    value={dateStart}
                    onChange={(e) => setDateStart(e.target.value)}
                    InputLabelProps={{ shrink: true }}
                    inputProps={{
                      min: dataStats.dateRange.minDate,
                      max: dataStats.dateRange.maxDate
                    }}
                    size="small"
                    required
                  />
                </Grid>
                <Grid item xs={6}>
                  <TextField
                    fullWidth
                    label="End Date"
                    type="date"
                    value={dateEnd}
                    onChange={(e) => setDateEnd(e.target.value)}
                    InputLabelProps={{ shrink: true }}
                    inputProps={{
                      min: dataStats.dateRange.minDate,
                      max: dataStats.dateRange.maxDate
                    }}
                    size="small"
                    required
                  />
                </Grid>
              </Grid>
            </Box>
          </Grid>

          {/* NEW: Transaction Type Filter (CREDIT/DEBIT) */}
          {availableTypes.length > 0 && (
            <Grid item xs={12}>
              <Box sx={{ mb: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <TrendingUpIcon color="primary" sx={{ fontSize: 20 }} />
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, color: '#1e293b' }}>
                    Transaction Type
                  </Typography>
                  <Chip 
                    label={`${availableTypes.length} types found`}
                    size="small"
                    sx={{ ml: 'auto', bgcolor: 'background.default', color: 'text.primary', fontSize: '0.7rem', border: '1px solid', borderColor: 'divider' }}
                  />
                </Box>
                <FormControl fullWidth size="small">
                  <InputLabel>Select Types (CREDIT, DEBIT)</InputLabel>
                  <Select
                    multiple
                    value={
                      activeRunLogic?.locked && activeRunLogic?.transaction_type
                        ? [String(activeRunLogic.transaction_type).toUpperCase()]
                        : selectedTypes
                    }
                    onChange={(e) => setSelectedTypes(e.target.value)}
                    disabled={Boolean(activeRunLogic?.locked && activeRunLogic?.transaction_type)}
                    renderValue={(selected) => (
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, py: 0.5 }}>
                        {selected.map((value) => (
                          <Chip 
                            key={value} 
                            label={`${value} (${dataStats.typeDistribution[value]?.toLocaleString()})`}
                            size="small" 
                            sx={{ 
                              bgcolor: 'background.default', 
                              color: 'text.primary', 
                              fontWeight: 600,
                              height: 24,
                              fontSize: '0.75rem'
                            }}
                          />
                        ))}
                      </Box>
                    )}
                  >
                    {availableTypes.map((type) => (
                      <MenuItem key={type} value={type} sx={{ py: 1 }}>
                        <Checkbox 
                          checked={selectedTypes.indexOf(type) > -1}
                          size="small"
                        />
                        <ListItemText 
                          primary={
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                              <Typography variant="body2" sx={{ fontWeight: 500 }}>{type}</Typography>
                              <Typography variant="caption" sx={{ color: '#64748b', ml: 2 }}>
                                {dataStats.typeDistribution[type]?.toLocaleString()} txns
                              </Typography>
                            </Box>
                          }
                        />
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>
            </Grid>
          )}

          {/* Transaction Category Filter (RTGS/NEFT/CHEQUE/etc) */}
          {availableCategories.length > 0 && (
            <Grid item xs={12}>
              <Box sx={{ mb: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <CategoryIcon color="primary" sx={{ fontSize: 20 }} />
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, color: '#1e293b' }}>
                    Transaction Category
                  </Typography>
                  <Chip 
                    label={`${availableCategories.length} categories found`}
                    size="small"
                    sx={{ ml: 'auto', bgcolor: '#e0f2fe', color: '#0369a1', fontSize: '0.7rem' }}
                  />
                </Box>
                <FormControl fullWidth size="small">
                  <InputLabel>Select Categories (RTGS, NEFT, CHEQUE, etc.)</InputLabel>
                  <Select
                    multiple
                    value={selectedCategories}
                    onChange={(e) => setSelectedCategories(e.target.value)}
                    renderValue={(selected) => (
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, py: 0.5 }}>
                        {selected.map((value) => (
                          <Chip 
                            key={value} 
                            label={`${value} (${dataStats.categoryDistribution[value]?.toLocaleString()})`}
                            size="small" 
                            sx={{ 
                              bgcolor: '#e0f2fe', 
                              color: '#0369a1', 
                              fontWeight: 600,
                              height: 24,
                              fontSize: '0.75rem'
                            }}
                          />
                        ))}
                      </Box>
                    )}
                  >
                    {availableCategories.map((category) => (
                      <MenuItem key={category} value={category} sx={{ py: 1 }}>
                        <Checkbox 
                          checked={selectedCategories.indexOf(category) > -1}
                          size="small"
                        />
                        <ListItemText 
                          primary={
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                              <Typography variant="body2" sx={{ fontWeight: 500 }}>{category}</Typography>
                              <Typography variant="caption" sx={{ color: '#64748b', ml: 2 }}>
                                {dataStats.categoryDistribution[category]?.toLocaleString()} txns
                              </Typography>
                            </Box>
                          }
                        />
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>
            </Grid>
          )}

          {/* Amount Range */}
          <Grid item xs={12}>
            <Box sx={{ mb: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <MoneyIcon sx={{ color: '#334155', fontSize: 20 }} />
                <Typography variant="subtitle2" sx={{ fontWeight: 600, color: '#1e293b' }}>
                  Amount Range (Optional)
                </Typography>
                {dataStats.amountRange.min !== null && (
                  <Chip 
                    label={`${Math.round(dataStats.amountRange.min).toLocaleString()} - ${Math.round(dataStats.amountRange.max).toLocaleString()}`}
                    size="small"
                    sx={{ ml: 'auto', bgcolor: '#f1f5f9', color: '#334155', fontSize: '0.7rem' }}
                  />
                )}
              </Box>
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <TextField
                    fullWidth
                    label="Minimum Amount"
                    type="number"
                    value={amountMin}
                    onChange={(e) => setAmountMin(e.target.value)}
                    placeholder="0"
                    size="small"
                  />
                </Grid>
                <Grid item xs={6}>
                  <TextField
                    fullWidth
                    label="Maximum Amount"
                    type="number"
                    value={amountMax}
                    onChange={(e) => setAmountMax(e.target.value)}
                    placeholder="No limit"
                    size="small"
                  />
                </Grid>
              </Grid>
            </Box>
          </Grid>

          {/* Coverage Summary */}
          <Grid item xs={12}>
            <Paper 
              elevation={0}
              sx={{ 
                p: 2.5, 
                bgcolor: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: 2
              }}
            >
              <Stack spacing={1.5}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, color: '#1e293b' }}>
                    Estimated Coverage
                  </Typography>
                  <Chip 
                    label={`≈ ${estimatedCount.toLocaleString()} transactions`}
                    sx={{ 
                      bgcolor: '#e2e8f0',
                      color: '#0f172a',
                      fontWeight: 600,
                      fontSize: '0.8rem'
                    }}
                  />
                </Box>
                
                <Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography variant="body2" sx={{ color: '#64748b', fontSize: '0.85rem' }}>
                      Coverage
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600, color: '#1e293b', fontSize: '0.85rem' }}>
                      {coverage}% of total data
                    </Typography>
                  </Box>
                  <LinearProgress 
                    variant="determinate" 
                    value={Math.min(coverage, 100)} 
                    sx={{
                      height: 10,
                      borderRadius: 5,
                      bgcolor: '#e2e8f0',
                      '& .MuiLinearProgress-bar': {
                        bgcolor: '#0f172a',
                        borderRadius: 5
                      }
                    }}
                  />
                </Box>

                {coverage < 20 && (
                  <Alert severity="warning" sx={{ py: 0.5 }}>
                    Very restrictive filters ({coverage}%). Consider broadening.
                  </Alert>
                )}
              </Stack>
            </Paper>
          </Grid>

          {/* Submit Button */}
          <Grid item xs={12}>
            <Button
              fullWidth
              variant="contained"
              size="large"
              onClick={handleSubmit}
              disabled={loading || !dateStart || !dateEnd || !universeName.trim()}
              startIcon={<PlayArrowIcon />}
              sx={{
                bgcolor: '#0f172a',
                '&:hover': { bgcolor: '#111827' },
                '&:disabled': { bgcolor: '#cbd5e1', color: '#94a3b8' },
                fontWeight: 600,
                textTransform: 'none',
                py: 1.5,
                fontSize: '1rem'
              }}
            >
              {loading ? 'Creating Universe...' : 'Create Draft Universe'}
            </Button>
          </Grid>
        </Grid>
      </Box>
    </Card>
  );
};

export default UniverseFilterBuilder;
