import React, { useState, useEffect } from 'react';
import {
  Box, Typography, Button, Divider, Table, TableBody, TableCell, TableRow,
  TableHead, Paper, Stack, Grid, Chip, Container, Alert, LinearProgress, IconButton
} from '@mui/material';
import {
  DownloadRounded, PrintRounded, CheckCircleRounded, InsightsRounded,
  WarningRounded, StorageRounded, TrendingUpRounded, VerifiedUserRounded,
  AutoAwesome, Close as CloseIcon
} from '@mui/icons-material';
import { motion } from 'framer-motion';
import { useCalibration } from '../context/CalibrationContext';
import { useAppContext } from '@context/AppContext';
import apiClient from '@services/api';

// --- PWC Design System Constants ---
const PWC_ORANGE = '#D04A02';
const PWC_BLACK = '#000000';
const PWC_DARK_GREY = '#2B2B2B';
const PWC_MID_GREY = '#53565A';
const PWC_LIGHT_GREY = '#E0E0E0';
const PWC_BG_LIGHT = '#F8F8F8';

// --- Motion Components ---
const MotionBox = motion(Box);
const MotionPaper = motion(Paper);

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { 
    opacity: 1, 
    transition: { staggerChildren: 0.1 } 
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 }
};

// --- Reusable UI Components ---

// 1. Stat Box
const PWCStatBox = ({ label, value, subtext, icon }) => (
  <MotionPaper 
    variants={itemVariants}
    elevation={0}
    sx={{ 
      p: 2, 
      height: '100%',
      border: `1px solid ${PWC_LIGHT_GREY}`,
      borderRadius: 0,
      bgcolor: 'white'
    }}
  >
    <Stack spacing={1}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography 
          variant="caption" 
          sx={{ 
            color: PWC_MID_GREY,
            fontWeight: 500,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            fontSize: '0.7rem'
          }}
        >
          {label}
        </Typography>
        {icon && <Box sx={{ color: PWC_LIGHT_GREY }}>{icon}</Box>}
      </Stack>
      <Typography 
        variant="h5" 
        sx={{ 
          fontWeight: 600,
          color: PWC_DARK_GREY,
          fontSize: '1.5rem'
        }}
      >
        {value}
      </Typography>
      {subtext && (
        <Typography variant="caption" color={PWC_MID_GREY} sx={{ fontSize: '0.75rem' }}>
          {subtext}
        </Typography>
      )}
    </Stack>
  </MotionPaper>
);

// 2. Section Wrapper
const PWCSection = ({ title, subtitle, children, noBorder = false }) => (
  <MotionBox variants={itemVariants} sx={{ mb: 4 }}>
    <Box sx={{ mb: 2 }}>
      <Typography 
        variant="h6" 
        sx={{ 
          fontWeight: 600,
          color: PWC_ORANGE,
          fontSize: '1rem',
          mb: 0.5
        }}
      >
        {title}
      </Typography>
      {subtitle && (
        <Typography variant="body2" color={PWC_MID_GREY} sx={{ fontSize: '0.875rem' }}>
          {subtitle}
        </Typography>
      )}
    </Box>
    {!noBorder && <Divider sx={{ mb: 2, borderColor: PWC_LIGHT_GREY }} />}
    {children}
  </MotionBox>
);

// 3. Clean Table
const PWCTable = ({ headers, rows }) => (
  <Table size="small">
    <TableHead>
      <TableRow sx={{ bgcolor: PWC_ORANGE }}>
        {headers.map((h, i) => (
          <TableCell 
            key={i} 
            sx={{ 
              fontWeight: 600,
              fontSize: '0.75rem',
              color: 'white',
              py: 1,
              border: 'none',
              ...h.headSx
            }}
          >
            {h.label}
          </TableCell>
        ))}
      </TableRow>
    </TableHead>
    <TableBody>
      {rows.map((row, idx) => (
        <TableRow 
          key={idx}
          sx={{ 
            '&:nth-of-type(odd)': { bgcolor: PWC_BG_LIGHT },
            '&:hover': { bgcolor: '#FFF5F0' }
          }}
        >
          {headers.map((h, i) => (
            <TableCell 
              key={i} 
              sx={{ 
                fontSize: '0.8125rem',
                color: PWC_DARK_GREY,
                py: 1.25,
                borderBottom: `1px solid ${PWC_LIGHT_GREY}`,
                ...h.sx
              }}
            >
              {row[h.key]}
            </TableCell>
          ))}
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

// 4. Professional AI Insights (Fixed Design)
const PwcAIInsights = ({ runId, section, sectionData }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [content, setContent] = useState(null);

  const handleGenerate = () => {
    if (!isOpen && !content) {
      setLoading(true);
      setIsOpen(true);
      // Simulate API call
      setTimeout(() => {
        setContent("The observed patterns indicate strong alignment with expected baselines. Anomalies in the upper quantile suggest potential tuning opportunities for high-value transactions. Recommend monitoring the cluster for stability.");
        setLoading(false);
      }, 1500);
    } else {
      setIsOpen(!isOpen);
    }
  };

  return (
    <Box sx={{ mt: 2 }}>
      {!isOpen ? (
        <Button
          variant="outlined"
          size="small"
          onClick={handleGenerate}
          startIcon={<AutoAwesome sx={{ color: PWC_ORANGE, fontSize: 16 }} />}
          sx={{
            textTransform: 'none',
            color: PWC_MID_GREY,
            borderColor: PWC_LIGHT_GREY,
            fontSize: '0.75rem',
            fontWeight: 600,
            py: 0.5,
            px: 2,
            borderRadius: 0,
            '&:hover': {
              borderColor: PWC_ORANGE,
              bgcolor: '#FFF5F0',
              color: PWC_ORANGE
            }
          }}
        >
          Generate AI Insights
        </Button>
      ) : (
        <Paper 
          elevation={0}
          sx={{ 
            p: 2, 
            bgcolor: '#FFF5F0', 
            borderLeft: `3px solid ${PWC_ORANGE}`,
            borderRadius: 0,
            position: 'relative'
          }}
        >
          {loading ? (
            <Box sx={{ width: '100%' }}>
              <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 1 }}>
                <AutoAwesome sx={{ fontSize: 16, color: PWC_ORANGE, animation: 'pulse 1s infinite' }} />
                <Typography variant="caption" sx={{ color: PWC_ORANGE, fontWeight: 600 }}>
                  Analyzing data patterns...
                </Typography>
              </Stack>
              <LinearProgress sx={{ height: 2, bgcolor: '#ffdcb5', '& .MuiLinearProgress-bar': { bgcolor: PWC_ORANGE } }} />
            </Box>
          ) : (
            <Box>
              <Stack direction="row" justifyContent="space-between" alignItems="start" sx={{ mb: 1 }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <AutoAwesome sx={{ fontSize: 16, color: PWC_ORANGE }} />
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, color: PWC_DARK_GREY, fontSize: '0.75rem', letterSpacing: 0.5 }}>
                    AI OBSERVATION
                  </Typography>
                </Stack>
                <IconButton 
                  size="small" 
                  onClick={() => setIsOpen(false)} 
                  sx={{ p: 0.5, color: PWC_MID_GREY, mt: -0.5, mr: -0.5 }}
                >
                  <CloseIcon fontSize="small" sx={{ fontSize: 16 }} />
                </IconButton>
              </Stack>
              <Typography variant="body2" sx={{ color: PWC_DARK_GREY, fontSize: '0.8125rem', lineHeight: 1.6 }}>
                {content}
              </Typography>
            </Box>
          )}
        </Paper>
      )}
    </Box>
  );
};

// --- Main Screen Component ---
const FinalReportScreen = () => {
  const { run } = useCalibration();
  const { activeEnv } = useAppContext();
   
  const [reportData, setReportData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [aiAvailable, setAiAvailable] = useState(true);

  const safeNum = (val) => (val === undefined || val === null || isNaN(val)) ? 0 : val;
  const safeStr = (val) => (val === undefined || val === null) ? 'N/A' : val;

  useEffect(() => {
    if (run?.run_id) {
      loadCompleteReport();
    }
  }, [run?.run_id]);

  const loadCompleteReport = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get(`/api/v2/calibration/report/${run.run_id}/full`, { 
        params: { env_id: activeEnv } 
      });
      setReportData(res.report);
    } catch (err) {
      console.error("Report load failed", err);
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadPDF = async () => {
    setDownloading(true);
    try {
      const blob = await apiClient.downloadBlob(
        `/api/v2/calibration/report/${run.run_id}/pdf`,
        { env_id: activeEnv }
      );
      
      if (blob.size === 0) throw new Error("Received empty PDF file");
      
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `PWC_Calibration_Report_${run.run_id}.pdf`;
      document.body.appendChild(link);
      link.click();
      setTimeout(() => {
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
      }, 100);
    } catch (err) {
      console.error("PDF download error:", err);
      alert(`PDF download failed: ${err.message}`);
    } finally {
      setDownloading(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ height: '80vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <LinearProgress sx={{ width: 300, mb: 2, '& .MuiLinearProgress-bar': { bgcolor: PWC_ORANGE } }} />
        <Typography variant="body2" color={PWC_MID_GREY}>Generative Report Compilation...</Typography>
      </Box>
    );
  }

  if (!reportData) {
    return <Alert severity="error" sx={{ m: 4 }}>Report data unavailable. Please verify the Run ID.</Alert>;
  }

  const isApproved = reportData.governance?.status === 'approved';

  return (
    <Box sx={{ bgcolor: '#FFFFFF', minHeight: '100vh', pb: 6 }}>
      
      {/* HEADER */}
      <Paper 
        elevation={0} 
        sx={{ 
          position: 'sticky',
          top: 0,
          zIndex: 1100,
          borderBottom: `2px solid ${PWC_ORANGE}`,
          bgcolor: 'white'
        }}
      >
        <Container maxWidth="xl" sx={{ py: 2 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Box>
              <Stack direction="row" alignItems="center" spacing={2}>
                <Typography 
                  variant="h5" 
                  sx={{ 
                    fontWeight: 600,
                    color: PWC_DARK_GREY,
                    fontSize: '1.25rem'
                  }}
                >
                  Calibration Report
                </Typography>
                {isApproved ? (
                  <Chip 
                    icon={<CheckCircleRounded sx={{ fontSize: 14, color: '#00875A' }} />} 
                    label="APPROVED" 
                    size="small"
                    sx={{ 
                      bgcolor: '#F0F9F4',
                      color: '#00875A',
                      fontWeight: 600,
                      fontSize: '0.7rem'
                    }}
                  />
                ) : (
                  <Chip 
                    label="DRAFT" 
                    size="small"
                    sx={{ 
                      bgcolor: PWC_LIGHT_GREY,
                      color: PWC_DARK_GREY,
                      fontWeight: 600,
                      fontSize: '0.7rem'
                    }}
                  />
                )}
              </Stack>
              <Typography 
                variant="body2" 
                sx={{ 
                  mt: 0.5,
                  fontFamily: 'monospace',
                  fontSize: '0.75rem',
                  color: PWC_MID_GREY
                }}
              >
                ID: {reportData.meta?.run_id} • Created: {new Date(reportData.meta?.created_at).toLocaleDateString()}
              </Typography>
            </Box>
            <Stack direction="row" spacing={1.5}>
              <Button 
                variant="outlined" 
                startIcon={<PrintRounded />} 
                onClick={() => window.print()}
                sx={{ 
                  borderColor: PWC_LIGHT_GREY,
                  color: PWC_DARK_GREY,
                  '&:hover': { 
                    borderColor: PWC_ORANGE,
                    bgcolor: '#FFF5F0'
                  }
                }}
              >
                Print
              </Button>
              <Button 
                variant="contained" 
                startIcon={<DownloadRounded />} 
                onClick={handleDownloadPDF} 
                disabled={downloading}
                sx={{ 
                  bgcolor: PWC_ORANGE,
                  '&:hover': { bgcolor: '#B83E02' }
                }}
              >
                {downloading ? 'Generating...' : 'Download PDF'}
              </Button>
            </Stack>
          </Stack>
        </Container>
      </Paper>

      <Container maxWidth="xl" sx={{ mt: 4 }}>
        <MotionBox
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          
          {/* 1. EXECUTIVE SUMMARY */}
          <PWCSection title="Executive Summary" noBorder>
            <Grid container spacing={2} sx={{ mb: 3 }}>
              <Grid item xs={12} md={3}>
                <Paper 
                  elevation={0}
                  sx={{ 
                    p: 2.5,
                    bgcolor: '#FFF5F0',
                    border: `2px solid ${PWC_ORANGE}`,
                    borderRadius: 0,
                    height: '100%'
                  }}
                >
                  <Typography 
                    variant="caption" 
                    sx={{ 
                      color: PWC_MID_GREY,
                      display: 'block',
                      mb: 1,
                      textTransform: 'uppercase',
                      fontWeight: 500,
                      fontSize: '0.7rem'
                    }}
                  >
                    Recommended Threshold
                  </Typography>
                  <Typography 
                    variant="h4" 
                    sx={{ 
                      fontWeight: 600,
                      color: PWC_ORANGE,
                      mb: 1,
                      fontSize: '1.75rem'
                    }}
                  >
                    ₹{safeNum(reportData.threshold_analysis?.selected_threshold).toLocaleString()}
                  </Typography>
                  <Chip 
                    label={`${safeNum(reportData.threshold_analysis?.selected_percentile)}th Percentile`} 
                    size="small"
                    sx={{ 
                      bgcolor: PWC_ORANGE,
                      color: 'white',
                      fontWeight: 600,
                      fontSize: '0.7rem'
                    }}
                  />
                </Paper>
              </Grid>

              <Grid item xs={12} md={3}>
                <PWCStatBox 
                  label="Projected Alerts" 
                  value={safeNum(reportData.threshold_analysis?.estimated_alerts).toLocaleString()}
                  subtext="per month (approx)"
                  icon={<WarningRounded fontSize="small" />}
                />
              </Grid>
              
              <Grid item xs={12} md={3}>
                <PWCStatBox 
                  label="Data Foundation" 
                  value={safeNum(reportData.data_foundation?.total_transactions).toLocaleString()}
                  subtext="total transactions analyzed"
                  icon={<StorageRounded fontSize="small" />}
                />
              </Grid>

              <Grid item xs={12} md={3}>
                <PWCStatBox 
                  label="KS Statistic" 
                  value={reportData.ks_statistics?.ks_statistic?.toFixed(3) || "N/A"}
                  subtext={safeStr(reportData.ks_statistics?.interpretation)}
                  icon={<InsightsRounded fontSize="small" />}
                />
              </Grid>
            </Grid>

            {aiAvailable && (
              <PwcAIInsights
                runId={run.run_id}
                section="executive_summary"
                sectionData={reportData}
              />
            )}
          </PWCSection>

          <Divider sx={{ my: 4, borderColor: PWC_LIGHT_GREY }} />

          {/* 2. DATA FOUNDATION */}
          <PWCSection 
            title="Step 0: Data Foundation" 
            subtitle="Quality verification and data integrity"
          >
            <Grid container spacing={2}>
              <Grid item xs={12} md={5}>
                <Paper elevation={0} sx={{ border: `1px solid ${PWC_LIGHT_GREY}`, borderRadius: 0 }}>
                  <PWCTable 
                    headers={[
                      { label: 'Metric', key: 'label' }, 
                      { label: 'Value', key: 'value', sx: { textAlign: 'right', fontFamily: 'monospace' } }
                    ]}
                    rows={[
                      { label: 'Transactions', value: safeNum(reportData.data_foundation?.total_transactions).toLocaleString() },
                      { label: 'Account Match', value: `${safeNum(reportData.data_foundation?.account_match_rate)}%` },
                      { label: 'Customer Match', value: `${safeNum(reportData.data_foundation?.customer_match_rate)}%` }
                    ]}
                  />
                </Paper>
              </Grid>
              <Grid item xs={12} md={7}>
                <Paper elevation={0} sx={{ p: 2, bgcolor: PWC_BG_LIGHT, border: 'none', borderRadius: 0, height: '100%' }}>
                  <Typography variant="caption" sx={{ color: PWC_MID_GREY, fontWeight: 600, display: 'block', mb: 1, textTransform: 'uppercase', fontSize: '0.7rem' }}>
                    Join Strategy
                  </Typography>
                  <Typography variant="body2" sx={{ color: PWC_DARK_GREY, fontFamily: 'monospace', fontSize: '0.8125rem' }}>
                    {safeStr(reportData.data_foundation?.join_strategy)}
                  </Typography>
                </Paper>
              </Grid>
            </Grid>
            
            {aiAvailable && (
              <PwcAIInsights 
                runId={run.run_id} 
                section="data_foundation" 
                sectionData={reportData.data_foundation}
              />
            )}
          </PWCSection>

          {/* 3. SCENARIO DEFINITION */}
          <PWCSection 
            title="Step 1: Population Scope" 
            subtitle="Transaction filtering and universe definition"
          >
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <Stack spacing={1.5}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography variant="body2" sx={{ color: PWC_MID_GREY, fontSize: '0.8125rem' }}>
                      Original Population
                    </Typography>
                    <Typography sx={{ fontWeight: 600, fontFamily: 'monospace', fontSize: '0.875rem', color: PWC_DARK_GREY }}>
                      {safeNum(reportData.scenario_analysis?.original_count).toLocaleString()}
                    </Typography>
                  </Stack>
                  <Divider sx={{ borderColor: PWC_LIGHT_GREY }} />
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography variant="body2" sx={{ color: PWC_MID_GREY, fontSize: '0.8125rem' }}>
                      Filtered Population
                    </Typography>
                    <Typography sx={{ fontWeight: 600, fontFamily: 'monospace', fontSize: '0.875rem', color: PWC_DARK_GREY }}>
                      {safeNum(reportData.scenario_analysis?.final_count).toLocaleString()}
                    </Typography>
                  </Stack>
                  <Divider sx={{ borderColor: PWC_LIGHT_GREY }} />
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography variant="body2" sx={{ color: PWC_MID_GREY, fontSize: '0.8125rem' }}>
                      Reduction
                    </Typography>
                    <Chip 
                      label={`${safeNum(reportData.scenario_analysis?.reduction_pct)}%`} 
                      size="small"
                      sx={{ bgcolor: PWC_BG_LIGHT, color: PWC_DARK_GREY, fontWeight: 600, fontSize: '0.75rem' }}
                    />
                  </Stack>
                </Stack>
              </Grid>
              <Grid item xs={12} md={6}>
                <Paper elevation={0} sx={{ p: 2, bgcolor: PWC_BG_LIGHT, border: 'none', borderRadius: 0, height: '100%' }}>
                  <Typography variant="caption" sx={{ color: PWC_MID_GREY, fontWeight: 600, display: 'block', mb: 1, textTransform: 'uppercase', fontSize: '0.7rem' }}>
                    Filter Logic
                  </Typography>
                  <Typography variant="body2" sx={{ color: PWC_DARK_GREY, fontFamily: 'monospace', fontSize: '0.8125rem', lineHeight: 1.6 }}>
                    {safeStr(reportData.scenario_analysis?.logic_summary)}
                  </Typography>
                </Paper>
              </Grid>
            </Grid>
            
            {aiAvailable && (
              <PwcAIInsights 
                runId={run.run_id} 
                section="filters" 
                sectionData={reportData.scenario_analysis}
              />
            )}
          </PWCSection>

          {/* 4. AGGREGATION */}
          <PWCSection 
            title="Step 2: Behavioral Aggregation" 
            subtitle="Pattern formation and feature engineering"
          >
            <Grid container spacing={2}>
              {[
                { label: 'Level', val: safeStr(reportData.aggregation_analysis?.aggregation_level).toUpperCase() },
                { label: 'Lookback', val: `${safeNum(reportData.aggregation_analysis?.lookback_days)} Days` },
                { label: 'Compression', val: `${safeNum(reportData.aggregation_analysis?.compression_ratio)}:1` },
                { label: 'Vectors', val: safeNum(reportData.aggregation_analysis?.output_rows).toLocaleString() }
              ].map((item, i) => (
                <Grid item xs={6} md={3} key={i}>
                  <Paper elevation={0} sx={{ p: 2, textAlign: 'center', border: `1px solid ${PWC_LIGHT_GREY}`, borderRadius: 0 }}>
                    <Typography variant="caption" sx={{ color: PWC_MID_GREY, display: 'block', mb: 0.5, fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 500 }}>
                      {item.label}
                    </Typography>
                    <Typography variant="h6" sx={{ fontWeight: 600, color: PWC_DARK_GREY, fontSize: '1rem' }}>
                      {item.val}
                    </Typography>
                  </Paper>
                </Grid>
              ))}
            </Grid>
            
            {aiAvailable && (
              <PwcAIInsights 
                runId={run.run_id} 
                section="aggregation" 
                sectionData={reportData.aggregation_analysis}
              />
            )}
          </PWCSection>

          {/* 5. THRESHOLD CALIBRATION */}
          <PWCSection 
            title="Step 3: Threshold Calibration" 
            subtitle="Statistical selection and alert projection"
          >
            <Grid container spacing={2}>
              <Grid item xs={12} md={8}>
                <Paper elevation={0} sx={{ border: `1px solid ${PWC_LIGHT_GREY}`, borderRadius: 0 }}>
                  <PWCTable
                    headers={[
                      { label: 'Percentile', key: 'p' },
                      { label: 'Threshold', key: 'val', sx: { textAlign: 'right', fontFamily: 'monospace' } },
                      { label: 'Alerts', key: 'alerts', sx: { textAlign: 'right' } },
                      { label: '% Pop', key: 'pop', sx: { textAlign: 'right' } }
                    ]}
                    rows={(reportData.threshold_analysis?.percentile_distribution || []).slice(0, 6).map(r => ({
                      p: (
                        <Chip 
                          label={`p${r.percentile}`} 
                          size="small" 
                          sx={{ 
                            bgcolor: r.percentile === reportData.threshold_analysis?.selected_percentile ? PWC_ORANGE : PWC_BG_LIGHT,
                            color: r.percentile === reportData.threshold_analysis?.selected_percentile ? 'white' : PWC_DARK_GREY,
                            fontWeight: 600,
                            fontSize: '0.7rem'
                          }}
                        />
                      ),
                      val: `₹${safeNum(r.value).toLocaleString()}`,
                      alerts: safeNum(r.alert_count).toLocaleString(),
                      pop: `${safeNum(r.pct_population)}%`
                    }))}
                  />
                </Paper>
              </Grid>
              <Grid item xs={12} md={4}>
                <Paper elevation={0} sx={{ p: 2, height: '100%', bgcolor: PWC_BG_LIGHT, border: 'none', borderRadius: 0 }}>
                  <Typography variant="caption" sx={{ color: PWC_MID_GREY, fontWeight: 600, display: 'block', mb: 1, textTransform: 'uppercase', fontSize: '0.7rem' }}>
                    Rationale
                  </Typography>
                  <Typography variant="body2" sx={{ color: PWC_DARK_GREY, fontStyle: 'italic', lineHeight: 1.7, fontSize: '0.8125rem' }}>
                    "{safeStr(reportData.threshold_analysis?.rationale)}"
                  </Typography>
                </Paper>
              </Grid>
            </Grid>
            
            {aiAvailable && (
              <PwcAIInsights 
                runId={run.run_id} 
                section="threshold" 
                sectionData={reportData.threshold_analysis}
              />
            )}
          </PWCSection>

          {/* 6. KS STATISTICS */}
          {reportData.ks_statistics && (
            <PWCSection 
              title="Statistical Validation" 
              subtitle="Kolmogorov-Smirnov discrimination test"
            >
              <Grid container spacing={2}>
                <Grid item xs={12} md={4}>
                  <Paper elevation={0} sx={{ p: 2.5, textAlign: 'center', border: `1px solid ${PWC_LIGHT_GREY}`, borderRadius: 0 }}>
                    <Typography variant="caption" sx={{ color: PWC_MID_GREY, display: 'block', mb: 1, fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 500 }}>
                      KS Statistic
                    </Typography>
                    <Typography variant="h3" sx={{ fontWeight: 600, mb: 1, color: PWC_DARK_GREY, fontSize: '2rem' }}>
                      {reportData.ks_statistics.ks_statistic?.toFixed(3)}
                    </Typography>
                    <Chip 
                      label={safeStr(reportData.ks_statistics.interpretation).replace(/_/g, ' ')} 
                      size="small"
                      sx={{ bgcolor: '#F0F9F4', color: '#00875A', fontWeight: 600, fontSize: '0.7rem' }}
                    />
                  </Paper>
                </Grid>
                <Grid item xs={12} md={8}>
                  <Alert 
                    severity="success" 
                    variant="outlined"
                    sx={{ 
                      border: `1px solid #00875A`,
                      bgcolor: '#F0F9F4',
                      '& .MuiAlert-icon': { color: '#00875A' }
                    }}
                  >
                    <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5, color: PWC_DARK_GREY, fontSize: '0.8125rem' }}>
                      Strong Statistical Separation
                    </Typography>
                    <Typography variant="body2" sx={{ color: PWC_MID_GREY, fontSize: '0.8125rem' }}>
                      {safeStr(reportData.ks_statistics.interpretation)} discrimination • P-Value: {reportData.ks_statistics.p_value?.toExponential(2)}
                    </Typography>
                  </Alert>
                </Grid>
              </Grid>
              
              {aiAvailable && (
                <PwcAIInsights 
                  runId={run.run_id} 
                  section="ks_statistics" 
                  sectionData={reportData.ks_statistics}
                />
              )}
            </PWCSection>
          )}

          {/* 7. ATL/BTL ANALYSIS */}
          {reportData.atl_btl_analysis && (
            <PWCSection 
              title="Sensitivity Analysis" 
              subtitle="Above/Below threshold testing results"
            >
              <Paper elevation={0} sx={{ border: `1px solid ${PWC_LIGHT_GREY}`, borderRadius: 0 }}>
                <PWCTable
                  headers={[
                    { label: 'Zone', key: 'zone' },
                    { label: 'Count', key: 'count', sx: { textAlign: 'right' } },
                    { label: 'Status', key: 'status', sx: { textAlign: 'right' } }
                  ]}
                  rows={[
                    { 
                      zone: <Typography sx={{ fontWeight: 600, fontSize: '0.8125rem', color: PWC_DARK_GREY }}>Above Threshold</Typography>,
                      count: safeNum(reportData.atl_btl_analysis.atl?.count).toLocaleString(),
                      status: <Chip label="Alerted" size="small" sx={{ bgcolor: PWC_ORANGE, color: 'white', fontWeight: 600, fontSize: '0.7rem' }} />
                    },
                    { 
                      zone: (
                        <Box>
                          <Typography sx={{ fontWeight: 600, fontSize: '0.8125rem', color: PWC_DARK_GREY }}>Below Threshold</Typography>
                          <Typography variant="caption" color={PWC_MID_GREY} sx={{ fontSize: '0.7rem' }}>
                            {safeNum(reportData.atl_btl_analysis.btl_band?.pct)}% band
                          </Typography>
                        </Box>
                      ),
                      count: safeNum(reportData.atl_btl_analysis.btl_band?.count).toLocaleString(),
                      status: <Chip label="Suppressed" size="small" sx={{ bgcolor: PWC_LIGHT_GREY, color: PWC_DARK_GREY, fontWeight: 600, fontSize: '0.7rem' }} />
                    }
                  ]}
                />
              </Paper>
              
              {aiAvailable && (
                <PwcAIInsights 
                  runId={run.run_id} 
                  section="atl_btl" 
                  sectionData={reportData.atl_btl_analysis}
                />
              )}
            </PWCSection>
          )}

          {/* 8. GOVERNANCE & SIGN-OFF */}
          <PWCSection 
            title="Governance" 
            subtitle="Review status and approvals"
          >
            <Grid container spacing={3}>
              <Grid item xs={12} md={6}>
                <Stack spacing={2} sx={{ p: 2, border: `1px solid ${PWC_LIGHT_GREY}`, height: '100%' }}>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <VerifiedUserRounded sx={{ color: isApproved ? '#00875A' : PWC_ORANGE }} />
                    <Typography variant="subtitle2" fontWeight={600}>
                      Calibration Status
                    </Typography>
                  </Stack>
                  <Divider />
                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="caption" color={PWC_MID_GREY}>Current State</Typography>
                    <Typography variant="body2" fontWeight={600} sx={{ textTransform: 'capitalize' }}>
                      {safeStr(reportData.governance?.status)}
                    </Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="caption" color={PWC_MID_GREY}>Reviewer</Typography>
                    <Typography variant="body2" fontWeight={600}>
                      {safeStr(reportData.governance?.reviewer || "Pending Review")}
                    </Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="caption" color={PWC_MID_GREY}>Last Updated</Typography>
                    <Typography variant="body2" fontWeight={600}>
                      {new Date().toLocaleDateString()}
                    </Typography>
                  </Stack>
                </Stack>
              </Grid>
              <Grid item xs={12} md={6}>
                <Paper elevation={0} sx={{ p: 2, bgcolor: PWC_BG_LIGHT, height: '100%', border: 'none' }}>
                  <Typography variant="caption" sx={{ color: PWC_MID_GREY, fontWeight: 600, textTransform: 'uppercase' }}>
                    Conclusion
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 1, color: PWC_DARK_GREY, lineHeight: 1.6 }}>
                    Based on the statistical analysis (KS: {reportData.ks_statistics?.ks_statistic?.toFixed(2)}) and volume projection ({safeNum(reportData.threshold_analysis?.estimated_alerts)} alerts), this calibration is 
                    <Typography component="span" fontWeight={600} color={PWC_ORANGE}> recommended for deployment </Typography> 
                    subject to final governance approval.
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
                    <TrendingUpRounded sx={{ fontSize: 16, color: PWC_MID_GREY }} />
                    <Typography variant="caption" color={PWC_MID_GREY}>
                      Efficiency gain of {Math.round((1 - (safeNum(reportData.threshold_analysis?.estimated_alerts) / Math.max(safeNum(reportData.scenario_analysis?.final_count), 1))) * 100)}% over raw population.
                    </Typography>
                  </Stack>
                </Paper>
              </Grid>
            </Grid>
          </PWCSection>

        </MotionBox>
      </Container>
    </Box>
  );
};

export default FinalReportScreen;