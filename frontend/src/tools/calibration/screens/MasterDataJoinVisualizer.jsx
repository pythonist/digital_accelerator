import React from 'react';
import { Box, Card, CardContent, Typography, Grid, Chip, Stack, Divider, Tooltip } from '@mui/material';
import { 
  ArrowForward, CheckCircle, Warning, Info, Storage, AccountBalance, People, Receipt 
} from '@mui/icons-material';

const MasterDataJoinVisualizer = ({ joinReport, uploadStats }) => {
  
  if (!joinReport || joinReport.length === 0) {
    return null;
  }

  const getMatchColor = (matchRate) => {
    if (matchRate >= 95) return 'success';
    if (matchRate >= 80) return 'warning';
    return 'error';
  };

  const getMatchIcon = (matchRate) => {
    if (matchRate >= 95) return <CheckCircle fontSize="small" />;
    if (matchRate >= 80) return <Warning fontSize="small" />;
    return <Warning fontSize="small" />;
  };

  return (
    <Card variant="outlined" sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="h6" gutterBottom fontWeight="bold" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Storage color="primary" />
          Data Relationship Validation
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Join quality analysis - no physical tables created
        </Typography>

        {/* Join Flow Diagram */}
        <Box sx={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between',
          gap: 2,
          mb: 4,
          flexWrap: { xs: 'wrap', md: 'nowrap' }
        }}>
          
          {/* Transactions (Base Table) */}
          <Card 
            sx={{ 
              flex: 1,
              minWidth: 200,
              bgcolor: 'primary.50',
              border: '2px solid',
              borderColor: 'primary.main',
              position: 'relative'
            }}
          >
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <Receipt color="primary" />
                <Typography variant="subtitle2" fontWeight="bold">
                  TRANSACTIONS
                </Typography>
              </Box>
              <Typography variant="caption" color="text.secondary" display="block">
                Base Table
              </Typography>
              <Chip 
                label={`${uploadStats?.transactions?.toLocaleString()} rows`}
                size="small"
                color="primary"
                sx={{ mt: 1 }}
              />
              <Box sx={{ 
                position: 'absolute',
                top: -10,
                right: -10,
                bgcolor: 'primary.main',
                color: 'white',
                borderRadius: '50%',
                width: 24,
                height: 24,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.75rem',
                fontWeight: 'bold'
              }}>
                1
              </Box>
            </CardContent>
          </Card>

          {/* Join Arrow 1 */}
          <Box sx={{ textAlign: 'center', flexShrink: 0 }}>
            <Typography variant="caption" fontWeight="bold" color="secondary.main" display="block">
              LEFT JOIN
            </Typography>
            <ArrowForward color="secondary" sx={{ fontSize: 32 }} />
            <Typography variant="caption" color="text.secondary" display="block" sx={{ fontSize: '0.7rem' }}>
              ON account_id
            </Typography>
          </Box>

          {/* Accounts */}
          <Card 
            sx={{ 
              flex: 1,
              minWidth: 200,
              bgcolor: 'secondary.50',
              border: '2px solid',
              borderColor: 'secondary.main',
              position: 'relative'
            }}
          >
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <AccountBalance color="secondary" />
                <Typography variant="subtitle2" fontWeight="bold">
                  ACCOUNTS
                </Typography>
              </Box>
              <Typography variant="caption" color="text.secondary" display="block">
                Account Details
              </Typography>
              <Chip 
                label={`${uploadStats?.accounts?.toLocaleString()} rows`}
                size="small"
                color="secondary"
                sx={{ mt: 1 }}
              />
              {joinReport[0] && (
                <Tooltip title={`${joinReport[0].matched?.toLocaleString()} matched, ${joinReport[0].unmatched?.toLocaleString()} unmatched`}>
                  <Chip
                    icon={getMatchIcon(joinReport[0].match_rate)}
                    label={`${joinReport[0].match_rate}% match`}
                    size="small"
                    color={getMatchColor(joinReport[0].match_rate)}
                    sx={{ mt: 1, ml: 1 }}
                  />
                </Tooltip>
              )}
              <Box sx={{ 
                position: 'absolute',
                top: -10,
                right: -10,
                bgcolor: 'secondary.main',
                color: 'white',
                borderRadius: '50%',
                width: 24,
                height: 24,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.75rem',
                fontWeight: 'bold'
              }}>
                2
              </Box>
            </CardContent>
          </Card>

          {/* Join Arrow 2 */}
          <Box sx={{ textAlign: 'center', flexShrink: 0 }}>
            <Typography variant="caption" fontWeight="bold" color="info.main" display="block">
              LEFT JOIN
            </Typography>
            <ArrowForward color="info" sx={{ fontSize: 32 }} />
            <Typography variant="caption" color="text.secondary" display="block" sx={{ fontSize: '0.7rem' }}>
              ON customer_id
            </Typography>
          </Box>

          {/* Customers */}
          <Card 
            sx={{ 
              flex: 1,
              minWidth: 200,
              bgcolor: 'info.50',
              border: '2px solid',
              borderColor: 'info.main',
              position: 'relative'
            }}
          >
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <People color="info" />
                <Typography variant="subtitle2" fontWeight="bold">
                  CUSTOMERS
                </Typography>
              </Box>
              <Typography variant="caption" color="text.secondary" display="block">
                Customer Demographics
              </Typography>
              <Chip 
                label={`${uploadStats?.customers?.toLocaleString()} rows`}
                size="small"
                color="info"
                sx={{ mt: 1 }}
              />
              {joinReport[1] && (
                <Tooltip title={`${joinReport[1].matched?.toLocaleString()} matched, ${joinReport[1].unmatched?.toLocaleString()} unmatched`}>
                  <Chip
                    icon={getMatchIcon(joinReport[1].match_rate)}
                    label={`${joinReport[1].match_rate}% match`}
                    size="small"
                    color={getMatchColor(joinReport[1].match_rate)}
                    sx={{ mt: 1, ml: 1 }}
                  />
                </Tooltip>
              )}
              <Box sx={{ 
                position: 'absolute',
                top: -10,
                right: -10,
                bgcolor: 'info.main',
                color: 'white',
                borderRadius: '50%',
                width: 24,
                height: 24,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.75rem',
                fontWeight: 'bold'
              }}>
                3
              </Box>
            </CardContent>
          </Card>
        </Box>

        <Divider sx={{ my: 3 }} />

        {/* Detailed Join Statistics */}
        <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
          Validation Results:
        </Typography>

        <Grid container spacing={2}>
          {joinReport.map((report, index) => (
            <Grid item xs={12} md={6} key={index}>
              <Card variant="outlined" sx={{ height: '100%' }}>
                <CardContent>
                  <Typography variant="caption" color="text.secondary" fontWeight="bold" gutterBottom display="block">
                    {report.step}
                  </Typography>
                  
                  <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
                    <Chip 
                      label={report.join_type || 'LEFT JOIN'} 
                      size="small" 
                      variant="outlined"
                      sx={{ fontSize: '0.7rem' }}
                    />
                    <Chip 
                      icon={getMatchIcon(report.match_rate)}
                      label={`${report.match_rate}% match rate`}
                      size="small"
                      color={getMatchColor(report.match_rate)}
                    />
                  </Stack>

                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography variant="caption" color="text.secondary">
                      Matched Records:
                    </Typography>
                    <Typography variant="caption" fontWeight="bold" color="success.main">
                      {report.matched?.toLocaleString()}
                    </Typography>
                  </Box>

                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="caption" color="text.secondary">
                      Unmatched Records:
                    </Typography>
                    <Typography variant="caption" fontWeight="bold" color={report.unmatched > 0 ? 'warning.main' : 'text.primary'}>
                      {report.unmatched?.toLocaleString()}
                    </Typography>
                  </Box>

                  {report.unmatched > 0 && report.match_rate < 80 && (
                    <Box sx={{ mt: 1, p: 1, bgcolor: 'warning.50', borderRadius: 1 }}>
                      <Typography variant="caption" color="warning.dark">
                        <Warning fontSize="inherit" sx={{ verticalAlign: 'middle', mr: 0.5 }} />
                        Low match rate - review ID column formats
                      </Typography>
                    </Box>
                  )}
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>

        {/* Data Quality Note */}
        <Box sx={{ mt: 3, p: 2, bgcolor: 'info.50', borderRadius: 1, border: '1px solid', borderColor: 'info.main' }}>
          <Typography variant="body2">
            <Info fontSize="small" sx={{ verticalAlign: 'middle', mr: 1 }} />
            <strong>STEP 0 Validation:</strong> This is a dry-run analysis only. No physical tables are created. 
            Validation ensures join keys are properly mapped and data quality is acceptable before proceeding to scenario definition.
          </Typography>
        </Box>
      </CardContent>
    </Card>
  );
};

export default MasterDataJoinVisualizer;