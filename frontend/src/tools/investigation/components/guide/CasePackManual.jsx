import React from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Typography, Box, Divider, Grid, Paper,
  List, ListItem, ListItemIcon, ListItemText, Chip,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Alert, Stack, Accordion, AccordionSummary, AccordionDetails
} from '@mui/material';
import {
  School, AutoGraph, AccountBalance, 
  Hub, Psychology, ExpandMore, 
  Warning, Speed, SavedSearch
} from '@mui/icons-material';

/**
 * Case Pack Manual & Documentation
 * Explains the "Investigation Workbench" features and backend logic.
 */
const CasePackManual = ({ open, onClose }) => {
  
  return (
    <Dialog 
      open={open} 
      onClose={onClose} 
      maxWidth="md" 
      fullWidth
      scroll="paper"
      aria-labelledby="manual-title"
    >
      <DialogTitle id="manual-title" sx={{ display: 'flex', alignItems: 'center', gap: 1, borderBottom: '1px solid #eee', bgcolor: 'primary.main', color: 'white' }}>
        <School />
        <Typography variant="h6" fontWeight="bold">Investigation Workbench: User Guide</Typography>
      </DialogTitle>

      <DialogContent dividers sx={{ p: 3 }}>
        
        {/* SECTION 1: OVERVIEW */}
        <Box mb={4}>
          <Typography variant="h6" gutterBottom color="primary.main" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <SavedSearch fontSize="small" /> 1. The Case Pack Concept
          </Typography>
          <Typography variant="body2" paragraph>
            The <strong>Case Pack</strong> is a digital dossier that instantly aggregates all data related to a subject. 
            Instead of manually searching 10 different database tables (Alerts, Transactions, KYC, etc.), the system 
            generates this "Pack" in real-time.
          </Typography>
          <Alert severity="success" variant="outlined" sx={{ mb: 2 }}>
            <strong>Capabilities:</strong> Real-time Financial Profiling • Visual Link Analysis • Automated Typology Detection • AI-Assisted Narratives
          </Alert>
        </Box>

        <Divider sx={{ my: 3 }} />

        {/* SECTION 2: RISK SCORING */}
        <Box mb={4}>
          <Typography variant="h6" gutterBottom color="primary.main" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Speed fontSize="small" /> 2. Dynamic Risk Scoring
          </Typography>
          <Typography variant="body2" paragraph>
            The "Risk Score" you see in the top right is <strong>not static</strong>. It is calculated dynamically 
            every time you open a case, based on the live data found in the `case_pack_generator`.
          </Typography>
          
          <TableContainer component={Paper} variant="outlined" sx={{ mb: 2 }}>
            <Table size="small">
              <TableHead sx={{ bgcolor: 'grey.50' }}>
                <TableRow>
                  <TableCell><strong>Risk Factor</strong></TableCell>
                  <TableCell><strong>Weight</strong></TableCell>
                  <TableCell><strong>Why?</strong></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                <TableRow>
                  <TableCell><strong>Active Alerts</strong></TableCell>
                  <TableCell>+15 pts per alert</TableCell>
                  <TableCell>Direct indicator of suspicious activity.</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell><strong>High Volume</strong></TableCell>
                  <TableCell>+20 pts</TableCell>
                  <TableCell>Triggered if Total Volume {'>'} 100,000.</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell><strong>Typology Detected</strong></TableCell>
                  <TableCell>+40 pts</TableCell>
                  <TableCell>Specific patterns found (e.g., Structuring/Smurfing).</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>
          <Typography variant="caption" color="text.secondary">
            * Logic source: <code>_calculate_dynamic_risk</code> method in backend. Max score is capped at 99.
          </Typography>
        </Box>

        <Divider sx={{ my: 3 }} />

        {/* SECTION 3: TAB GUIDANCE */}
        <Box mb={4}>
          <Typography variant="h6" gutterBottom color="primary.main" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <AutoGraph fontSize="small" /> 3. Workbench Tools (Tabs)
          </Typography>
          
          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <Accordion defaultExpanded variant="outlined">
                <AccordionSummary expandIcon={<ExpandMore />}>
                  <Typography fontWeight="bold" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Hub color="primary" fontSize="small"/> Evidence (Link Analysis)
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Typography variant="body2">
                    Visualizes the "Money Flow". The central node is the Subject. 
                    The outer nodes are <strong>Counterparties</strong> (people sending/receiving money).
                    <br/><br/>
                    <strong>Logic:</strong> The system scans all transactions, groups them by 'Party Name', sums the volume, 
                    and visualizes the top 5 connections.
                  </Typography>
                </AccordionDetails>
              </Accordion>
            </Grid>

            <Grid item xs={12} md={6}>
              <Accordion defaultExpanded variant="outlined">
                <AccordionSummary expandIcon={<ExpandMore />}>
                  <Typography fontWeight="bold" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <AccountBalance color="success" fontSize="small"/> Ledger
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Typography variant="body2">
                    The raw forensic audit trail. This is the source of truth.
                    <br/><br/>
                    <strong>Tip:</strong> If the "Evidence" tab looks empty, check the Ledger. 
                    If the Ledger is empty, the system could not link transactions to this Case ID.
                  </Typography>
                </AccordionDetails>
              </Accordion>
            </Grid>

            <Grid item xs={12} md={6}>
              <Accordion variant="outlined">
                <AccordionSummary expandIcon={<ExpandMore />}>
                  <Typography fontWeight="bold" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Psychology color="secondary" fontSize="small"/> AI Explain & Review
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Typography variant="body2">
                    <strong>AI Explain:</strong> Generates a narrative summary of <em>why</em> this case is risky.
                    <br/>
                    <strong>AI Review:</strong> Suggests next steps (e.g., "File SAR" or "Close Case") based on the data.
                  </Typography>
                </AccordionDetails>
              </Accordion>
            </Grid>

            <Grid item xs={12} md={6}>
              <Accordion variant="outlined">
                <AccordionSummary expandIcon={<ExpandMore />}>
                  <Typography fontWeight="bold" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Warning color="error" fontSize="small"/> Typology Detection
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Typography variant="body2">
                    The system automatically runs rules against the transaction history.
                    <br/><br/>
                    <strong>Example:</strong> "Structuring" is flagged if multiple transactions appear between 
                    9,000 and 10,000 (attempting to evade reporting thresholds).
                  </Typography>
                </AccordionDetails>
              </Accordion>
            </Grid>
          </Grid>
        </Box>

        <Divider sx={{ my: 3 }} />

        {/* SECTION 4: ACTIONS */}
        <Box mb={2}>
          <Typography variant="h6" gutterBottom color="primary.main" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <School fontSize="small" /> 4. Investigator Workflow
          </Typography>
          <List dense>
            <ListItem>
              <ListItemIcon><Chip label="1" size="small" color="primary"/></ListItemIcon>
              <ListItemText 
                primary="Select a Case" 
                secondary="Use the 'Case Menu' button to open the drawer. You can search by Case ID or scroll the list." 
              />
            </ListItem>
            <ListItem>
              <ListItemIcon><Chip label="2" size="small" color="primary"/></ListItemIcon>
              <ListItemText 
                primary="Review the Overview" 
                secondary="Check the Risk Score and Monthly Velocity trend. A sudden spike in the bar chart is a red flag." 
              />
            </ListItem>
            <ListItem>
              <ListItemIcon><Chip label="3" size="small" color="primary"/></ListItemIcon>
              <ListItemText 
                primary="Check Connections" 
                secondary="Go to the 'Evidence' tab. Is money flowing to high-risk jurisdictions or unknown entities?" 
              />
            </ListItem>
            <ListItem>
              <ListItemIcon><Chip label="4" size="small" color="primary"/></ListItemIcon>
              <ListItemText 
                primary="Take Action" 
                secondary="Use the 'Close Case' button if it's a False Positive, or use the 'AI Review' tab to draft a SAR." 
              />
            </ListItem>
          </List>
        </Box>

      </DialogContent>
      <DialogActions sx={{ p: 2, bgcolor: 'grey.50' }}>
        <Button onClick={onClose} variant="contained" color="primary">
          Close Manual
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default CasePackManual;
