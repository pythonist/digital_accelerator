import React, { useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Typography, Box, Divider, Grid, Paper,
  List, ListItem, ListItemIcon, ListItemText, Chip,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Alert, Stack, Tabs, Tab, Accordion, AccordionSummary, AccordionDetails,Card,
} from '@mui/material';
import {
  Hub, Timeline, GridOn, 
  ExpandMore, Grain, CompareArrows,
  ScatterPlot, Warning, RadioButtonChecked,
  Functions, Storage, Tune, Architecture,
  Psychology, Speed, Category
} from '@mui/icons-material';

/**
 * Network Investigation Manual - Deep Dive
 * Comprehensive documentation of the Graph Analysis Screen logic and capabilities.
 */
const NetworkGraphManual = ({ open, onClose }) => {
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
      aria-labelledby="graph-manual-title"
    >
      <DialogTitle id="graph-manual-title" sx={{ display: 'flex', alignItems: 'center', gap: 1, borderBottom: '1px solid #eee', bgcolor: '#f8fafc', p: 2 }}>
        <Hub color="primary" sx={{ fontSize: 28 }} />
        <Box>
          <Typography variant="h6" fontWeight="bold" color="text.primary">Network Investigation Workbench</Typography>
          <Typography variant="caption" color="text.secondary">Comprehensive Investigator Guide v2.0</Typography>
        </Box>
      </DialogTitle>

      <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 3, bgcolor: '#fff' }}>
        <Tabs value={tab} onChange={handleTabChange} variant="scrollable" scrollButtons="auto">
          <Tab icon={<Architecture fontSize="small"/>} iconPosition="start" label="Architecture & Physics" />
          <Tab icon={<Category fontSize="small"/>} iconPosition="start" label="Visual Legend" />
          <Tab icon={<Psychology fontSize="small"/>} iconPosition="start" label="Automated Forensics" />
          <Tab icon={<Functions fontSize="small"/>} iconPosition="start" label="Scoring Logic" />
          <Tab icon={<Storage fontSize="small"/>} iconPosition="start" label="Data Lineage" />
        </Tabs>
      </Box>

      <DialogContent dividers sx={{ p: 4, minHeight: 500 }}>
        
        {/* --- TAB 0: ARCHITECTURE & PHYSICS --- */}
        {tab === 0 && (
          <Box>
            <Typography variant="h5" gutterBottom color="primary.dark" fontWeight="bold">
              1. The Graph Engine Architecture
            </Typography>
            <Typography variant="body1" paragraph>
              The Network View is not a static chart. It is a live, <strong>Force-Directed Physics Simulation</strong> powered by a custom D3-like engine running inside the browser. It interprets financial data as physical objects with mass, velocity, and gravitational pull.
            </Typography>

            <Grid container spacing={3} sx={{ mt: 1 }}>
              <Grid item xs={12} md={6}>
                <Paper variant="outlined" sx={{ p: 3, height: '100%', bgcolor: '#f0f9ff', borderColor: '#bae6fd' }}>
                  <Typography variant="h6" fontWeight="bold" color="primary.dark" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Speed fontSize="small" /> Physics Rules
                  </Typography>
                  <List dense>
                    <ListItem>
                      <ListItemText 
                        primary="Gravity & Centrality" 
                        secondary="Nodes are pulled toward the center of the canvas. Heavier nodes (higher volume) resist movement more than lighter ones." 
                      />
                    </ListItem>
                    <ListItem>
                      <ListItemText 
                        primary="Electrostatic Repulsion" 
                        secondary="Every node pushes every other node away (Charge = -1200). This prevents clustering and reveals distinct 'islands' of activity." 
                      />
                    </ListItem>
                    <ListItem>
                      <ListItemText 
                        primary="Link Tension" 
                        secondary="Transactions act as springs. Stronger connections (higher volume) pull nodes closer together, visually grouping related entities." 
                      />
                    </ListItem>
                  </List>
                </Paper>
              </Grid>

              <Grid item xs={12} md={6}>
                <Paper variant="outlined" sx={{ p: 3, height: '100%', bgcolor: '#fff7ed', borderColor: '#fed7aa' }}>
                  <Typography variant="h6" fontWeight="bold" color="warning.dark" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Tune fontSize="small" /> The "Flow Layout" Bias
                  </Typography>
                  <Typography variant="body2" paragraph>
                    When the "Toggle Layout" button is active, the physics engine applies a <strong>horizontal bias</strong> to structure the investigation chronologically from left to right:
                  </Typography>
                  <Stack spacing={1}>
                    <Chip label="STEP 1: CASE FILE (Left -400px)" color="primary" variant="outlined" sx={{ justifyContent: 'flex-start' }} />
                    <Chip label="STEP 2: CUSTOMER (Mid-Left -200px)" color="success" variant="outlined" sx={{ justifyContent: 'flex-start' }} />
                    <Chip label="STEP 3: ACCOUNT (Center 0px)" color="warning" variant="outlined" sx={{ justifyContent: 'flex-start' }} />
                    <Chip label="STEP 4: COUNTERPARTY (Right +300px)" color="error" variant="outlined" sx={{ justifyContent: 'flex-start' }} />
                  </Stack>
                </Paper>
              </Grid>
            </Grid>
          </Box>
        )}

        {/* --- TAB 1: VISUAL LEGEND --- */}
        {tab === 1 && (
          <Box>
            <Typography variant="h5" gutterBottom color="primary.dark" fontWeight="bold">
              2. Visual Semantics (Decoding the Graph)
            </Typography>
            <Typography variant="body1" paragraph>
              Every pixel in the graph conveys specific data. The investigator must learn to read these visual cues to rapidly assess risk without reading tabular data.
            </Typography>

            <TableContainer component={Paper} variant="outlined" sx={{ mb: 4 }}>
              <Table>
                <TableHead sx={{ bgcolor: 'grey.100' }}>
                  <TableRow>
                    <TableCell><strong>Visual Element</strong></TableCell>
                    <TableCell><strong>Appearance</strong></TableCell>
                    <TableCell><strong>Data Representation</strong></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  <TableRow>
                    <TableCell><strong>Node Size</strong></TableCell>
                    <TableCell>Variable Radius</TableCell>
                    <TableCell>
                      Logarithmic scale of <strong>Total Volume ($)</strong>. 
                      <br/>
                      <code>Size = 5 + log(Volume) * 0.5</code>
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell><strong>Critical Node</strong></TableCell>
                    <TableCell><Chip label="Red Glow / Shadow" size="small" color="error" /></TableCell>
                    <TableCell>
                      Calculated Risk Score &gt; 50. The glow intensity represents the urgency of the threat.
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell><strong>Edge Thickness</strong></TableCell>
                    <TableCell>Variable Line Width</TableCell>
                    <TableCell>
                      Proportional to the <strong>Volume ($)</strong> transferred between two entities. Thicker lines = High value corridors.
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell><strong>Particles</strong></TableCell>
                    <TableCell>Moving Dots on Lines</TableCell>
                    <TableCell>
                      <strong>Density:</strong> Number of dots = Number of transactions (capped at 5).
                      <br/>
                      <strong>Speed:</strong> Random variation implies activity frequency.
                      <br/>
                      <strong>Direction:</strong> Always moves Source → Target.
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>

            <Typography variant="h6" gutterBottom>Color Coding Standard</Typography>
            <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
              <Paper sx={{ p: 2, bgcolor: '#8b5cf6', color: 'white', minWidth: 120 }}><strong>Purple</strong><br/>Case File</Paper>
              <Paper sx={{ p: 2, bgcolor: '#10b981', color: 'white', minWidth: 120 }}><strong>Green</strong><br/>Customer (KYC)</Paper>
              <Paper sx={{ p: 2, bgcolor: '#3b82f6', color: 'white', minWidth: 120 }}><strong>Blue</strong><br/>Account / Safe</Paper>
              <Paper sx={{ p: 2, bgcolor: '#ef4444', color: 'white', minWidth: 120 }}><strong>Red</strong><br/>Alert / High Risk</Paper>
              <Paper sx={{ p: 2, bgcolor: '#6b7280', color: 'white', minWidth: 120 }}><strong>Grey</strong><br/>External Party</Paper>
            </Stack>
          </Box>
        )}

        {/* --- TAB 2: AUTOMATED FORENSICS --- */}
        {tab === 2 && (
          <Box>
            <Typography variant="h5" gutterBottom color="primary.dark" fontWeight="bold">
              3. Automated Typology Detection
            </Typography>
            <Typography variant="body1" paragraph>
              The system does not just display data; it actively hunts for money laundering patterns using graph theory algorithms. These run in real-time on the backend (<code>graph_builder.py</code>).
            </Typography>

            <Stack spacing={3}>
              <Accordion defaultExpanded variant="outlined" sx={{ borderColor: 'warning.light' }}>
                <AccordionSummary expandIcon={<ExpandMore />} sx={{ bgcolor: '#fffbeb' }}>
                  <Typography fontWeight="bold" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <CompareArrows color="warning" /> 1. Pass-Through Account (Layering)
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Grid container spacing={2}>
                    <Grid item xs={8}>
                      <Typography variant="body2">
                        <strong>Behavior:</strong> An account receives funds and immediately transfers them out, retaining almost nothing. Used to distance illicit funds from their source.
                      </Typography>
                      <Alert severity="warning" sx={{ mt: 1 }}>
                        <strong>Detection Logic:</strong>
                        <br/>
                        1. Calculate Total Inflow ($) and Total Outflow ($).
                        <br/>
                        2. Trigger if <code>min(In, Out) / max(In, Out) &gt; 0.90</code> (90% Match).
                        <br/>
                        3. Trigger if Total Volume &gt; $1,000.
                      </Alert>
                    </Grid>
                    <Grid item xs={4} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Typography variant="caption" sx={{ fontStyle: 'italic', textAlign: 'center' }}>
                        "Account A acts as a mule, moving $50k in and $49.5k out."
                      </Typography>
                    </Grid>
                  </Grid>
                </AccordionDetails>
              </Accordion>

              <Accordion variant="outlined" sx={{ borderColor: 'info.light' }}>
                <AccordionSummary expandIcon={<ExpandMore />} sx={{ bgcolor: '#eff6ff' }}>
                  <Typography fontWeight="bold" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Grain color="info" /> 2. Fan-Out Dispersion (Structuring/Smurfing)
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Typography variant="body2" paragraph>
                    <strong>Behavior:</strong> A single entity breaking a large sum into smaller payments to multiple recipients to avoid reporting thresholds or confuse tracers.
                  </Typography>
                  <Alert severity="info">
                    <strong>Detection Logic:</strong>
                    <br/>
                    • Identify nodes with <strong>Out-Degree &ge; 4</strong> (Sending to 4+ unique targets).
                    <br/>
                    • Flags as "Medium Severity" evidence.
                  </Alert>
                </AccordionDetails>
              </Accordion>

              <Accordion variant="outlined" sx={{ borderColor: 'error.light' }}>
                <AccordionSummary expandIcon={<ExpandMore />} sx={{ bgcolor: '#fef2f2' }}>
                  <Typography fontWeight="bold" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Warning color="error" /> 3. Circular Flow (Round Tripping)
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Typography variant="body2" paragraph>
                    <strong>Behavior:</strong> Money moving in a closed loop (A → B → C → A) to artificially inflate turnover or create a fake audit trail.
                  </Typography>
                  <Alert severity="error">
                    <strong>Detection Logic:</strong>
                    <br/>
                    • Uses <code>NetworkX simple_cycles</code> algorithm.
                    <br/>
                    • Detects loops of any length (e.g., 3-hop or 10-hop cycles).
                    <br/>
                    • Flags as <strong>Critical Severity</strong> immediately.
                  </Alert>
                </AccordionDetails>
              </Accordion>
            </Stack>
          </Box>
        )}

        {/* --- TAB 3: SCORING LOGIC --- */}
        {tab === 3 && (
          <Box>
            <Typography variant="h5" gutterBottom color="primary.dark" fontWeight="bold">
              4. The Risk Scoring Algorithm
            </Typography>
            <Typography variant="body1" paragraph>
              The "Risk Score" (0-100) shown on nodes is not random. It is deterministically calculated based on graph topology and neighbor contamination.
            </Typography>

            <Paper variant="outlined" sx={{ p: 4, bgcolor: '#263238', color: '#fff', fontFamily: 'monospace', mb: 3 }}>
              <Typography variant="h6" color="#80cbc4" gutterBottom>
                // Backend Logic (graph_builder.py)
              </Typography>
              <Box sx={{ pl: 2, borderLeft: '2px solid #546e7a' }}>
                <Typography variant="body2" sx={{ mb: 1 }}>
                  Base_Score = 0
                </Typography>
                <Typography variant="body2" sx={{ mb: 1 }}>
                  # 1. Neighbor Contamination (Guilt by Association)<br/>
                  If neighbor is ALERT or High Risk: <span style={{ color: '#ffcc80' }}>Score += 10 points per neighbor</span>
                </Typography>
                <Typography variant="body2" sx={{ mb: 1 }}>
                  # 2. Volume Magnitude (Logarithmic)<br/>
                  <span style={{ color: '#ffcc80' }}>Score += Math.log(Volume) * 3</span>
                </Typography>
                <Typography variant="body2" sx={{ mb: 1 }}>
                  # 3. Structural Risk (Cycles)<br/>
                  If node in Circular Flow: <span style={{ color: '#ffab91' }}>Score += 25 points (Immediate Spike)</span>
                </Typography>
                <Typography variant="body2">
                  Final_Score = Min(100, Base_Score)
                </Typography>
              </Box>
            </Paper>

            <Alert severity="info">
              <strong>Impact:</strong> This means a clean account (no alerts) can still be flagged as <strong>High Risk (Red)</strong> simply by receiving funds from a dirty wallet or participating in a laundering loop.
            </Alert>
          </Box>
        )}

        {/* --- TAB 4: DATA LINEAGE --- */}
        {tab === 4 && (
          <Box>
            <Typography variant="h5" gutterBottom color="primary.dark" fontWeight="bold">
              5. Data Sources & Schema
            </Typography>
            <Typography variant="body1" paragraph>
              The graph is constructed by dynamically querying multiple tables in the underlying <code>investigation.db</code>. It does not require a rigid schema but adapts to available data columns.
            </Typography>

            <Grid container spacing={2}>
              <Grid item xs={12} md={4}>
                <Card variant="outlined">
                  <Box sx={{ p: 1, bgcolor: '#e3f2fd', borderBottom: '1px solid #ddd' }}>
                    <Typography variant="subtitle2" fontWeight="bold">ALERTS Table</Typography>
                  </Box>
                  <List dense>
                    <ListItem><ListItemIcon><Storage fontSize="small"/></ListItemIcon><ListItemText primary="Case ID" secondary="Links to central Case Node" /></ListItem>
                    <ListItem><ListItemIcon><Storage fontSize="small"/></ListItemIcon><ListItemText primary="Severity" secondary="Sets base Risk Score" /></ListItem>
                  </List>
                </Card>
              </Grid>
              <Grid item xs={12} md={4}>
                <Card variant="outlined">
                  <Box sx={{ p: 1, bgcolor: '#e8f5e9', borderBottom: '1px solid #ddd' }}>
                    <Typography variant="subtitle2" fontWeight="bold">TRANSACTIONS Table</Typography>
                  </Box>
                  <List dense>
                    <ListItem><ListItemIcon><CompareArrows fontSize="small"/></ListItemIcon><ListItemText primary="Source / Target" secondary="Creates Edges" /></ListItem>
                    <ListItem><ListItemIcon><CompareArrows fontSize="small"/></ListItemIcon><ListItemText primary="Amount" secondary="Determines Line Width" /></ListItem>
                  </List>
                </Card>
              </Grid>
              <Grid item xs={12} md={4}>
                <Card variant="outlined">
                  <Box sx={{ p: 1, bgcolor: '#fff3e0', borderBottom: '1px solid #ddd' }}>
                    <Typography variant="subtitle2" fontWeight="bold">ACCOUNTS Table</Typography>
                  </Box>
                  <List dense>
                    <ListItem><ListItemIcon><Grain fontSize="small"/></ListItemIcon><ListItemText primary="Account ID" secondary="Merges duplicate entities" /></ListItem>
                    <ListItem><ListItemIcon><Grain fontSize="small"/></ListItemIcon><ListItemText primary="Customer Link" secondary="Links to KYC profile" /></ListItem>
                  </List>
                </Card>
              </Grid>
            </Grid>

            <Box sx={{ mt: 3 }}>
              <Typography variant="subtitle2" fontWeight="bold" gutterBottom>Data Merging Logic</Typography>
              <Typography variant="body2" color="text.secondary">
                The builder employs a "Fuzzy Column Matching" algorithm. It looks for columns named <code>acct_id</code>, <code>account_no</code>, or <code>beneficiary</code> to automatically deduce relationships, meaning it works even if column names vary slightly between environments.
              </Typography>
            </Box>
          </Box>
        )}

      </DialogContent>
      <DialogActions sx={{ p: 3, bgcolor: 'grey.50' }}>
        <Button onClick={onClose} variant="contained" size="large" color="primary">
          Return to Investigation
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default NetworkGraphManual;