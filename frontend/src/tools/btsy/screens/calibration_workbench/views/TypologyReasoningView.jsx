import React, { useMemo, useState } from 'react';
import { Box, Typography, Paper, Stack, Chip, TextField, Button, Divider } from '@mui/material';

const TYPOLOGIES = [
  'Cash structuring',
  'Mule funnel',
  'Rapid velocity',
  'Dormant activation',
  'Layering / pass-through',
  'High value low frequency',
  'Repeated moderate',
  'Burst activity'
];

const TypologyReasoningView = ({ session, annotations, onSave }) => {
  const [selectedTags, setSelectedTags] = useState([]);
  const [notes, setNotes] = useState('');

  const existing = useMemo(() => {
    return (annotations || []).filter(a => a.annotation_type === 'typology' || a.annotation_type === 'rationale');
  }, [annotations]);

  const toggleTag = (tag) => {
    setSelectedTags((prev) => (prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]));
  };

  const handleSave = async () => {
    const text = [
      selectedTags.length ? `Typology tags: ${selectedTags.join(', ')}` : null,
      notes.trim() ? `Notes:\n${notes.trim()}` : null
    ].filter(Boolean).join('\n\n');
    if (!text) return;
    await onSave({ annotation_type: 'typology', text });
    setSelectedTags([]);
    setNotes('');
  };

  if (!session) return null;

  return (
    <Box>
      <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0, mb: 2 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Typology Alignment</Typography>
        <Typography variant="body2" sx={{ color: '#64748b', mb: 1 }}>
          Analyst annotation. This is not automation and does not flag entities. It captures rationale for audit and replay.
        </Typography>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', mb: 1 }}>
          {TYPOLOGIES.map((t) => (
            <Chip
              key={t}
              label={t}
              color={selectedTags.includes(t) ? 'primary' : 'default'}
              variant={selectedTags.includes(t) ? 'filled' : 'outlined'}
              onClick={() => toggleTag(t)}
              sx={{ mb: 1 }}
            />
          ))}
        </Stack>
        <TextField
          fullWidth
          multiline
          minRows={4}
          label="Analyst Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <Button variant="contained" sx={{ mt: 1, bgcolor: '#0f172a' }} onClick={handleSave}>
          Save Typology Note
        </Button>
      </Paper>

      <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Saved Notes</Typography>
        {existing.length === 0 && (
          <Typography variant="body2" sx={{ color: '#64748b' }}>No typology notes yet.</Typography>
        )}
        {existing.length > 0 && (
          <Stack spacing={1}>
            {existing.map((a) => (
              <Box key={a.annotation_id} sx={{ border: '1px solid #e2e8f0', p: 1 }}>
                <Typography variant="caption" sx={{ color: '#64748b', display: 'block' }}>
                  {a.created_at} • {a.created_by || '—'}
                </Typography>
                <Divider sx={{ my: 0.5 }} />
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                  {a.text}
                </Typography>
              </Box>
            ))}
          </Stack>
        )}
      </Paper>
    </Box>
  );
};

export default TypologyReasoningView;

