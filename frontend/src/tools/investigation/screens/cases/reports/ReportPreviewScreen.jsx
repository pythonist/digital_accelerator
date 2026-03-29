import React from 'react';
import { Box, Paper, Stack, Typography } from '@mui/material';

const Section = ({ title, children }) => (
  <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 2.5 }}>
    <Typography sx={{ fontSize: 14.5, fontWeight: 800, color: '#0f172a', mb: 1.25 }}>{title}</Typography>
    {children}
  </Paper>
);

const ReportPreviewScreen = ({ preview }) => {
  if (!preview) return null;

  return (
    <Stack spacing={2.25}>
      <Section title="Executive Summary">
        <Typography sx={{ fontSize: 13, lineHeight: 1.8, color: '#334155' }}>
          {preview.executive_summary || 'Executive summary will appear here after report generation.'}
        </Typography>
      </Section>

      <Box sx={{ display: 'grid', gap: 2.25, gridTemplateColumns: { xs: '1fr', xl: '1fr 1fr' } }}>
        <Section title="Evidence Summary">
          <Typography sx={{ fontSize: 13, lineHeight: 1.8, color: '#334155' }}>
            {preview.evidence_explanation || preview.evidence_summary?.narrative_seed || 'Evidence summary not available.'}
          </Typography>
        </Section>
        <Section title="Review Questions">
          <Stack spacing={1}>
            {(preview.review_questions || []).map((item, index) => (
              <Typography key={`question_${index + 1}`} sx={{ fontSize: 13, color: '#334155', lineHeight: 1.7 }}>
                {index + 1}. {item}
              </Typography>
            ))}
          </Stack>
        </Section>
      </Box>

      <Section title="Report Contents">
        <Typography sx={{ fontSize: 12.75, lineHeight: 1.8, color: '#475569' }}>
          The generated PDF includes the case overview, evidence summary, suspicious transaction ledger, Copilot investigation insights, review questions, lineage chain, similar-case comparison, graph summary, rule and typology interpretation, final resolution, and appendix tables.
        </Typography>
      </Section>
    </Stack>
  );
};

export default ReportPreviewScreen;
