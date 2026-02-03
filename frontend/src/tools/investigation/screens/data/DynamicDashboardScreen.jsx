import React, { useState, useEffect, useMemo } from 'react';
import { useAppContext } from "@context/AppContext";
import apiClient from "@services/api";

// ✅ Correct Layout Import
import PageContainer from "@investigation-layout/PageContainer";

// Recharts
import { 
  BarChart, Bar, LineChart, Line, AreaChart, Area, XAxis, YAxis, 
  CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell
} from 'recharts';

// MUI Imports
import {
  Box,
  Paper,
  Typography,
  Button,
  IconButton,
  Select,
  MenuItem,
  Stack,
  Chip,
  Divider,
  CircularProgress,
  Alert,
  ToggleButton,
  ToggleButtonGroup,
  FormControl,
  Autocomplete,
  TextField,
  useTheme
} from '@mui/material';

// MUI Icons
import {
  Storage as DatabaseIcon,
  BarChart as BarChartIcon,
  Science as MicroscopeIcon,
  ErrorOutline as AlertCircleIcon,
  Visibility as EyeIcon,
  VisibilityOff as EyeOffIcon,
  ChevronRight as ChevronRightIcon,
  Settings as SettingsIcon,
  InsertChartOutlined as BarChart2Icon
} from '@mui/icons-material';

// ✅ BRAND COLORS - PwC PALETTE
const BRAND_PRIMARY = '#D93900'; // PwC Orange
const CHART_COLORS = [
  '#D93900', // Orange
  '#FFB600', // Yellow
  '#404041', // Dark Grey
  '#E0301E', // Red
  '#DB536A', // Rose
  '#E88D68', // Light Orange
  '#8F8F8F'  // Medium Grey
];

const DynamicDashboardScreen = () => {
  const { datasetLoaded } = useAppContext();
  const theme = useTheme();
  
  // --- STATE MANAGEMENT ---
  const [activeTab, setActiveTab] = useState('profiler'); // 'profiler' | 'builder'
  
  // Data State
  const [availableTables, setAvailableTables] = useState([]);
  const [selectedTables, setSelectedTables] = useState([]); 
  const [schema, setSchema] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Profiler State
  const [profCol, setProfCol] = useState(null);
  const [profData, setProfData] = useState(null);
  const [profChartType, setProfChartType] = useState('bar');

  // Builder State
  const [expConfig, setExpConfig] = useState({ 
    xAxis: '', yAxis: '', aggregation: 'sum', groupBy: '', chartType: 'bar' 
  });
  const [expData, setExpData] = useState([]);

  // UI State
  const [showIds, setShowIds] = useState(false);

  // --- INITIALIZATION ---
  useEffect(() => {
    if (datasetLoaded) loadTables();
  }, [datasetLoaded]);

  const loadTables = async () => {
    try {
      const res = await apiClient.get('/api/v2/discovery/tables');
      if (res.tables) {
        setAvailableTables(res.tables);
        if (res.tables.length > 0) setSelectedTables([res.tables[0].value]);
      }
    } catch (e) { console.error("Load failed", e); }
  };

  useEffect(() => {
    if (selectedTables.length > 0) loadSchema();
  }, [selectedTables]);

  const loadSchema = async () => {
    try {
        const res = await apiClient.post(`/api/v2/discovery/schema/multi`, { tables: selectedTables });
        setSchema(res || []);
        setProfCol(null); 
        setProfData(null);
        setExpConfig({ xAxis: '', yAxis: '', aggregation: 'sum', groupBy: '', chartType: 'bar' });
    } catch (e) { console.error("Schema load failed", e); }
  };

  // --- ACTIONS ---
  const runProfile = async (col) => {
    setProfCol(col); setLoading(true); setError('');
    
    if (col.ui_hint === 'date') setProfChartType('area');
    else if (col.ui_hint === 'category') setProfChartType('bar'); 
    else setProfChartType('bar');

    try {
        const res = await apiClient.post('/api/v2/discovery/profile', { 
            table: col.table, 
            column: col.original_name,
            is_multi: selectedTables.length > 1 
        });
        if (res.success) setProfData(res);
        else setError(res.error);
    } catch (e) { setError('Profiling failed'); } finally { setLoading(false); }
  };

  const runQuery = async () => {
    if (!expConfig.xAxis) return;
    setLoading(true); setError('');
    try {
        const res = await apiClient.post('/api/v2/discovery/query/multi', {
            tables: selectedTables,
            x_axis: expConfig.xAxis, 
            y_axis: expConfig.yAxis, 
            aggregation: expConfig.aggregation, 
            group_by: expConfig.groupBy
        });
        
        if (res.success) setExpData(res.data);
        else setError(res.error);
    } catch (e) { setError('Query failed'); } finally { setLoading(false); }
  };

  useEffect(() => { 
      if (activeTab === 'builder' && expConfig.xAxis) runQuery(); 
  }, [expConfig.xAxis, expConfig.yAxis, expConfig.aggregation, expConfig.groupBy]);

  const visibleColumns = useMemo(() => {
    if (showIds) return schema;
    return schema.filter(c => c.ui_hint !== 'id' && !c.name.toLowerCase().includes('_id'));
  }, [schema, showIds]);

  const axisOpts = useMemo(() => ({
    dims: visibleColumns.filter(c => ['category','text','date'].includes(c.ui_hint)),
    metrics: visibleColumns.filter(c => ['numeric','currency'].includes(c.ui_hint))
  }), [visibleColumns]);

  // --- RENDERERS ---
  const renderChart = (type, data, xKey='name', yKey='value') => {
    if (!data || data.length === 0) {
        return (
            <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'text.disabled' }}>
                <BarChart2Icon sx={{ fontSize: 48, mb: 2, opacity: 0.2 }}/>
                <Typography variant="body2" fontWeight="500">No visualization generated</Typography>
                <Typography variant="caption">Configure axis parameters to generate preview</Typography>
            </Box>
        );
    }

    const CommonProps = { data, margin: { top: 20, right: 30, left: 20, bottom: 50 } };
    
    if (type === 'pie') {
        return (
            <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                    <Pie data={data} dataKey={yKey} nameKey={xKey} cx="50%" cy="50%" outerRadius={100} label>
                        {data.map((_,i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]}/>)}
                    </Pie>
                    <Tooltip contentStyle={{borderRadius:'6px', border:'1px solid #e2e8f0', boxShadow:'0 2px 4px rgba(0,0,0,0.05)'}}/> 
                    <Legend/>
                </PieChart>
            </ResponsiveContainer>
        );
    }

    const ChartComponent = type === 'line' ? LineChart : type === 'area' ? AreaChart : BarChart;
    const DataComponent = type === 'line' ? Line : type === 'area' ? Area : Bar;

    return (
        <ResponsiveContainer width="100%" height="100%">
            <ChartComponent {...CommonProps}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9"/>
                <XAxis 
                    dataKey={xKey} 
                    tick={{fontSize:10, fill:'#64748b'}} 
                    angle={-30} 
                    textAnchor="end" 
                    height={60}
                    tickLine={false}
                    axisLine={{stroke:'#cbd5e1'}}
                />
                <YAxis 
                    tick={{fontSize:10, fill:'#64748b'}} 
                    tickLine={false}
                    axisLine={false}
                />
                <Tooltip 
                    contentStyle={{borderRadius:'6px', border:'1px solid #e2e8f0', boxShadow:'0 4px 6px rgba(0,0,0,0.05)'}}
                    itemStyle={{fontSize:'12px', fontWeight:500}}
                />
                <Legend iconType="circle" wrapperStyle={{paddingTop:'20px'}}/>
                
                {/* ✅ UPDATED: Use PwC Chart Colors for Bars/Lines */}
                <DataComponent 
                    dataKey={yKey} 
                    fill={BRAND_PRIMARY} 
                    stroke={BRAND_PRIMARY} 
                    strokeWidth={2}
                    radius={type === 'bar' ? [4,4,0,0] : 0} 
                    activeDot={{r: 6, strokeWidth: 0}}
                >
                    {/* For Bar charts, we can alternate colors if needed, but usually single series is one color.
                        If you want each bar different: */}
                    {type === 'bar' && data.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                </DataComponent>
            </ChartComponent>
        </ResponsiveContainer>
    );
  };

  // --- PROFILER TAB ---
  const renderProfiler = () => (
    <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden', height: '100%' }}>
        <Box sx={{ width: 280, borderRight: 1, borderColor: 'divider', bgcolor: 'background.paper', display: 'flex', flexDirection: 'column', flexShrink: 0, height: '100%' }}>
            <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'space-between', bgcolor: 'grey.50', flexShrink: 0 }}>
                <Typography variant="caption" fontWeight="700" color="text.secondary" textTransform="uppercase" letterSpacing={1}>Select Column</Typography>
                <IconButton 
                    size="small"
                    onClick={()=>setShowIds(!showIds)} 
                    sx={{ color: 'text.secondary', '&:hover': { color: BRAND_PRIMARY } }}
                >
                    {showIds ? <EyeIcon fontSize="small"/> : <EyeOffIcon fontSize="small"/>}
                </IconButton>
            </Box>
            <Box sx={{ flex: 1, overflowY: 'auto', p: 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                {visibleColumns.map(col => (
                    <Button 
                        key={col.name} 
                        onClick={() => runProfile(col)}
                        fullWidth
                        sx={{ 
                            justifyContent: 'flex-start',
                            px: 1.5, py: 1,
                            textTransform: 'none',
                            color: profCol?.name === col.name ? BRAND_PRIMARY : 'text.secondary',
                            bgcolor: profCol?.name === col.name ? '#fff3e0' : 'transparent', // Light Orange bg
                            border: profCol?.name === col.name ? `1px solid ${BRAND_PRIMARY}` : '1px solid transparent',
                            '&:hover': { bgcolor: 'grey.50', color: 'text.primary' }
                        }}
                    >
                        <Chip 
                          label={col.ui_hint.substring(0,3)}
                          size="small"
                          sx={{ 
                            height: 20, fontSize: '0.65rem', fontWeight: 700, borderRadius: 0.5, mr: 1.5,
                            textTransform: 'uppercase',
                            bgcolor: col.ui_hint === 'numeric' ? '#fff3e0' : col.ui_hint === 'date' ? '#FFFBEB' : '#F1F5F9',
                            color: col.ui_hint === 'numeric' ? '#D93900' : col.ui_hint === 'date' ? '#D97706' : 'text.secondary',
                            border: 1,
                            borderColor: col.ui_hint === 'numeric' ? '#ffccbc' : col.ui_hint === 'date' ? '#FEF3C7' : 'divider'
                          }}
                        />
                        <Typography variant="body2" noWrap sx={{ flex: 1, textAlign: 'left' }}>{col.label}</Typography>
                        {profCol?.name === col.name && <ChevronRightIcon fontSize="small" sx={{ color: BRAND_PRIMARY, fontSize: 16 }}/>}
                    </Button>
                ))}
            </Box>
        </Box>
        
        <Box sx={{ flex: 1, p: 3, bgcolor: '#F8FAFC', display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%' }}>
            {!profData ? (
                 <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'text.secondary' }}>
                    <MicroscopeIcon sx={{ fontSize: 48, mb: 2, color: 'grey.300' }}/>
                    <Typography variant="body2" fontWeight="500" color="text.secondary">Select a column to generate profiling statistics</Typography>
                 </Box>
            ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2, flexShrink: 0 }}>
                        <Stack direction="row" alignItems="center" spacing={1}>
                            <Typography variant="h6" fontWeight="700" color="text.primary">{profCol.label}</Typography>
                            <Chip 
                                label={profData.stats.ui_hint} 
                                size="small" 
                                sx={{ height: 20, fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', bgcolor: 'grey.100', color: 'text.secondary', border: '1px solid', borderColor: 'divider' }}
                            />
                        </Stack>
                        
                        <Paper variant="outlined" sx={{ p: 0.5, bgcolor: 'background.paper', display: 'flex' }}>
                            {['bar','line','area','pie'].map(t => (
                                <ToggleButton 
                                    key={t}
                                    value={t}
                                    selected={profChartType === t}
                                    onClick={()=>setProfChartType(t)}
                                    size="small"
                                    sx={{ 
                                        px: 1.5, py: 0.5, fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', border: 'none', borderRadius: 1,
                                        '&.Mui-selected': { bgcolor: BRAND_PRIMARY, color: 'white', '&:hover': { bgcolor: '#b93000' } }
                                    }}
                                >
                                    {t}
                                </ToggleButton>
                            ))}
                        </Paper>
                    </Box>

                    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 2, mb: 3, flexShrink: 0 }}>
                        <StatCard label="Total Rows" value={profData.stats.total?.toLocaleString()} />
                        <StatCard label="Missing Values" value={profData.stats.nulls?.toLocaleString()} highlight={profData.stats.nulls > 0} />
                        <StatCard label="Unique Values" value={profData.stats.unique?.toLocaleString()} />
                        <StatCard label="Est. Validity" value={`${((1 - (profData.stats.nulls/profData.stats.total)) * 100).toFixed(1)}%`} />
                    </Box>

                    <Paper variant="outlined" sx={{ flex: 1, p: 3, position: 'relative', minHeight: 0, bgcolor: 'background.paper', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                        {loading && (
                            <Box sx={{ position: 'absolute', inset: 0, bgcolor: 'rgba(255,255,255,0.8)', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <CircularProgress size={32} sx={{ color: BRAND_PRIMARY }} />
                            </Box>
                        )}
                        <Box sx={{ flex: 1, width: '100%', minHeight: 0, height: '100%' }}>
                            {renderChart(profChartType, profData.chart_data)}
                        </Box>
                    </Paper>
                </Box>
            )}
        </Box>
    </Box>
  );

  // --- BUILDER TAB ---
  const renderBuilder = () => (
    <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden', height: '100%' }}>
        <Box sx={{ width: 300, borderRight: 1, borderColor: 'divider', bgcolor: 'background.paper', p: 2, overflowY: 'auto', flexShrink: 0, height: '100%' }}>
            <Stack direction="row" alignItems="center" spacing={1} mb={3}>
                <SettingsIcon sx={{ color: BRAND_PRIMARY }} fontSize="small"/>
                <Typography variant="subtitle2" fontWeight="700">Visualization Config</Typography>
            </Stack>
            
            <ControlBox label="X-Axis (Dimension)">
                <FormControl fullWidth size="small">
                    <Select
                        value={expConfig.xAxis}
                        onChange={e=>setExpConfig({...expConfig, xAxis:e.target.value})}
                        displayEmpty
                        sx={{ bgcolor: 'grey.50' }}
                    >
                        <MenuItem value="">Select Dimension...</MenuItem>
                        {axisOpts.dims.map(c => <MenuItem key={c.name} value={c.name}>{c.label}</MenuItem>)}
                    </Select>
                </FormControl>
            </ControlBox>

            <ControlBox label="Y-Axis (Metric)">
                <FormControl fullWidth size="small">
                    <Select
                        value={expConfig.yAxis}
                        onChange={e=>setExpConfig({...expConfig, yAxis:e.target.value})}
                        displayEmpty
                        sx={{ bgcolor: 'grey.50', mb: 1.5 }}
                    >
                        <MenuItem value="">Record Count</MenuItem>
                        {axisOpts.metrics.map(c => <MenuItem key={c.name} value={c.name}>{c.label}</MenuItem>)}
                    </Select>
                </FormControl>
                
                {expConfig.yAxis && (
                    <ToggleButtonGroup 
                        exclusive
                        value={expConfig.aggregation}
                        onChange={(e, v) => v && setExpConfig({...expConfig, aggregation: v})}
                        fullWidth
                        size="small"
                        sx={{ '& .Mui-selected': { bgcolor: `${BRAND_PRIMARY} !important`, color: 'white' } }}
                    >
                        {['sum','avg','max'].map(a => (
                            <ToggleButton key={a} value={a} sx={{ textTransform: 'uppercase', fontSize: '0.65rem', fontWeight: 700 }}>
                                {a}
                            </ToggleButton>
                        ))}
                    </ToggleButtonGroup>
                )}
            </ControlBox>

            <ControlBox label="Segmentation (Group By)">
                <FormControl fullWidth size="small">
                    <Select
                        value={expConfig.groupBy}
                        onChange={e=>setExpConfig({...expConfig, groupBy:e.target.value})}
                        displayEmpty
                        sx={{ bgcolor: 'grey.50' }}
                    >
                        <MenuItem value="">None</MenuItem>
                        {axisOpts.dims.map(c => <MenuItem key={c.name} value={c.name}>{c.label}</MenuItem>)}
                    </Select>
                </FormControl>
            </ControlBox>

            <Divider sx={{ my: 2 }} />

            <Typography variant="caption" fontWeight="700" color="text.secondary" textTransform="uppercase" letterSpacing={1} display="block" mb={1.5}>Chart Type</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1 }}>
                {['bar','line','area','pie','scatter'].map(t => (
                    <Button 
                        key={t} 
                        onClick={()=>setExpConfig({...expConfig, chartType:t})} 
                        variant={expConfig.chartType===t ? 'contained' : 'outlined'}
                        size="small"
                        sx={{ 
                            fontSize: '0.65rem', fontWeight: 700, 
                            bgcolor: expConfig.chartType===t ? BRAND_PRIMARY : 'background.paper',
                            color: expConfig.chartType===t ? 'white' : 'text.secondary',
                            borderColor: expConfig.chartType===t ? BRAND_PRIMARY : 'divider',
                            '&:hover': { bgcolor: expConfig.chartType===t ? '#b93000' : 'grey.50' }
                        }}
                    >
                        {t}
                    </Button>
                ))}
            </Box>
        </Box>

        <Box sx={{ flex: 1, p: 3, bgcolor: '#F8FAFC', display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%' }}>
            {error ? (
                <Alert severity="error" icon={<AlertCircleIcon fontSize="inherit" />} sx={{ mx: 'auto', mt: 'auto', mb: 'auto' }}>
                    {error}
                </Alert>
            ) : (
                <Paper variant="outlined" sx={{ flex: 1, display: 'flex', flexDirection: 'column', p: 3, position: 'relative', overflow: 'hidden', minHeight: 0 }}>
                      {loading && (
                        <Box sx={{ position: 'absolute', inset: 0, bgcolor: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(1px)', zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                            <CircularProgress size={32} sx={{ mb: 1, color: BRAND_PRIMARY }} />
                            <Typography variant="caption" fontWeight="700" sx={{ color: BRAND_PRIMARY }}>PROCESSING QUERY...</Typography>
                        </Box>
                      )}
                      
                      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: 1, borderColor: 'divider', pb: 2, flexShrink: 0 }}>
                          <Box>
                            <Typography variant="caption" fontWeight="700" color="text.disabled" textTransform="uppercase" letterSpacing={1} display="block" mb={0.5}>Visualization Preview</Typography>
                            <Typography variant="body2" fontWeight="600" color="text.primary">
                                {expConfig.xAxis 
                                    ? `${expConfig.aggregation.toUpperCase()} of ${expConfig.yAxis || 'Records'} by ${expConfig.xAxis}` 
                                    : 'Awaiting Configuration'}
                            </Typography>
                          </Box>
                      </Box>
                      
                      <Box sx={{ flex: 1, width: '100%', minHeight: 0, height: '100%' }}>
                          {renderChart(expConfig.chartType, expData)}
                      </Box>
                </Paper>
            )}
        </Box>
    </Box>
  );

  return (
    <PageContainer 
      title="Data Studio" 
      subtitle="Exploratory Analysis & Visualization"
      breadcrumbs={['Discovery', 'Dashboard']}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
          
          {/* Control Bar */}
          <Paper 
            variant="outlined" 
            sx={{ 
                px: 2, py: 1.5, 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'space-between', 
                gap: 2,
                mb: 2,
                bgcolor: 'white',
                flexShrink: 0 
            }}
          >
              <Stack direction="row" alignItems="center" spacing={2} sx={{ flex: 1, maxWidth: 800 }}>
                 <Stack direction="row" alignItems="center" spacing={1} sx={{ color: 'text.secondary', minWidth: 'max-content' }}>
                    <DatabaseIcon fontSize="small" />
                    <Typography variant="caption" fontWeight="700" textTransform="uppercase" letterSpacing={0.5}>
                        Active Datasets:
                    </Typography>
                 </Stack>

                 <Autocomplete
                    multiple
                    limitTags={3}
                    options={availableTables}
                    getOptionLabel={(option) => option.label || option.value}
                    value={availableTables.filter(t => selectedTables.includes(t.value))}
                    onChange={(event, newValue) => {
                        const newValues = newValue.map(item => item.value);
                        if (activeTab === 'profiler' && newValues.length > 1) {
                            setSelectedTables([newValues[newValues.length - 1]]);
                        } else if (newValues.length === 0) {
                            setSelectedTables([]); 
                        } else {
                            setSelectedTables(newValues);
                        }
                    }}
                    renderInput={(params) => (
                        <TextField 
                            {...params} 
                            placeholder={selectedTables.length === 0 ? "Select tables..." : ""}
                            size="small" 
                        />
                    )}
                    renderTags={(value, getTagProps) =>
                        value.map((option, index) => (
                          <Chip 
                            label={option.label} 
                            size="small" 
                            {...getTagProps({ index })} 
                            sx={{ 
                                fontWeight: 600, 
                                height: 24,
                                bgcolor: '#fff3e0', // Light Orange
                                color: BRAND_PRIMARY,
                                borderColor: '#ffccbc',
                                border: '1px solid'
                            }} 
                          />
                        ))
                    }
                    size="small"
                    sx={{ flex: 1 }}
                    disableCloseOnSelect
                 />
              </Stack>

              <Paper variant="outlined" sx={{ p: 0.5, bgcolor: 'grey.50', display: 'flex', gap: 0.5 }}>
                 <TabButton 
                    active={activeTab === 'profiler'} 
                    onClick={() => { setActiveTab('profiler'); if(selectedTables.length > 1) setSelectedTables([selectedTables[0]]); }}
                    icon={MicroscopeIcon}
                    label="Deep Profiler"
                 />
                 <TabButton 
                    active={activeTab === 'builder'} 
                    onClick={() => setActiveTab('builder')}
                    icon={BarChartIcon}
                    label="Visual Builder"
                 />
              </Paper>
          </Paper>

          {/* Main Workspace - Fills remaining space */}
          <Paper variant="outlined" sx={{ flex: 1, overflow: 'hidden', borderRadius: 2, display: 'flex', flexDirection: 'column' }}>
             {activeTab === 'profiler' ? renderProfiler() : renderBuilder()}
          </Paper>
      </Box>
    </PageContainer>
  );
};

// --- SUB-COMPONENTS ---
const ControlBox = ({label, children}) => (
    <Box sx={{ mb: 3 }}>
        <Typography variant="caption" fontWeight="700" color="text.secondary" textTransform="uppercase" letterSpacing={1} display="block" mb={1}>{label}</Typography>
        {children}
    </Box>
);

const StatCard = ({label, value, highlight}) => (
    <Paper variant="outlined" sx={{ p: 2, bgcolor: highlight ? '#FFF1F2' : 'background.paper', borderColor: highlight ? '#FECDD3' : 'divider' }}>
        <Typography variant="caption" fontWeight="700" textTransform="uppercase" letterSpacing={1} display="block" mb={0.5} color={highlight ? 'error.main' : 'text.secondary'}>
            {label}
        </Typography>
        <Typography variant="h6" fontWeight="700" color={highlight ? 'error.dark' : 'text.primary'}>
            {value || '-'}
        </Typography>
    </Paper>
);

const TabButton = ({ active, onClick, icon: Icon, label }) => (
    <Button 
        onClick={onClick}
        size="small"
        startIcon={<Icon fontSize="small" sx={{ color: active ? BRAND_PRIMARY : 'text.disabled' }}/>}
        sx={{ 
            px: 2, py: 1, textTransform: 'none', fontWeight: 700, fontSize: '0.75rem',
            bgcolor: active ? 'background.paper' : 'transparent',
            color: active ? BRAND_PRIMARY : 'text.secondary',
            boxShadow: active ? 1 : 0,
            '&:hover': { bgcolor: active ? 'background.paper' : 'grey.200' }
        }}
    >
        {label}
    </Button>
);

export default DynamicDashboardScreen;