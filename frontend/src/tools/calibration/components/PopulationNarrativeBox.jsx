// frontend/src/tools/calibration/components/PopulationNarrativeBox.jsx
import React from 'react';
import { Box, Card, CardContent, Typography, Stack, Divider } from '@mui/material';
import { InfoOutlined, Check } from '@mui/icons-material';

const PopulationNarrativeBox = ({ narrative }) => {
  if (!narrative) return null;

  return (
    <Box sx={{ mb: 3 }}>
      <Card
        variant="outlined"
        sx={{
          bgcolor: 'info.50',
          borderColor: 'info.200',
          border: '2px solid'
        }}
      >
        <CardContent>
          <Stack direction="row" spacing={1} alignItems="center" mb={1.5}>
            <InfoOutlined color="info" />
            <Typography variant="subtitle2" fontWeight="600">
              Population Definition Summary
            </Typography>
          </Stack>

          <Typography variant="body2" sx={{ mb: 2, lineHeight: 1.6 }}>
            {narrative.auto_narrative}
          </Typography>

          <Divider sx={{ my: 1.5 }} />

          <Typography variant="caption" fontWeight="600" display="block" mb={1}>
            Applied Filters:
          </Typography>
          <Stack spacing={0.5}>
            {narrative.filters_summary.map((filter, idx) => (
              <Stack key={idx} direction="row" spacing={0.5} alignItems="center">
                <Check fontSize="small" color="success" sx={{ fontSize: 14 }} />
                <Typography variant="caption" color="text.secondary">
                  {filter}
                </Typography>
              </Stack>
            ))}
          </Stack>

          <Box sx={{ mt: 2, p: 1, bgcolor: 'white', borderRadius: 1 }}>
            <Typography variant="caption" color="text.secondary" fontStyle="italic">
              💡 This narrative will appear in the final calibration report
            </Typography>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
};

export default PopulationNarrativeBox;