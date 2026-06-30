import sys

filepath = 'e:/Trae/AI_AML_tool/frontend/src/tools/mlops/components/ModelTrainingPanel.jsx'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update Props
old_props = '''  allowedTrainingModes = null,
}) => {'''
new_props = '''  allowedTrainingModes = null,
  trainedModels = [],
  activeModelRun = null,
  onActiveModelSelect,
}) => {'''
content = content.replace(old_props, new_props)

# 2. Add History Dropdown state
old_is_mule = '''  const isMuleVariant = String(pipelineVariant || 'fcc').trim().toLowerCase() === 'mule';'''
new_is_mule = '''  const isMuleVariant = String(pipelineVariant || 'fcc').trim().toLowerCase() === 'mule';
  const [historyAnchorEl, setHistoryAnchorEl] = useState(null);
  const handleOpenHistory = (event) => setHistoryAnchorEl(event.currentTarget);
  const handleCloseHistory = () => setHistoryAnchorEl(null);
'''
content = content.replace(old_is_mule, new_is_mule)

# 3. Modify Tabs container
old_tabs_start = '''        <Tabs
          value={activeTab}
          onChange={(_, v) => setActiveTab(v)}
          sx={{
            bgcolor: '#fff',
            borderBottom: `1px solid ${T.border}`,
            '& .MuiTab-root': {
              textTransform: 'none',
              fontSize: 13,
              fontWeight: 600,
              minHeight: 48,
              borderRadius: 0,
            },
            '& .Mui-selected': { color: T.orange },
            '& .MuiTabs-indicator': { bgcolor: T.orange, height: 3 },
          }}
        >'''

new_tabs_start = '''        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: `1px solid ${T.border}`, bgcolor: '#fff' }}>
          <Tabs
            value={activeTab}
            onChange={(_, v) => setActiveTab(v)}
            sx={{
              '& .MuiTab-root': {
                textTransform: 'none',
                fontSize: 13,
                fontWeight: 600,
                minHeight: 48,
                borderRadius: 0,
              },
              '& .Mui-selected': { color: T.orange },
              '& .MuiTabs-indicator': { bgcolor: T.orange, height: 3 },
            }}
          >'''
content = content.replace(old_tabs_start, new_tabs_start)

old_tabs_end = '''            />
          ))}
        </Tabs>
      </Paper>'''

new_tabs_end = '''            />
          ))}
          </Tabs>
          
          <Box sx={{ pr: 2, pb: 0.75 }}>
            <Button
              onClick={handleOpenHistory}
              variant="outlined"
              size="small"
              endIcon={<KeyboardArrowDown sx={{ fontSize: 16 }} />}
              sx={{
                textTransform: 'none',
                borderRadius: 1.5,
                borderColor: T.border,
                color: T.textPrimary,
                bgcolor: '#fafbfc',
                height: 32,
                px: 1.5,
                '&:hover': { bgcolor: '#f1f5f9', borderColor: T.border }
              }}
            >
              <Box component="span" sx={{ fontSize: 10, color: T.textDim, fontWeight: 700, mr: 0.75, textTransform: 'uppercase', letterSpacing: 0.5 }}>History:</Box>
              <Box component="span" sx={{ fontSize: 12.5, fontWeight: 700 }}>
                {activeModelRun ? (activeModelRun.algorithm || 'Selected Model') : 'No Model Loaded'}
              </Box>
            </Button>
            <Menu
              anchorEl={historyAnchorEl}
              open={Boolean(historyAnchorEl)}
              onClose={handleCloseHistory}
              PaperProps={{
                elevation: 0,
                sx: {
                  mt: 1,
                  minWidth: 260,
                  borderRadius: 2,
                  border: `1px solid ${T.border}`,
                  boxShadow: '0 4px 20px rgba(0,0,0,0.08)'
                }
              }}
            >
              {trainedModels.length === 0 ? (
                <MenuItem disabled sx={{ fontSize: 12 }}>No models trained in this session.</MenuItem>
              ) : (
                trainedModels.map((model, idx) => (
                  <MenuItem 
                    key={model.job_id || idx} 
                    onClick={() => {
                      if (onActiveModelSelect) onActiveModelSelect(model);
                      handleCloseHistory();
                    }}
                    sx={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      py: 1,
                      px: 2,
                      bgcolor: activeModelRun?.job_id === model.job_id ? T.orangeLight : 'transparent'
                    }}
                  >
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%', mb: 0.5 }}>
                      <Typography sx={{ fontSize: 13, fontWeight: 700, color: T.textPrimary }}>
                        {model.algorithm || 'Model'}
                      </Typography>
                      {activeModelRun?.job_id === model.job_id && (
                        <CheckCircle sx={{ fontSize: 14, color: T.orange }} />
                      )}
                    </Box>
                    <Stack direction="row" spacing={1.5} alignItems="center">
                      <Typography sx={{ fontSize: 11, color: T.textMuted, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        AUC: <span style={{ fontWeight: 800, color: T.textPrimary, fontFamily: T.mono }}>{model.auc ? model.auc.toFixed(3) : '-'}</span>
                      </Typography>
                      {model.threshold && (
                         <Typography sx={{ fontSize: 11, color: T.textMuted, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                           Thresh: <span style={{ fontWeight: 800, color: T.textPrimary, fontFamily: T.mono }}>{model.threshold.toFixed(2)}</span>
                         </Typography>
                      )}
                    </Stack>
                  </MenuItem>
                ))
              )}
            </Menu>
          </Box>
        </Box>
      </Paper>'''
content = content.replace(old_tabs_end, new_tabs_end)

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)
print("Updated UI in ModelTrainingPanel")
