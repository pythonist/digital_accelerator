import React, { useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Typography, Box, Divider, Grid, Paper,
  List, ListItem, ListItemIcon, ListItemText, Chip,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Alert, Stack, Tabs, Tab, Accordion, AccordionSummary, AccordionDetails
} from '@mui/material';
import {
  MenuBook, Calculate, Functions, 
  ExpandMore, MergeType, Link,
  Warning, Policy, DataObject
} from '@mui/icons-material';

/**
 * Typology Manual
 * Explains the automated AML detection logic and algorithms.
 */
const TypologyManual = ({ open, onClose }) => {
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
      aria-labelledby="typology-manual-title"
    >
      <DialogTitle id="typology-manual-title" sx={{ display: 'flex', alignItems: 'center', gap: 1, borderBottom: '1px solid #eee', bgcolor: '#fff8e1', p: 2 }}>
        <MenuBook color="warning" sx={{ fontSize: 28 }} />
        <Box>
          <Typography variant="h6" fontWeight="bold" color="text.primary">Typology Detection Guide</Typography>
          <Typography variant="caption" color="text.secondary">Automated Pattern Recognition Logic</Typography>
        </Box>
      </DialogTitle>

      <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 3, bgcolor: '#fff' }}>
        <Tabs value={tab} onChange={handleTabChange} variant="scrollable" scrollButtons="auto" textColor="secondary" indicatorColor="secondary">
          <Tab icon={<Functions fontSize="small"/>} iconPosition="start" label="Detection Algorithms" />
          <Tab icon={<MergeType fontSize="small"/>} iconPosition="start" label="Data Linking Strategy" />
          <Tab icon={<Policy fontSize="small"/>} iconPosition="start" label="Investigation Policy" />
        </Tabs>
      </Box>

      <DialogContent dividers sx={{ p: 4, minHeight: 450 }}>
        
        {/* --- TAB 0: ALGORITHMS --- */}
        {tab === 0 && (
          <Box>
            <Typography variant="h5" gutterBottom color="warning.dark" fontWeight="bold">
              1. Detection Algorithms
            </Typography>
            <Typography variant="body1" paragraph>
              The system scans transaction history against known money laundering patterns. Below is the exact logic used to flag cases.
            </Typography>

            <Stack spacing={3}>
              <Accordion defaultExpanded variant="outlined" sx={{ borderColor: 'error.light' }}>
                <AccordionSummary expandIcon={<ExpandMore />} sx={{ bgcolor: '#fef2f2' }}>
                  <Typography fontWeight="bold" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Warning color="error" fontSize="small"/> 1. Pass-Through Account (Money Mule)
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Grid container spacing={2}>
                    <Grid item xs={12} md={8}>
                      <Typography variant="body2" paragraph>
                        <strong>Concept:</strong> An account used solely to layer funds. Money comes in and leaves immediately, leaving a minimal balance.
                      </Typography>
                      <Paper variant="outlined" sx={{ p: 2, bgcolor: '#fff', borderLeft: '4px solid #ef5350' }}>
                        <Typography variant="caption" fontWeight="bold" display="block" gutterBottom>THE FORMULA:</Typography>
                        <code style={{ fontFamily: 'monospace', fontSize: '0.9rem' }}>
                          Retention Ratio = |Credits - Debits| / Credits
                        </code>
                        <Box sx={{ mt: 1 }}>
                          <Chip label="Trigger: Ratio < 0.15 (15%)" size="small" color="error" />
                          <Chip label="Min Volume: > $20,000" size="small" sx={{ ml: 1 }} />
                        </Box>
                      </Paper>
                    </Grid>
                    <Grid item xs={12} md={4} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: '#fafafa', borderRadius: 1 }}>
                      <Stack alignItems="center">
                        <Typography variant="h6" fontWeight="bold">In: $100k</Typography>
                        <Typography variant="h6" fontWeight="bold" color="error">Out: $98k</Typography>
                        <Typography variant="caption">Retained: 2% (FLAGS ALERT)</Typography>
                      </Stack>
                    </Grid>
                  </Grid>
                </AccordionDetails>
              </Accordion>

              <Accordion variant="outlined" sx={{ borderColor: 'warning.light' }}>
                <AccordionSummary expandIcon={<ExpandMore />} sx={{ bgcolor: '#fff8e1' }}>
                  <Typography fontWeight="bold" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Calculate color="warning" fontSize="small"/> 2. Structuring (Smurfing)
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Typography variant="body2" paragraph>
                    <strong>Concept:</strong> Breaking large deposits into smaller amounts to avoid regulatory reporting thresholds (typically $10,000).
                  </Typography>
                  <Paper variant="outlined" sx={{ p: 2, bgcolor: '#fff', borderLeft: '4px solid #ff9800' }}>
                    <Typography variant="caption" fontWeight="bold" display="block" gutterBottom>THE LOGIC:</Typography>
                    <List dense disablePadding>
                      <ListItem disablePadding>
                        <ListItemIcon sx={{ minWidth: 30 }}><functions fontSize="small"/></ListItemIcon>
                        <ListItemText primary="Value Range: $9,000 to $10,000" />
                      </ListItem>
                      <ListItem disablePadding>
                        <ListItemIcon sx={{ minWidth: 30 }}><functions fontSize="small"/></ListItemIcon>
                        <ListItemText primary="Frequency: >= 2 transactions in history" />
                      </ListItem>
                    </List>
                  </Paper>
                </AccordionDetails>
              </Accordion>

              <Accordion variant="outlined" sx={{ borderColor: 'info.light' }}>
                <AccordionSummary expandIcon={<ExpandMore />} sx={{ bgcolor: '#e3f2fd' }}>
                  <Typography fontWeight="bold" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <DataObject color="info" fontSize="small"/> 3. Round Amount Anomalies
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Typography variant="body2" paragraph>
                    <strong>Concept:</strong> Human-generated fraud often uses round numbers (e.g., $500, $1000) unlike natural commerce (e.g., $19.99).
                  </Typography>
                  <Paper variant="outlined" sx={{ p: 2, bgcolor: '#fff', borderLeft: '4px solid #03a9f4' }}>
                    <Typography variant="caption" fontWeight="bold" display="block" gutterBottom>THE LOGIC:</Typography>
                    <Typography variant="body2">
                      If <strong>&gt;40%</strong> of large transactions ({'>'}$500) are exact multiples of 100.
                    </Typography>
                  </Paper>
                </AccordionDetails>
              </Accordion>
            </Stack>
          </Box>
        )}

        {/* --- TAB 1: DATA LINKING --- */}
        {tab === 1 && (
          <Box>
            <Typography variant="h5" gutterBottom color="warning.dark" fontWeight="bold">
              2. Data Linking Strategy
            </Typography>
            <Typography variant="body1" paragraph>
              The engine uses a "Cascade Search" strategy to find transactions for a case. It tries three methods in order until data is found.
            </Typography>

            <Stack spacing={2} sx={{ mt: 2 }}>
              <Paper sx={{ p: 2, border: '1px solid #e0e0e0', display: 'flex', alignItems: 'center', gap: 2 }}>
                <Chip label="Strategy A" color="success" size="small" />
                <Box>
                  <Typography variant="subtitle2" fontWeight="bold">Direct Link</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Searches for <code>case_id</code> column directly in the <code>transactions</code> table.
                  </Typography>
                </Box>
              </Paper>

              <Paper sx={{ p: 2, border: '1px solid #e0e0e0', display: 'flex', alignItems: 'center', gap: 2 }}>
                <Chip label="Strategy B" color="primary" size="small" />
                <Box>
                  <Typography variant="subtitle2" fontWeight="bold">Alert Link (Most Common)</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Case &rarr; Alerts &rarr; Transactions. It finds alerts linked to the case, then pulls transactions attached to those alerts.
                  </Typography>
                </Box>
              </Paper>

              <Paper sx={{ p: 2, border: '1px solid #e0e0e0', display: 'flex', alignItems: 'center', gap: 2 }}>
                <Chip label="Strategy C" color="warning" size="small" />
                <Box>
                  <Typography variant="subtitle2" fontWeight="bold">Account Link</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Case &rarr; Account ID &rarr; Transactions. Fetches all activity for the account subject.
                  </Typography>
                </Box>
              </Paper>
            </Stack>
          </Box>
        )}

        {/* --- TAB 2: POLICY --- */}
        {tab === 2 && (
          <Box>
            <Typography variant="h5" gutterBottom color="warning.dark" fontWeight="bold">
              3. Investigation Policy
            </Typography>
            <Typography variant="body1" paragraph>
              How to interpret results and take action based on Standard Operating Procedures (SOP).
            </Typography>

            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead sx={{ bgcolor: 'grey.100' }}>
                  <TableRow>
                    <TableCell><strong>Severity</strong></TableCell>
                    <TableCell><strong>Required Action</strong></TableCell>
                    <TableCell><strong>SLA</strong></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  <TableRow>
                    <TableCell><Chip label="CRITICAL" color="error" size="small" /></TableCell>
                    <TableCell>Immediate escalation to L2. File SAR draft.</TableCell>
                    <TableCell>24 Hours</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell><Chip label="HIGH" color="warning" size="small" /></TableCell>
                    <TableCell>Full KYC review required. Check beneficial owners.</TableCell>
                    <TableCell>3 Days</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell><Chip label="MEDIUM" color="info" size="small" /></TableCell>
                    <TableCell>Note in case file. Monitor for recurrence.</TableCell>
                    <TableCell>5 Days</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}

      </DialogContent>
      <DialogActions sx={{ p: 3, bgcolor: 'grey.50' }}>
        <Button onClick={onClose} variant="contained" size="large" color="warning">
          Back to Analysis
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default TypologyManual;