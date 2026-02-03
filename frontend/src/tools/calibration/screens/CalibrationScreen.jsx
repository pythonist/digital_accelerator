// frontend/src/tools/calibration/screens/CalibrationScreen.jsx
// PwC Bank-Grade Design - Professional & Clean

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Box, Grid, Slider, Button, Card, CardContent, Typography, Stack,
  IconButton
} from '@mui/material';
import { 
  CheckCircle as CheckIcon,
  ExpandMore as ExpandIcon
} from '@mui/icons-material';
import { useCalibration } from "../context/CalibrationContext";
import { useAppContext } from '@context/AppContext';
import PageContainer from '../layout/PageContainer';

// Hooks
import { useCalibrationInsights } from '../hooks/useCalibrationInsights';
import { useKSAnalysis } from '../hooks/useKSAnalysis';
import { useATLBTLAnalysis } from '../hooks/useATLBTLAnalysis';

// Components
import CalibrationMetadataBar from '../components/CalibrationMetadataBar';
import DistributionIntelligencePanel from '../components/DistributionIntelligencePanel';
import PercentileLadderTable from '../components/PercentileLadderTable';
import ThresholdComparisonBoard from '../components/ThresholdComparisonBoard';
import ImpactSummaryPanel from '../components/ImpactSummaryPanel';
import DecisionRationalePanel from '../components/DecisionRationalePanel';
import AlertPopulationTable from '../components/AlertPopulationTable';
import CustomerImpactPanel from '../components/CustomerImpactPanel';
import STRImpactPanel from '../components/STRImpactPanel';
import KSStatisticsPanel from '../components/KSStatisticsPanel';
import ATLBTLAnalysisPanel from '../components/ATLBTLAnalysisPanel';
import { PageTransition, MotionContainer, MotionItem } from "@components/MotionWrappers/MotionWrappers";

// PwC Brand Colors
const PWC_COLORS = {
  orange: '#D04A02',
  darkGray: '#2C2C2C',
  mediumGray: '#53565A',
  lightGray: '#E6E6E6',
  white: '#FFFFFF',
  error: '#C5281C',
  success: '#107C41'
};

// ============================================================================
// FRAMER MOTION VARIANTS - Subtle & Professional
// ============================================================================

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.05
    }
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 8 },
  show: { 
    opacity: 1, 
    y: 0,
    transition: {
      duration: 0.3,
      ease: "easeOut"
    }
  }
};

// ============================================================================
// COLLAPSIBLE CARD WRAPPER - Minimalist Design
// ============================================================================

const CollapsibleCard = ({ title, subtitle, children, defaultExpanded = true }) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  
  return (
    <motion.div variants={itemVariants}>
      <Card 
        variant="outlined"
        sx={{ 
          overflow: 'visible',
          border: `1px solid ${PWC_COLORS.lightGray}`,
          boxShadow: 'none',
          mb: 2
        }}
      >
        <Box 
          sx={{ 
            px: 3, 
            py: 2, 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between',
            cursor: 'pointer',
            bgcolor: expanded ? PWC_COLORS.white : '#FAFAFA',
            borderBottom: expanded ? `1px solid ${PWC_COLORS.lightGray}` : 'none',
            transition: 'background-color 0.2s'
          }}
          onClick={() => setExpanded(!expanded)}
        >
          <Box>
            <Typography 
              variant="subtitle2" 
              fontWeight={600} 
              sx={{ 
                color: PWC_COLORS.darkGray,
                fontSize: '0.938rem',
                letterSpacing: '-0.01em'
              }}
            >
              {title}
            </Typography>
            {subtitle && (
              <Typography 
                variant="caption" 
                sx={{ 
                  color: PWC_COLORS.mediumGray,
                  fontSize: '0.813rem'
                }}
              >
                {subtitle}
              </Typography>
            )}
          </Box>
          <IconButton size="small">
            <motion.div
              animate={{ rotate: expanded ? 180 : 0 }}
              transition={{ duration: 0.25, ease: "easeInOut" }}
            >
              <ExpandIcon sx={{ color: PWC_COLORS.mediumGray }} />
            </motion.div>
          </IconButton>
        </Box>
        
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ 
                height: "auto", 
                opacity: 1,
                transition: {
                  height: { duration: 0.25, ease: "easeOut" },
                  opacity: { duration: 0.2, delay: 0.05 }
                }
              }}
              exit={{ 
                height: 0, 
                opacity: 0,
                transition: {
                  height: { duration: 0.25, ease: "easeIn" },
                  opacity: { duration: 0.15 }
                }
              }}
              style={{ overflow: 'hidden' }}
            >
              <CardContent sx={{ pt: 3, pb: 3 }}>
                {children}
              </CardContent>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </motion.div>
  );
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

const CalibrationScreen = () => {
  const { run, selectThreshold, goToStep } = useCalibration();
  const { activeEnv } = useAppContext();
  
  // Core calibration insights
  const {
    percentiles,
    histogramData,
    metadata,
    distributionTable,
    distributionShape,
    ladder,
    comprehensiveImpact,
    rationale,
    entityOutcome,
    sliderPercentile,
    currentThreshold,
    handleSliderChange,
    handleSliderCommit,
    jumpToPercentile,
    setRationale,
    loading,
    impactLoading,
    entityLoading
  } = useCalibrationInsights(run?.run_id, activeEnv);
  
  // KS Analysis Hook
  const {
    ksStatistic,
    ksSensitivity,
    cdfData,
    ksNarrative,
    handleThresholdChange: handleKSThresholdChange,
    ksLoading,
    cdfLoading
  } = useKSAnalysis(run?.run_id, activeEnv);
  
  // ATL/BTL Analysis Hook
  const {
    atlBtlSplit,
    volumeSensitivity,
    strOverlay,
    behavioralConcentration,
    narrative: atlBtlNarrative,
    loading: atlBtlLoading,
    fetchATLBTLAnalysis
  } = useATLBTLAnalysis(run?.run_id, activeEnv);
  
  // Enhanced slider commit handler
  const handleEnhancedSliderCommit = async (val) => {
    await handleSliderCommit(val);
    
    const threshold = percentiles.find(p => p.percentile === val)?.threshold || currentThreshold;
    
    if (threshold) {
      await handleKSThresholdChange(threshold, val);
      await fetchATLBTLAnalysis(threshold, 10, 'amount');
    }
  };
  
  const handleApprove = async () => {
    if (!comprehensiveImpact || !rationale) return;
    
    try {
      await selectThreshold(
        currentThreshold,
        sliderPercentile,
        comprehensiveImpact.alerts_triggered,
        rationale
      );
    } catch (err) {
      console.error('Approval failed:', err);
    }
  };
  
  const canApprove = comprehensiveImpact && rationale && rationale.length > 50;
  
  return (
    <PageTransition>
      <PageContainer 
        title="Step 3: Calibration Cockpit" 
        subtitle="Interactive threshold tuning with real-time impact analysis"
      >
        {/* Metadata Context Bar */}
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <CalibrationMetadataBar metadata={metadata} />
        </motion.div>
        
        <Grid container spacing={3}>
          
          {/* ============================================ */}
          {/* LEFT COLUMN: VISUAL EXPLORER */}
          {/* ============================================ */}
          <Grid item xs={12} lg={8}>
            <MotionContainer
              variants={containerVariants}
              initial="hidden"
              animate="show"
            >
              
              {/* Distribution Intelligence Panel */}
              <CollapsibleCard
                title="Distribution Intelligence"
                subtitle="Understand your data's shape and spread"
                defaultExpanded={true}
              >
                <DistributionIntelligencePanel
                  histogramData={histogramData}
                  distributionTable={distributionTable}
                  distributionShape={distributionShape}
                  threshold={currentThreshold}
                  percentile={sliderPercentile}
                />
              </CollapsibleCard>
              
              {/* Threshold Slider */}
              <MotionItem variants={itemVariants}>
                <Card 
                  variant="outlined"
                  sx={{
                    border: `1px solid ${PWC_COLORS.lightGray}`,
                    boxShadow: 'none',
                    mb: 2
                  }}
                >
                  <CardContent sx={{ px: 3, py: 3 }}>
                    <Typography 
                      variant="subtitle2" 
                      gutterBottom 
                      fontWeight={600}
                      sx={{ 
                        color: PWC_COLORS.darkGray,
                        fontSize: '0.938rem',
                        mb: 1
                      }}
                    >
                      Threshold Selector
                    </Typography>
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.15 }}
                    >
                      <Typography 
                        variant="caption" 
                        display="block" 
                        sx={{ 
                          mb: 3,
                          color: PWC_COLORS.mediumGray,
                          fontSize: '0.813rem'
                        }}
                      >
                        Current: <strong>p{sliderPercentile}</strong> = <strong>₹{currentThreshold?.toLocaleString()}</strong>
                      </Typography>
                    </motion.div>
                    
                    <Box sx={{ px: 2, py: 2 }}>
                      <Slider
                        value={sliderPercentile}
                        min={50}
                        max={99.9}
                        step={0.5}
                        onChange={(e, val) => handleSliderChange(val)}
                        onChangeCommitted={(e, val) => handleEnhancedSliderCommit(val)}
                        valueLabelDisplay="auto"
                        valueLabelFormat={(val) => `p${val}`}
                        marks={[
                          { value: 50, label: 'p50' },
                          { value: 75, label: 'p75' },
                          { value: 90, label: 'p90' },
                          { value: 95, label: 'p95' },
                          { value: 99, label: 'p99' }
                        ]}
                        sx={{
                          color: PWC_COLORS.orange,
                          '& .MuiSlider-markLabel': {
                            color: PWC_COLORS.mediumGray,
                            fontSize: '0.75rem'
                          }
                        }}
                      />
                      <Typography 
                        variant="caption" 
                        align="center" 
                        display="block" 
                        sx={{ 
                          mt: 1,
                          color: PWC_COLORS.mediumGray,
                          fontSize: '0.75rem'
                        }}
                      >
                        Drag to adjust percentile cut-off (50th to 99.9th)
                      </Typography>
                    </Box>
                  </CardContent>
                </Card>
              </MotionItem>
              
              {/* Percentile Ladder */}
              <CollapsibleCard
                title="Percentile Ladder"
                subtitle="Quick jump to common thresholds"
              >
                <PercentileLadderTable
                  ladder={ladder}
                  currentPercentile={sliderPercentile}
                  onJumpToPercentile={jumpToPercentile}
                />
              </CollapsibleCard>
              
              {/* Scenario Comparison */}
              <CollapsibleCard
                title="Threshold Comparison"
                subtitle="Compare multiple scenarios side-by-side"
              >
                <ThresholdComparisonBoard
                  currentScenario={{
                    ...comprehensiveImpact,
                    ...entityOutcome
                  }}
                  loading={impactLoading || entityLoading}
                  runId={run?.run_id}
                  onJumpToScenario={jumpToPercentile}
                />
              </CollapsibleCard>
              
              {/* KS Statistics */}
              <CollapsibleCard
                title="KS Statistical Analysis"
                subtitle="Separation power between alerted and suppressed"
              >
                <KSStatisticsPanel
                  ksStatistic={ksStatistic}
                  ksSensitivity={ksSensitivity}
                  cdfData={cdfData}
                  ksNarrative={ksNarrative}
                  loading={ksLoading || cdfLoading}
                  currentThreshold={currentThreshold}
                  currentPercentile={sliderPercentile}
                />
              </CollapsibleCard>

              {/* ATL/BTL Analysis */}
              <CollapsibleCard
                title="ATL/BTL Volume Analysis"
                subtitle="Above vs below threshold behavioral patterns"
              >
                <ATLBTLAnalysisPanel
                  atlBtlSplit={atlBtlSplit}
                  volumeSensitivity={volumeSensitivity}
                  strOverlay={strOverlay}
                  behavioralConcentration={behavioralConcentration}
                  narrative={atlBtlNarrative}
                  loading={atlBtlLoading}
                />
              </CollapsibleCard>

              {/* Alert Population */}
              <CollapsibleCard
                title="Alert Population Explorer"
                subtitle="Detailed entity-level view"
                defaultExpanded={false}
              >
                <AlertPopulationTable
                  runId={run?.run_id}
                  threshold={currentThreshold}
                  metric="amount"
                />
              </CollapsibleCard>
            </MotionContainer>
          </Grid>
          
          {/* ============================================ */}
          {/* RIGHT COLUMN: DECISION PANEL */}
          {/* ============================================ */}
          <Grid item xs={12} lg={4}>
            <MotionContainer
              variants={containerVariants}
              initial="hidden"
              animate="show"
            >
              
              {/* Impact Summary */}
              <MotionItem variants={itemVariants}>
                <ImpactSummaryPanel
                  impact={comprehensiveImpact}
                  entityOutcome={entityOutcome}
                  loading={impactLoading || entityLoading}
                />
              </MotionItem>

              {/* Customer Impact */}
              <CollapsibleCard
                title="Customer Impact"
                subtitle="Unique customer rollup"
              >
                <CustomerImpactPanel
                  runId={run?.run_id}
                  threshold={currentThreshold}
                  metric="amount"
                />
              </CollapsibleCard>

              {/* STR Evaluation */}
              <CollapsibleCard
                title="STR Evaluation"
                subtitle="Suspicious transaction reporting impact"
              >
                <STRImpactPanel
                  runId={run?.run_id}
                  threshold={currentThreshold}
                  metric="amount"
                />
              </CollapsibleCard>
              
              {/* Decision Rationale */}
              <MotionItem variants={itemVariants}>
                <DecisionRationalePanel
                  rationale={rationale}
                  onRationaleChange={setRationale}
                  metadata={comprehensiveImpact?.alert_grain ? {
                    aggregation: `${metadata?.frequency || ''} ${metadata?.metrics || 'amount'}`,
                    alert_grain: comprehensiveImpact.alert_grain?.unit,
                    lookback_days: metadata?.lookback_days
                  } : null}
                  isAutoGenerated={true}
                />
              </MotionItem>
              
              {/* Approve Button */}
              <MotionItem variants={itemVariants}>
                <Button 
                  variant="contained" 
                  size="large" 
                  fullWidth 
                  startIcon={<CheckIcon />}
                  onClick={handleApprove}
                  disabled={!canApprove || loading}
                  sx={{
                    py: 1.75,
                    fontWeight: 600,
                    bgcolor: PWC_COLORS.orange,
                    color: PWC_COLORS.white,
                    textTransform: 'none',
                    fontSize: '0.938rem',
                    letterSpacing: '-0.01em',
                    boxShadow: 'none',
                    '&:hover': {
                      bgcolor: '#B83F02',
                      boxShadow: 'none'
                    },
                    '&:disabled': {
                      bgcolor: PWC_COLORS.lightGray,
                      color: PWC_COLORS.mediumGray
                    }
                  }}
                >
                  {loading ? 'Processing...' : 'Approve Calibration Cut'}
                </Button>
                
                {!canApprove && rationale && rationale.length < 50 && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    <Typography 
                      variant="caption" 
                      align="center" 
                      sx={{ 
                        display: 'block', 
                        mt: 1.5,
                        color: PWC_COLORS.error,
                        fontSize: '0.75rem'
                      }}
                    >
                      Please provide a more detailed rationale (at least 50 characters)
                    </Typography>
                  </motion.div>
                )}
              </MotionItem>
            </MotionContainer>
          </Grid>
        </Grid>
      </PageContainer>
    </PageTransition>
  );
};

export default CalibrationScreen;