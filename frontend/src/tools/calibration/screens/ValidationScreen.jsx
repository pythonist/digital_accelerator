import React, { useState, useEffect } from 'react';
import {
  Box, Paper, Typography, Grid, Button, Card, CardContent,
  LinearProgress, Alert, Chip, Stack, Divider, Tabs, Tab, Checkbox, FormControlLabel
} from '@mui/material';
import {
  CheckCircle, Warning, Info, TrendingUp, Speed, ErrorOutline
} from '@mui/icons-material';
import { useCalibration } from "../context/CalibrationContext";
import { useAppContext } from '@context/AppContext';
import PageContainer from '../layout/PageContainer';

const TOOL_HEADER_HEIGHT = 56;

// Styled Cards matching AggregationScreen
const InfoCard = ({ title, subtitle, icon, children }) => (
  <Paper sx={{ p: 2.5, border: '1px solid', borderColor: 'divider', position: 'relative', overflow: 'hidden' }}>
    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
      {icon && <Box sx={{ color: 'primary.main', display: 'flex' }}>{icon}</Box>}
      <Box>
        <Typography variant="subtitle2" fontWeight="600">{title}</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.2 }}>
          {subtitle}
        </Typography>
      </Box>
    </Stack>
    {children}
  </Paper>
);

const ValidationScreen = () => {
  const { run, goToStep } = useCalibration();
  const { activeEnv } = useAppContext();
  
  const [loading, setLoading] = useState(true);
  const [explanation, setExplanation] = useState(null);
  const [activeTab, setActiveTab] = useState(0);
  
  // User confirmation checkboxes
  const [userChecks, setUserChecks] = useState({
    step1Reviewed: false,
    step2Reviewed: false,
    validationPassed: false
  });
  
  useEffect(() => {
    if (run?.run_id && activeEnv) {
      loadExplanation();
    }
  }, [run?.run_id, activeEnv]);
  
  const loadExplanation = async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/v2/calibration/validation/${run.run_id}/explanation?env_id=${activeEnv}`
      );
      const data = await response.json();
      
      if (data.success) {
        setExplanation(data);
      }
    } catch (error) {
      console.error('Failed to load explanation:', error);
    } finally {
      setLoading(false);
    }
  };
  
  const handleContinue = async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/v2/calibration/validation/${run.run_id}/advance`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ env_id: activeEnv })
        }
      );
      
      if (response.ok) {
        goToStep('calibration');
      }
    } catch (error) {
      console.error('Failed to advance:', error);
    } finally {
      setLoading(false);
    }
  };
  
  if (loading && !explanation) {
    return (
      <PageContainer
        title="Step 2.5: Validation"
        subtitle="Loading validation analysis..."
        maxWidth={false}
      >
        <LinearProgress />
      </PageContainer>
    );
  }
  
  const step1 = explanation?.step1 || {};
  const step2 = explanation?.step2 || {};
  const validation = explanation?.validation || {};
  
  // Compute validation gates (Visual only - not blocking)
  const validationGates = {
    minDataVolume: (validation.stats?.row_count || 0) >= 100,
    qualityScore: (validation.stats?.quality_score || 0) >= 60,
    noHighSeverityWarnings: !validation.warnings?.some(w => w.severity === 'high'),
    hasData: (validation.stats?.row_count || 0) > 0
  };
  
  const allGatesPassed = Object.values(validationGates).every(gate => gate);
  const allUserChecksComplete = Object.values(userChecks).every(check => check);
  
  // ✅ FIX: Allow proceeding even if gates fail, as long as user confirms checks
  const canProceed = allUserChecksComplete && !loading;
  
  return (
    <PageContainer
      title="Step 2.5: Validation & Data Explanation"
      subtitle="Review how your calibration population was constructed"
      maxWidth={false}
    >
      <Box sx={{ 
        height: `calc(100vh - ${TOOL_HEADER_HEIGHT}px)`,
        overflowY: 'auto',
        p: 3
      }}>
        
        {/* Warnings */}
        {validation.warnings?.length > 0 && (
          <Box sx={{ mb: 3 }}>
            {validation.warnings.map((warning, idx) => (
              <Alert
                key={idx}
                severity={warning.severity === 'high' ? 'error' : warning.severity === 'medium' ? 'warning' : 'info'}
                icon={warning.severity === 'high' ? <Warning /> : warning.severity === 'medium' ? <Info /> : <CheckCircle />}
                sx={{ mb: 1 }}
              >
                <Typography variant="body2" fontWeight="600" gutterBottom>
                  {warning.message}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  💡 Recommendation: {warning.recommendation}
                </Typography>
              </Alert>
            ))}
          </Box>
        )}
        
        {/* Validation Gates */}
        <Paper sx={{ p: 2.5, mb: 3, border: '1px solid', borderColor: 'divider' }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
            <Box>
                <Typography variant="subtitle2" fontWeight="600" gutterBottom>
                    Validation Analysis
                </Typography>
                <Typography variant="caption" color="text.secondary">
                    Automatic health checks for your population
                </Typography>
            </Box>
            {!allGatesPassed && (
                <Chip 
                    label="Risks Detected" 
                    color="warning" 
                    size="small" 
                    icon={<Warning />} 
                    variant="outlined" 
                />
            )}
          </Stack>
          
          <Grid container spacing={2}>
            <Grid item xs={6}>
              <Stack direction="row" alignItems="center" spacing={1}>
                {validationGates.minDataVolume ? (
                  <CheckCircle fontSize="small" color="success" />
                ) : (
                  <Warning fontSize="small" color="warning" />
                )}
                <Typography variant="body2" color={validationGates.minDataVolume ? 'text.primary' : 'text.secondary'}>
                  Minimum Data Volume (≥100 rows)
                </Typography>
              </Stack>
            </Grid>
            
            <Grid item xs={6}>
              <Stack direction="row" alignItems="center" spacing={1}>
                {validationGates.qualityScore ? (
                  <CheckCircle fontSize="small" color="success" />
                ) : (
                  <Warning fontSize="small" color="warning" />
                )}
                <Typography variant="body2" color={validationGates.qualityScore ? 'text.primary' : 'text.secondary'}>
                  Quality Score (≥60%)
                </Typography>
              </Stack>
            </Grid>
            
            <Grid item xs={6}>
              <Stack direction="row" alignItems="center" spacing={1}>
                {validationGates.noHighSeverityWarnings ? (
                  <CheckCircle fontSize="small" color="success" />
                ) : (
                  <ErrorOutline fontSize="small" color="error" />
                )}
                <Typography variant="body2" color={validationGates.noHighSeverityWarnings ? 'text.primary' : 'text.secondary'}>
                  No High Severity Issues
                </Typography>
              </Stack>
            </Grid>
            
            <Grid item xs={6}>
              <Stack direction="row" alignItems="center" spacing={1}>
                {validationGates.hasData ? (
                  <CheckCircle fontSize="small" color="success" />
                ) : (
                  <ErrorOutline fontSize="small" color="error" />
                )}
                <Typography variant="body2" color={validationGates.hasData ? 'text.primary' : 'text.secondary'}>
                  Data Available
                </Typography>
              </Stack>
            </Grid>
          </Grid>
          
          {!allGatesPassed && (
            <Alert severity="warning" sx={{ mt: 2, bgcolor: 'warning.50' }}>
              Validation gates indicate potential issues. You may proceed, but results might be unstable.
            </Alert>
          )}
        </Paper>
        
        {/* Tabs */}
        <Paper sx={{ mb: 3 }}>
          <Tabs 
            value={activeTab} 
            onChange={(e, v) => setActiveTab(v)}
            sx={{ borderBottom: 1, borderColor: 'divider' }}
          >
            <Tab label="Step 1: Population Filters" icon={<CheckCircle fontSize="small" />} iconPosition="start" />
            <Tab label="Step 2: Aggregation Logic" icon={<TrendingUp fontSize="small" />} iconPosition="start" />
            <Tab label="Validation Results" icon={<Speed fontSize="small" />} iconPosition="start" />
          </Tabs>
        </Paper>
        
        {/* Tab Content */}
        
        {/* STEP 1: Population */}
        {activeTab === 0 && (
          <Grid container spacing={3}>
            <Grid item xs={12}>
              <InfoCard
                title="What was selected?"
                subtitle={step1.description}
                icon={<CheckCircle />}
              >
                <Box sx={{ mt: 2 }}>
                  <Grid container spacing={2}>
                    <Grid item xs={6}>
                      <Card variant="outlined">
                        <CardContent>
                          <Typography variant="caption" color="text.secondary">
                            Raw Population Count
                          </Typography>
                          <Typography variant="h4" color="primary" fontWeight="700">
                            {step1.raw_population_count?.toLocaleString() || '0'}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            Transactions after filtering
                          </Typography>
                        </CardContent>
                      </Card>
                    </Grid>
                  </Grid>
                </Box>
              </InfoCard>
            </Grid>
            
            <Grid item xs={12}>
              <InfoCard
                title="Filters Applied"
                subtitle="Population selection criteria"
              >
                {step1.filters_applied?.length > 0 ? (
                  <Stack spacing={1.5} sx={{ mt: 2 }}>
                    {step1.filters_applied.map((filter, idx) => (
                      <Paper
                        key={idx}
                        variant="outlined"
                        sx={{ p: 2, borderLeft: '4px solid', borderLeftColor: 'primary.main' }}
                      >
                        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                          <Typography variant="subtitle2" fontWeight="600">
                            {filter.type}
                          </Typography>
                          <Chip label={filter.value} color="primary" size="small" />
                        </Stack>
                        <Typography variant="body2" color="text.secondary">
                          {filter.impact}
                        </Typography>
                      </Paper>
                    ))}
                  </Stack>
                ) : (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                    No filters applied - using all data
                  </Typography>
                )}
              </InfoCard>
            </Grid>
          </Grid>
        )}
        
        {/* STEP 2: Aggregation */}
        {activeTab === 1 && (
          <Grid container spacing={3}>
            <Grid item xs={12}>
              <InfoCard
                title="How was data transformed?"
                subtitle={step2.summary}
                icon={<TrendingUp />}
              >
                <Grid container spacing={2} sx={{ mt: 1 }}>
                  <Grid item xs={3}>
                    <Card variant="outlined">
                      <CardContent>
                        <Typography variant="caption" color="text.secondary">Input Rows</Typography>
                        <Typography variant="h5" fontWeight="700">
                          {step2.compression_stats?.input_rows?.toLocaleString() || '0'}
                        </Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                  
                  <Grid item xs={3}>
                    <Card variant="outlined">
                      <CardContent>
                        <Typography variant="caption" color="text.secondary">Output Rows</Typography>
                        <Typography variant="h5" color="primary" fontWeight="700">
                          {step2.compression_stats?.output_rows?.toLocaleString() || '0'}
                        </Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                  
                  <Grid item xs={3}>
                    <Card variant="outlined">
                      <CardContent>
                        <Typography variant="caption" color="text.secondary">Compression</Typography>
                        <Typography variant="h5" color="success.main" fontWeight="700">
                          {step2.compression_stats?.compression_ratio || '0'}x
                        </Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                  
                  <Grid item xs={3}>
                    <Card variant="outlined">
                      <CardContent>
                        <Typography variant="caption" color="text.secondary">Unique Entities</Typography>
                        <Typography variant="h5" fontWeight="700">
                          {step2.compression_stats?.unique_entities?.toLocaleString() || '0'}
                        </Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                </Grid>
              </InfoCard>
            </Grid>
            
            <Grid item xs={12}>
              <InfoCard
                title="Aggregation Process"
                subtitle="Step-by-step transformation"
              >
                <Stack spacing={1.5} sx={{ mt: 2 }}>
                  {step2.process_steps?.map((step, idx) => (
                    <Paper
                      key={idx}
                      variant="outlined"
                      sx={{ p: 2, borderLeft: '4px solid', borderLeftColor: 'primary.main' }}
                    >
                      <Typography variant="caption" color="text.secondary">
                        Step {idx + 1}: {step.step}
                      </Typography>
                      <Typography variant="subtitle2" color="primary" fontWeight="600" sx={{ mb: 0.5 }}>
                        {step.value}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {step.description}
                      </Typography>
                    </Paper>
                  ))}
                </Stack>
              </InfoCard>
            </Grid>
            
            <Grid item xs={12}>
              <InfoCard
                title="Metrics Calculated"
                subtitle="Aggregated measures"
              >
                <Stack spacing={1} sx={{ mt: 2 }}>
                  {Object.entries(step2.metrics_calculated || {}).map(([key, desc]) => (
                    <Paper key={key} variant="outlined" sx={{ p: 1.5 }}>
                      <Typography variant="subtitle2" color="primary" fontWeight="600" sx={{ textTransform: 'uppercase' }}>
                        {key.replace('_', ' ')}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {desc}
                      </Typography>
                    </Paper>
                  ))}
                </Stack>
              </InfoCard>
            </Grid>
          </Grid>
        )}
        
        {/* VALIDATION: Results */}
        {activeTab === 2 && (
          <Grid container spacing={3}>
            <Grid item xs={12}>
              <InfoCard
                title="Final Calibration Population"
                subtitle="Ready for threshold tuning"
                icon={<Speed />}
              >
                <Grid container spacing={2} sx={{ mt: 1 }}>
                  <Grid item xs={3}>
                    <Card variant="outlined">
                      <CardContent>
                        <Typography variant="caption" color="text.secondary">Total Rows</Typography>
                        <Typography variant="h5" fontWeight="700">
                          {validation.stats?.row_count?.toLocaleString() || '-'}
                        </Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                  
                  <Grid item xs={3}>
                    <Card variant="outlined">
                      <CardContent>
                        <Typography variant="caption" color="text.secondary">Unique Entities</Typography>
                        <Typography variant="h5" fontWeight="700">
                          {validation.stats?.unique_entities?.toLocaleString() || '-'}
                        </Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                  
                  <Grid item xs={3}>
                    <Card variant="outlined">
                      <CardContent>
                        <Typography variant="caption" color="text.secondary">Max Value</Typography>
                        <Typography variant="h5" color="primary" fontWeight="700">
                          ₹{(validation.stats?.amount_stats?.max || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                  
                  <Grid item xs={3}>
                    <Card variant="outlined">
                      <CardContent>
                        <Typography variant="caption" color="text.secondary">Avg Value</Typography>
                        <Typography variant="h5" fontWeight="700">
                          ₹{(validation.stats?.amount_stats?.mean || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                </Grid>
              </InfoCard>
            </Grid>
            
            {validation.stats?.data_quality && (
              <Grid item xs={12}>
                <InfoCard
                  title="Data Quality Analysis"
                  subtitle="Population health metrics"
                >
                  <Grid container spacing={2} sx={{ mt: 1 }}>
                    <Grid item xs={6}>
                      <Card variant="outlined">
                        <CardContent>
                          <Typography variant="caption" color="text.secondary">Null Values</Typography>
                          <Typography variant="h6" fontWeight="700">
                            {validation.stats.data_quality.null_count}{' '}
                            <Typography component="span" variant="body2" color="text.secondary">
                              ({validation.stats.data_quality.null_pct}%)
                            </Typography>
                          </Typography>
                        </CardContent>
                      </Card>
                    </Grid>
                    
                    <Grid item xs={6}>
                      <Card variant="outlined">
                        <CardContent>
                          <Typography variant="caption" color="text.secondary">Zero Values</Typography>
                          <Typography variant="h6" fontWeight="700">
                            {validation.stats.data_quality.zero_count}{' '}
                            <Typography component="span" variant="body2" color="text.secondary">
                              ({validation.stats.data_quality.zero_pct}%)
                            </Typography>
                          </Typography>
                        </CardContent>
                      </Card>
                    </Grid>
                  </Grid>
                  
                  <Box sx={{ mt: 3 }}>
                    <Typography variant="caption" color="text.secondary" gutterBottom>
                      Quality Score
                    </Typography>
                    <Stack direction="row" spacing={2} alignItems="center">
                      <Box sx={{ flex: 1 }}>
                        <LinearProgress
                          variant="determinate"
                          value={validation.stats?.quality_score || 0}
                          sx={{
                            height: 12,
                            borderRadius: 1,
                            bgcolor: 'grey.200',
                            '& .MuiLinearProgress-bar': {
                              bgcolor: validation.stats?.quality_score >= 80 ? 'success.main' : 
                                       validation.stats?.quality_score >= 60 ? 'warning.main' : 'error.main'
                            }
                          }}
                        />
                      </Box>
                      <Typography variant="h6" fontWeight="700">
                        {validation.stats?.quality_score || 0}%
                      </Typography>
                    </Stack>
                  </Box>
                </InfoCard>
              </Grid>
            )}
            
            {validation.stats?.outlier_analysis && (
              <Grid item xs={12}>
                <InfoCard
                  title="Distribution Analysis"
                  subtitle="Outlier detection"
                >
                  <Grid container spacing={2} sx={{ mt: 1 }}>
                    <Grid item xs={4}>
                      <Card variant="outlined">
                        <CardContent>
                          <Typography variant="caption" color="text.secondary">1st Percentile</Typography>
                          <Typography variant="h6" fontWeight="700">
                            ₹{validation.stats.outlier_analysis.p1?.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </Typography>
                        </CardContent>
                      </Card>
                    </Grid>
                    
                    <Grid item xs={4}>
                      <Card variant="outlined">
                        <CardContent>
                          <Typography variant="caption" color="text.secondary">99th Percentile</Typography>
                          <Typography variant="h6" fontWeight="700">
                            ₹{validation.stats.outlier_analysis.p99?.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </Typography>
                        </CardContent>
                      </Card>
                    </Grid>
                    
                    <Grid item xs={4}>
                      <Card variant="outlined">
                        <CardContent>
                          <Typography variant="caption" color="text.secondary">Outlier Ratio</Typography>
                          <Typography variant="h6" fontWeight="700">
                            {(validation.stats.outlier_analysis.outlier_ratio * 100).toFixed(2)}%
                          </Typography>
                        </CardContent>
                      </Card>
                    </Grid>
                  </Grid>
                </InfoCard>
              </Grid>
            )}
          </Grid>
        )}
        
        {/* Footer Actions */}
        <Paper sx={{ p: 2.5, mb: 3, border: '1px solid', borderColor: 'divider', bgcolor: 'grey.50' }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
             <Box>
                <Typography variant="subtitle2" fontWeight="600" gutterBottom>
                    User Confirmation
                </Typography>
                <Typography variant="caption" color="text.secondary">
                    Review and acknowledge population readiness
                </Typography>
             </Box>
             {!allUserChecksComplete && (
                 <Chip label="Required" size="small" color="primary" variant="outlined" />
             )}
          </Stack>
          
          <Stack spacing={1.5}>
            {/* Step 1 Check */}
            <Stack 
              direction="row" 
              alignItems="center" 
              spacing={1}
              sx={{ 
                p: 1.5, 
                bgcolor: 'white', 
                borderRadius: 1,
                border: '1px solid',
                borderColor: userChecks.step1Reviewed ? 'success.main' : 'divider',
                cursor: 'pointer',
                transition: 'all 0.2s',
                '&:hover': { borderColor: 'primary.main' }
              }}
              onClick={() => setUserChecks(prev => ({ ...prev, step1Reviewed: !prev.step1Reviewed }))}
            >
              <Checkbox
                checked={userChecks.step1Reviewed}
                size="small"
                color="success"
              />
              <Typography variant="body2">
                I have reviewed <strong>Step 1: Population Filters</strong> and confirm the selection criteria are correct
              </Typography>
            </Stack>
            
            {/* Step 2 Check */}
            <Stack 
              direction="row" 
              alignItems="center" 
              spacing={1}
              sx={{ 
                p: 1.5, 
                bgcolor: 'white', 
                borderRadius: 1,
                border: '1px solid',
                borderColor: userChecks.step2Reviewed ? 'success.main' : 'divider',
                cursor: 'pointer',
                transition: 'all 0.2s',
                '&:hover': { borderColor: 'primary.main' }
              }}
              onClick={() => setUserChecks(prev => ({ ...prev, step2Reviewed: !prev.step2Reviewed }))}
            >
              <Checkbox
                checked={userChecks.step2Reviewed}
                size="small"
                color="success"
              />
              <Typography variant="body2">
                I have reviewed <strong>Step 2: Aggregation Logic</strong> and confirm the transformation is appropriate
              </Typography>
            </Stack>
            
            {/* Validation Check */}
            <Stack 
              direction="row" 
              alignItems="center" 
              spacing={1}
              sx={{ 
                p: 1.5, 
                bgcolor: 'white', 
                borderRadius: 1,
                border: '1px solid',
                borderColor: userChecks.validationPassed ? 'success.main' : 'divider',
                cursor: 'pointer',
                transition: 'all 0.2s',
                '&:hover': { borderColor: 'primary.main' }
              }}
              onClick={() => setUserChecks(prev => ({ ...prev, validationPassed: !prev.validationPassed }))}
            >
              <Checkbox
                checked={userChecks.validationPassed}
                size="small"
                color="success"
              />
              <Typography variant="body2">
                I have reviewed the <strong>Validation Results</strong> and accept the population for calibration
              </Typography>
            </Stack>
          </Stack>
        </Paper>
        
        {/* Navigation Buttons */}
        <Stack direction="row" justifyContent="space-between" sx={{ mt: 4, pt: 3, borderTop: 1, borderColor: 'divider' }}>
          <Button
            variant="outlined"
            onClick={() => goToStep('aggregation')}
            disabled={loading}
          >
            ← Back to Aggregation
          </Button>
          
          <Stack direction="row" spacing={2} alignItems="center">
            {!allUserChecksComplete && (
                <Typography variant="caption" color="text.secondary">
                    Please complete all confirmation checks
                </Typography>
            )}
            
            <Button
              variant="contained"
              onClick={handleContinue}
              disabled={!canProceed}
              color={!allGatesPassed && canProceed ? "warning" : "primary"}
              size="large"
              startIcon={canProceed ? <CheckCircle /> : <Warning />}
            >
              {loading ? 'Processing...' : 
               !allGatesPassed ? 'Proceed with Risks →' : 
               'Proceed to Calibration →'}
            </Button>
          </Stack>
        </Stack>
      </Box>
    </PageContainer>
  );
};

export default ValidationScreen;