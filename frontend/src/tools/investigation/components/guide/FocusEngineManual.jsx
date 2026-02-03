import React from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Typography, Box, Divider, Grid, Paper,
  List, ListItem, ListItemIcon, ListItemText, Chip,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Alert, Stack
} from '@mui/material';
import {
  School, Calculate, Tune, Layers,
  CheckCircle, Cancel, Warning, Info,
  AutoGraph, Timer,
  LocalFireDepartment, Visibility, Block,
  CalendarToday, TrendingDown, Security
} from '@mui/icons-material';

/**
 * Focus Engine Manual & Documentation
 * Explains the backend logic found in focus_engine.py to the frontend user.
 */
const FocusEngineManual = ({ open, onClose }) => {
  
  return (
    <Dialog 
      open={open} 
      onClose={onClose} 
      maxWidth="md" 
      fullWidth
      scroll="paper"
      aria-labelledby="manual-title"
    >
      <DialogTitle id="manual-title" sx={{ display: 'flex', alignItems: 'center', gap: 1, borderBottom: '1px solid #eee' }}>
        <School color="primary" />
        <Typography variant="h6" fontWeight="bold">Focus Engine: User Manual & Logic Guide</Typography>
      </DialogTitle>

      <DialogContent dividers sx={{ p: 3 }}>
        
        {/* SECTION 1: OVERVIEW */}
        <Box mb={4}>
          <Typography variant="h6" gutterBottom color="primary.main" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <AutoGraph fontSize="small" /> 1. How it Works
          </Typography>
          <Typography variant="body2" paragraph>
            The Focus Engine is a deterministic risk scoring system designed to prioritize your inbox. 
            Unlike "black box" AI, this engine uses transparent, configurable weights to calculate a 
            <strong> 0-100 Risk Score</strong> for every case.
          </Typography>
          <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>
            <strong>Core Loop:</strong> Fetch Alerts → Calculate Score → Assign Reasons → Sort into Buckets → Save Snapshot
          </Alert>
        </Box>

        <Divider sx={{ my: 3 }} />

        {/* SECTION 2: SCORING LOGIC */}
        <Box mb={4}>
          <Typography variant="h6" gutterBottom color="primary.main" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Calculate fontSize="small" /> 2. The Math (Scoring Logic)
          </Typography>
          <Typography variant="body2" paragraph>
            Every alert associated with a case contributes to the total score. The engine sums these points 
            (capped at 100) to determine urgency.
          </Typography>
          
          <TableContainer component={Paper} variant="outlined" sx={{ mb: 2 }}>
            <Table size="small">
              <TableHead sx={{ bgcolor: 'grey.50' }}>
                <TableRow>
                  <TableCell><strong>Alert Severity</strong></TableCell>
                  <TableCell><strong>Points Added</strong></TableCell>
                  <TableCell><strong>Impact</strong></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                <TableRow>
                  <TableCell><Chip label="CRITICAL" color="error" size="small" /></TableCell>
                  <TableCell><strong>+20 points</strong></TableCell>
                  <TableCell>Major risk driver. Often triggers immediate priority.</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell><Chip label="HIGH" color="warning" size="small" /></TableCell>
                  <TableCell><strong>+10 points</strong></TableCell>
                  <TableCell>Significant contributor to risk score.</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell><Chip label="MEDIUM" color="info" size="small" /></TableCell>
                  <TableCell><strong>+5 points</strong></TableCell>
                  <TableCell>Moderate impact. Accumulates volume risk.</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell><Chip label="LOW" size="small" /></TableCell>
                  <TableCell><strong>+1 point</strong></TableCell>
                  <TableCell>Minor impact. Used for noise filtering.</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>
          <Typography variant="caption" color="text.secondary">
            * Scores are capped at 100 maximum. 
            * Logic source: <code>_analyze_entity</code> method in backend.
          </Typography>
        </Box>

        <Divider sx={{ my: 3 }} />

        {/* SECTION 3: BUCKETING STRATEGY */}
        <Box mb={4}>
          <Typography variant="h6" gutterBottom color="primary.main" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Layers fontSize="small" /> 3. Bucketing Rules
          </Typography>
          <Typography variant="body2" paragraph>
            Once scored, cases are automatically routed into one of three buckets. 
            You can customize these thresholds in the "Engine Configuration" panel.
          </Typography>

          <Grid container spacing={2}>
            <Grid item xs={12} md={4}>
              <Paper variant="outlined" sx={{ p: 2, height: '100%', borderColor: 'error.light', bgcolor: '#fff5f5' }}>
                <Typography variant="subtitle2" color="error.main" fontWeight="bold" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <LocalFireDepartment fontSize="small" /> PRIORITY
                </Typography>
                <Divider sx={{ my: 1 }} />
                <List dense disablePadding>
                  <ListItem disablePadding><ListItemIcon sx={{ minWidth: 30 }}><CheckCircle fontSize="small" color="error"/></ListItemIcon>
                    <ListItemText primary="Score ≥ 80" />
                  </ListItem>
                  <ListItem disablePadding><ListItemIcon sx={{ minWidth: 30 }}><CheckCircle fontSize="small" color="error"/></ListItemIcon>
                    <ListItemText primary="OR Critical Alert exists" />
                  </ListItem>
                </List>
                <Typography variant="caption" sx={{ mt: 1, display: 'block' }}>Action: Immediate Investigation</Typography>
              </Paper>
            </Grid>
            <Grid item xs={12} md={4}>
              <Paper variant="outlined" sx={{ p: 2, height: '100%', borderColor: 'warning.light', bgcolor: '#fffbf0' }}>
                <Typography variant="subtitle2" color="warning.main" fontWeight="bold" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Visibility fontSize="small" /> MONITOR
                </Typography>
                <Divider sx={{ my: 1 }} />
                <List dense disablePadding>
                  <ListItem disablePadding><ListItemIcon sx={{ minWidth: 30 }}><Warning fontSize="small" color="warning"/></ListItemIcon>
                    <ListItemText primary="Score ≥ 40 (and < 80)" />
                  </ListItem>
                  <ListItem disablePadding><ListItemIcon sx={{ minWidth: 30 }}><Warning fontSize="small" color="warning"/></ListItemIcon>
                    <ListItemText primary="Medium Risk Profile" />
                  </ListItem>
                </List>
                <Typography variant="caption" sx={{ mt: 1, display: 'block' }}>Action: Review within 48h</Typography>
              </Paper>
            </Grid>
            <Grid item xs={12} md={4}>
              <Paper variant="outlined" sx={{ p: 2, height: '100%', borderColor: 'text.disabled', bgcolor: 'grey.50' }}>
                <Typography variant="subtitle2" color="text.secondary" fontWeight="bold" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Block fontSize="small" /> SUPPRESSED
                </Typography>
                <Divider sx={{ my: 1 }} />
                <List dense disablePadding>
                  <ListItem disablePadding><ListItemIcon sx={{ minWidth: 30 }}><Cancel fontSize="small" color="disabled"/></ListItemIcon>
                    <ListItemText primary="Score < 10" />
                  </ListItem>
                  <ListItem disablePadding><ListItemIcon sx={{ minWidth: 30 }}><Cancel fontSize="small" color="disabled"/></ListItemIcon>
                    <ListItemText primary="Auto-Excluded from Queue" />
                  </ListItem>
                </List>
                <Typography variant="caption" sx={{ mt: 1, display: 'block' }}>Action: None (Audit Trail Only)</Typography>
              </Paper>
            </Grid>
          </Grid>
        </Box>

        <Divider sx={{ my: 3 }} />

        {/* SECTION 4: CONFIGURATION GUIDE */}
        <Box mb={2}>
          <Typography variant="h6" gutterBottom color="primary.main" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Tune fontSize="small" /> 4. Configuration Guide
          </Typography>
          <Typography variant="body2" paragraph>
            The configuration panel on the dashboard allows you to tune the engine without code changes.
          </Typography>
          
          <Stack spacing={2}>
            <Box>
              <Typography variant="subtitle2" fontWeight="bold" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CalendarToday fontSize="small" color="action" /> Lookback Days
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ ml: 4 }}>
                Determines how far back the engine searches for alerts. Increasing this adds historical context but may slow down the run.
              </Typography>
            </Box>
            <Box>
              <Typography variant="subtitle2" fontWeight="bold" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <TrendingDown fontSize="small" color="action" /> Min Score Threshold
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ ml: 4 }}>
                The global floor for the "Monitor" bucket. Raising this makes the engine stricter (fewer cases generated).
              </Typography>
            </Box>
            <Box>
              <Typography variant="subtitle2" fontWeight="bold" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Security fontSize="small" color="action" /> Auto-Suppress
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ ml: 4 }}>
                Low-value cases (e.g., single "Low" severity alert = 1 point) are automatically removed from your view to reduce noise, though they are kept in the database for audit.
              </Typography>
            </Box>
          </Stack>
        </Box>

      </DialogContent>
      <DialogActions sx={{ p: 2, bgcolor: 'grey.50' }}>
        <Button onClick={onClose} variant="contained" color="primary">
          Got it
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default FocusEngineManual;