import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Alert,
  Stack,
  TextField,
  MenuItem,
  Grid,
  Chip,
  Typography,
  Divider,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody
} from '@mui/material';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line } from 'recharts';
import muleApi from '../services/muleApi';

const TrainModelScreen = () => {
  const [modelType, setModelType] = useState('xgboost');
  const [testSize, setTestSize] = useState(0.2);
  const [useSmote, setUseSmote] = useState(true);
  const [cvFolds, setCvFolds] = useState(5);
  const [randomState, setRandomState] = useState(42);
  const [xgbParams, setXgbParams] = useState({
    n_estimators: 300,
    max_depth: 6,
    learning_rate: 0.05,
    subsample: 0.9,
    colsample_bytree: 0.9,
    min_child_weight: 1,
    gamma: 0,
    reg_lambda: 1
  });
  const [rfParams, setRfParams] = useState({
    n_estimators: 500,
    max_depth: 12,
    min_samples_split: 5,
    min_samples_leaf: 2
  });
  const [isoParams, setIsoParams] = useState({
    n_estimators: 300,
    contamination: 0.1,
    max_samples: 1.0
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [models, setModels] = useState([]);
  const [compareA, setCompareA] = useState('');
  const [compareB, setCompareB] = useState('');

  const loadModels = async () => {
    try {
      const res = await muleApi.listModels();
      setModels(res.models || []);
    } catch {
      setModels([]);
    }
  };

  useEffect(() => {
    loadModels();
  }, []);

  useEffect(() => {
    if (!models.length) return;
    if (!compareA) setCompareA(models[0].model_version);
    if (!compareB && models.length > 1) setCompareB(models[1].model_version);
  }, [models]);

  const toInt = (v, fallback) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.trunc(n);
  };

  const toFloat = (v, fallback) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return n;
  };

  const buildHyperparams = () => {
    if (modelType === 'xgboost') {
      return {
        n_estimators: toInt(xgbParams.n_estimators, 300),
        max_depth: toInt(xgbParams.max_depth, 6),
        learning_rate: toFloat(xgbParams.learning_rate, 0.05),
        subsample: toFloat(xgbParams.subsample, 0.9),
        colsample_bytree: toFloat(xgbParams.colsample_bytree, 0.9),
        min_child_weight: toFloat(xgbParams.min_child_weight, 1),
        gamma: toFloat(xgbParams.gamma, 0),
        reg_lambda: toFloat(xgbParams.reg_lambda, 1)
      };
    }
    if (modelType === 'randomforest') {
      return {
        n_estimators: toInt(rfParams.n_estimators, 500),
        max_depth: toInt(rfParams.max_depth, 12),
        min_samples_split: toInt(rfParams.min_samples_split, 5),
        min_samples_leaf: toInt(rfParams.min_samples_leaf, 2)
      };
    }
    return {
      n_estimators: toInt(isoParams.n_estimators, 300),
      contamination: toFloat(isoParams.contamination, 0.1),
      max_samples: isoParams.max_samples === 'auto' ? 'auto' : toFloat(isoParams.max_samples, 1.0)
    };
  };

  const train = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const hyperparams = buildHyperparams();
      const res = await muleApi.trainModel({
        model_type: modelType,
        test_size: Number(testSize),
        use_smote: Boolean(useSmote),
        cv_folds: Number(cvFolds),
        random_state: Number(randomState),
        hyperparams
      });
      setResult(res);
      await loadModels();
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Training failed');
    } finally {
      setLoading(false);
    }
  };

  const HyperparamFields = () => {
    if (modelType === 'xgboost') {
      return (
        <Grid container spacing={2}>
          <Grid item xs={12}>
            <Typography variant="subtitle2">XGBoost Hyperparameters</Typography>
            <Divider sx={{ mt: 1 }} />
          </Grid>
          <Grid item xs={6}>
            <TextField
              label="n_estimators"
              type="number"
              value={xgbParams.n_estimators}
              onChange={(e) => setXgbParams((p) => ({ ...p, n_estimators: e.target.value }))}
              fullWidth
            />
          </Grid>
          <Grid item xs={6}>
            <TextField
              label="max_depth"
              type="number"
              value={xgbParams.max_depth}
              onChange={(e) => setXgbParams((p) => ({ ...p, max_depth: e.target.value }))}
              fullWidth
            />
          </Grid>
          <Grid item xs={6}>
            <TextField
              label="learning_rate"
              type="number"
              inputProps={{ step: 0.01, min: 0.0001, max: 1 }}
              value={xgbParams.learning_rate}
              onChange={(e) => setXgbParams((p) => ({ ...p, learning_rate: e.target.value }))}
              fullWidth
            />
          </Grid>
          <Grid item xs={6}>
            <TextField
              label="subsample"
              type="number"
              inputProps={{ step: 0.05, min: 0.1, max: 1 }}
              value={xgbParams.subsample}
              onChange={(e) => setXgbParams((p) => ({ ...p, subsample: e.target.value }))}
              fullWidth
            />
          </Grid>
          <Grid item xs={6}>
            <TextField
              label="colsample_bytree"
              type="number"
              inputProps={{ step: 0.05, min: 0.1, max: 1 }}
              value={xgbParams.colsample_bytree}
              onChange={(e) => setXgbParams((p) => ({ ...p, colsample_bytree: e.target.value }))}
              fullWidth
            />
          </Grid>
          <Grid item xs={6}>
            <TextField
              label="min_child_weight"
              type="number"
              inputProps={{ step: 0.5, min: 0 }}
              value={xgbParams.min_child_weight}
              onChange={(e) => setXgbParams((p) => ({ ...p, min_child_weight: e.target.value }))}
              fullWidth
            />
          </Grid>
          <Grid item xs={6}>
            <TextField
              label="gamma"
              type="number"
              inputProps={{ step: 0.1, min: 0 }}
              value={xgbParams.gamma}
              onChange={(e) => setXgbParams((p) => ({ ...p, gamma: e.target.value }))}
              fullWidth
            />
          </Grid>
          <Grid item xs={6}>
            <TextField
              label="reg_lambda"
              type="number"
              inputProps={{ step: 0.1, min: 0 }}
              value={xgbParams.reg_lambda}
              onChange={(e) => setXgbParams((p) => ({ ...p, reg_lambda: e.target.value }))}
              fullWidth
            />
          </Grid>
        </Grid>
      );
    }

    if (modelType === 'randomforest') {
      return (
        <Grid container spacing={2}>
          <Grid item xs={12}>
            <Typography variant="subtitle2">RandomForest Hyperparameters</Typography>
            <Divider sx={{ mt: 1 }} />
          </Grid>
          <Grid item xs={6}>
            <TextField
              label="n_estimators"
              type="number"
              value={rfParams.n_estimators}
              onChange={(e) => setRfParams((p) => ({ ...p, n_estimators: e.target.value }))}
              fullWidth
            />
          </Grid>
          <Grid item xs={6}>
            <TextField
              label="max_depth"
              type="number"
              value={rfParams.max_depth}
              onChange={(e) => setRfParams((p) => ({ ...p, max_depth: e.target.value }))}
              fullWidth
            />
          </Grid>
          <Grid item xs={6}>
            <TextField
              label="min_samples_split"
              type="number"
              value={rfParams.min_samples_split}
              onChange={(e) => setRfParams((p) => ({ ...p, min_samples_split: e.target.value }))}
              fullWidth
            />
          </Grid>
          <Grid item xs={6}>
            <TextField
              label="min_samples_leaf"
              type="number"
              value={rfParams.min_samples_leaf}
              onChange={(e) => setRfParams((p) => ({ ...p, min_samples_leaf: e.target.value }))}
              fullWidth
            />
          </Grid>
        </Grid>
      );
    }

    return (
      <Grid container spacing={2}>
        <Grid item xs={12}>
          <Typography variant="subtitle2">Isolation Forest Hyperparameters</Typography>
          <Divider sx={{ mt: 1 }} />
        </Grid>
        <Grid item xs={6}>
          <TextField
            label="n_estimators"
            type="number"
            value={isoParams.n_estimators}
            onChange={(e) => setIsoParams((p) => ({ ...p, n_estimators: e.target.value }))}
            fullWidth
          />
        </Grid>
        <Grid item xs={6}>
          <TextField
            label="contamination"
            type="number"
            inputProps={{ step: 0.01, min: 0.001, max: 0.5 }}
            value={isoParams.contamination}
            onChange={(e) => setIsoParams((p) => ({ ...p, contamination: e.target.value }))}
            fullWidth
          />
        </Grid>
        <Grid item xs={12}>
          <TextField
            select
            label="max_samples"
            value={String(isoParams.max_samples)}
            onChange={(e) => setIsoParams((p) => ({ ...p, max_samples: e.target.value }))}
            fullWidth
          >
            <MenuItem value="auto">auto</MenuItem>
            <MenuItem value="0.5">0.5</MenuItem>
            <MenuItem value="0.7">0.7</MenuItem>
            <MenuItem value="1.0">1.0</MenuItem>
          </TextField>
        </Grid>
      </Grid>
    );
  };

  const latest = models.length ? models[0] : null;

  const compareData = useMemo(() => {
    const a = models.find((m) => m.model_version === compareA);
    const b = models.find((m) => m.model_version === compareB);
    const metrics = [
      { key: 'accuracy', label: 'Accuracy' },
      { key: 'precision', label: 'Precision' },
      { key: 'recall', label: 'Recall' },
      { key: 'f1', label: 'F1' },
      { key: 'auc', label: 'AUC' }
    ];
    return metrics.map((m) => ({
      metric: m.label,
      A: Number(a?.[m.key] ?? 0),
      B: Number(b?.[m.key] ?? 0)
    }));
  }, [models, compareA, compareB]);

  const importanceData = useMemo(() => {
    const fi = result?.feature_importance || {};
    const names = fi.top_features || [];
    const vals = fi.top_importance || [];
    return names.map((f, i) => ({ feature: f, importance: Number(vals[i] ?? 0) }));
  }, [result]);

  const rocData = useMemo(() => {
    const rc = result?.metrics?.roc_curve;
    const fpr = rc?.fpr || [];
    const tpr = rc?.tpr || [];
    const rows = [];
    for (let i = 0; i < Math.min(fpr.length, tpr.length); i += 1) rows.push({ fpr: Number(fpr[i]), tpr: Number(tpr[i]) });
    return rows;
  }, [result]);

  const cm = result?.metrics?.confusion_matrix || null;

  return (
    <Box sx={{ p: 2 }}>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      <Grid container spacing={2}>
        <Grid item xs={12}>
          <Grid container spacing={2}>
            {[
              { title: 'Latest Accuracy', value: latest ? `${(Number(latest.accuracy || 0) * 100).toFixed(1)}%` : '-' },
              { title: 'Precision', value: latest ? `${(Number(latest.precision || 0) * 100).toFixed(1)}%` : '-' },
              { title: 'Recall', value: latest ? `${(Number(latest.recall || 0) * 100).toFixed(1)}%` : '-' },
              { title: 'Model Versions', value: models.length }
            ].map((c) => (
              <Grid item xs={12} sm={6} md={3} key={c.title}>
                <Card elevation={0} sx={{ border: '1px solid rgba(148,163,184,0.2)' }}>
                  <CardContent>
                    <Typography variant="caption" color="text.secondary">{c.title}</Typography>
                    <Typography variant="h5" fontWeight={800}>{c.value}</Typography>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </Grid>
        <Grid item xs={12} md={5}>
          <Card>
            <CardHeader title="Train Model" subheader="Train and persist a model from engineered features" />
            <CardContent>
              <Stack spacing={2}>
                <TextField
                  select
                  label="Model Type"
                  value={modelType}
                  onChange={(e) => setModelType(e.target.value)}
                >
                  <MenuItem value="xgboost">XGBoost</MenuItem>
                  <MenuItem value="randomforest">RandomForest</MenuItem>
                  <MenuItem value="isolation_forest">Isolation Forest</MenuItem>
                </TextField>
                <TextField
                  label="Test Size"
                  type="number"
                  inputProps={{ step: 0.05, min: 0.05, max: 0.5 }}
                  value={testSize}
                  onChange={(e) => setTestSize(e.target.value)}
                />
                <TextField
                  select
                  label="Use SMOTE"
                  value={useSmote ? 'true' : 'false'}
                  onChange={(e) => setUseSmote(e.target.value === 'true')}
                >
                  <MenuItem value="true">true</MenuItem>
                  <MenuItem value="false">false</MenuItem>
                </TextField>
                <TextField
                  label="CV Folds"
                  type="number"
                  inputProps={{ step: 1, min: 2, max: 10 }}
                  value={cvFolds}
                  onChange={(e) => setCvFolds(e.target.value)}
                />
                <TextField
                  label="Random State"
                  type="number"
                  inputProps={{ step: 1, min: 0, max: 999999 }}
                  value={randomState}
                  onChange={(e) => setRandomState(e.target.value)}
                />
                <HyperparamFields />
                <Button variant="contained" onClick={train} disabled={loading}>
                  {loading ? 'Training…' : 'Train'}
                </Button>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={7}>
          <Card sx={{ mb: 2 }}>
            <CardHeader title="Latest Result" action={<Button onClick={loadModels}>Refresh</Button>} />
            <CardContent>
              {result?.success ? (
                <Stack spacing={2}>
                  <Stack direction="row" spacing={1} flexWrap="wrap">
                    <Typography variant="body2" fontWeight={800}>
                      Model Version: {result.model_version}
                    </Typography>
                    <Chip label={`AUC: ${Number(result.metrics?.roc_auc || 0).toFixed(3)}`} />
                    <Chip label={`Precision: ${Number(result.metrics?.precision || 0).toFixed(3)}`} />
                    <Chip label={`Recall: ${Number(result.metrics?.recall || 0).toFixed(3)}`} />
                    <Chip label={`F1: ${Number(result.metrics?.f1_score || 0).toFixed(3)}`} />
                    <Chip label={`Accuracy: ${Number(result.metrics?.accuracy || 0).toFixed(3)}`} />
                  </Stack>

                  <Grid container spacing={2}>
                    <Grid item xs={12} md={6}>
                      <Card variant="outlined">
                        <CardHeader title="Top Feature Importance" subheader="Features used by the model" />
                        <CardContent sx={{ height: 240 }}>
                          {importanceData.length === 0 ? (
                            <Typography variant="body2" color="text.secondary">
                              Train a model to view importance.
                            </Typography>
                          ) : (
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={importanceData} layout="vertical" margin={{ left: 10, right: 10 }}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis type="number" />
                                <YAxis type="category" dataKey="feature" width={160} />
                                <Tooltip />
                                <Bar dataKey="importance" fill="#0ea5e9" />
                              </BarChart>
                            </ResponsiveContainer>
                          )}
                        </CardContent>
                      </Card>
                    </Grid>

                    <Grid item xs={12} md={6}>
                      <Card variant="outlined">
                        <CardHeader title="ROC Curve" subheader="Trade-off between TPR and FPR" />
                        <CardContent sx={{ height: 240 }}>
                          {rocData.length === 0 ? (
                            <Typography variant="body2" color="text.secondary">
                              ROC curve available when both classes are present.
                            </Typography>
                          ) : (
                            <ResponsiveContainer width="100%" height="100%">
                              <LineChart data={rocData}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="fpr" domain={[0, 1]} type="number" />
                                <YAxis dataKey="tpr" domain={[0, 1]} type="number" />
                                <Tooltip />
                                <Line type="monotone" dataKey="tpr" stroke="#ea580c" dot={false} strokeWidth={2} />
                              </LineChart>
                            </ResponsiveContainer>
                          )}
                        </CardContent>
                      </Card>
                    </Grid>

                    <Grid item xs={12}>
                      <Card variant="outlined">
                        <CardHeader title="Confusion Matrix" subheader="Test set classification outcomes" />
                        <CardContent>
                          {Array.isArray(cm) && cm.length === 2 ? (
                            <Grid container spacing={2}>
                              <Grid item xs={6} md={3}>
                                <Card elevation={0} sx={{ border: '1px solid rgba(15,23,42,0.12)' }}>
                                  <CardContent>
                                    <Typography variant="caption" color="text.secondary">True Negatives</Typography>
                                    <Typography variant="h6" fontWeight={900}>{cm[0][0]}</Typography>
                                  </CardContent>
                                </Card>
                              </Grid>
                              <Grid item xs={6} md={3}>
                                <Card elevation={0} sx={{ border: '1px solid rgba(15,23,42,0.12)' }}>
                                  <CardContent>
                                    <Typography variant="caption" color="text.secondary">False Positives</Typography>
                                    <Typography variant="h6" fontWeight={900}>{cm[0][1]}</Typography>
                                  </CardContent>
                                </Card>
                              </Grid>
                              <Grid item xs={6} md={3}>
                                <Card elevation={0} sx={{ border: '1px solid rgba(15,23,42,0.12)' }}>
                                  <CardContent>
                                    <Typography variant="caption" color="text.secondary">False Negatives</Typography>
                                    <Typography variant="h6" fontWeight={900}>{cm[1][0]}</Typography>
                                  </CardContent>
                                </Card>
                              </Grid>
                              <Grid item xs={6} md={3}>
                                <Card elevation={0} sx={{ border: '1px solid rgba(15,23,42,0.12)' }}>
                                  <CardContent>
                                    <Typography variant="caption" color="text.secondary">True Positives</Typography>
                                    <Typography variant="h6" fontWeight={900}>{cm[1][1]}</Typography>
                                  </CardContent>
                                </Card>
                              </Grid>
                            </Grid>
                          ) : (
                            <Typography variant="body2" color="text.secondary">
                              Confusion matrix not available.
                            </Typography>
                          )}
                        </CardContent>
                      </Card>
                    </Grid>
                  </Grid>
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  Train a model to see metrics.
                </Typography>
              )}
            </CardContent>
          </Card>

          <Card sx={{ mb: 2 }}>
            <CardHeader title="Model Comparison" subheader="Compare two trained models by metrics" />
            <CardContent>
              <Stack spacing={2}>
                <Stack direction="row" spacing={2}>
                  <TextField select label="Model A" size="small" value={compareA} onChange={(e) => setCompareA(e.target.value)} fullWidth>
                    {models.map((m) => (
                      <MenuItem key={m.model_version} value={m.model_version}>
                        {m.model_version} · {m.algorithm}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField select label="Model B" size="small" value={compareB} onChange={(e) => setCompareB(e.target.value)} fullWidth>
                    <MenuItem value="">None</MenuItem>
                    {models.map((m) => (
                      <MenuItem key={m.model_version} value={m.model_version}>
                        {m.model_version} · {m.algorithm}
                      </MenuItem>
                    ))}
                  </TextField>
                </Stack>
                <Box sx={{ height: 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={compareData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="metric" />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="A" fill="#0ea5e9" />
                      {compareB ? <Bar dataKey="B" fill="#ea580c" /> : null}
                    </BarChart>
                  </ResponsiveContainer>
                </Box>
              </Stack>
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="Experiment History" subheader="Versions, metrics, and hyperparameters" />
            <CardContent>
              {models.length === 0 ? (
                <Typography variant="body2" color="text.secondary">No models found.</Typography>
              ) : (
                <Grid container spacing={2}>
                  {models.slice(0, 12).map((m) => (
                    <Grid item xs={12} sm={6} md={4} key={m.model_version}>
                      <Card variant="outlined">
                        <CardContent>
                          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2}>
                            <Box>
                              <Typography variant="subtitle2" fontWeight={900}>
                                {m.model_version}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {m.algorithm}
                              </Typography>
                            </Box>
                            <Chip label={`AUC ${Number(m.auc || 0).toFixed(3)}`} />
                          </Stack>
                          <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mt: 1 }}>
                            <Chip size="small" label={`Acc ${Number(m.accuracy || 0).toFixed(3)}`} />
                            <Chip size="small" label={`P ${Number(m.precision || 0).toFixed(3)}`} />
                            <Chip size="small" label={`R ${Number(m.recall || 0).toFixed(3)}`} />
                            <Chip size="small" label={`F1 ${Number(m.f1 || 0).toFixed(3)}`} />
                          </Stack>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                            {Object.entries(m.hyperparams || {}).map(([k, v]) => `${k}=${v}`).join(', ') || 'No hyperparameters saved'}
                          </Typography>
                        </CardContent>
                      </Card>
                    </Grid>
                  ))}
                </Grid>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default TrainModelScreen;
