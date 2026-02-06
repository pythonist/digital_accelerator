import React, { useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Typography, Box, Divider, Grid, Paper,
  List, ListItem, ListItemIcon, ListItemText, Chip,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Alert, Stack, Tabs, Tab, Accordion, AccordionSummary, AccordionDetails
} from '@mui/material';
import {
  Assessment, Functions, Timeline, 
  ExpandMore, ShowChart, CompareArrows,
  History, AccessTime, Security,
  InfoOutlined, HelpOutline
} from '@mui/icons-material';

/**
 * Baseline Analysis Manual
 * Comprehensive guide to Behavioral Profiling and Statistical Deviation.
 */
const BaselineManual = ({ open, onClose }) => {
  const [tab, setTab] = useState(0);

  const handleTabChange = (event, newValue) => {
    setTab(newValue);
  };

  return (
    <Dialog 
      open={open} 
      onClose={onClose} 
      maxWidth="lg" 
      fullWidth
      scroll="paper"
      aria-labelledby="baseline-manual-title"
    >
      <DialogTitle id="baseline-manual-title" sx={{ display: 'flex', alignItems: 'center', gap: 1, borderBottom: '1px solid #eee', bgcolor: '#f8fafc', p: 2 }}>
        <Assessment color="primary" sx={{ fontSize: 28 }} />
        <Box>
          <Typography variant="h6" fontWeight="bold" color="text.primary">Behavioral Profiling Guide</Typography>
          <Typography variant="caption" color="text.secondary">Statistical Deviation & Anomaly Detection</Typography>
        </Box>
      </DialogTitle>

      <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 3, bgcolor: '#fff' }}>
        <Tabs value={tab} onChange={handleTabChange} variant="scrollable" scrollButtons="auto">
          <Tab icon={<Functions fontSize="small"/>} iconPosition="start" label="Statistical Engine" />
          <Tab icon={<Timeline fontSize="small"/>} iconPosition="start" label="Indicators" />
          <Tab icon={<History fontSize="small"/>} iconPosition="start" label="Baseline Strategy" />
        </Tabs>
      </Box>

      <DialogContent dividers sx={{ p: 4, minHeight: 450 }}>
        
        {/* --- TAB 0: STATISTICAL ENGINE --- */}
        {tab === 0 && (
          <Box>
            <Typography variant="h5" gutterBottom color="primary.dark" fontWeight="bold">
              1. The Statistical Engine
            </Typography>
            <Typography variant="body1" paragraph>
              Unlike rule-based systems that look for fixed thresholds (e.g., "Amount {'>'} 10k"), the Baseline Engine uses <strong>Dynamic Statistical Profiling</strong>. It learns what is "normal" for each customer and flags significant deviations.
            </Typography>

            <Grid container spacing={3} sx={{ mt: 1 }}>
              <Grid item xs={12} md={6}>
                <Paper variant="outlined" sx={{ p: 3, height: '100%', bgcolor: '#f0f9ff', borderColor: '#bae6fd' }}>
                  <Typography variant="h6" fontWeight="bold" color="primary.dark" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Functions fontSize="small" /> The Z-Score Method
                  </Typography>
                  <Typography variant="body2" paragraph>
                    The engine calculates a "Z-Score" for every transaction batch. This measures how many <strong>Standard Deviations</strong> the current activity is away from the historical average.
                  </Typography>
                  <Alert severity="info" variant="outlined" sx={{ bgcolor: 'white' }}>
                    <strong>Formula:</strong> <code>(Current Value - Baseline Mean) / Baseline StdDev</code>
                  </Alert>
                  <List dense>
                    <ListItem>
                      <ListItemIcon><ShowChart fontSize="small" color="primary"/></ListItemIcon>
                      <ListItemText primary="Score > 3.0" secondary="Statistically Significant (High Deviation)" />
                    </ListItem>
                    <ListItem>
                      <ListItemIcon><ShowChart fontSize="small" color="primary"/></ListItemIcon>
                      <ListItemText primary="Score < 1.0" secondary="Within Normal Bounds" />
                    </ListItem>
                  </List>
                </Paper>
              </Grid>

              <Grid item xs={12} md={6}>
                <Paper variant="outlined" sx={{ p: 3, height: '100%', bgcolor: '#fff7ed', borderColor: '#fed7aa' }}>
                  <Typography variant="h6" fontWeight="bold" color="warning.dark" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <CompareArrows fontSize="small" /> Comparison Windows
                  </Typography>
                  <Typography variant="body2" paragraph>
                    The system uses a "Sliding Window" approach to ensure relevance.
                  </Typography>
                  <Stack spacing={2}>
                    <Box sx={{ p: 1.5, border: '1px solid #e0e0e0', borderRadius: 1, bgcolor: 'white' }}>
                      <Typography variant="subtitle2" fontWeight="bold">Baseline Profile (Training)</Typography>
                      <Typography variant="caption" color="text.secondary">
                        Previous <strong>180 Days</strong>. Establishes the "pattern of life" (paychecks, rent, regular spending).
                      </Typography>
                    </Box>
                    <Box sx={{ p: 1.5, border: '1px solid #e0e0e0', borderRadius: 1, bgcolor: 'white' }}>
                      <Typography variant="subtitle2" fontWeight="bold">Current Window (Analysis)</Typography>
                      <Typography variant="caption" color="text.secondary">
                        Last <strong>30 Days</strong>. Tested against the baseline to detect sudden shifts (Account Takeover, Mule activity).
                      </Typography>
                    </Box>
                  </Stack>
                </Paper>
              </Grid>
            </Grid>
          </Box>
        )}

        {/* --- TAB 1: INDICATORS --- */}
        {tab === 1 && (
          <Box>
            <Typography variant="h5" gutterBottom color="primary.dark" fontWeight="bold">
              2. Key Risk Indicators
            </Typography>
            <Typography variant="body1" paragraph>
              The engine monitors specific behavioral vectors defined in <code>baseline_engine.py</code>.
            </Typography>

            <Stack spacing={2}>
              <Accordion defaultExpanded variant="outlined">
                <AccordionSummary expandIcon={<ExpandMore />}>
                  <Typography fontWeight="bold" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <ShowChart color="error" fontSize="small"/> Volume Surge
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Typography variant="body2">
                    <strong>Logic:</strong> Flags if the total transaction volume in the Current Window exceeds the Baseline Average by more than 300% (3x).
                    <br/>
                    <strong>Implication:</strong> Potential sudden influx of illicit funds or layering phase.
                  </Typography>
                </AccordionDetails>
              </Accordion>

              <Accordion variant="outlined">
                <AccordionSummary expandIcon={<ExpandMore />}>
                  <Typography fontWeight="bold" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <AccessTime color="warning" fontSize="small"/> Temporal Anomaly (Off-Hours)
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Typography variant="body2">
                    <strong>Logic:</strong> Compares the ratio of Weekend/Night transactions.
                    <br/>
                    <strong>Implication:</strong> If a B2B customer (typically Mon-Fri) suddenly transacts heavily on Sunday nights, it signals potential unauthorized access.
                  </Typography>
                </AccordionDetails>
              </Accordion>

              <Accordion variant="outlined">
                <AccordionSummary expandIcon={<ExpandMore />}>
                  <Typography fontWeight="bold" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Security color="info" fontSize="small"/> Counterparty Expansion
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Typography variant="body2">
                    <strong>Logic:</strong> Tracks the number of <em>Unique Beneficiaries</em>.
                    <br/>
                    <strong>Implication:</strong> A sudden spike in new payees suggests "Fan-Out" activity (scattering funds) often associated with fraud or structuring.
                  </Typography>
                </AccordionDetails>
              </Accordion>
            </Stack>
          </Box>
        )}

        {/* --- TAB 2: BASELINE STRATEGY --- */}
        {tab === 2 && (
          <Box>
            <Typography variant="h5" gutterBottom color="primary.dark" fontWeight="bold">
              3. Profiling Strategy & Scoring
            </Typography>
            <Typography variant="body1" paragraph>
              How the final "Deviation Score" (0-100) is calculated from raw metrics.
            </Typography>

            <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
              <Table size="small">
                <TableHead sx={{ bgcolor: 'grey.50' }}>
                  <TableRow>
                    <TableCell><strong>Deviation Level</strong></TableCell>
                    <TableCell><strong>Score Range</strong></TableCell>
                    <TableCell><strong>Operational Meaning</strong></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  <TableRow>
                    <TableCell><Chip label="CRITICAL" color="error" size="small" /></TableCell>
                    <TableCell><strong>75 - 100</strong></TableCell>
                    <TableCell>Behavior is unrecognizable. Likely Account Takeover or Mule Activity. Immediate Freeze recommended.</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell><Chip label="HIGH" color="warning" size="small" /></TableCell>
                    <TableCell><strong>50 - 74</strong></TableCell>
                    <TableCell>Significant shift. Customer may have changed business model or source of wealth. Review required.</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell><Chip label="MEDIUM" color="info" size="small" /></TableCell>
                    <TableCell><strong>25 - 49</strong></TableCell>
                    <TableCell>Minor anomalies (e.g., slight volume increase). Monitor for trend.</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell><Chip label="LOW" color="success" size="small" /></TableCell>
                    <TableCell><strong>0 - 24</strong></TableCell>
                    <TableCell>Behavior consistent with historical profile.</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>

            <Alert severity="info" icon={<InfoOutlined fontSize="inherit" />}>
              <strong>Note on "Learning Mode":</strong> New accounts ({'<'} 30 days old) may not have a sufficient baseline. In these cases, the engine defaults to a "Peer Group" comparison if available, or marks the profile as "Learning".
            </Alert>
          </Box>
        )}

      </DialogContent>
      <DialogActions sx={{ p: 3, bgcolor: 'grey.50' }}>
        <Button onClick={onClose} variant="contained" color="primary">
          Return to Analysis
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default BaselineManual;
