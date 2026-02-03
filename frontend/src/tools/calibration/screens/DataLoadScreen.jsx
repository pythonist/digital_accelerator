import React, { useState, useEffect } from 'react';
import {
  Box, Paper, Typography, Button, Stepper, Step, StepLabel,
  Card, CardContent, Alert, CircularProgress, Grid,
  Select, MenuItem, Chip, Stack, Divider, Fade
} from '@mui/material';
import {
  CloudUpload, Storage, CheckCircle, ArrowForward, Save, Build,
  PlayArrow, Refresh, Visibility, Warning, VerifiedUser
} from '@mui/icons-material';
import { useCalibration } from "../context/CalibrationContext";
import { useAppContext } from '@context/AppContext';
import apiClient from '@services/api';
import PageContainer from '../layout/PageContainer';
import MasterDataJoinVisualizer from '../screens/MasterDataJoinVisualizer';

const REQUIRED_FILES = [
  { key: 'transactions', label: 'Transactions', description: 'Transaction-level ledger data' },
  { key: 'accounts', label: 'Accounts', description: 'Account attributes and status' },
  { key: 'customers', label: 'Customers', description: 'KYC and demographic info' }
];

const DataLoadScreen = () => {
  const { activeEnv } = useAppContext();
  const { createRun } = useCalibration();

  // --- STATE: STR SPECIFIC ---
  const [strFile, setStrFile] = useState(null);
  const [strUploading, setStrUploading] = useState(false);
  const [strStats, setStrStats] = useState(null);

  // --- STATE: GENERAL ---
  const [activeStep, setActiveStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Data Stats
  const [stats, setStats] = useState({ transactions: 0, accounts: 0, customers: 0 });
  
  // Mapping State
  const [schemaOptions, setSchemaOptions] = useState(null);
  const [canonicalFields, setCanonicalFields] = useState(null);
  const [mapping, setMapping] = useState({ transactions: {}, accounts: {}, customers: {} });

  // Validation Results
  const [validationResult, setValidationResult] = useState(null);
  const [readiness, setReadiness] = useState(null);

  // --- INITIALIZATION ---
  useEffect(() => {
    if (activeEnv) {
      refreshAllData();
      loadSTRStats();
    }
  }, [activeEnv]);

  const refreshAllData = async () => {
    try {
      // 1. Fetch Stats & Readiness
      const statsRes = await apiClient.get('/api/v2/calibration/data/stats', { params: { env_id: activeEnv } });
      if (statsRes.success) {
        setStats(statsRes.stats);
        setReadiness(statsRes.readiness);
        
        // Load validation results if they exist
        if (statsRes.join_report && statsRes.join_report.length > 0) {
            setValidationResult({
              validation_results: statsRes.join_report,
              overall_quality: 'GOOD' 
            });
        }

        const r = statsRes.readiness;
        const s = statsRes.stats;

        // Auto-navigate Logic
        if (r?.is_ready || r?.conditions?.joins_validated) {
           setActiveStep(2);
        } else if (r?.conditions?.mapping_completed) {
           setActiveStep(2);
        } else if (s.transactions > 0 && s.accounts > 0 && s.customers > 0) {
           setActiveStep(1);
        } else {
           setActiveStep(0);
        }
      }

      // 2. Fetch Mapping Options
      const optsRes = await apiClient.get('/api/v2/calibration/data/mapping/options', { params: { env_id: activeEnv } });
      if (optsRes.success) {
        setSchemaOptions(optsRes.source_columns);
        setCanonicalFields(optsRes.canonical_fields);
      }
      
      // 3. Fetch Existing Mapping
      const mapRes = await apiClient.get('/api/v2/calibration/data/mapping', { params: { env_id: activeEnv } });
      if (mapRes.success && mapRes.mapping) setMapping(mapRes.mapping);

    } catch (err) {
      console.error(err);
    }
  };

  const loadSTRStats = async () => {
    try {
      const res = await apiClient.get('/api/v2/calibration/data/str-stats', {
        params: { env_id: activeEnv }
      });
      if (res.success && res.uploaded) {
        setStrStats(res);
      }
    } catch (err) {
      console.warn('STR stats not available:', err);
    }
  };

  // --- ACTIONS: GENERAL UPLOAD ---
  const handleFileUpload = async (fileKey, file) => {
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('table_name', fileKey);
    formData.append('env_id', activeEnv);

    setLoading(true); setError(''); setSuccessMsg('');
    try {
      await apiClient.postForm('/api/v2/calibration/data/upload', formData);
      setSuccessMsg(`Successfully uploaded ${fileKey}`);
      refreshAllData();
    } catch (err) { setError(err.message || 'Upload failed'); } 
    finally { setLoading(false); }
  };

  // --- ACTIONS: STR UPLOAD ---
  const handleSTRUpload = async (file) => {
    if (!file) return;
    
    setStrUploading(true);
    setError('');
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('env_id', activeEnv);
    
    try {
      const res = await apiClient.postForm('/api/v2/calibration/data/upload-str', formData);
      
      setSuccessMsg(`✅ Uploaded ${res.rows_inserted} STR records`);
      setStrStats(res);
      console.log('STR upload success:', res);
      
    } catch (err) {
      setError(`STR upload failed: ${err.response?.data?.error || err.message}`);
    } finally {
      setStrUploading(false);
    }
  };

  // --- ACTIONS: MAPPING & VALIDATION ---
  const saveMapping = async () => {
    // Client-side Validation
    if (canonicalFields) {
      for (const table of ['transactions', 'accounts', 'customers']) {
        const missing = canonicalFields[table].filter(f => f.required && !mapping[table]?.[f.key]);
        if (missing.length > 0) {
          setError(`Missing required mapping in ${table}: ${missing[0].label}`);
          return;
        }
      }
    }

    setLoading(true); setError('');
    try {
      const res = await apiClient.post('/api/v2/calibration/data/mapping', { env_id: activeEnv, mapping });
      if (res.success) {
        setSuccessMsg("Mapping saved successfully!");
        setActiveStep(2);
        refreshAllData();
      }
    } catch (err) { setError(err.message); } 
    finally { setLoading(false); }
  };

  const validateJoins = async () => {
    setLoading(true); setError(''); setValidationResult(null);
    try {
      const res = await apiClient.post('/api/v2/calibration/data/validate-joins', { env_id: activeEnv });
      if (res.success) {
        setValidationResult(res);
        setSuccessMsg("Join validation complete!");
        refreshAllData();
      }
    } catch (err) { setError(err.message); } 
    finally { setLoading(false); }
  };

  const handleStartScenario = async () => {
    try {
      await createRun(`Scenario Run - ${new Date().toLocaleString()}`);
    } catch (err) { setError(err.message); }
  };

  // --- RENDER STEPS ---

  const renderUploadStep = () => (
    <Box sx={{ mt: 2 }}>
      <Grid container spacing={3}>
        {/* 1. REQUIRED FILES */}
        {REQUIRED_FILES.map((file) => {
          const count = stats[file.key] || 0;
          const isUploaded = count > 0;
          return (
            <Grid item xs={12} md={4} key={file.key}>
              <Card variant="outlined" sx={{ height: '100%', bgcolor: isUploaded ? 'success.50' : 'background.paper' }}>
                <CardContent sx={{ textAlign: 'center' }}>
                  <Box sx={{ mb: 2 }}>{isUploaded ? <CheckCircle color="success" fontSize="large"/> : <CloudUpload color="action" fontSize="large"/>}</Box>
                  <Typography variant="h6">{file.label}</Typography>
                  <Typography variant="caption" display="block" sx={{ mb: 2 }}>{file.description}</Typography>
                  {isUploaded && <Chip label={`${count.toLocaleString()} rows`} color="success" size="small" sx={{ mb: 2 }} />}
                  <Button variant={isUploaded ? "outlined" : "contained"} component="label" disabled={loading} fullWidth>
                    {isUploaded ? "Replace File" : "Upload File"}
                    <input type="file" hidden accept=".csv" onChange={(e) => handleFileUpload(file.key, e.target.files[0])} />
                  </Button>
                </CardContent>
              </Card>
            </Grid>
          );
        })}

        {/* 2. OPTIONAL STR FILE */}
        <Grid item xs={12} md={12}>
          <Card 
            variant="outlined" 
            sx={{ 
              bgcolor: strStats?.uploaded ? '#E8F5E9' : '#FFF9E6',
              border: '2px dashed',
              borderColor: strStats?.uploaded ? 'success.main' : 'warning.main'
            }}
          >
            <CardContent>
              <Stack direction="row" spacing={2} alignItems="center">
                <Box sx={{ flex: 1 }}>
                  <Stack direction="row" alignItems="center" spacing={1} mb={1}>
                    <Typography variant="h6">
                      STR Data (Optional)
                    </Typography>
                    <Chip 
                      label="Ground Truth" 
                      size="small" 
                      color="info" 
                      variant="outlined"
                    />
                  </Stack>
                  
                  <Typography variant="body2" color="text.secondary" mb={1}>
                    Upload Suspicious Transaction Reports for post-investigation evaluation.
                    This data is used ONLY in Step 3 to measure threshold effectiveness.
                  </Typography>
                  
                  <Typography variant="caption" color="text.secondary" display="block">
                    Required columns: <strong>str_id, account_id, str_filed_date</strong>
                  </Typography>
                  
                  {strStats?.uploaded && (
                    <Box sx={{ mt: 2 }}>
                      <Alert severity="success" sx={{ py: 0.5 }}>
                        <Stack direction="row" spacing={2}>
                          <Chip 
                            label={`${strStats.str_count} STRs`} 
                            size="small" 
                            color="success"
                          />
                          <Chip 
                            label={`${strStats.unique_accounts} Accounts`} 
                            size="small" 
                            color="success"
                          />
                          <Typography variant="caption">
                            Date Range: {strStats.date_range.start} to {strStats.date_range.end}
                          </Typography>
                        </Stack>
                      </Alert>
                    </Box>
                  )}
                </Box>
                
                <Box>
                  <Button
                    variant={strStats?.uploaded ? "outlined" : "contained"}
                    component="label"
                    disabled={strUploading}
                    color={strStats?.uploaded ? "success" : "warning"}
                    startIcon={strUploading ? <CircularProgress size={20} /> : <CloudUpload />}
                  >
                    {strUploading ? 'Uploading...' : strStats?.uploaded ? 'Replace STR File' : 'Upload STR Data'}
                    <input
                      type="file"
                      hidden
                      accept=".csv"
                      onChange={(e) => handleSTRUpload(e.target.files[0])}
                    />
                  </Button>
                </Box>
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
      
      {/* INFO ALERT */}
      <Alert severity="info" sx={{ mt: 3 }}>
        <Typography variant="body2">
          <strong>💡 About STR Data:</strong> STR (Suspicious Transaction Report) data represents 
          regulatory outcomes that occur <em>after</em> investigation. This data is downstream of 
          calibration and is used ONLY to evaluate how many STRs your threshold would have captured. 
          It does NOT influence threshold selection.
        </Typography>
      </Alert>

      {/* NAVIGATION */}
      <Box sx={{ mt: 4, textAlign: 'right' }}>
        <Button variant="contained" endIcon={<ArrowForward />} onClick={() => setActiveStep(1)} disabled={!stats.transactions}>
          Next: Map Schema
        </Button>
      </Box>
    </Box>
  );

  const renderMappingStep = () => {
    if (!schemaOptions || !canonicalFields) return <CircularProgress />;
    return (
      <Box sx={{ mt: 2 }}>
        <Alert severity="info" sx={{ mb: 3 }}>Map your CSV columns to System Fields. Fields marked * are required.</Alert>
        <Grid container spacing={3}>
          {['transactions', 'accounts', 'customers'].map((table) => (
            <Grid item xs={12} lg={4} key={table}>
              <Paper variant="outlined" sx={{ p: 2, bgcolor: '#fafafa' }}>
                <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 2, textTransform: 'uppercase' }}>{table}</Typography>
                {canonicalFields[table]?.map((field) => (
                  <Box key={field.key} sx={{ mb: 2 }}>
                    <Typography variant="caption" fontWeight="bold">
                      {field.label} {field.required && <span style={{color:'red'}}>*</span>}
                    </Typography>
                    <Select
                      fullWidth size="small"
                      value={mapping[table]?.[field.key] || ''}
                      onChange={(e) => setMapping(p => ({ ...p, [table]: { ...p[table], [field.key]: e.target.value } }))}
                      displayEmpty sx={{ bgcolor: 'white' }}
                    >
                      <MenuItem value=""><em>-- Select Column --</em></MenuItem>
                      {schemaOptions[table]?.map((col) => <MenuItem key={col} value={col}>{col}</MenuItem>)}
                    </Select>
                  </Box>
                ))}
              </Paper>
            </Grid>
          ))}
        </Grid>
        <Box sx={{ mt: 4, display: 'flex', justifyContent: 'space-between' }}>
          <Button onClick={() => setActiveStep(0)}>Back</Button>
          <Button variant="contained" startIcon={<Save />} onClick={saveMapping} disabled={loading}>
            Save & Continue
          </Button>
        </Box>
      </Box>
    );
  };

  const renderValidationStep = () => (
    <Box sx={{ mt: 2, maxWidth: 900, mx: 'auto', textAlign: 'center' }}>
      {!validationResult ? (
        <>
          <VerifiedUser sx={{ fontSize: 80, color: 'primary.light', mb: 2 }} />
          <Typography variant="h5">Validate Data Relationships</Typography>
          <Typography color="text.secondary" sx={{ mb: 4 }}>
            Verify join quality between Transactions, Accounts, and Customers.
          </Typography>
          <Button variant="contained" size="large" onClick={validateJoins} disabled={loading} startIcon={loading ? <CircularProgress size={20}/> : <Build />}>
            {loading ? 'Validating...' : 'Run Validation'}
          </Button>
          <Box sx={{ mt: 2 }}><Button onClick={() => setActiveStep(1)}>Back to Mapping</Button></Box>
        </>
      ) : (
        <Fade in>
          <Box>
            {readiness?.is_ready ? (
              <Alert severity="success" sx={{ mb: 4 }}>
                ✅ STEP 0 Complete! Data is ready for scenario exploration.
              </Alert>
            ) : (
              <Alert severity="info" sx={{ mb: 4 }}>
                Validation Complete. Review results below.
              </Alert>
            )}
            
            {/* Join Visualizer */}
            {validationResult.validation_results && (
              <MasterDataJoinVisualizer 
                joinReport={validationResult.validation_results}
                uploadStats={stats}
              />
            )}

            <Stack direction="row" spacing={2} justifyContent="center" sx={{ mt: 4 }}>
              {readiness?.is_ready && (
                <Button variant="contained" size="large" endIcon={<PlayArrow />} onClick={handleStartScenario}>
                  Proceed to Scenario Definition
                </Button>
              )}
              <Button variant="outlined" startIcon={<Refresh/>} onClick={validateJoins}>
                Re-validate
              </Button>
              <Button onClick={() => setActiveStep(1)}>Edit Mapping</Button>
            </Stack>
          </Box>
        </Fade>
      )}
    </Box>
  );

  return (
    <PageContainer title="Data Foundation Setup" subtitle="STEP 0: Upload, Map, and Validate">
      {!activeEnv ? <Alert severity="warning">Select environment first.</Alert> : (
        <>
          {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}
          {successMsg && <Alert severity="success" onClose={() => setSuccessMsg('')} sx={{ mb: 2 }}>{successMsg}</Alert>}
          
          <Paper sx={{ p: 3 }}>
            <Stepper activeStep={activeStep} alternativeLabel sx={{ mb: 4 }}>
              <Step><StepLabel>Upload</StepLabel></Step>
              <Step><StepLabel>Map Schema</StepLabel></Step>
              <Step><StepLabel>Validate</StepLabel></Step>
            </Stepper>
            {activeStep === 0 && renderUploadStep()}
            {activeStep === 1 && renderMappingStep()}
            {activeStep === 2 && renderValidationStep()}
          </Paper>
        </>
      )}
    </PageContainer>
  );
};

export default DataLoadScreen;