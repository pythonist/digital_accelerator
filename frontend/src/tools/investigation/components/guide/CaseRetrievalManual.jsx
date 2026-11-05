import React, { useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Typography, Box, Grid, Paper,
  List, ListItem, ListItemIcon, ListItemText, Chip,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Alert, Stack, Tabs, Tab
} from '@mui/material';
import {
  CompareArrows, Speed, AccountTree, Hub,
  AutoAwesome, Functions, Shield,
  DataObject, Storage, CheckCircle, WarningAmber,
  Timeline, TrendingUp, Category, Rule
} from '@mui/icons-material';

/**
 * Case Retrieval & Comparison Manual
 * Explains the 4 Similarity Modes, Vector Architecture & Precedent Review.
 */
const CaseRetrievalManual = ({ open, onClose }) => {
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
      aria-labelledby="case-retrieval-manual-title"
    >
      {/* Header */}
      <DialogTitle id="case-retrieval-manual-title" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, borderBottom: '1px solid #eee', bgcolor: '#f8fafc', p: 2 }}>
        <CompareArrows color="primary" sx={{ fontSize: 30 }} />
        <Box>
          <Typography variant="h6" fontWeight="bold" color="text.primary">Case Retrieval & Comparison Guide</Typography>
          <Typography variant="caption" color="text.secondary">Similarity Modes, Feature Vector Architecture & Precedent Review</Typography>
        </Box>
      </DialogTitle>

      {/* Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 3, bgcolor: '#fff' }}>
        <Tabs value={tab} onChange={handleTabChange} variant="scrollable" scrollButtons="auto">
          <Tab icon={<AutoAwesome fontSize="small" />} iconPosition="start" label="4 Similarity Modes" />
          <Tab icon={<Functions fontSize="small" />} iconPosition="start" label="Vector Architecture & Math" />
          <Tab icon={<Timeline fontSize="small" />} iconPosition="start" label="Precedent & Playbook" />
          <Tab icon={<Shield fontSize="small" />} iconPosition="start" label="Examiner Audit Defense" />
        </Tabs>
      </Box>

      {/* Content */}
      <DialogContent dividers sx={{ p: 4, minHeight: 440 }}>
        
        {/* --- TAB 0: 4 SIMILARITY MODES --- */}
        {tab === 0 && (
          <Box>
            <Typography variant="h5" gutterBottom color="primary.dark" fontWeight="bold">
              1. The 4 Forensic Similarity Lenses
            </Typography>
            <Typography variant="body1" paragraph>
              Rather than matching simple text labels, the Case Retrieval Engine converts each case into a <strong>32-dimensional empirical feature vector</strong> defined in <code>case_profile_builder.py</code>. Investigators can toggle between <strong>4 distinct mathematical lenses</strong> depending on the investigation hypothesis.
            </Typography>

            <Alert severity="info" sx={{ mb: 3 }}>
              <strong>How it works:</strong> Each similarity mode emphasizes different risk dimensions—isolating transactional rhythm, financial crime typologies, counterparty graph structures, or calculating an ensemble composite score.
            </Alert>

            <Grid container spacing={3}>
              {/* Behavioral Similarity */}
              <Grid item xs={12} md={6}>
                <Paper variant="outlined" sx={{ p: 0, overflow: 'hidden', height: '100%', display: 'flex', flexDirection: 'column' }}>
                  <Box sx={{ p: 2, bgcolor: '#e0f2fe', borderBottom: '1px solid #bae6fd', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Speed sx={{ color: '#0284c7' }} />
                      <Typography variant="subtitle2" fontWeight="bold" color="#0369a1">1. Behavioral Similarity (11 Dimensions)</Typography>
                    </Stack>
                    <Chip label="Cash Dynamics" size="small" sx={{ bgcolor: '#bae6fd', color: '#0369a1', fontWeight: 'bold', fontSize: 10 }} />
                  </Box>
                  <Box sx={{ p: 2, flexGrow: 1 }}>
                    <Typography variant="body2" color="text.secondary" paragraph>
                      <strong>What it does:</strong> Analyzes transactional velocity, cash flow symmetry, peak amounts, and temporal activity patterns.
                    </Typography>
                    <Typography variant="caption" fontWeight="bold" color="text.primary" sx={{ display: 'block', mb: 1, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      Underlying Features:
                    </Typography>
                    <List dense disablePadding>
                      <ListItem disableGutters sx={{ py: 0.25 }}>
                        <ListItemIcon sx={{ minWidth: 24 }}><DataObject fontSize="inherit" color="primary" /></ListItemIcon>
                        <ListItemText primary="Transaction Volume: ln(Count), ln(Total), ln(Avg), ln(Max)" />
                      </ListItem>
                      <ListItem disableGutters sx={{ py: 0.25 }}>
                        <ListItemIcon sx={{ minWidth: 24 }}><DataObject fontSize="inherit" color="primary" /></ListItemIcon>
                        <ListItemText primary="Temporal Footprint: Burstiness index, Off-hours & Weekend ratios" />
                      </ListItem>
                      <ListItem disableGutters sx={{ py: 0.25 }}>
                        <ListItemIcon sx={{ minWidth: 24 }}><DataObject fontSize="inherit" color="primary" /></ListItemIcon>
                        <ListItemText primary="Flow Symmetry: In/Out imbalance ratio, Pass-through symmetry ratio" />
                      </ListItem>
                      <ListItem disableGutters sx={{ py: 0.25 }}>
                        <ListItemIcon sx={{ minWidth: 24 }}><DataObject fontSize="inherit" color="primary" /></ListItemIcon>
                        <ListItemText primary="Counterparty Rhythm: Repeated beneficiary recurrence ratio" />
                      </ListItem>
                    </List>
                  </Box>
                  <Box sx={{ p: 1.5, bgcolor: '#f8fafc', borderTop: '1px solid #e2e8f0' }}>
                    <Typography variant="caption" color="#0369a1">
                      💡 <strong>Best for:</strong> Matching accounts with identical cash flow rhythms, burst velocity, or pass-through wash patterns.
                    </Typography>
                  </Box>
                </Paper>
              </Grid>

              {/* Typology Similarity */}
              <Grid item xs={12} md={6}>
                <Paper variant="outlined" sx={{ p: 0, overflow: 'hidden', height: '100%', display: 'flex', flexDirection: 'column' }}>
                  <Box sx={{ p: 2, bgcolor: '#fff3e0', borderBottom: '1px solid #ffe0b2', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <AccountTree sx={{ color: '#ea580c' }} />
                      <Typography variant="subtitle2" fontWeight="bold" color="#c2410c">2. Typology Similarity (6 Dimensions)</Typography>
                    </Stack>
                    <Chip label="FATF Typologies" size="small" sx={{ bgcolor: '#ffe0b2', color: '#c2410c', fontWeight: 'bold', fontSize: 10 }} />
                  </Box>
                  <Box sx={{ p: 2, flexGrow: 1 }}>
                    <Typography variant="body2" color="text.secondary" paragraph>
                      <strong>What it does:</strong> Evaluates specific financial crime modus operandi against established regulatory typologies.
                    </Typography>
                    <Typography variant="caption" fontWeight="bold" color="text.primary" sx={{ display: 'block', mb: 1, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      Underlying Features:
                    </Typography>
                    <List dense disablePadding>
                      <ListItem disableGutters sx={{ py: 0.25 }}>
                        <ListItemIcon sx={{ minWidth: 24 }}><DataObject fontSize="inherit" sx={{ color: '#ea580c' }} /></ListItemIcon>
                        <ListItemText primary="Structuring / Smurfing Score (0-1): Evading reporting limits" />
                      </ListItem>
                      <ListItem disableGutters sx={{ py: 0.25 }}>
                        <ListItemIcon sx={{ minWidth: 24 }}><DataObject fontSize="inherit" sx={{ color: '#ea580c' }} /></ListItemIcon>
                        <ListItemText primary="Layering Score (0-1): Multi-hop transfers and circular loops" />
                      </ListItem>
                      <ListItem disableGutters sx={{ py: 0.25 }}>
                        <ListItemIcon sx={{ minWidth: 24 }}><DataObject fontSize="inherit" sx={{ color: '#ea580c' }} /></ListItemIcon>
                        <ListItemText primary="Mule & Funnel Account Scores (0-1): Inbound-to-outbound dispersal" />
                      </ListItem>
                      <ListItem disableGutters sx={{ py: 0.25 }}>
                        <ListItemIcon sx={{ minWidth: 24 }}><DataObject fontSize="inherit" sx={{ color: '#ea580c' }} /></ListItemIcon>
                        <ListItemText primary="High-Risk Corridor Ratio: Exposure to FATF grey/black-list jurisdictions" />
                      </ListItem>
                    </List>
                  </Box>
                  <Box sx={{ p: 1.5, bgcolor: '#f8fafc', borderTop: '1px solid #e2e8f0' }}>
                    <Typography variant="caption" color="#c2410c">
                      💡 <strong>Best for:</strong> Finding historical precedents that share the exact laundering mechanics, regardless of dollar scale.
                    </Typography>
                  </Box>
                </Paper>
              </Grid>

              {/* Network Similarity */}
              <Grid item xs={12} md={6}>
                <Paper variant="outlined" sx={{ p: 0, overflow: 'hidden', height: '100%', display: 'flex', flexDirection: 'column' }}>
                  <Box sx={{ p: 2, bgcolor: '#f3e5f5', borderBottom: '1px solid #e1bee7', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Hub sx={{ color: '#9333ea' }} />
                      <Typography variant="subtitle2" fontWeight="bold" color="#7e22ce">3. Network Similarity (5 Dimensions)</Typography>
                    </Stack>
                    <Chip label="Graph & Counterparties" size="small" sx={{ bgcolor: '#e1bee7', color: '#7e22ce', fontWeight: 'bold', fontSize: 10 }} />
                  </Box>
                  <Box sx={{ p: 2, flexGrow: 1 }}>
                    <Typography variant="body2" color="text.secondary" paragraph>
                      <strong>What it does:</strong> Computes graph topology, entity clustering, and counterparty concentration.
                    </Typography>
                    <Typography variant="caption" fontWeight="bold" color="text.primary" sx={{ display: 'block', mb: 1, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      Underlying Features:
                    </Typography>
                    <List dense disablePadding>
                      <ListItem disableGutters sx={{ py: 0.25 }}>
                        <ListItemIcon sx={{ minWidth: 24 }}><DataObject fontSize="inherit" sx={{ color: '#9333ea' }} /></ListItemIcon>
                        <ListItemText primary="Counterparty Breadth: ln(1 + Unique Counterparties)" />
                      </ListItem>
                      <ListItem disableGutters sx={{ py: 0.25 }}>
                        <ListItemIcon sx={{ minWidth: 24 }}><DataObject fontSize="inherit" sx={{ color: '#9333ea' }} /></ListItemIcon>
                        <ListItemText primary="Counterparty Concentration: Herfindahl-Hirschman Index (HHI)" />
                      </ListItem>
                      <ListItem disableGutters sx={{ py: 0.25 }}>
                        <ListItemIcon sx={{ minWidth: 24 }}><DataObject fontSize="inherit" sx={{ color: '#9333ea' }} /></ListItemIcon>
                        <ListItemText primary="Shared Beneficiaries: Collisions with known network clusters" />
                      </ListItem>
                      <ListItem disableGutters sx={{ py: 0.25 }}>
                        <ListItemIcon sx={{ minWidth: 24 }}><DataObject fontSize="inherit" sx={{ color: '#9333ea' }} /></ListItemIcon>
                        <ListItemText primary="Graph Centrality: Degree connectivity and multi-tier density" />
                      </ListItem>
                    </List>
                  </Box>
                  <Box sx={{ p: 1.5, bgcolor: '#f8fafc', borderTop: '1px solid #e2e8f0' }}>
                    <Typography variant="caption" color="#7e22ce">
                      💡 <strong>Best for:</strong> Uncovering collusive rings, shell company syndicates, and shared money mule networks.
                    </Typography>
                  </Box>
                </Paper>
              </Grid>

              {/* Hybrid Similarity */}
              <Grid item xs={12} md={6}>
                <Paper variant="outlined" sx={{ p: 0, overflow: 'hidden', height: '100%', display: 'flex', flexDirection: 'column' }}>
                  <Box sx={{ p: 2, bgcolor: '#ede9fe', borderBottom: '1px solid #ddd6fe', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <AutoAwesome sx={{ color: '#6d28d9' }} />
                      <Typography variant="subtitle2" fontWeight="bold" color="#5b21b6">4. Hybrid Similarity (100% Ensemble)</Typography>
                    </Stack>
                    <Chip label="Weighted Composite" size="small" sx={{ bgcolor: '#ddd6fe', color: '#5b21b6', fontWeight: 'bold', fontSize: 10 }} />
                  </Box>
                  <Box sx={{ p: 2, flexGrow: 1 }}>
                    <Typography variant="body2" color="text.secondary" paragraph>
                      <strong>What it does:</strong> Fuses all 4 dimensions into a unified, balanced similarity score using customizable weights.
                    </Typography>
                    <Typography variant="caption" fontWeight="bold" color="text.primary" sx={{ display: 'block', mb: 1, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      Default Weight Distribution:
                    </Typography>
                    <List dense disablePadding>
                      <ListItem disableGutters sx={{ py: 0.25 }}>
                        <ListItemIcon sx={{ minWidth: 24 }}><DataObject fontSize="inherit" sx={{ color: '#6d28d9' }} /></ListItemIcon>
                        <ListItemText primary="45% Behavioral Dynamics: Transaction velocity and flow symmetry" />
                      </ListItem>
                      <ListItem disableGutters sx={{ py: 0.25 }}>
                        <ListItemIcon sx={{ minWidth: 24 }}><DataObject fontSize="inherit" sx={{ color: '#6d28d9' }} /></ListItemIcon>
                        <ListItemText primary="25% Typology Indicators: FATF crime scenario scoring" />
                      </ListItem>
                      <ListItem disableGutters sx={{ py: 0.25 }}>
                        <ListItemIcon sx={{ minWidth: 24 }}><DataObject fontSize="inherit" sx={{ color: '#6d28d9' }} /></ListItemIcon>
                        <ListItemText primary="20% Network Topology: Graph concentration and entity links" />
                      </ListItem>
                      <ListItem disableGutters sx={{ py: 0.25 }}>
                        <ListItemIcon sx={{ minWidth: 24 }}><DataObject fontSize="inherit" sx={{ color: '#6d28d9' }} /></ListItemIcon>
                        <ListItemText primary="10% Alert & CDD Risk: Alert counts, KYC completeness, PEP/sanctions" />
                      </ListItem>
                    </List>
                  </Box>
                  <Box sx={{ p: 1.5, bgcolor: '#f8fafc', borderTop: '1px solid #e2e8f0' }}>
                    <Typography variant="caption" color="#5b21b6">
                      💡 <strong>Best for:</strong> Default general-purpose search. Delivers the most balanced and defensible peer comparisons.
                    </Typography>
                  </Box>
                </Paper>
              </Grid>
            </Grid>
          </Box>
        )}

        {/* --- TAB 1: VECTOR ARCHITECTURE & MATH --- */}
        {tab === 1 && (
          <Box>
            <Typography variant="h5" gutterBottom color="primary.dark" fontWeight="bold">
              2. Vector Architecture & Mathematical Pipeline
            </Typography>
            <Typography variant="body1" paragraph>
              The system standardizes feature spaces across multiple tables to ensure high-volume commercial entities do not distort retail structuring patterns.
            </Typography>

            <Alert severity="success" sx={{ mb: 3 }}>
              <strong>Mathematical Guarantee:</strong> Vectors are standardized with Z-scores and projected onto an L2 unit hypersphere, making FAISS cosine similarity bounded strictly between <code>0.0 (0% match)</code> and <code>1.0 (100% match)</code>.
            </Alert>

            <Grid container spacing={3} sx={{ mb: 3 }}>
              <Grid item xs={12} md={6}>
                <Paper variant="outlined" sx={{ p: 2.5, bgcolor: '#f8fafc' }}>
                  <Typography variant="subtitle2" fontWeight="bold" color="primary.dark" gutterBottom>
                    📐 Mathematical Transformation Stages
                  </Typography>
                  <List dense>
                    <ListItem>
                      <ListItemIcon><Functions color="primary" /></ListItemIcon>
                      <ListItemText 
                        primary="1. Log Compression" 
                        secondary="x_scaled = ln(1 + x) — Eliminates extreme dollar skew" 
                      />
                    </ListItem>
                    <ListItem>
                      <ListItemIcon><Functions color="primary" /></ListItemIcon>
                      <ListItemText 
                        primary="2. Z-Score Standardization" 
                        secondary="z = (x - μ) / σ — Normalizes feature variance across population" 
                      />
                    </ListItem>
                    <ListItem>
                      <ListItemIcon><Functions color="primary" /></ListItemIcon>
                      <ListItemText 
                        primary="3. L2 Unit Normalization" 
                        secondary="v_norm = v / ||v||_2 — Projects vector onto unit sphere" 
                      />
                    </ListItem>
                    <ListItem>
                      <ListItemIcon><Functions color="primary" /></ListItemIcon>
                      <ListItemText 
                        primary="4. FAISS FlatIP Search" 
                        secondary="Similarity = A · B = Σ (A_i * B_i) — Exact inner product cosine match" 
                      />
                    </ListItem>
                  </List>
                </Paper>
              </Grid>

              <Grid item xs={12} md={6}>
                <Paper variant="outlined" sx={{ p: 2.5, bgcolor: '#f8fafc' }}>
                  <Typography variant="subtitle2" fontWeight="bold" color="secondary.dark" gutterBottom>
                    🗂️ Multi-Table Data Ingestion Map
                  </Typography>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 'bold' }}>Source Table</TableCell>
                          <TableCell sx={{ fontWeight: 'bold' }}>Extracted Features</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        <TableRow>
                          <TableCell><code>transactions</code></TableCell>
                          <TableCell>Velocity, amounts, timestamps, flow symmetry, counterparties</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell><code>alerts</code></TableCell>
                          <TableCell>Alert counts, dominant scenarios, recurrence frequency</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell><code>customers</code></TableCell>
                          <TableCell>KYC completeness, PEP, sanctions, customer risk rating</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell><code>accounts</code></TableCell>
                          <TableCell>Account tenure, product type, linked account count</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Paper>
              </Grid>
            </Grid>
          </Box>
        )}

        {/* --- TAB 2: PRECEDENT & PLAYBOOK --- */}
        {tab === 2 && (
          <Box>
            <Typography variant="h5" gutterBottom color="primary.dark" fontWeight="bold">
              3. Investigator Playbook & Precedent Review
            </Typography>
            <Typography variant="body1" paragraph>
              Historical case outcomes (e.g. <em>SAR Recommended</em> vs <em>Closed without Action</em>) provide quantifiable benchmark precedents for consistent and defensible decision-making.
            </Typography>

            <Grid container spacing={3}>
              <Grid item xs={12} md={4}>
                <Paper variant="outlined" sx={{ p: 2.5, bgcolor: '#f0fdf4', borderColor: '#bbf7d0' }}>
                  <Typography variant="subtitle2" fontWeight="bold" color="#166534" gutterBottom>
                    🟢 90%+ Match (Critical Precedent)
                  </Typography>
                  <Typography variant="body2" color="#14532d">
                    Near-identical operational or typology footprint. Strongly review historical SAR narratives or closure rationale.
                  </Typography>
                </Paper>
              </Grid>
              <Grid item xs={12} md={4}>
                <Paper variant="outlined" sx={{ p: 2.5, bgcolor: '#fefce8', borderColor: '#fef08a' }}>
                  <Typography variant="subtitle2" fontWeight="bold" color="#854d0e" gutterBottom>
                    🟡 75% - 89% Match (Strong Correlation)
                  </Typography>
                  <Typography variant="body2" color="#713f12">
                    Strong behavioral or structural correlation. Examine shared indicators, counterparty overlap, and flow imbalance.
                  </Typography>
                </Paper>
              </Grid>
              <Grid item xs={12} md={4}>
                <Paper variant="outlined" sx={{ p: 2.5, bgcolor: '#f8fafc', borderColor: '#e2e8f0' }}>
                  <Typography variant="subtitle2" fontWeight="bold" color="#475569" gutterBottom>
                    ⚪ 50% - 74% Match (Moderate Resemblance)
                  </Typography>
                  <Typography variant="body2" color="#334155">
                    Broad typology or industry cohort resemblance. Useful for sector-wide baseline benchmarking.
                  </Typography>
                </Paper>
              </Grid>
            </Grid>

            <Box sx={{ mt: 3 }}>
              <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                Why Do Some Highly Similar Cases Have Different Outcomes?
              </Typography>
              <Typography variant="body2" color="text.secondary" paragraph>
                Two cases with a 95% match score may resolve differently due to:
              </Typography>
              <List dense>
                <ListItem>
                  <ListItemIcon><CheckCircle color="success" fontSize="small" /></ListItemIcon>
                  <ListItemText primary="Enhanced Customer Due Diligence (EDD)" secondary="Verified legitimate commercial contracts or source of wealth documentation" />
                </ListItem>
                <ListItem>
                  <ListItemIcon><CheckCircle color="success" fontSize="small" /></ListItemIcon>
                  <ListItemText primary="Cross-Border Jurisdictional Thresholds" secondary="Varying regulatory filing limits between domestic and international corridors" />
                </ListItem>
                <ListItem>
                  <ListItemIcon><CheckCircle color="success" fontSize="small" /></ListItemIcon>
                  <ListItemText primary="Adverse Media & Law Enforcement Inquiries" secondary="External subpoenas or negative news triggering mandatory escalation on one entity" />
                </ListItem>
              </List>
            </Box>
          </Box>
        )}

        {/* --- TAB 3: EXAMINER AUDIT DEFENSE --- */}
        {tab === 3 && (
          <Box>
            <Typography variant="h5" gutterBottom color="primary.dark" fontWeight="bold">
              4. Regulatory Examiner Challenge Defense
            </Typography>
            <Typography variant="body1" paragraph>
              When regulators (OCC, FinCEN, RBI, FCA) or internal audit examine AML dispositions, citing quantifiable empirical peer matches establishes procedural consistency.
            </Typography>

            <Alert severity="warning" sx={{ mb: 3 }}>
              <strong>Audit Defense Standard:</strong> Documenting that an account's velocity matched a prior SAR-filed precedent with 92% typology similarity provides defensible mathematical rationale.
            </Alert>

            <Paper variant="outlined" sx={{ p: 3, bgcolor: '#ffffff' }}>
              <Typography variant="subtitle2" fontWeight="bold" color="primary.dark" gutterBottom>
                Procedural Audit Defense Checklist:
              </Typography>
              <List dense>
                <ListItem>
                  <ListItemIcon><Rule color="primary" /></ListItemIcon>
                  <ListItemText 
                    primary="1. Export Case Comparison Report" 
                    secondary="Generate a side-by-side evidence matrix comparing the active case against 2-3 historical precedents." 
                  />
                </ListItem>
                <ListItem>
                  <ListItemIcon><Rule color="primary" /></ListItemIcon>
                  <ListItemText 
                    primary="2. Document Shared Risk Indicators" 
                    secondary="Highlight common typology triggers (e.g., pass-through flow, repeated counterparties, burst velocity)." 
                  />
                </ListItem>
                <ListItem>
                  <ListItemIcon><Rule color="primary" /></ListItemIcon>
                  <ListItemText 
                    primary="3. Detail Rationale for Escalation or Dismissal" 
                    secondary="Explain why the case followed or deviated from historical peer outcomes based on verified CDD findings." 
                  />
                </ListItem>
              </List>
            </Paper>
          </Box>
        )}

      </DialogContent>

      {/* Footer */}
      <DialogActions sx={{ p: 2, bgcolor: '#f8fafc', borderTop: '1px solid #eee' }}>
        <Button 
          onClick={onClose} 
          variant="contained" 
          sx={{ 
            bgcolor: '#d9531e', 
            textTransform: 'none', 
            fontWeight: 'bold',
            px: 3,
            '&:hover': { bgcolor: '#b84010' } 
          }}
        >
          Got it
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default CaseRetrievalManual;
