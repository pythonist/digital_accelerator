// frontend/src/tools/btsy/screens/CalibrationRunsPlaceholder.jsx
// FIXED: Properly passes snapshot_id to TransactionUniverseScreen
import React, { useState, useEffect } from 'react';
import {
  Box, Card, Typography, Button, Alert, Chip, Grid,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, IconButton, Tooltip, Dialog, DialogTitle, DialogContent, 
  DialogActions, TextField, Stepper, Step, StepLabel
} from '@mui/material';
import {
  Add, PlayArrow, Settings, Visibility, CheckCircle
} from '@mui/icons-material';
import { useAppContext } from '@context/AppContext';
import btsyApi from '@btsy/services/btsyApi';
import TransactionUniverseScreen from './calibration/transaction_universe/TransactionUniverseScreen';

const CALIBRATION_STEPS = [
  { label: 'Transaction Universe', status: 'active' },
  { label: 'Behavior Patterns', status: 'pending' },
  { label: 'Threshold Tuning', status: 'pending' },
  { label: 'Alert Generation', status: 'pending' }
];

const CalibrationRunsPlaceholder = () => {
  const { activeEnv } = useAppContext();
  const [snapshots, setSnapshots] = useState([]);
  const [selectedSnapshot, setSelectedSnapshot] = useState(null);
  const [showNewRunDialog, setShowNewRunDialog] = useState(false);
  const [newRunName, setNewRunName] = useState('');
  const [activeStep, setActiveStep] = useState(0);
  const [currentRunId, setCurrentRunId] = useState(null);
  const [loading, setLoading] = useState(false);
  
  useEffect(() => {
    loadSnapshots();
  }, []);
  
  const loadSnapshots = async () => {
    try {
      setLoading(true);
      const response = await btsyApi.snapshot.listSnapshots();
      if (response.success) {
        setSnapshots(response.data);
      }
    } catch (error) {
      console.error('Failed to load snapshots:', error);
    } finally {
      setLoading(false);
    }
  };
  
  const handleCreateRun = () => {
    if (!newRunName.trim()) {
      alert('Please enter a run name');
      return;
    }
    
    if (!selectedSnapshot) {
      alert('Please select a snapshot');
      return;
    }
    
    // Mock calibration run creation
    // In real implementation, this would POST to /api/btsy/calibration/create
    const mockRunId = Math.floor(Math.random() * 10000);
    setCurrentRunId(mockRunId);
    setActiveStep(0);
    setShowNewRunDialog(false);
    setNewRunName('');
  };
  
  const handleStepComplete = (step) => {
    setActiveStep(step + 1);
  };
  
  const handleExitRun = () => {
    if (confirm('Exit this calibration run? Unsaved progress will be lost.')) {
      setCurrentRunId(null);
      setSelectedSnapshot(null);
      setActiveStep(0);
    }
  };
  
  // If no run is active, show snapshot selection
  if (!currentRunId) {
    return (
      <Box sx={{ p: 3 }}>
        <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 600, color: '#1e293b', mb: 1 }}>
              Calibration Runs
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Create and manage calibration scenarios
            </Typography>
          </Box>
          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={() => setShowNewRunDialog(true)}
            disabled={loading || snapshots.length === 0}
            sx={{
              bgcolor: '#D04A02',
              '&:hover': { bgcolor: '#b13f02' }
            }}
          >
            New Calibration Run
          </Button>
        </Box>
        
        {loading ? (
          <Alert severity="info">Loading snapshots...</Alert>
        ) : snapshots.length === 0 ? (
          <Alert severity="info">
            No foundation snapshots available. Please complete Data Foundation first.
          </Alert>
        ) : (
          <Card>
            <Box sx={{ p: 2.5, borderBottom: '1px solid #e2e8f0' }}>
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                Available Snapshots
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Select a snapshot to create a calibration run
              </Typography>
            </Box>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Snapshot ID</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Domains</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Transactions</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Created</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {snapshots.map(snap => (
                    <TableRow key={snap.snapshot_id}>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 500 }}>
                          {snap.snapshot_id}
                        </Typography>
                      </TableCell>
                      <TableCell>{snap.total_domains}</TableCell>
                      <TableCell>{snap.total_input_rows?.toLocaleString()}</TableCell>
                      <TableCell>{new Date(snap.created_at).toLocaleDateString()}</TableCell>
                      <TableCell>
                        <Chip label={snap.status} size="small" color="success" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Card>
        )}
        
        {/* New Run Dialog */}
        <Dialog open={showNewRunDialog} onClose={() => setShowNewRunDialog(false)} maxWidth="sm" fullWidth>
          <DialogTitle>Create New Calibration Run</DialogTitle>
          <DialogContent>
            <Box sx={{ pt: 2 }}>
              <TextField
                fullWidth
                label="Run Name"
                value={newRunName}
                onChange={(e) => setNewRunName(e.target.value)}
                placeholder="e.g., Q1 2024 CASH Analysis"
                sx={{ mb: 3 }}
              />
              
              <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                Select Snapshot
              </Typography>
              {snapshots.map(snap => (
                <Paper
                  key={snap.snapshot_id}
                  sx={{
                    p: 2,
                    mb: 1,
                    cursor: 'pointer',
                    border: '2px solid',
                    borderColor: selectedSnapshot?.snapshot_id === snap.snapshot_id ? '#D04A02' : '#e2e8f0',
                    '&:hover': { borderColor: '#D04A02' }
                  }}
                  onClick={() => setSelectedSnapshot(snap)}
                >
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    {snap.snapshot_id}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {snap.total_input_rows?.toLocaleString()} transactions • {snap.total_domains} domains
                  </Typography>
                </Paper>
              ))}
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setShowNewRunDialog(false)}>Cancel</Button>
            <Button
              variant="contained"
              onClick={handleCreateRun}
              disabled={!selectedSnapshot || !newRunName.trim()}
              sx={{ bgcolor: '#D04A02', '&:hover': { bgcolor: '#b13f02' } }}
            >
              Create Run
            </Button>
          </DialogActions>
        </Dialog>
      </Box>
    );
  }
  
  // Active run workflow - FIXED: Pass selectedSnapshot.snapshot_id
  return (
    <Box sx={{ p: 3 }}>
      {/* Run Header */}
      <Card sx={{ mb: 3, bgcolor: '#f8fafc' }}>
        <Box sx={{ p: 2.5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                {newRunName}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Run ID: {currentRunId} • Snapshot: {selectedSnapshot?.snapshot_id}
              </Typography>
            </Box>
            <Button
              variant="outlined"
              size="small"
              onClick={handleExitRun}
            >
              Exit Run
            </Button>
          </Box>
          
          <Stepper activeStep={activeStep} sx={{ mt: 2 }}>
            {CALIBRATION_STEPS.map((step, index) => (
              <Step key={step.label}>
                <StepLabel>{step.label}</StepLabel>
              </Step>
            ))}
          </Stepper>
        </Box>
      </Card>
      
      {/* Step Content - FIXED: Pass snapshot_id correctly */}
      {activeStep === 0 && selectedSnapshot && (
        <TransactionUniverseScreen
          calibrationRunId={currentRunId}
          snapshotId={selectedSnapshot.snapshot_id}
          onComplete={() => handleStepComplete(0)}
        />
      )}
      
      {activeStep > 0 && (
        <Alert severity="info">
          Step {activeStep + 1}: {CALIBRATION_STEPS[activeStep].label} - Coming Soon
        </Alert>
      )}
    </Box>
  );
};

export default CalibrationRunsPlaceholder;