import React, { useState } from 'react';
import {
  Box,
  Drawer,
  Stack,
  Typography,
  IconButton,
  Chip,
  Paper,
  Divider,
  Tabs,
  Tab,
  Button,
} from '@mui/material';
import {
  Close as CloseIcon,
  Hub as HubIcon,
  Speed as SpeedIcon,
  AccountTree as TypologyIcon,
  AutoAwesome as HybridIcon,
  Timeline as FlowIcon,
  Shield as ShieldIcon,
  MenuBook as BookIcon,
  HelpOutline as HelpIcon,
} from '@mui/icons-material';

const MODE_THEMES = {
  '1. Behavioral Similarity': {
    color: '#0d9488',
    bg: '#f0fdfa',
    border: '#99f6e4',
    icon: <SpeedIcon sx={{ fontSize: 18, color: '#0d9488' }} />,
    tag: 'Operational Cash Rhythm',
  },
  '2. Typology Similarity': {
    color: '#d97706',
    bg: '#fffbeb',
    border: '#fde68a',
    icon: <TypologyIcon sx={{ fontSize: 18, color: '#d97706' }} />,
    tag: 'FATF Crime Typologies',
  },
  '3. Network Similarity': {
    color: '#2563eb',
    bg: '#eff6ff',
    border: '#bfdbfe',
    icon: <HubIcon sx={{ fontSize: 18, color: '#2563eb' }} />,
    tag: 'Graph & Counterparties',
  },
  '4. Hybrid Similarity': {
    color: '#7c3aed',
    bg: '#f5f3ff',
    border: '#ddd6fe',
    icon: <HybridIcon sx={{ fontSize: 18, color: '#7c3aed' }} />,
    tag: 'Ensemble Composite',
  },
};

const ModuleGuideDrawer = ({ open, onClose, guide }) => {
  const [activeTab, setActiveTab] = useState(0);

  const sections = guide?.sections || [];

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: { xs: '100%', sm: 600, md: 680 },
          bgcolor: '#fafafa',
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
      {/* Header */}
      <Box
        sx={{
          px: 3,
          py: 2.5,
          bgcolor: '#ffffff',
          borderBottom: '1px solid #e2e8f0',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Box>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.75 }}>
              <BookIcon sx={{ fontSize: 18, color: '#f97316' }} />
              <Typography sx={{ fontSize: 11, fontWeight: 800, color: '#f97316', letterSpacing: 0.8, textTransform: 'uppercase' }}>
                Investigator Forensic Guide
              </Typography>
            </Stack>
            <Typography sx={{ fontSize: 19, fontWeight: 800, color: '#0f172a' }}>
              {guide?.title || 'Case Retrieval & Comparison: Forensic Similarity Guide'}
            </Typography>
            <Typography sx={{ mt: 0.5, fontSize: 12.5, color: '#64748b', lineHeight: 1.5 }}>
              Comprehensive reference on similarity algorithms, 4 mathematical lenses, and defensible precedent review.
            </Typography>
          </Box>
          <IconButton size="small" onClick={onClose} sx={{ color: '#94a3b8' }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>

        {/* Section Navigation Tabs */}
        <Tabs
          value={activeTab}
          onChange={(_, val) => setActiveTab(val)}
          sx={{
            mt: 2,
            minHeight: 36,
            '& .MuiTab-root': {
              minHeight: 36,
              py: 0.5,
              px: 1.5,
              fontSize: 12,
              fontWeight: 700,
              textTransform: 'none',
            },
          }}
        >
          <Tab label="1. Architecture & Vector Index" />
          <Tab label="2. The 4 Similarity Lenses" />
          <Tab label="3. Workflow & Precedent" />
        </Tabs>
      </Box>

      {/* Content Body */}
      <Box sx={{ p: 3, flexGrow: 1, overflowY: 'auto' }}>
        {/* TAB 0: Section 1 (Architecture) */}
        {activeTab === 0 && sections[0] && (
          <Stack spacing={2.5}>
            <Box>
              <Chip
                label={sections[0].tag || 'MATHEMATICAL FOUNDATION'}
                size="small"
                sx={{ bgcolor: '#f1f5f9', color: '#475569', fontWeight: 800, fontSize: 10, mb: 1 }}
              />
              <Typography sx={{ fontSize: 16, fontWeight: 800, color: '#0f172a' }}>
                {sections[0].heading}
              </Typography>
              <Typography sx={{ mt: 1, fontSize: 13.5, color: '#334155', lineHeight: 1.7 }}>
                {sections[0].body}
              </Typography>
            </Box>

            {(sections[0].details || []).map((detail, idx) => (
              <Paper
                key={idx}
                variant="outlined"
                sx={{
                  p: 2.25,
                  borderRadius: 2,
                  bgcolor: '#ffffff',
                  borderColor: '#e2e8f0',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
                }}
              >
                <Typography sx={{ fontSize: 13.5, fontWeight: 800, color: '#0f172a', mb: 0.75 }}>
                  {detail.title}
                </Typography>
                <Typography sx={{ fontSize: 12.5, color: '#475569', lineHeight: 1.7, whiteSpace: 'pre-line' }}>
                  {detail.text}
                </Typography>
              </Paper>
            ))}

            <Paper
              variant="outlined"
              sx={{
                p: 2,
                borderRadius: 2,
                bgcolor: '#f8fafc',
                borderColor: '#cbd5e1',
                borderLeft: '4px solid #0284c7',
              }}
            >
              <Typography sx={{ fontSize: 12, fontWeight: 800, color: '#0369a1', mb: 0.5 }}>
                📐 Mathematical Transformation Pipeline:
              </Typography>
              <Typography sx={{ fontSize: 12, color: '#334155', fontFamily: 'monospace', lineHeight: 1.6 }}>
                Raw Metrics ➔ log1p(x) ➔ z = (x - μ)/σ ➔ v / ||v|| (L2 Normalized) ➔ FAISS IndexFlatIP Cosine Similarity
              </Typography>
            </Paper>
          </Stack>
        )}

        {/* TAB 1: Section 2 (The 4 Similarity Lenses) */}
        {activeTab === 1 && sections[1] && (
          <Stack spacing={2.5}>
            <Box>
              <Chip
                label={sections[1].tag || '4 FORENSIC LENSES'}
                size="small"
                sx={{ bgcolor: '#fff7ed', color: '#c2410c', fontWeight: 800, fontSize: 10, mb: 1 }}
              />
              <Typography sx={{ fontSize: 16, fontWeight: 800, color: '#0f172a' }}>
                {sections[1].heading}
              </Typography>
              <Typography sx={{ mt: 1, fontSize: 13.5, color: '#334155', lineHeight: 1.7 }}>
                {sections[1].body}
              </Typography>
            </Box>

            {(sections[1].modes || []).map((mode) => {
              const theme = MODE_THEMES[mode.name] || MODE_THEMES['1. Behavioral Similarity'];
              return (
                <Paper
                  key={mode.name}
                  variant="outlined"
                  sx={{
                    p: 2.5,
                    borderRadius: 2.5,
                    bgcolor: '#ffffff',
                    borderColor: theme.border,
                    boxShadow: '0 1px 4px rgba(0,0,0,0.03)',
                  }}
                >
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                    <Stack direction="row" spacing={1.25} alignItems="center">
                      <Box sx={{ p: 0.75, borderRadius: 1.5, bgcolor: theme.bg, display: 'flex' }}>
                        {theme.icon}
                      </Box>
                      <Typography sx={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>
                        {mode.name}
                      </Typography>
                    </Stack>
                    <Chip
                      label={theme.tag}
                      size="small"
                      sx={{ bgcolor: theme.bg, color: theme.color, fontWeight: 800, fontSize: 10, border: `1px solid ${theme.border}` }}
                    />
                  </Box>

                  <Typography sx={{ fontSize: 11, fontWeight: 700, color: '#64748b', mb: 1 }}>
                    Vector Structure: <span style={{ color: '#0f172a' }}>{mode.weight}</span>
                  </Typography>

                  <Typography sx={{ fontSize: 12.5, color: '#334155', lineHeight: 1.65, mb: 1.75 }}>
                    <strong>What it does:</strong> {mode.what_it_does}
                  </Typography>

                  <Box sx={{ p: 1.75, borderRadius: 2, bgcolor: '#f8fafc', mb: 1.75, border: '1px solid #f1f5f9' }}>
                    <Typography sx={{ fontSize: 11, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.5, mb: 1 }}>
                      Calculated Features ({mode.features_used?.length || 0}):
                    </Typography>
                    <Stack spacing={0.6}>
                      {(mode.features_used || []).map((feat, fIdx) => (
                        <Box key={fIdx} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                          <Typography sx={{ fontSize: 12, color: theme.color, fontWeight: 800, lineHeight: 1.4 }}>•</Typography>
                          <Typography sx={{ fontSize: 12, color: '#475569', lineHeight: 1.5 }}>{feat}</Typography>
                        </Box>
                      ))}
                    </Stack>
                  </Box>

                  <Box sx={{ p: 1.5, borderRadius: 1.5, bgcolor: theme.bg, border: `1px dashed ${theme.border}` }}>
                    <Typography sx={{ fontSize: 11.5, fontWeight: 800, color: theme.color, mb: 0.25 }}>
                      💡 Recommended Investigator Use Case:
                    </Typography>
                    <Typography sx={{ fontSize: 12, color: '#334155', lineHeight: 1.6 }}>
                      {mode.investigator_use_case}
                    </Typography>
                  </Box>
                </Paper>
              );
            })}
          </Stack>
        )}

        {/* TAB 2: Section 3 (Workflow & Precedent) */}
        {activeTab === 2 && sections[2] && (
          <Stack spacing={2.5}>
            <Box>
              <Chip
                label={sections[2].tag || 'INVESTIGATION PLAYBOOK'}
                size="small"
                sx={{ bgcolor: '#ecfdf5', color: '#047857', fontWeight: 800, fontSize: 10, mb: 1 }}
              />
              <Typography sx={{ fontSize: 16, fontWeight: 800, color: '#0f172a' }}>
                {sections[2].heading}
              </Typography>
              <Typography sx={{ mt: 1, fontSize: 13.5, color: '#334155', lineHeight: 1.7 }}>
                {sections[2].body}
              </Typography>
            </Box>

            {(sections[2].details || []).map((detail, idx) => (
              <Paper
                key={idx}
                variant="outlined"
                sx={{
                  p: 2.25,
                  borderRadius: 2,
                  bgcolor: '#ffffff',
                  borderColor: '#e2e8f0',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
                }}
              >
                <Typography sx={{ fontSize: 13.5, fontWeight: 800, color: '#0f172a', mb: 0.75 }}>
                  {detail.title}
                </Typography>
                <Typography sx={{ fontSize: 12.5, color: '#475569', lineHeight: 1.7, whiteSpace: 'pre-line' }}>
                  {detail.text}
                </Typography>
              </Paper>
            ))}

            <Paper
              variant="outlined"
              sx={{
                p: 2,
                borderRadius: 2,
                bgcolor: '#f0fdf4',
                borderColor: '#bbf7d0',
                borderLeft: '4px solid #16a34a',
              }}
            >
              <Typography sx={{ fontSize: 12, fontWeight: 800, color: '#15803d', mb: 0.5 }}>
                🛡️ Examiner Audit Defense Tip:
              </Typography>
              <Typography sx={{ fontSize: 12, color: '#166534', lineHeight: 1.6 }}>
                Always export the side-by-side Case Comparison Report when concluding high-risk reviews. Showing that an account's flow matched a prior SAR-filing pattern with 92% typology similarity provides defensible, empirical rationale.
              </Typography>
            </Paper>
          </Stack>
        )}
      </Box>

      {/* Footer */}
      <Box sx={{ p: 2, bgcolor: '#ffffff', borderTop: '1px solid #e2e8f0', textAlign: 'right' }}>
        <Button variant="contained" size="small" onClick={onClose} sx={{ textTransform: 'none', fontWeight: 700 }}>
          Close Guide
        </Button>
      </Box>
    </Drawer>
  );
};

export default ModuleGuideDrawer;
