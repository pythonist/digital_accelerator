// frontend/src/screens/cases/AiExplainPanel.jsx
import React, { useState } from 'react';
import {
  Box, Paper, Typography, Button, CircularProgress, Alert, Stack, Chip,
  Divider, Tooltip, IconButton
} from '@mui/material';
import {
  AutoAwesome as SparklesIcon, Refresh as RefreshIcon, ContentCopy as CopyIcon,
  Description as DescriptionIcon, NoteAdd as NoteAddIcon, Shield as ShieldIcon,
  CheckCircleOutline as CheckIcon, ArrowForward as ArrowIcon, HelpOutline as HelpIcon,
  AssignmentTurnedIn as DispositionIcon, Lightbulb as LightbulbIcon
} from '@mui/icons-material';
import apiClient from '@services/api';
import FormattedMarkdown from '../../components/FormattedMarkdown';

const AiExplainPanel = ({ caseId }) => {
  const [explanation, setExplanation] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [noteNotice, setNoteNotice] = useState('');

  const generateExplanation = async () => {
    if (!caseId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.post('/api/v2/llm/explain-case', {
        case_id: caseId,
      });
      if (res.success && res.explanation) {
        setExplanation(res.explanation);
      } else {
        setError(res.error || 'Failed to generate explanation');
      }
    } catch (e) {
      setError(e.message || 'AI service unavailable');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (!explanation) return;
    navigator.clipboard.writeText(explanation);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveToNotes = () => {
    if (!explanation || !caseId) return;
    try {
      const key = `case_notes_${caseId}`;
      const existing = localStorage.getItem(key) || '';
      const updated = existing ? `${existing}\n\n[AI Case Explanation]\n${explanation}` : `[AI Case Explanation]\n${explanation}`;
      localStorage.setItem(key, updated);
      navigator.clipboard.writeText(explanation);
      setNoteNotice('Saved to Case Notes!');
      setTimeout(() => setNoteNotice(''), 3000);
    } catch (e) {
      navigator.clipboard.writeText(explanation);
      setNoteNotice('Copied for Notes!');
      setTimeout(() => setNoteNotice(''), 3000);
    }
  };

  return (
    <Box sx={{ p: 3, height: '100%', display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {/* ============================================================ */}
      {/* 1. TOP EXECUTIVE INTELLIGENCE & HUMAN-CENTRIC COMMAND BAR    */}
      {/* ============================================================ */}
      <Paper
        variant="outlined"
        sx={{
          p: 2,
          borderRadius: 2,
          bgcolor: '#ffffff',
          borderColor: '#e2e8f0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 2,
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
        }}
      >
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Box sx={{ width: 36, height: 36, borderRadius: '50%', bgcolor: '#fff7ed', border: '1.5px solid #fdba74', display: 'grid', placeItems: 'center' }}>
            <SparklesIcon sx={{ fontSize: 20, color: '#ea580c' }} />
          </Box>
          <Box>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography sx={{ fontSize: 14.5, fontWeight: 800, color: '#0f172a' }}>
                AI Case Narrative & Investigative Synthesis
              </Typography>
              <Chip
                size="small"
                label={caseId}
                sx={{ height: 22, fontWeight: 700, fontSize: 11, bgcolor: '#f1f5f9', color: '#334155' }}
              />
            </Stack>
            <Typography sx={{ fontSize: 11.5, color: '#64748b' }}>
              Human-in-the-Loop: Objective factual synthesis designed for regulatory audit defensibility
            </Typography>
          </Box>
        </Stack>

        <Stack direction="row" spacing={1.25} alignItems="center">
          {explanation && (
            <>
              <Tooltip title={copied ? 'Copied to clipboard!' : 'Copy full narrative'}>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<CopyIcon sx={{ fontSize: 15 }} />}
                  onClick={handleCopy}
                  sx={{ textTransform: 'none', fontSize: 12, fontWeight: 700, borderColor: '#cbd5e1', color: '#334155' }}
                >
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </Tooltip>

              <Tooltip title="Append narrative to Case Notes">
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<NoteAddIcon sx={{ fontSize: 15 }} />}
                  onClick={handleSaveToNotes}
                  sx={{ textTransform: 'none', fontSize: 12, fontWeight: 700, borderColor: '#cbd5e1', color: '#334155' }}
                >
                  {noteNotice || 'Save to Notes'}
                </Button>
              </Tooltip>
            </>
          )}

          <Button
            size="small"
            variant="contained"
            startIcon={loading ? <CircularProgress size={14} color="inherit" /> : explanation ? <RefreshIcon sx={{ fontSize: 15 }} /> : <SparklesIcon sx={{ fontSize: 15 }} />}
            onClick={generateExplanation}
            disabled={loading}
            sx={{ bgcolor: '#ea580c', '&:hover': { bgcolor: '#c2410c' }, textTransform: 'none', fontSize: 12, fontWeight: 700 }}
          >
            {loading ? 'Synthesizing...' : explanation ? 'Regenerate' : 'Generate Explanation'}
          </Button>
        </Stack>
      </Paper>

      {/* ============================================================ */}
      {/* 2. MAIN DUAL-PANE WORKBENCH (FULL SCREEN LAYOUT)             */}
      {/* ============================================================ */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '320px 1fr', xl: '380px 1fr' }, gap: { xs: 1.5, md: 2.5 }, flex: 1, minHeight: 0 }}>
        
        {/* LEFT PANE: Human Analyst Decision Playbook */}
        <Stack spacing={2} sx={{ display: 'flex', flexDirection: 'column' }}>
          
          {/* Actionable Investigator Playbook */}
          <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, bgcolor: '#ffffff', borderColor: '#e2e8f0' }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
              <LightbulbIcon sx={{ color: '#ea580c', fontSize: 20 }} />
              <Typography sx={{ fontSize: 13.5, fontWeight: 800, color: '#0f172a' }}>
                Investigator Decision Playbook
              </Typography>
            </Stack>
            <Typography variant="caption" sx={{ color: '#64748b', display: 'block', mb: 2 }}>
              Recommended procedural actions based on this case profile:
            </Typography>

            <Stack spacing={1.5}>
              <Box sx={{ p: 1.5, borderRadius: 1.5, bgcolor: '#f8fafc', border: '1px solid #e2e8f0' }}>
                <Typography sx={{ fontSize: 12, fontWeight: 700, color: '#0f172a', mb: 0.5 }}>
                  1. Verify Account Activity & Dormancy
                </Typography>
                <Typography sx={{ fontSize: 11.5, color: '#475569', lineHeight: 1.5 }}>
                  Confirm if the zero-transaction profile is expected due to account opening date or dormant retail status.
                </Typography>
              </Box>

              <Box sx={{ p: 1.5, borderRadius: 1.5, bgcolor: '#f8fafc', border: '1px solid #e2e8f0' }}>
                <Typography sx={{ fontSize: 12, fontWeight: 700, color: '#0f172a', mb: 0.5 }}>
                  2. Cross-Check Customer Due Diligence (CDD)
                </Typography>
                <Typography sx={{ fontSize: 11.5, color: '#475569', lineHeight: 1.5 }}>
                  Verify that KYC identity documents, source of wealth, and beneficial ownership are up to date.
                </Typography>
              </Box>

              <Box sx={{ p: 1.5, borderRadius: 1.5, bgcolor: '#f8fafc', border: '1px solid #e2e8f0' }}>
                <Typography sx={{ fontSize: 12, fontWeight: 700, color: '#0f172a', mb: 0.5 }}>
                  3. Disposition Documentation
                </Typography>
                <Typography sx={{ fontSize: 11.5, color: '#475569', lineHeight: 1.5 }}>
                  If no adverse media or suspicious linkages exist, document the rationale and close as routine review.
                </Typography>
              </Box>
            </Stack>
          </Paper>

          {/* Compliance & Audit Guardrail Card */}
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: '#f8fafc', borderColor: '#e2e8f0' }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
              <ShieldIcon sx={{ fontSize: 18, color: '#16a34a' }} />
              <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: '#0f172a' }}>
                Regulatory Defensibility
              </Typography>
            </Stack>
            <Typography sx={{ fontSize: 11.5, color: '#475569', lineHeight: 1.6 }}>
              This narrative synthesizes empirical transaction and alert telemetry. All final filing dispositions remain under the sole authority of the designated compliance officer.
            </Typography>
          </Paper>
        </Stack>

        {/* RIGHT PANE: Structured Narrative Studio */}
        <Paper
          variant="outlined"
          sx={{
            borderRadius: 2,
            bgcolor: '#ffffff',
            borderColor: '#e2e8f0',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}
        >
          {/* Header */}
          <Box sx={{ p: 2, borderBottom: '1px solid #e2e8f0', bgcolor: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography sx={{ fontSize: 13.5, fontWeight: 800, color: '#0f172a' }}>
              Investigative Findings Narrative
            </Typography>
            <Chip
              size="small"
              label="Analyst-Ready Markdown"
              sx={{ fontSize: 10.5, height: 22, bgcolor: '#eff6ff', color: '#1d4ed8', fontWeight: 700 }}
            />
          </Box>

          {/* Narrative Content */}
          <Box sx={{ flex: 1, p: 3, overflowY: 'auto', bgcolor: '#ffffff' }}>
            {error && <Alert severity="error" sx={{ mb: 2, fontSize: 12.5 }}>{error}</Alert>}

            {loading && (
              <Box sx={{ textAlign: 'center', py: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <CircularProgress size={36} thickness={4} sx={{ color: '#ea580c' }} />
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body1" fontWeight={700} sx={{ color: '#0f172a' }}>
                    Generating documents & findings
                  </Typography>
                  <Box sx={{ display: 'inline-flex', gap: 0.5, alignItems: 'center' }}>
                    <Box component="span" sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#ea580c', animation: 'dotPulse 1.2s infinite ease-in-out', animationDelay: '0s', '@keyframes dotPulse': { '0%, 80%, 100%': { transform: 'scale(0.4)', opacity: 0.3 }, '40%': { transform: 'scale(1.2)', opacity: 1 } } }} />
                    <Box component="span" sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#ea580c', animation: 'dotPulse 1.2s infinite ease-in-out', animationDelay: '0.2s', '@keyframes dotPulse': { '0%, 80%, 100%': { transform: 'scale(0.4)', opacity: 0.3 }, '40%': { transform: 'scale(1.2)', opacity: 1 } } }} />
                    <Box component="span" sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#ea580c', animation: 'dotPulse 1.2s infinite ease-in-out', animationDelay: '0.4s', '@keyframes dotPulse': { '0%, 80%, 100%': { transform: 'scale(0.4)', opacity: 0.3 }, '40%': { transform: 'scale(1.2)', opacity: 1 } } }} />
                  </Box>
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ maxWidth: 450 }}>
                  AI agent is reviewing case metrics, transaction behaviors, and drafting the investigative narrative...
                </Typography>
              </Box>
            )}

            {!explanation && !loading && !error && (
              <Box sx={{ textAlign: 'center', py: 8, color: '#94a3b8' }}>
                <SparklesIcon sx={{ fontSize: 48, opacity: 0.3, mb: 1.5 }} />
                <Typography sx={{ fontSize: 14, fontWeight: 700, color: '#475569' }}>
                  No Narrative Generated Yet
                </Typography>
                <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mt: 0.5, mb: 2 }}>
                  Click "Generate Explanation" to synthesize the case telemetry into an executive dossier.
                </Typography>
                <Button
                  variant="contained"
                  startIcon={<SparklesIcon sx={{ fontSize: 15 }} />}
                  onClick={generateExplanation}
                  sx={{ bgcolor: '#ea580c', '&:hover': { bgcolor: '#c2410c' }, textTransform: 'none', fontWeight: 700, fontSize: 12 }}
                >
                  Generate Case Explanation
                </Button>
              </Box>
            )}

            {explanation && !loading && (
              <Box sx={{ p: 1 }}>
                <FormattedMarkdown content={explanation} />
              </Box>
            )}
          </Box>
        </Paper>
      </Box>
    </Box>
  );
};

export default AiExplainPanel;
