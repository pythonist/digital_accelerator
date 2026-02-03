import React, { useState, useEffect } from 'react';
import { useAppContext } from "@context/AppContext";
import apiClient from "@services/api";
import SentinelLogo from '../../assets/sentinel_logo.png';

// ✅ Import Layout Components
import PageContainer from "@investigation-layout/PageContainer";

// MUI Components
import {
  Box, Paper, Typography, Button, Stack, TextField, Grid,
  Avatar, Chip, Divider, CircularProgress, Container
} from '@mui/material';

// Icons
import {
  AccountBalance as LandmarkIcon,
  CloudUpload as UploadIcon,
  CheckCircle as CheckIcon,
  Dns as ServerIcon,
  Add as AddIcon
} from '@mui/icons-material';

const EnvironmentManagerScreen = () => {
  const [createdEnvs, setCreatedEnvs] = useState({});
  const [defaultBanks, setDefaultBanks] = useState([]);
  const [activeDbPath, setActiveDbPath] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const { setActiveBankName } = useAppContext();

  const fetchAll = async () => {
    setIsLoading(true);
    try {
      const createdRes = await apiClient.get('/api/v2/environments/list-created');
      setCreatedEnvs(createdRes.environments || {});
      setActiveDbPath(createdRes.active_db_path || '');
      setActiveBankName(createdRes.active_bank_name || 'Default');
      
      const defaultsRes = await apiClient.get('/api/v2/environments/list-defaults');
      setDefaultBanks(defaultsRes || []);
    } catch (err) { console.error(err); } 
    finally { setIsLoading(false); }
  };
  
  useEffect(() => { fetchAll(); }, []);

  const handleSetActive = async (key) => {
    if (createdEnvs[key].db_path === activeDbPath) return;
    if (!window.confirm('Server will restart. Continue?')) return;
    try { await apiClient.post('/api/v2/environments/set-active', { db_path_key: key }); alert('Restarting... Reload page.'); } 
    catch (err) { alert('Server restarting...'); }
  };

  if (isLoading) {
    return (
      <PageContainer 
        title="Environment Manager" 
        subtitle="Manage and switch between isolated banking environments"
        breadcrumbs={['System', 'Environments']}
      >
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <CircularProgress />
        </Box>
      </PageContainer>
    );
  }

  return (
    <PageContainer 
      title="Environment Manager" 
      subtitle="Manage and switch between isolated banking environments"
      breadcrumbs={['System', 'Environments']}
    >
      <Box sx={{ flex: 1, p: 3, overflowY: 'auto' }}>
        <Grid container spacing={3}>
          
          {/* LEFT PANEL: Create New */}
          <Grid item xs={12} md={4}>
            <CreateEnvironmentPanel defaultBanks={defaultBanks} onRefresh={fetchAll} />
          </Grid>

          {/* RIGHT PANEL: List */}
          <Grid item xs={12} md={8}>
            <Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
              <Typography variant="h6" fontWeight="bold" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <ServerIcon color="primary" /> Your Environments
              </Typography>
              <Typography variant="body2" color="text.secondary" mb={3}>
                Select an active environment to isolate data and configurations.
              </Typography>

              <Stack spacing={2}>
                {Object.keys(createdEnvs).map(key => {
                  const env = createdEnvs[key];
                  const isActive = env.db_path === activeDbPath;
                  return (
                    <Paper 
                      key={key} 
                      variant="outlined"
                      sx={{ 
                        p: 2, 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center',
                        borderColor: isActive ? 'primary.main' : 'divider',
                        bgcolor: isActive ? '#e3f2fd' : 'background.paper',
                        transition: 'all 0.2s',
                        '&:hover': { borderColor: 'primary.main' }
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Avatar 
                          src={env.logo_url} 
                          variant="rounded"
                          sx={{ bgcolor: 'white', border: '1px solid #eee', color: 'grey.400' }}
                        >
                          <LandmarkIcon />
                        </Avatar>
                        
                        <Box>
                          <Stack direction="row" spacing={1} alignItems="center">
                            <Typography variant="subtitle1" fontWeight="bold" color="text.primary">
                              {env.name}
                            </Typography>
                            {isActive && (
                              <Chip label="ACTIVE" size="small" color="primary" sx={{ height: 20, fontSize: '0.65rem', fontWeight: 'bold' }} />
                            )}
                          </Stack>
                          <Typography variant="caption" color="text.secondary">
                            ID: {key}
                          </Typography>
                        </Box>
                      </Box>

                      <Button 
                        variant={isActive ? "text" : "contained"}
                        color="primary"
                        onClick={() => handleSetActive(key)}
                        disabled={isActive}
                        disableElevation
                        size="small"
                      >
                        {isActive ? 'Current' : 'Set Active'}
                      </Button>
                    </Paper>
                  );
                })}
              </Stack>
            </Paper>
          </Grid>

        </Grid>
      </Box>
    </PageContainer>
  );
};

const CreateEnvironmentPanel = ({ defaultBanks, onRefresh }) => {
  const [name, setName] = useState('');
  const [file, setFile] = useState(null);
  const [creating, setCreating] = useState(false);
  
  const createCustom = async (e) => {
    e.preventDefault();
    if(!name) return;
    setCreating(true);
    try {
      const fd = new FormData(); 
      fd.append('bank_name', name); 
      if(file) fd.append('logo', file);
      await apiClient.postForm('/api/v2/environments/create-custom', fd);
      setName('');
      setFile(null);
      onRefresh();
    } catch(e) {
      console.error(e);
    } finally {
      setCreating(false);
    }
  };

  const installTemplate = async (b) => {
    setCreating(true);
    try {
      await apiClient.post('/api/v2/environments/create-from-default', { key: b.key, name: b.name, logo_url: b.logo_url });
      onRefresh();
    } finally {
      setCreating(false);
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
      <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
        Create New
      </Typography>
      
      <Box component="form" onSubmit={createCustom} sx={{ mb: 4 }}>
        <Stack spacing={2}>
          <TextField 
            label="Environment Name" 
            size="small" 
            fullWidth 
            value={name}
            onChange={e => setName(e.target.value)}
            disabled={creating}
          />
          
          <Button
            component="label"
            variant="outlined"
            size="small"
            startIcon={<UploadIcon />}
            fullWidth
            disabled={creating}
            sx={{ borderStyle: 'dashed', color: 'text.secondary' }}
          >
            {file ? file.name : "Upload Logo (Optional)"}
            <input type="file" hidden onChange={e => setFile(e.target.files[0])} accept="image/*" />
          </Button>

          <Button 
            type="submit" 
            variant="contained" 
            fullWidth 
            disabled={creating || !name}
            startIcon={creating ? <CircularProgress size={16} color="inherit" /> : <AddIcon />}
          >
            Create Custom
          </Button>
        </Stack>
      </Box>
      
      <Divider sx={{ my: 3 }} />
      
      <Typography variant="caption" fontWeight="bold" color="text.secondary" sx={{ textTransform: 'uppercase', mb: 2, display: 'block' }}>
        Available Templates
      </Typography>
      
      <Stack spacing={1}>
        {defaultBanks.map(b => (
          <Paper key={b.key} variant="outlined" sx={{ p: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center', bgcolor: '#fafafa' }}>
            <Typography variant="body2" fontWeight="500">{b.name}</Typography>
            <Button 
              size="small" 
              variant={b.is_created ? "text" : "outlined"}
              color={b.is_created ? "success" : "primary"}
              disabled={b.is_created || creating}
              onClick={() => installTemplate(b)}
              sx={{ fontSize: '0.75rem', py: 0.5 }}
              startIcon={b.is_created ? <CheckIcon fontSize="small" /> : <UploadIcon fontSize="small" />}
            >
              {b.is_created ? 'Installed' : 'Install'}
            </Button>
          </Paper>
        ))}
      </Stack>
    </Paper>
  );
};

export default EnvironmentManagerScreen;