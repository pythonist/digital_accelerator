import React, { useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Typography, Box, Divider, Grid, Paper,
  List, ListItem, ListItemIcon, ListItemText, Chip,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Alert, Stack, Tabs, Tab, Accordion, AccordionSummary, AccordionDetails
} from '@mui/material';
import {
  Gavel, Transform, Code, 
  ExpandMore, Bolt, Rule,
  Psychology, VerifiedUser, FilterAlt,
  Functions, DataObject, Storage
} from '@mui/icons-material';

/**
 * Rule Engine Manual
 * Explains the Universal Normalization Logic and Rule Creation Syntax.
 */
const RuleEngineManual = ({ open, onClose }) => {
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
      aria-labelledby="rule-manual-title"
    >
      <DialogTitle id="rule-manual-title" sx={{ display: 'flex', alignItems: 'center', gap: 1, borderBottom: '1px solid #eee', bgcolor: '#f8fafc', p: 2 }}>
        <Gavel color="primary" sx={{ fontSize: 28 }} />
        <Box>
          <Typography variant="h6" fontWeight="bold" color="text.primary">Universal Rule Engine Guide</Typography>
          <Typography variant="caption" color="text.secondary">Configuration, Syntax & Data Normalization</Typography>
        </Box>
      </DialogTitle>

      <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 3, bgcolor: '#fff' }}>
        <Tabs value={tab} onChange={handleTabChange} variant="scrollable" scrollButtons="auto">
          <Tab icon={<Transform fontSize="small"/>} iconPosition="start" label="Universal Normalization" />
          <Tab icon={<Code fontSize="small"/>} iconPosition="start" label="Syntax & Operators" />
          <Tab icon={<Psychology fontSize="small"/>} iconPosition="start" label="Logic Gates" />
          <Tab icon={<VerifiedUser fontSize="small"/>} iconPosition="start" label="Data Quality" />
        </Tabs>
      </Box>

      <DialogContent dividers sx={{ p: 4, minHeight: 400 }}>
        
        {/* --- TAB 0: UNIVERSAL NORMALIZATION --- */}
        {tab === 0 && (
          <Box>
            <Typography variant="h5" gutterBottom color="primary.dark" fontWeight="bold">
              1. Universal Data Normalization
            </Typography>
            <Typography variant="body1" paragraph>
              Unlike traditional rule engines that break if you change a column name (e.g., from <code>txn_amt</code> to <code>amount</code>), 
              this engine uses a <strong>Semantic Mapping Layer</strong> defined in <code>rule_engine.py</code>.
            </Typography>

            <Alert severity="info" sx={{ mb: 3 }}>
              <strong>How it works:</strong> You write rules using standard keys (Amount, Date, Country). 
              The engine automatically hunts for matching columns in your uploaded CSV/Database.
            </Alert>

            <Grid container spacing={3}>
              <Grid item xs={12} md={6}>
                <Paper variant="outlined" sx={{ p: 0, overflow: 'hidden' }}>
                  <Box sx={{ p: 2, bgcolor: '#e3f2fd', borderBottom: '1px solid #90caf9' }}>
                    <Typography variant="subtitle2" fontWeight="bold" color="primary.dark">Standard Keys (You Use These)</Typography>
                  </Box>
                  <List dense>
                    <ListItem>
                      <ListItemIcon><DataObject fontSize="small" /></ListItemIcon>
                      <ListItemText primary="amount" secondary="Target for numeric checks (> 10000)" />
                    </ListItem>
                    <ListItem>
                      <ListItemIcon><DataObject fontSize="small" /></ListItemIcon>
                      <ListItemText primary="date" secondary="Target for time-window checks" />
                    </ListItem>
                    <ListItem>
                      <ListItemIcon><DataObject fontSize="small" /></ListItemIcon>
                      <ListItemText primary="party" secondary="Target for beneficiary/remitter matching" />
                    </ListItem>
                  </List>
                </Paper>
              </Grid>
              
              <Grid item xs={12} md={6}>
                <Paper variant="outlined" sx={{ p: 0, overflow: 'hidden' }}>
                  <Box sx={{ p: 2, bgcolor: '#f3e5f5', borderBottom: '1px solid #ce93d8' }}>
                    <Typography variant="subtitle2" fontWeight="bold" color="secondary.dark">Auto-Detected Columns (Backend)</Typography>
                  </Box>
                  <List dense>
                    <ListItem>
                      <ListItemIcon><Storage fontSize="small" /></ListItemIcon>
                      <ListItemText primary="Maps to 'amount'" secondary="txn_amount, amt, val, value, credit, debit" />
                    </ListItem>
                    <ListItem>
                      <ListItemIcon><Storage fontSize="small" /></ListItemIcon>
                      <ListItemText primary="Maps to 'date'" secondary="timestamp, created_at, val_date, time" />
                    </ListItem>
                    <ListItem>
                      <ListItemIcon><Storage fontSize="small" /></ListItemIcon>
                      <ListItemText primary="Maps to 'party'" secondary="counterparty, beneficiary, merchant, entity" />
                    </ListItem>
                  </List>
                </Paper>
              </Grid>
            </Grid>
          </Box>
        )}

        {/* --- TAB 1: SYNTAX & OPERATORS --- */}
        {tab === 1 && (
          <Box>
            <Typography variant="h5" gutterBottom color="primary.dark" fontWeight="bold">
              2. Rule Syntax & Operators
            </Typography>
            <Typography variant="body1" paragraph>
              Rules are constructed as JSON objects. Each condition specifies a <code>field</code>, an <code>operator</code>, and a <code>value</code>.
            </Typography>

            <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
              <Table size="small">
                <TableHead sx={{ bgcolor: 'grey.100' }}>
                  <TableRow>
                    <TableCell><strong>Operator</strong></TableCell>
                    <TableCell><strong>Description</strong></TableCell>
                    <TableCell><strong>Example JSON</strong></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  <TableRow>
                    <TableCell><code>&gt;</code>, <code>&gt;=</code></TableCell>
                    <TableCell>Numeric Greater Than</TableCell>
                    <TableCell><code>{`{"field": "amount", "op": ">", "value": 10000}`}</code></TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell><code>==</code></TableCell>
                    <TableCell>Exact Match (Case Insensitive)</TableCell>
                    <TableCell><code>{`{"field": "country", "op": "==", "value": "IR"}`}</code></TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell><code>in</code></TableCell>
                    <TableCell>List Membership</TableCell>
                    <TableCell><code>{`{"field": "type", "op": "in", "value": ["WIRE", "SWIFT"]}`}</code></TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell><code>contains</code></TableCell>
                    <TableCell>Substring Search</TableCell>
                    <TableCell><code>{`{"field": "party", "op": "contains", "value": "CASINO"}`}</code></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>

            <Alert severity="warning">
              <strong>Tip:</strong> The engine automatically handles type conversion. If you compare a string column "100.50" with a number 100, it parses the string before comparison.
            </Alert>
          </Box>
        )}

        {/* --- TAB 2: LOGIC GATES --- */}
        {tab === 2 && (
          <Box>
            <Typography variant="h5" gutterBottom color="primary.dark" fontWeight="bold">
              3. Boolean Logic Gates
            </Typography>
            <Typography variant="body1" paragraph>
              You can combine multiple conditions using <code>AND</code> or <code>OR</code> logic blocks.
            </Typography>

            <Stack spacing={2}>
              <Paper variant="outlined" sx={{ p: 2, borderColor: 'primary.light' }}>
                <Typography variant="subtitle1" fontWeight="bold" color="primary.main" gutterBottom>
                  <Functions fontSize="small" sx={{ mr: 1, verticalAlign: 'middle' }}/>
                  AND Logic (Strict)
                </Typography>
                <Typography variant="body2" gutterBottom>
                  ALL conditions must be true for the rule to trigger. Use this to reduce false positives.
                </Typography>
                <Box sx={{ bgcolor: '#263238', color: '#fff', p: 1.5, borderRadius: 1, fontFamily: 'monospace', fontSize: '0.8rem' }}>
                  "logic": "AND",<br/>
                  "conditions": [<br/>
                  &nbsp;&nbsp;{`{"field": "amount", "op": ">", "value": 50000}`},<br/>
                  &nbsp;&nbsp;{`{"field": "country", "op": "==", "value": "High Risk"}`}<br/>
                  ]
                </Box>
              </Paper>

              <Paper variant="outlined" sx={{ p: 2, borderColor: 'secondary.light' }}>
                <Typography variant="subtitle1" fontWeight="bold" color="secondary.main" gutterBottom>
                  <FilterAlt fontSize="small" sx={{ mr: 1, verticalAlign: 'middle' }}/>
                  OR Logic (Broad)
                </Typography>
                <Typography variant="body2" gutterBottom>
                  ANY condition can be true. Use this for broad monitoring or catch-all buckets.
                </Typography>
                <Box sx={{ bgcolor: '#263238', color: '#fff', p: 1.5, borderRadius: 1, fontFamily: 'monospace', fontSize: '0.8rem' }}>
                  "logic": "OR",<br/>
                  "conditions": [<br/>
                  &nbsp;&nbsp;{`{"field": "notes", "op": "contains", "value": "refused"}`},<br/>
                  &nbsp;&nbsp;{`{"field": "status", "op": "==", "value": "FAILED"}`}<br/>
                  ]
                </Box>
              </Paper>
            </Stack>
          </Box>
        )}

        {/* --- TAB 3: DATA QUALITY --- */}
        {tab === 3 && (
          <Box>
            <Typography variant="h5" gutterBottom color="primary.dark" fontWeight="bold">
              4. Data Quality & Validation
            </Typography>
            <Typography variant="body1" paragraph>
              The engine includes a pre-flight check called <code>validate_case_data</code>. Before running rules, it scores the dataset quality.
            </Typography>

            <Grid container spacing={2}>
              <Grid item xs={12} md={4}>
                <Paper sx={{ p: 2, textAlign: 'center', bgcolor: '#e8f5e9' }}>
                  <Typography variant="h4" color="success.dark" fontWeight="bold">90%+</Typography>
                  <Typography variant="caption">Excellent Quality</Typography>
                  <Typography variant="body2" sx={{ mt: 1 }}>All critical columns (Amount, Date, Party) mapped successfully.</Typography>
                </Paper>
              </Grid>
              <Grid item xs={12} md={4}>
                <Paper sx={{ p: 2, textAlign: 'center', bgcolor: '#fff3e0' }}>
                  <Typography variant="h4" color="warning.dark" fontWeight="bold">50-89%</Typography>
                  <Typography variant="caption">Partial Mapping</Typography>
                  <Typography variant="body2" sx={{ mt: 1 }}>Missing non-critical fields (e.g., Channel, Status). Rules may partially fail.</Typography>
                </Paper>
              </Grid>
              <Grid item xs={12} md={4}>
                <Paper sx={{ p: 2, textAlign: 'center', bgcolor: '#ffebee' }}>
                  <Typography variant="h4" color="error.dark" fontWeight="bold">&lt; 50%</Typography>
                  <Typography variant="caption">Critical Failure</Typography>
                  <Typography variant="body2" sx={{ mt: 1 }}>Core columns (Amount/Date) missing. Engine cannot run.</Typography>
                </Paper>
              </Grid>
            </Grid>

            <Box sx={{ mt: 3 }}>
              <Typography variant="subtitle2" fontWeight="bold">Troubleshooting Missing Columns:</Typography>
              <List dense>
                <ListItem>
                  <ListItemIcon><Bolt fontSize="small" color="error"/></ListItemIcon>
                  <ListItemText primary="Check CSV Headers" secondary="Ensure headers are in the first row and not empty." />
                </ListItem>
                <ListItem>
                  <ListItemIcon><Bolt fontSize="small" color="error"/></ListItemIcon>
                  <ListItemText primary="Check Aliases" secondary="If your amount column is named 'quantity_money', rename it to 'amt' or 'amount'." />
                </ListItem>
              </List>
            </Box>
          </Box>
        )}

      </DialogContent>
      <DialogActions sx={{ p: 3, bgcolor: 'grey.50' }}>
        <Button onClick={onClose} variant="contained" size="large" color="primary">
          Got it
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default RuleEngineManual;