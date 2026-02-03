import React from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Typography, Box, Divider, Grid, Paper,
  List, ListItem, ListItemIcon, ListItemText, Chip,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Alert, Stack, Accordion, AccordionSummary, AccordionDetails
} from '@mui/material';
import {
  AccountTree, Storage, VerifiedUser, 
  FindInPage, GppBad, ExpandMore, 
  FactCheck, DataObject, Link
} from '@mui/icons-material';

/**
 * Evidence Lineage Manual
 * Explains how to trace data provenance and verify system computations.
 */
const EvidenceLineageManual = ({ open, onClose }) => {
  
  return (
    <Dialog 
      open={open} 
      onClose={onClose} 
      maxWidth="md" 
      fullWidth
      scroll="paper"
      aria-labelledby="lineage-manual-title"
    >
      <DialogTitle id="lineage-manual-title" sx={{ display: 'flex', alignItems: 'center', gap: 1, borderBottom: '1px solid #eee', bgcolor: '#f3e5f5' }}>
        <AccountTree color="secondary" />
        <Typography variant="h6" fontWeight="bold" color="secondary.main">Evidence Lineage Explorer: User Guide</Typography>
      </DialogTitle>

      <DialogContent dividers sx={{ p: 3 }}>
        
        {/* SECTION 1: PURPOSE */}
        <Box mb={4}>
          <Typography variant="h6" gutterBottom color="secondary.main" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <VerifiedUser fontSize="small" /> 1. What is this tool?
          </Typography>
          <Typography variant="body2" paragraph>
            The <strong>Evidence Lineage Explorer</strong> is a forensic verification tool. Unlike the "Case Pack" which shows you <em>what</em> is happening, this screen shows you <em>how we know</em> it is happening.
          </Typography>
          <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>
            <strong>Goal:</strong> Validate that the "Risk Score" is based on real database records, not AI hallucinations or stale cache.
          </Alert>
        </Box>

        <Divider sx={{ my: 3 }} />

        {/* SECTION 2: READING THE TREE */}
        <Box mb={4}>
          <Typography variant="h6" gutterBottom color="secondary.main" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <AccountTree fontSize="small" /> 2. Reading the Lineage Tree
          </Typography>
          <Typography variant="body2" paragraph>
            The tree visualizes the path from the raw database table up to the final Risk Score.
          </Typography>
          
          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <Paper variant="outlined" sx={{ p: 2, height: '100%', borderColor: '#ce93d8', bgcolor: '#f3e5f5' }}>
                <Typography variant="subtitle2" color="secondary.main" fontWeight="bold">🟣 Lineage Nodes (The Logic)</Typography>
                <Divider sx={{ my: 1 }} />
                <List dense>
                  <ListItem disablePadding>
                    <ListItemIcon sx={{ minWidth: 30 }}><DataObject fontSize="small" color="primary" /></ListItemIcon>
                    <ListItemText primary="Derived Field" secondary="A calculated metric (e.g., 'Total Volume'). Click to see the math." />
                  </ListItem>
                  <ListItem disablePadding>
                    <ListItemIcon sx={{ minWidth: 30 }}><Link fontSize="small" color="action" /></ListItemIcon>
                    <ListItemText primary="Join Path" secondary="Shows how we linked tables (e.g., alerts.CASE_ID = cases.ID)." />
                  </ListItem>
                </List>
              </Paper>
            </Grid>
            <Grid item xs={12} md={6}>
              <Paper variant="outlined" sx={{ p: 2, height: '100%', borderColor: '#bdbdbd', bgcolor: '#fafafa' }}>
                <Typography variant="subtitle2" color="text.secondary" fontWeight="bold">⚪ Raw Data Nodes (The Proof)</Typography>
                <Divider sx={{ my: 1 }} />
                <List dense>
                  <ListItem disablePadding>
                    <ListItemIcon sx={{ minWidth: 30 }}><Storage fontSize="small" color="disabled" /></ListItemIcon>
                    <ListItemText primary="Source Table" secondary="The actual database table used (e.g., 'transactions')." />
                  </ListItem>
                  <ListItem disablePadding>
                    <ListItemIcon sx={{ minWidth: 30 }}><FindInPage fontSize="small" color="disabled" /></ListItemIcon>
                    <ListItemText primary="Row Record" secondary="Individual data rows you can inspect." />
                  </ListItem>
                </List>
              </Paper>
            </Grid>
          </Grid>
        </Box>

        <Divider sx={{ my: 3 }} />

        {/* SECTION 3: METRICS & FRESHNESS */}
        <Box mb={4}>
          <Typography variant="h6" gutterBottom color="secondary.main" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <FactCheck fontSize="small" /> 3. Verification Metrics
          </Typography>
          <Typography variant="body2" paragraph>
            When you click a node, check the <strong>Value Freshness</strong> badge in the details panel.
          </Typography>
          
          <TableContainer component={Paper} variant="outlined" sx={{ mb: 2 }}>
            <Table size="small">
              <TableHead sx={{ bgcolor: 'grey.50' }}>
                <TableRow>
                  <TableCell><strong>Freshness</strong></TableCell>
                  <TableCell><strong>Meaning</strong></TableCell>
                  <TableCell><strong>Action</strong></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                <TableRow>
                  <TableCell><Chip label="REALTIME" color="success" size="small" /></TableCell>
                  <TableCell>Computed <strong>right now</strong> from live DB query.</TableCell>
                  <TableCell>Trust this 100%.</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell><Chip label="CACHED" color="primary" size="small" /></TableCell>
                  <TableCell>Retrieved from a previous run (e.g., Risk Score).</TableCell>
                  <TableCell>Check "Last Run Date" to ensure it's not stale.</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell><Chip label="UNAVAILABLE" color="default" size="small" /></TableCell>
                  <TableCell>Calculation failed (e.g., missing column).</TableCell>
                  <TableCell>Report to engineering as a data quality issue.</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>
        </Box>

        <Divider sx={{ my: 3 }} />

        {/* SECTION 4: ACTIONS */}
        <Box mb={2}>
          <Typography variant="h6" gutterBottom color="secondary.main" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <GppBad fontSize="small" /> 4. Flagging Weak Evidence
          </Typography>
          <Typography variant="body2" paragraph>
            If you find a discrepancy (e.g., the Lineage says "50 Alerts" but you only see 2 rows in the Raw Data), use the <strong>Flag Weak Evidence</strong> button.
          </Typography>
          <List dense>
            <ListItem>
              <ListItemIcon><Chip label="1" size="small" color="warning"/></ListItemIcon>
              <ListItemText 
                primary="Select the Node" 
                secondary="Click on the specific metric or data source in the tree." 
              />
            </ListItem>
            <ListItem>
              <ListItemIcon><Chip label="2" size="small" color="warning"/></ListItemIcon>
              <ListItemText 
                primary="Click 'Flag Weak Evidence'" 
                secondary="This marks the node in orange and excludes it from the confidence score." 
              />
            </ListItem>
          </List>
        </Box>

      </DialogContent>
      <DialogActions sx={{ p: 2, bgcolor: 'grey.50' }}>
        <Button onClick={onClose} variant="contained" color="secondary">
          Close Guide
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default EvidenceLineageManual;