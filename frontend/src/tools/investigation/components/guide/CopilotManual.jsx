import React from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Typography, Box, Divider, Grid, Paper,
  List, ListItem, ListItemIcon, ListItemText, Chip,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Alert, Stack, Accordion, AccordionSummary, AccordionDetails
} from '@mui/material';
import {
  SmartToy, Security, Timeline, Gavel, 
  ExpandMore, Lightbulb, Storage, Bolt
} from '@mui/icons-material';

/**
 * Investigation Copilot Manual
 * Explains the hybrid Deterministic + AI architecture.
 */
const CopilotManual = ({ open, onClose }) => {
  
  return (
    <Dialog 
      open={open} 
      onClose={onClose} 
      maxWidth="md" 
      fullWidth
      scroll="paper"
      aria-labelledby="copilot-manual-title"
    >
      <DialogTitle id="copilot-manual-title" sx={{ display: 'flex', alignItems: 'center', gap: 1, borderBottom: '1px solid #eee', bgcolor: '#1e3a8a', color: 'white' }}>
        <SmartToy />
        <Typography variant="h6" fontWeight="bold">Investigation Copilot: User Guide</Typography>
      </DialogTitle>

      <DialogContent dividers sx={{ p: 3 }}>
        
        {/* SECTION 1: HYBRID ARCHITECTURE */}
        <Box mb={4}>
          <Typography variant="h6" gutterBottom color="primary.dark" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Bolt fontSize="small" /> 1. Hybrid Intelligence
          </Typography>
          <Typography variant="body2" paragraph>
            The Investigation Copilot is built on a <strong>"Fact-First" architecture</strong>. It does not hallucinate data.
            Instead, it uses a two-step process:
          </Typography>
          
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12} md={6}>
              <Paper variant="outlined" sx={{ p: 2, height: '100%', borderColor: 'primary.main', bgcolor: '#f0f7ff' }}>
                <Typography variant="subtitle2" color="primary.main" fontWeight="bold" gutterBottom>
                  Step 1: Deterministic Facts (The "Truth")
                </Typography>
                <Typography variant="caption" display="block" gutterBottom>
                  The system queries the database directly (SQL) to calculate hard numbers.
                </Typography>
                <List dense>
                  <ListItem disablePadding><ListItemIcon sx={{ minWidth: 30 }}><Storage fontSize="small" color="primary"/></ListItemIcon>
                    <ListItemText primary="30-Day Volume" secondary="Sum of transaction amounts" />
                  </ListItem>
                  <ListItem disablePadding><ListItemIcon sx={{ minWidth: 30 }}><Storage fontSize="small" color="primary"/></ListItemIcon>
                    <ListItemText primary="Alert Count" secondary="Exact number of database rows" />
                  </ListItem>
                </List>
              </Paper>
            </Grid>
            <Grid item xs={12} md={6}>
              <Paper variant="outlined" sx={{ p: 2, height: '100%', borderColor: 'secondary.main', bgcolor: '#fbf0ff' }}>
                <Typography variant="subtitle2" color="secondary.main" fontWeight="bold" gutterBottom>
                  Step 2: AI Narrative (The "Assistant")
                </Typography>
                <Typography variant="caption" display="block" gutterBottom>
                  The LLM (AI) receives the Facts from Step 1 and writes the explanation.
                </Typography>
                <List dense>
                  <ListItem disablePadding><ListItemIcon sx={{ minWidth: 30 }}><SmartToy fontSize="small" color="secondary"/></ListItemIcon>
                    <ListItemText primary="Drafts SARs" secondary="Using the facts provided" />
                  </ListItem>
                  <ListItem disablePadding><ListItemIcon sx={{ minWidth: 30 }}><SmartToy fontSize="small" color="secondary"/></ListItemIcon>
                    <ListItemText primary="Explains Risk" secondary="Contextualizes the volume" />
                  </ListItem>
                </List>
              </Paper>
            </Grid>
          </Grid>
        </Box>

        <Divider sx={{ my: 3 }} />

        {/* SECTION 2: RISK SCORING */}
        <Box mb={4}>
          <Typography variant="h6" gutterBottom color="primary.dark" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Timeline fontSize="small" /> 2. Copilot Risk Scoring
          </Typography>
          <Typography variant="body2" paragraph>
            The Risk Score shown in the sidebar is calculated live by the <code>facts_builder.py</code> engine.
          </Typography>
          
          <TableContainer component={Paper} variant="outlined" sx={{ mb: 2 }}>
            <Table size="small">
              <TableHead sx={{ bgcolor: 'grey.50' }}>
                <TableRow>
                  <TableCell><strong>Factor</strong></TableCell>
                  <TableCell><strong>Impact</strong></TableCell>
                  <TableCell><strong>Trigger Condition</strong></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                <TableRow>
                  <TableCell><strong>KYC Risk</strong></TableCell>
                  <TableCell>+10 to +90</TableCell>
                  <TableCell>Based on customer risk rating (Low -{'>'} Critical)</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell><strong>Volume Surge</strong></TableCell>
                  <TableCell>+25 points</TableCell>
                  <TableCell>If 30-day volume {'>'} $100,000</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell><strong>Velocity</strong></TableCell>
                  <TableCell>+15 points</TableCell>
                  <TableCell>If {'>'} 10 transactions in 7 days</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>
          <Alert severity="info" variant="outlined">
            <strong>Impact:</strong> A score {'>'} 80 is considered <strong>Critical</strong> and typically requires escalation.
          </Alert>
        </Box>

        <Divider sx={{ my: 3 }} />

        {/* SECTION 3: USING THE COPILOT */}
        <Box mb={4}>
          <Typography variant="h6" gutterBottom color="primary.dark" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Lightbulb fontSize="small" /> 3. Capabilities & Prompts
          </Typography>
          <Typography variant="body2" paragraph>
            The chat interface is context-aware. It knows the active case's facts. Try these prompts:
          </Typography>

          <Stack spacing={2}>
             <Accordion defaultExpanded variant="outlined">
                <AccordionSummary expandIcon={<ExpandMore />}>
                  <Typography fontWeight="bold" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Gavel color="error" fontSize="small"/> "Draft SAR Narrative"
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Typography variant="body2">
                    The AI will generate a formal Suspicious Activity Report narrative using the 
                    <strong> confirmed</strong> transaction volumes and alert dates. It structures it into:
                    Introduction, Activity Review, and Conclusion.
                  </Typography>
                </AccordionDetails>
              </Accordion>

              <Accordion variant="outlined">
                <AccordionSummary expandIcon={<ExpandMore />}>
                  <Typography fontWeight="bold" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Security color="primary" fontSize="small"/> "Explain Risk Drivers"
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Typography variant="body2">
                    Asks the system to explain <em>why</em> the score is high. 
                    Example output: "The score is driven by high cash velocity (40% ratio) and a critical KYC rating."
                  </Typography>
                </AccordionDetails>
              </Accordion>
          </Stack>
        </Box>

      </DialogContent>
      <DialogActions sx={{ p: 2, bgcolor: 'grey.50' }}>
        <Button onClick={onClose} variant="contained" sx={{ bgcolor: '#1e3a8a' }}>
          Got it
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default CopilotManual;