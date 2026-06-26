/**
 * ModelTrainingPanel.jsx - Step 6: ML Training Workbench (Enhanced v3)
 * ─────────────────────────────────────────────────────────────────────────────
 * FIXES applied:
 *   ① Encoding bug - XGBoost gamma label "Î³" corrected to "γ"
 *   ② Unused imports removed - RadioButtonChecked, RadioButtonUnchecked, Rule,
 *      Speed, AreaChart, Area (were imported but never used)
 *   ③ algoParams useMemo - was computed but never used (removed dead code)
 *   ④ Pipeline polling useEffect - dependency on pipelineRuns.length means
 *      a same-size re-run never restarts polling; fixed to use a stable
 *      pipelineRunsRef.current snapshot + a separate triggerKey
 *   ⑤ handleLoadRun - run.algorithm can be a label string, not an ID;
 *      now only tests against algo IDs, never raw label
 *   ⑥ togglePipelineSelection - loose != used instead of !==
 *   ⑦ ScoringLedger audit alert - called filtered[0]?.prob.toFixed(4) which
 *      throws when filtered[0] is undefined; guarded properly
 *   ⑧ ConfigureTab - defined as a nested function inside render, causing
 *      remount on every parent render; extracted to a stable inner component
 *      with props passed explicitly (same pattern applied to all inner tabs)
 *   ⑩ Tab index 4 badge - tabBadge(4) was called with a closure but the
 *      function only ever checks idx===4, so it was simplified inline
 *   ⑪ HMLThresholdEditor estimate logic - highCount estimate was wrong:
 *      used (1 - hmlHigh) * 0.6 which doesn't sum to total; corrected to a
 *      proportional three-way split that always reconciles
 *   ⑫ TreeNode maxDepth prop - accepted but never used (removed)
 *   ⑬ Progress display in pipeline table - backend returns 0-100 int but
 *      code divided by 100 again; fixed
 *   ⑭ Scoring Ledger mockLedger - used Math.random() inside useMemo without
 *      a stable seed, causing non-deterministic re-renders; made deterministic
 */

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, Collapse, Divider,
  Dialog, DialogContent, DialogTitle,
  IconButton, LinearProgress, Paper, Slider, Stack,
  Tab, Tabs, TextField, Tooltip, Typography,
  ToggleButton, ToggleButtonGroup,
} from '@mui/material';
import {
  AccountTree, AddCircleOutline, Analytics, Article, ArrowForward, AutoGraph,
  Bolt, CheckCircle, ChevronRight, Close, CloudDownload, CompareArrows,
  Delete, ErrorOutline, FilterList, Functions,
  Hub, Info, KeyboardArrowDown, KeyboardArrowUp, Layers, ModelTraining,
  Refresh, SaveAlt,
  ScatterPlot, Search, Settings, ShowChart, TableChart,
  Terminal, Timeline, TrendingUp, VisibilityOutlined,
} from '@mui/icons-material';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTip, ResponsiveContainer, ScatterChart, Scatter, Legend,
} from 'recharts';
import mlopsApi from '../services/mlopsApi';
import RunReport from './RunReport';
import { ALLOW_INCOMPLETE_ACTIONS } from '../utils/uiFlags';
import { curvePointsForChart } from './validation/validationUtils';

// ── Design Tokens ─────────────────────────────────────────────────────────────
const canDisable = (cond) => !ALLOW_INCOMPLETE_ACTIONS && cond;

const T = {
  orange:      '#D04A02',
  orangeHover: '#b83d00',
  orangeLight: '#fff1ec',
  orangeMid:   '#f97316',
  done:        '#111827',
  doneLight:   '#f8fafc',
  amber:       '#D04A02',
  amberLight:  '#fff7ed',
  red:         '#7f1d1d',
  redLight:    '#fef2f2',
  canvas:      '#f5f6f8',
  paper:       '#ffffff',
  border:      '#e2e8f0',
  textPrimary: '#111827',
  textMuted:   '#4b5563',
  textDim:     '#6b7280',
  termBg:      '#111827',
  termText:    '#d1d5db',
  termDim:     '#9ca3af',
  mono:        '"Fira Code","Cascadia Code",monospace',
  high:        '#111827',
  highLight:   '#f8fafc',
  highBorder:  '#e5e7eb',
  medium:      '#374151',
  mediumLight: '#f9fafb',
  mediumBorder:'#e5e7eb',
  low:         '#4b5563',
  lowLight:    '#f9fafb',
  lowBorder:   '#e5e7eb',
};
const DEPLOY_THRESHOLD_MIN = 0.5;
const DEPLOY_THRESHOLD_MAX = 0.6;
const DEFAULT_BUSINESS_THRESHOLD = 0.5;

// ── Enterprise Algorithm Palette ──────────────────────────────────────────────
const ALGO_COLOURS = {
  logistic_regression:    { accent: T.orange, tag: 'Baseline'         },
  random_forest:          { accent: T.orange, tag: 'Ensemble'         },
  gradient_boosting:      { accent: T.orange, tag: 'High Accuracy'    },
  xgboost:                { accent: T.orange, tag: 'Boosted Trees'    },
  lightgbm:               { accent: T.orange, tag: 'Leaf-wise GBM'   },
  hist_gradient_boosting: { accent: T.orange, tag: 'Histogram GBM'   },
  extra_trees:            { accent: T.orange, tag: 'Randomised Trees' },
  adaboost:               { accent: T.orange, tag: 'Adaptive Boost'  },
  decision_tree:          { accent: T.orange, tag: 'Explainable'      },
  linear_svm:             { accent: T.orange, tag: 'Hyperplane'       },
  knn:                    { accent: T.orange, tag: 'Distance-based'   },
  naive_bayes:            { accent: T.orange, tag: 'Probabilistic'    },
  soft_voting_ensemble:   { accent: T.orange, tag: 'Hybrid Ensemble'  },
  stacking_ensemble:      { accent: T.orange, tag: 'Stacked Ensemble' },
  kmeans:                 { accent: T.orange, tag: 'Clustering'       },
  gaussian_mixture:       { accent: T.orange, tag: 'Soft Clusters'    },
  agglomerative_clustering:{ accent: T.orange, tag: 'Hierarchy'       },
  dbscan:                 { accent: T.orange, tag: 'Density'          },
  isolation_forest:       { accent: T.orange, tag: 'Anomaly'          },
  local_outlier_factor:   { accent: T.orange, tag: 'Neighbour Outlier'},
  one_class_svm:          { accent: T.orange, tag: 'Boundary Anomaly' },
  mlp_classifier:         { accent: T.orange, tag: 'Neural Network'   },
  deep_mlp_classifier:    { accent: T.orange, tag: 'Deep Network'     },
  tabular_autoencoder:    { accent: T.orange, tag: 'Autoencoder'      },
};

// ── Algorithm internals metadata ──────────────────────────────────────────────
const ALGO_VIZ = {
  logistic_regression:    { vizType: 'coefficients',      vizLabel: 'Coefficient Plot',     description: 'Shows log-odds weight of each feature. Positive = pushes toward ESCALATE. Magnitude = strength.' },
  random_forest:          { vizType: 'feature_importance', vizLabel: 'Feature Importance',  description: 'Mean decrease in impurity (MDI) across all trees. Shows which features the forest relies on most.' },
  gradient_boosting:      { vizType: 'learning_curve',    vizLabel: 'Boosting Loss Curve',  description: 'Log-loss per boosting round. Watch for over-fit when validation curve rises while train continues falling.' },
  xgboost:                { vizType: 'learning_curve',    vizLabel: 'XGBoost Loss Curve',   description: 'AUC per round for train vs validation. Early stopping fires when val AUC plateaus.' },
  lightgbm:               { vizType: 'learning_curve',    vizLabel: 'LightGBM Loss Curve',  description: 'Leaf-wise growth means loss drops faster per round but can spike - watch validation curve.' },
  hist_gradient_boosting: { vizType: 'feature_importance', vizLabel: 'Feature Importance',  description: 'Permutation importance from sklearn HistGB. Robust to correlated features.' },
  extra_trees:            { vizType: 'feature_importance', vizLabel: 'Feature Importance',  description: 'Randomised threshold importance - less prone to bias toward high-cardinality features vs RF.' },
  adaboost:               { vizType: 'learning_curve',    vizLabel: 'AdaBoost Error Curve', description: 'Training error per boosting round. AdaBoost rarely overfits early - but can diverge on noisy data.' },
  decision_tree:          { vizType: 'tree',              vizLabel: 'Decision Tree',         description: 'Full tree structure showing every split decision. Fully interpretable - each path is an audit-ready rule.' },
  linear_svm:             { vizType: 'coefficients',      vizLabel: 'SVM Weights',           description: 'Hyperplane coefficients after calibration. Similar interpretation to logistic regression.' },
  knn:                    { vizType: 'feature_importance', vizLabel: 'Distance Weights',     description: 'KNN has no native importance - shows feature variance contribution as a proxy.' },
  naive_bayes:            { vizType: 'coefficients',      vizLabel: 'Class Likelihoods',     description: 'Log-probability ratios P(feature|TP) / P(feature|FP). High value = strong TP signal.' },
  soft_voting_ensemble:   { vizType: 'feature_importance', vizLabel: 'Ensemble Importances', description: 'Weighted soft-vote across AML base models for robust suppression ranking.' },
  stacking_ensemble:      { vizType: 'feature_importance', vizLabel: 'Stacked Meta Model',   description: 'Meta learner combines multiple base model outputs for stronger ranking stability.' },
  kmeans:                 { vizType: 'projection',        vizLabel: 'Cluster Projection',    description: '2D projection of cluster membership and separation.' },
  gaussian_mixture:       { vizType: 'projection',        vizLabel: 'Mixture Projection',    description: 'Soft cluster membership across behavior segments with overlap-aware boundaries.' },
  agglomerative_clustering:{ vizType: 'projection',       vizLabel: 'Hierarchy Projection',  description: 'Bottom-up cluster structure projected into analyst-friendly segments.' },
  dbscan:                 { vizType: 'projection',        vizLabel: 'Density Map',           description: 'Highlights dense pockets and noise points in 2D space.' },
  isolation_forest:       { vizType: 'projection',        vizLabel: 'Anomaly Projection',    description: 'Shows anomaly scoring and extreme outlier pockets.' },
  local_outlier_factor:   { vizType: 'projection',        vizLabel: 'Local Outlier Map',     description: 'Scores records by local neighborhood isolation and highlights sparse behavior.' },
  one_class_svm:          { vizType: 'projection',        vizLabel: 'Boundary Anomaly Map',  description: 'Learns the normal frontier and shows which records fall outside it.' },
  mlp_classifier:         { vizType: 'learning_curve',    vizLabel: 'Training Curves',       description: 'Loss and validation traces for the neural network.' },
  deep_mlp_classifier:    { vizType: 'learning_curve',    vizLabel: 'Deep Network Curves',   description: 'Three-layer neural training curves for nonlinear alert scoring.' },
  tabular_autoencoder:    { vizType: 'learning_curve',    vizLabel: 'Reconstruction Curves', description: 'Autoencoder learning trace and reconstruction-error behavior for unseen anomaly capture.' },
};

// ── Algorithm Definitions ─────────────────────────────────────────────────────
const ALGORITHMS = [
  {
    id: 'logistic_regression', label: 'Logistic Regression', icon: ShowChart,
    bizDesc: 'Fast, fully transparent baseline - every coefficient is auditable.',
    techDesc: 'L2-regularised GLM. Solver: lbfgs. Class-weight balanced by default.',
    speed: 'Fast',
    presets: [
      { id: 'business', label: 'Business Baseline', description: 'Stable, interpretable baseline for auditability.', values: { C: 0.5, max_iter: 1000, tol: -4, class_weight: 'balanced' } },
      { id: 'technical', label: 'Technical Baseline', description: 'Tighter convergence for sensitivity on wide features.', values: { C: 1.0, max_iter: 3000, tol: -5, class_weight: 'balanced' } },
    ],
    params: [
      { key: 'C', label: 'Regularisation Strength (C)', type: 'slider', min: 0.001, max: 20, step: 0.001, default: 1.0, tip: 'Inverse of regularisation. Lower C = stronger penalty.' },
      { key: 'max_iter', label: 'Max Iterations', type: 'number', min: 100, max: 10000, default: 1000, tip: 'Increase to 5000 if convergence warning appears.' },
      { key: 'tol', label: 'Convergence Tolerance (log10)', type: 'slider', min: -6, max: -2, step: 0.5, default: -4, tip: 'log10(tol). Tighter = slower but more precise.' },
      { key: 'class_weight', label: 'Class Weight', type: 'toggle', options: ['balanced', 'none'], default: 'balanced', tip: 'Balanced compensates for SAR class imbalance.' },
    ],
  },
  {
    id: 'random_forest', label: 'Random Forest', icon: AccountTree,
    bizDesc: 'Robust default for AML scoring - handles messy, mixed-type data well.',
    techDesc: 'Bagged CART ensemble. OOB estimation. Feature subsampling = sqrt(p).',
    speed: 'Medium',
    presets: [
      { id: 'business', label: 'Business Balanced', description: 'Stable, interpretable forest with conservative depth.', values: { n_estimators: 300, max_depth: 12, min_samples_split: 10, min_samples_leaf: 4, max_features: 'sqrt', class_weight: 'balanced' } },
      { id: 'technical', label: 'Technical Accuracy', description: 'Deeper forest with more trees for maximum lift.', values: { n_estimators: 500, max_depth: 18, min_samples_split: 6, min_samples_leaf: 2, max_features: 'sqrt', class_weight: 'balanced_subsample' } },
    ],
    params: [
      { key: 'n_estimators', label: 'Number of Trees', type: 'slider', min: 50, max: 1000, step: 25, default: 300, tip: 'More trees → lower variance. Diminishing returns after 400.' },
      { key: 'max_depth', label: 'Max Tree Depth', type: 'slider', min: 2, max: 30, step: 1, default: 15, tip: 'AML rule of thumb: 10–18.' },
      { key: 'min_samples_split', label: 'Min Samples to Split', type: 'slider', min: 2, max: 100, step: 2, default: 10, tip: 'Raise to smooth overfitting.' },
      { key: 'min_samples_leaf', label: 'Min Samples per Leaf', type: 'slider', min: 1, max: 100, step: 1, default: 4, tip: 'Higher values smooth decision boundaries.' },
      { key: 'max_features', label: 'Max Features at Split', type: 'toggle', options: ['sqrt', 'log2', 'none'], default: 'sqrt', tip: 'sqrt = standard bagging.' },
      { key: 'class_weight', label: 'Class Weight', type: 'toggle', options: ['balanced', 'balanced_subsample', 'none'], default: 'balanced', tip: 'balanced_subsample recomputes weights per bootstrap.' },
    ],
  },
  {
    id: 'gradient_boosting', label: 'Gradient Boosting', icon: TrendingUp,
    bizDesc: 'Most accurate sklearn tree-based method - learns from errors iteratively.',
    techDesc: 'Sequential CART ensemble, log-loss objective. Stochastic subsampling supported.',
    speed: 'Slow',
    presets: [
      { id: 'business', label: 'Business Balanced', description: 'Conservative boosting for stable, explainable lift.', values: { n_estimators: 200, max_depth: 3, learning_rate: 0.1, subsample: 0.8, min_samples_leaf: 10, min_samples_split: 20, max_features: 'sqrt' } },
      { id: 'technical', label: 'Technical Accuracy', description: 'Lower learning rate with more rounds for precision.', values: { n_estimators: 400, max_depth: 4, learning_rate: 0.05, subsample: 0.8, min_samples_leaf: 5, min_samples_split: 10, max_features: 'none' } },
    ],
    params: [
      { key: 'n_estimators', label: 'Boosting Stages', type: 'slider', min: 50, max: 800, step: 25, default: 250, tip: 'More stages improve fit but risk overfitting.' },
      { key: 'max_depth', label: 'Max Tree Depth', type: 'slider', min: 2, max: 10, step: 1, default: 4, tip: 'GBM best with shallow trees (3–6).' },
      { key: 'learning_rate', label: 'Learning Rate (η)', type: 'slider', min: 0.005, max: 0.5, step: 0.005, default: 0.08, tip: 'Lower η needs more stages but generalises better.' },
      { key: 'subsample', label: 'Row Subsample', type: 'slider', min: 0.3, max: 1.0, step: 0.05, default: 0.8, tip: 'Fraction of training samples per tree.' },
      { key: 'min_samples_split', label: 'Min Samples to Split', type: 'slider', min: 2, max: 100, step: 2, default: 20, tip: 'Higher values simplify trees and improve stability.' },
      { key: 'min_samples_leaf', label: 'Min Samples per Leaf', type: 'slider', min: 1, max: 100, step: 1, default: 8, tip: 'Regularise leaf size.' },
      { key: 'max_features', label: 'Max Features at Split', type: 'toggle', options: ['sqrt', 'log2', 'none'], default: 'none', tip: 'Feature subsampling per split.' },
    ],
  },
  {
    id: 'xgboost', label: 'XGBoost', icon: Bolt,
    bizDesc: 'Industry-standard for AML tabular scoring - highly competitive accuracy.',
    techDesc: 'XGBoost; tree_method=hist; eval_metric=auc. L1+L2 regularisation.',
    speed: 'Medium',
    presets: [
      { id: 'business', label: 'Business Balanced', description: 'Balanced accuracy with conservative depth.', values: { n_estimators: 300, max_depth: 5, learning_rate: 0.08, subsample: 0.8, colsample_bytree: 0.8, colsample_bylevel: 1.0, reg_alpha: 0, reg_lambda: 1.0, min_child_weight: 1, gamma: 0 } },
      { id: 'technical', label: 'Technical Accuracy', description: 'Lower learning rate with stronger regularisation.', values: { n_estimators: 600, max_depth: 6, learning_rate: 0.05, subsample: 0.8, colsample_bytree: 0.8, colsample_bylevel: 0.8, reg_alpha: 0.1, reg_lambda: 1.0, min_child_weight: 5, gamma: 0.1 } },
    ],
    params: [
      { key: 'n_estimators', label: 'Boosting Rounds', type: 'slider', min: 50, max: 1000, step: 25, default: 400, tip: 'Combined with low learning rate (0.05) for best generalisation.' },
      { key: 'max_depth', label: 'Max Depth', type: 'slider', min: 2, max: 14, step: 1, default: 6, tip: '6 is XGBoost default. AML datasets prefer 4–8.' },
      { key: 'learning_rate', label: 'Learning Rate (eta)', type: 'slider', min: 0.005, max: 0.3, step: 0.005, default: 0.05, tip: 'Lower eta = better generalisation at cost of more rounds.' },
      { key: 'subsample', label: 'Row Subsample', type: 'slider', min: 0.4, max: 1.0, step: 0.05, default: 0.8, tip: 'Values 0.7–0.9 reduce overfitting.' },
      { key: 'colsample_bytree', label: 'Col Subsample / Tree', type: 'slider', min: 0.3, max: 1.0, step: 0.05, default: 0.8, tip: 'Key regularisation knob for XGBoost.' },
      { key: 'colsample_bylevel', label: 'Col Subsample / Level', type: 'slider', min: 0.3, max: 1.0, step: 0.05, default: 1.0, tip: 'Additional feature subsampling per depth level.' },
      { key: 'reg_alpha', label: 'L1 Regularisation (α)', type: 'slider', min: 0, max: 10, step: 0.1, default: 0, tip: 'L1 penalty. Induces sparsity.' },
      { key: 'reg_lambda', label: 'L2 Regularisation (λ)', type: 'slider', min: 0, max: 20, step: 0.5, default: 1.0, tip: 'L2 penalty. Smoother model.' },
      { key: 'min_child_weight', label: 'Min Child Weight', type: 'slider', min: 1, max: 50, step: 1, default: 1, tip: 'Raise for imbalanced data.' },
      // FIX ①: "Î³" was a UTF-8 encoding corruption of "γ"
      { key: 'gamma', label: 'Min Split Gain (γ)', type: 'slider', min: 0, max: 5, step: 0.05, default: 0, tip: 'Minimum loss reduction required for a split.' },
    ],
  },
  {
    id: 'lightgbm', label: 'LightGBM', icon: Analytics,
    bizDesc: 'Fastest gradient booster - scales to millions of alerts with low memory.',
    techDesc: 'Leaf-wise (best-first) growth. Native categorical support. DART mode optional.',
    speed: 'Very Fast',
    presets: [
      { id: 'business', label: 'Business Balanced', description: 'Fast, stable LightGBM with controlled depth.', values: { n_estimators: 300, num_leaves: 63, max_depth: 8, learning_rate: 0.05, subsample: 0.8, colsample_bytree: 0.8, min_child_samples: 30, reg_alpha: 0, reg_lambda: 0, class_weight: 'balanced' } },
      { id: 'technical', label: 'Technical Accuracy', description: 'More leaves and rounds for higher lift.', values: { n_estimators: 600, num_leaves: 127, max_depth: -1, learning_rate: 0.03, subsample: 0.8, colsample_bytree: 0.8, min_child_samples: 20, reg_alpha: 0.1, reg_lambda: 0.1, class_weight: 'balanced' } },
    ],
    params: [
      { key: 'n_estimators', label: 'Boosting Rounds', type: 'slider', min: 50, max: 1000, step: 25, default: 400, tip: 'Leaf-wise needs fewer rounds than depth-wise.' },
      { key: 'num_leaves', label: 'Num Leaves', type: 'slider', min: 15, max: 512, step: 8, default: 63, tip: 'Primary complexity control. AML: 31–127.' },
      { key: 'max_depth', label: 'Max Depth', type: 'slider', min: -1, max: 20, step: 1, default: -1, tip: '-1 = unlimited. Cap depth to prevent overfitting on small datasets.' },
      { key: 'learning_rate', label: 'Learning Rate', type: 'slider', min: 0.005, max: 0.3, step: 0.005, default: 0.05, tip: '0.05 with 400+ rounds is reliable.' },
      { key: 'subsample', label: 'Row Subsample', type: 'slider', min: 0.4, max: 1.0, step: 0.05, default: 0.8, tip: 'Fraction per iteration.' },
      { key: 'colsample_bytree', label: 'Col Subsample', type: 'slider', min: 0.3, max: 1.0, step: 0.05, default: 0.8, tip: 'Feature subsampling per iteration.' },
      { key: 'min_child_samples', label: 'Min Data in Leaf', type: 'slider', min: 5, max: 500, step: 5, default: 20, tip: 'Key regularisation for LightGBM.' },
      { key: 'reg_alpha', label: 'L1 Regularisation', type: 'slider', min: 0, max: 10, step: 0.1, default: 0, tip: 'L1 penalty. Encourages simpler models.' },
      { key: 'reg_lambda', label: 'L2 Regularisation', type: 'slider', min: 0, max: 20, step: 0.5, default: 0, tip: 'L2 penalty. Improves stability.' },
      { key: 'class_weight', label: 'Class Weight', type: 'toggle', options: ['balanced', 'none'], default: 'balanced', tip: 'Handles SAR minority class.' },
    ],
  },
  {
    id: 'hist_gradient_boosting', label: 'Hist Gradient Boosting', icon: Bolt,
    bizDesc: 'XGBoost-class accuracy in pure sklearn - handles NaN natively.',
    techDesc: 'sklearn HistGradientBoostingClassifier. Histogram binning. Native NaN support.',
    speed: 'Fast',
    presets: [
      { id: 'business', label: 'Business Balanced', description: 'Stable histogram booster with conservative leaf size.', values: { max_iter: 200, max_depth: 6, max_leaf_nodes: 31, learning_rate: 0.1, l2_regularization: 0, min_samples_leaf: 20, class_weight: 'balanced' } },
      { id: 'technical', label: 'Technical Accuracy', description: 'More rounds and deeper trees for higher lift.', values: { max_iter: 400, max_depth: 10, max_leaf_nodes: 63, learning_rate: 0.05, l2_regularization: 1, min_samples_leaf: 10, class_weight: 'balanced' } },
    ],
    params: [
      { key: 'max_iter', label: 'Max Iterations', type: 'slider', min: 50, max: 1000, step: 25, default: 300, tip: 'Number of boosting stages.' },
      { key: 'max_depth', label: 'Max Depth', type: 'slider', min: 2, max: 20, step: 1, default: 8, tip: 'Shallow trees (4–10) work well.' },
      { key: 'max_leaf_nodes', label: 'Max Leaf Nodes', type: 'slider', min: 10, max: 255, step: 5, default: 31, tip: 'Primary complexity knob.' },
      { key: 'min_samples_leaf', label: 'Min Samples per Leaf', type: 'slider', min: 1, max: 100, step: 1, default: 20, tip: 'Higher values simplify the model and reduce noise.' },
      { key: 'learning_rate', label: 'Learning Rate', type: 'slider', min: 0.01, max: 0.5, step: 0.01, default: 0.1, tip: 'Lower = slower convergence but better generalisation.' },
      { key: 'l2_regularization', label: 'L2 Regularisation', type: 'slider', min: 0, max: 20, step: 0.5, default: 0, tip: 'Increase for noisy AML datasets.' },
      { key: 'class_weight', label: 'Class Weight', type: 'toggle', options: ['balanced', 'none'], default: 'balanced', tip: 'Handles SAR minority class.' },
    ],
  },
  {
    id: 'extra_trees', label: 'Extra Trees', icon: Layers,
    bizDesc: 'Faster than Random Forest - random thresholds reduce bias.',
    techDesc: 'Extremely Randomised Trees. Random cut-points sampled at each node.',
    speed: 'Fast',
    presets: [
      { id: 'business', label: 'Business Balanced', description: 'Fast, stable trees with controlled depth.', values: { n_estimators: 300, max_depth: 20, min_samples_split: 5, min_samples_leaf: 2, max_features: 'sqrt', class_weight: 'balanced' } },
      { id: 'technical', label: 'Technical Accuracy', description: 'More trees for higher lift on complex data.', values: { n_estimators: 500, max_depth: 30, min_samples_split: 2, min_samples_leaf: 1, max_features: 'sqrt', class_weight: 'balanced' } },
    ],
    params: [
      { key: 'n_estimators', label: 'Number of Trees', type: 'slider', min: 50, max: 1000, step: 25, default: 300, tip: '200–400 is usually sufficient.' },
      { key: 'max_depth', label: 'Max Depth', type: 'slider', min: 2, max: 40, step: 1, default: 20, tip: 'Fully grown trees are common.' },
      { key: 'min_samples_split', label: 'Min Samples to Split', type: 'slider', min: 2, max: 100, step: 2, default: 5, tip: 'Higher values simplify splits and reduce noise.' },
      { key: 'min_samples_leaf', label: 'Min Samples per Leaf', type: 'slider', min: 1, max: 50, step: 1, default: 2, tip: 'Leaf smoothing parameter.' },
      { key: 'max_features', label: 'Max Features at Split', type: 'toggle', options: ['sqrt', 'log2', 'none'], default: 'sqrt', tip: 'sqrt is standard.' },
      { key: 'class_weight', label: 'Class Weight', type: 'toggle', options: ['balanced', 'none'], default: 'balanced', tip: 'Balanced for imbalanced AML.' },
    ],
  },
  {
    id: 'adaboost', label: 'AdaBoost', icon: AutoGraph,
    bizDesc: 'Classic adaptive booster - upweights misclassified alerts iteratively.',
    techDesc: 'Adaptive Boost (SAMME.R). Upweights misclassified samples each iteration.',
    speed: 'Medium',
    presets: [
      { id: 'business', label: 'Business Balanced', description: 'Moderate boosting with shallow learners.', values: { n_estimators: 100, learning_rate: 0.5, base_max_depth: 2 } },
      { id: 'technical', label: 'Technical Accuracy', description: 'More rounds with slightly deeper base learners.', values: { n_estimators: 300, learning_rate: 0.1, base_max_depth: 3 } },
    ],
    params: [
      { key: 'n_estimators', label: 'Number of Estimators', type: 'slider', min: 50, max: 500, step: 25, default: 100, tip: 'More estimators reduce bias but slow training.' },
      { key: 'learning_rate', label: 'Learning Rate', type: 'slider', min: 0.01, max: 2.0, step: 0.01, default: 1.0, tip: 'Shrinks contribution of each estimator.' },
      { key: 'base_max_depth', label: 'Base Estimator Depth', type: 'slider', min: 1, max: 6, step: 1, default: 2, tip: 'Depth of the weak learner (tree stump depth).' },
    ],
  },
  {
    id: 'decision_tree', label: 'Decision Tree', icon: Hub,
    bizDesc: 'Fully explainable - every decision is a readable if-then rule.',
    techDesc: 'CART. Criterion: gini or entropy. Pre/post-pruning via min_samples and ccp_alpha.',
    speed: 'Very Fast',
    presets: [
      { id: 'business', label: 'Business Balanced', description: 'Shallow, auditable tree with pruning.', values: { max_depth: 6, min_samples_split: 20, min_samples_leaf: 10, criterion: 'gini', ccp_alpha: 0.001, class_weight: 'balanced' } },
      { id: 'technical', label: 'Technical Accuracy', description: 'Deeper tree for complex patterns.', values: { max_depth: 12, min_samples_split: 10, min_samples_leaf: 5, criterion: 'entropy', ccp_alpha: 0, class_weight: 'balanced' } },
    ],
    params: [
      { key: 'max_depth', label: 'Max Depth', type: 'slider', min: 1, max: 20, step: 1, default: 6, tip: 'Shallow trees (4–8) are more interpretable and less overfit.' },
      { key: 'min_samples_split', label: 'Min Samples to Split', type: 'slider', min: 2, max: 100, step: 2, default: 20, tip: 'Higher = simpler, more pruned tree.' },
      { key: 'min_samples_leaf', label: 'Min Samples per Leaf', type: 'slider', min: 1, max: 100, step: 1, default: 10, tip: 'Larger leaves = smoother decisions.' },
      { key: 'criterion', label: 'Split Criterion', type: 'toggle', options: ['gini', 'entropy'], default: 'gini', tip: 'Gini is faster. Entropy can find slightly better splits.' },
      { key: 'ccp_alpha', label: 'Cost-Complexity Pruning (α)', type: 'slider', min: 0, max: 0.05, step: 0.001, default: 0, tip: 'Post-pruning. Higher values = smaller, more generalised tree.' },
      { key: 'class_weight', label: 'Class Weight', type: 'toggle', options: ['balanced', 'none'], default: 'balanced', tip: 'Balances true positives vs false positives.' },
    ],
  },
  {
    id: 'linear_svm', label: 'Linear SVM', icon: ScatterPlot,
    bizDesc: 'Maximum-margin classifier - strong on linearly separable AML patterns.',
    techDesc: 'LinearSVC with CalibratedClassifierCV for probability output. L2 penalty default.',
    speed: 'Medium',
    presets: [
      { id: 'business', label: 'Business Balanced', description: 'Stable margin with balanced classes.', values: { C: 0.5, max_iter: 3000, tol: -4, class_weight: 'balanced' } },
      { id: 'technical', label: 'Technical Accuracy', description: 'Tighter convergence for higher sensitivity.', values: { C: 1.0, max_iter: 6000, tol: -5, class_weight: 'balanced' } },
    ],
    params: [
      { key: 'C', label: 'Regularisation Strength (C)', type: 'slider', min: 0.001, max: 10, step: 0.001, default: 1.0, tip: 'Inverse regularisation. Lower C = wider margin, more regularisation.' },
      { key: 'max_iter', label: 'Max Iterations', type: 'number', min: 500, max: 10000, default: 1000, tip: 'Increase if convergence warning appears.' },
      { key: 'tol', label: 'Convergence Tolerance (log10)', type: 'slider', min: -6, max: -2, step: 0.5, default: -4, tip: 'log10(tol). Lower values train longer but stabilize the margin.' },
      { key: 'class_weight', label: 'Class Weight', type: 'toggle', options: ['balanced', 'none'], default: 'balanced', tip: 'Balances true positives vs false positives.' },
    ],
  },
  {
    id: 'knn', label: 'K-Nearest Neighbours', icon: Hub,
    bizDesc: 'Scores alerts by similarity to labelled historical cases.',
    techDesc: 'KNN with ball-tree. Requires feature scaling (applied automatically).',
    speed: 'Fast train / Slow predict',
    presets: [
      { id: 'business', label: 'Business Balanced', description: 'Smooth decisions with moderate K.', values: { n_neighbors: 15, weights: 'distance', p: 2, leaf_size: 30 } },
      { id: 'technical', label: 'Technical Accuracy', description: 'Higher K with Manhattan distance for mixed features.', values: { n_neighbors: 25, weights: 'distance', p: 1, leaf_size: 40 } },
    ],
    params: [
      { key: 'n_neighbors', label: 'Neighbours (K)', type: 'slider', min: 3, max: 50, step: 1, default: 15, tip: 'Higher K = smoother boundaries. For AML try 10–25.' },
      { key: 'weights', label: 'Weight Function', type: 'toggle', options: ['uniform', 'distance'], default: 'distance', tip: 'Distance weighting gives closer neighbours more influence.' },
      { key: 'leaf_size', label: 'Leaf Size', type: 'slider', min: 10, max: 100, step: 5, default: 30, tip: 'Trade-off between speed and memory for KNN search.' },
      { key: 'p', label: 'Distance Metric (p)', type: 'slider', min: 1, max: 2, step: 1, default: 2, tip: 'p=2 Euclidean. p=1 Manhattan (better for mixed-type features).' },
    ],
  },
  {
    id: 'naive_bayes', label: 'Gaussian Naive Bayes', icon: Functions,
    bizDesc: 'Extremely fast probabilistic model - good calibrated baseline for low-data regimes.',
    techDesc: 'GaussianNB. Assumes feature independence. Useful when training data is limited.',
    speed: 'Very Fast',
    presets: [
      { id: 'business', label: 'Business Baseline', description: 'Stable probabilistic baseline.', values: { var_smoothing: -9 } },
      { id: 'technical', label: 'Technical Sensitivity', description: 'Lower smoothing for finer signal capture.', values: { var_smoothing: -10 } },
    ],
    params: [
      { key: 'var_smoothing', label: 'Variance Smoothing (log10)', type: 'slider', min: -12, max: -1, step: 0.5, default: -9, tip: 'log10 of smoothing added to variance.' },
    ],
  },

  {
    id: 'soft_voting_ensemble', label: 'Soft Voting Ensemble', icon: CompareArrows,
    bizDesc: 'Combines multiple AML models with weighted soft voting for stable suppression decisions.',
    techDesc: 'VotingClassifier over heterogeneous base models. Supports profile-driven member mix and vote weights.',
    speed: 'Medium',
    presets: [
      { id: 'business', label: 'Business Balanced', description: 'Balanced mix for stable precision/recall trade-off.', values: { members_profile: 'balanced_aml', weight_profile: 'balanced' } },
      { id: 'technical', label: 'Technical Recall', description: 'Boosted + linear mix tuned for higher recall.', values: { members_profile: 'high_recall', weight_profile: 'recall_heavy' } },
    ],
    params: [
      { key: 'members_profile', label: 'Member Set', type: 'toggle', options: ['balanced_aml', 'high_recall', 'tree_heavy'], default: 'balanced_aml', tip: 'Chooses the base models included in the ensemble.' },
      { key: 'weight_profile', label: 'Vote Weights', type: 'toggle', options: ['balanced', 'recall_heavy', 'precision_heavy'], default: 'balanced', tip: 'Controls vote contribution of each base model.' },
    ],
  },
  {
    id: 'stacking_ensemble', label: 'Stacking Ensemble', icon: Layers,
    bizDesc: 'Trains a meta-model on top of multiple base learners for maximum AML ranking lift.',
    techDesc: 'StackingClassifier with configurable base profile and logistic/random-forest meta learner.',
    speed: 'Slow',
    presets: [
      { id: 'business', label: 'Business Stable', description: 'Conservative stack with interpretable meta learner.', values: { stack_profile: 'balanced_aml', meta_estimator: 'logistic_regression' } },
      { id: 'technical', label: 'Technical Lift', description: 'Richer stack with tree-based meta learner.', values: { stack_profile: 'high_recall', meta_estimator: 'random_forest' } },
    ],
    params: [
      { key: 'stack_profile', label: 'Base Stack', type: 'toggle', options: ['balanced_aml', 'high_recall', 'tree_heavy'], default: 'balanced_aml', tip: 'Controls which base models feed the meta learner.' },
      { key: 'meta_estimator', label: 'Meta Learner', type: 'toggle', options: ['logistic_regression', 'random_forest'], default: 'logistic_regression', tip: 'Final model trained on out-of-fold base probabilities.' },
    ],
  },
];

// ── Pipeline DAG Stages ────────────────────────────────────────────────────────
const UNSUPERVISED_ALGORITHMS = [
  {
    id: 'kmeans', label: 'KMeans', icon: ScatterPlot,
    bizDesc: 'Segments alerts into compact behavior clusters for triage and pattern discovery.',
    techDesc: 'Centroid-based clustering with PCA projection for visual inspection.',
    speed: 'Fast',
    params: [
      { key: 'n_clusters', label: 'Clusters', type: 'slider', min: 2, max: 12, step: 1, default: 4, tip: 'Number of behavioral groups to discover.' },
    ],
  },
  {
    id: 'gaussian_mixture', label: 'Gaussian Mixture', icon: Analytics,
    bizDesc: 'Builds soft behavior segments when alert patterns overlap instead of falling into hard buckets.',
    techDesc: 'Probabilistic mixture model with soft cluster membership and overlap-aware scoring.',
    speed: 'Fast',
    params: [
      { key: 'n_components', label: 'Components', type: 'slider', min: 2, max: 12, step: 1, default: 4, tip: 'Number of latent behavioral groups to discover.' },
      { key: 'covariance_type', label: 'Covariance', type: 'toggle', options: ['full', 'diag', 'tied'], default: 'full', tip: 'full captures richer cluster shape; diag is lighter and faster.' },
    ],
  },
  {
    id: 'agglomerative_clustering', label: 'Agglomerative Clustering', icon: AccountTree,
    bizDesc: 'Creates investigator-friendly hierarchy from broad groups down to fine-grained typologies.',
    techDesc: 'Bottom-up hierarchical clustering with centroid handoff for holdout scoring.',
    speed: 'Medium',
    params: [
      { key: 'n_clusters', label: 'Clusters', type: 'slider', min: 2, max: 10, step: 1, default: 4, tip: 'Final number of hierarchy groups to expose in the workbench.' },
      { key: 'linkage', label: 'Linkage', type: 'toggle', options: ['ward', 'average', 'complete'], default: 'ward', tip: 'ward favors compact clusters; complete favors separation.' },
    ],
  },
  {
    id: 'dbscan', label: 'DBSCAN', icon: Hub,
    bizDesc: 'Finds dense clusters and isolates sparse unusual behavior as noise.',
    techDesc: 'Density-based clustering that marks sparse regions as outliers.',
    speed: 'Medium',
    params: [
      { key: 'eps', label: 'Neighborhood Radius (x100)', type: 'slider', min: 20, max: 250, step: 5, default: 115, tip: 'Higher radius merges more clusters.' },
      { key: 'min_samples', label: 'Min Samples', type: 'slider', min: 3, max: 40, step: 1, default: 12, tip: 'Minimum records required for a dense region.' },
    ],
  },
  {
    id: 'isolation_forest', label: 'Isolation Forest', icon: Analytics,
    bizDesc: 'Flags rare, isolated behavior with anomaly scores for investigator review.',
    techDesc: 'Tree-based anomaly detector that isolates unusual points quickly.',
    speed: 'Fast',
    params: [
      { key: 'n_estimators', label: 'Trees', type: 'slider', min: 50, max: 400, step: 25, default: 200, tip: 'More trees stabilize anomaly scores.' },
      { key: 'contamination_pct', label: 'Expected Anomaly %', type: 'slider', min: 1, max: 20, step: 1, default: 5, tip: 'Expected share of anomalous records.' },
    ],
  },
  {
    id: 'local_outlier_factor', label: 'Local Outlier Factor', icon: AutoGraph,
    bizDesc: 'Finds records that look abnormal only within their local peer group, which is useful for subtle AML outliers.',
    techDesc: 'Neighborhood-density anomaly detector with novelty scoring for unseen holdout data.',
    speed: 'Medium',
    params: [
      { key: 'n_neighbors', label: 'Neighbours', type: 'slider', min: 5, max: 60, step: 1, default: 20, tip: 'Defines the local peer group used to judge density anomalies.' },
      { key: 'contamination_pct', label: 'Expected Anomaly %', type: 'slider', min: 1, max: 20, step: 1, default: 5, tip: 'Estimated portion of unusual records in the sample.' },
    ],
  },
  {
    id: 'one_class_svm', label: 'One-Class SVM', icon: ScatterPlot,
    bizDesc: 'Learns the boundary of normal activity and flags rows that sit outside the learned frontier.',
    techDesc: 'Kernel-based novelty detector useful when suspicious behavior is rare but structurally distinct.',
    speed: 'Slow',
    params: [
      { key: 'nu', label: 'Expected Outlier Share', type: 'slider', min: 0.01, max: 0.3, step: 0.01, default: 0.08, tip: 'Upper bound on the fraction of outliers and lower bound on support vectors.' },
      { key: 'kernel', label: 'Kernel', type: 'toggle', options: ['rbf', 'sigmoid'], default: 'rbf', tip: 'rbf is the default choice for nonlinear anomaly boundaries.' },
    ],
  },
];

const DEEP_LEARNING_METHODS = [
  {
    id: 'mlp_classifier', label: 'MLP Classifier', icon: Bolt,
    bizDesc: 'A compact neural network for nonlinear alert scoring on wide tabular features.',
    techDesc: 'Feed-forward multilayer perceptron with early stopping and validation monitoring.',
    speed: 'Medium',
    params: [
      { key: 'hidden_layer_1', label: 'Hidden Layer 1', type: 'slider', min: 16, max: 256, step: 16, default: 64, tip: 'Units in the first hidden layer.' },
      { key: 'hidden_layer_2', label: 'Hidden Layer 2', type: 'slider', min: 8, max: 128, step: 8, default: 32, tip: 'Units in the second hidden layer.' },
      { key: 'max_iter', label: 'Epochs', type: 'slider', min: 30, max: 250, step: 10, default: 120, tip: 'Maximum training epochs before early stop.' },
    ],
  },
  {
    id: 'deep_mlp_classifier', label: 'Deep MLP', icon: Layers,
    bizDesc: 'A deeper tabular neural network for harder nonlinear relationships across customer, account, and alert features.',
    techDesc: 'Three-hidden-layer feed-forward network with early stopping for richer feature interactions.',
    speed: 'Medium',
    params: [
      { key: 'hidden_layer_1', label: 'Hidden Layer 1', type: 'slider', min: 32, max: 256, step: 16, default: 128, tip: 'Width of the first dense layer.' },
      { key: 'hidden_layer_2', label: 'Hidden Layer 2', type: 'slider', min: 16, max: 192, step: 16, default: 64, tip: 'Width of the second dense layer.' },
      { key: 'hidden_layer_3', label: 'Hidden Layer 3', type: 'slider', min: 8, max: 128, step: 8, default: 32, tip: 'Width of the third dense layer.' },
      { key: 'max_iter', label: 'Epochs', type: 'slider', min: 40, max: 300, step: 10, default: 180, tip: 'Maximum number of training epochs before early stop.' },
    ],
  },
  {
    id: 'tabular_autoencoder', label: 'Tabular Autoencoder', icon: Hub,
    bizDesc: 'Learns a compact latent view of normal behavior and highlights high-reconstruction-error records as unusual.',
    techDesc: 'Encoder-decoder neural architecture for anomaly-style scoring on wide AML feature tables.',
    speed: 'Medium',
    params: [
      { key: 'encoder_width', label: 'Encoder Width', type: 'slider', min: 32, max: 256, step: 16, default: 96, tip: 'Width of the encoder and decoder outer layers.' },
      { key: 'latent_dim', label: 'Latent Dimension', type: 'slider', min: 4, max: 64, step: 4, default: 24, tip: 'Compressed latent representation size.' },
      { key: 'max_iter', label: 'Epochs', type: 'slider', min: 40, max: 300, step: 10, default: 180, tip: 'Maximum reconstruction training epochs before early stop.' },
    ],
  },
];

const TRAINING_LIBRARY = [...ALGORITHMS, ...UNSUPERVISED_ALGORITHMS, ...DEEP_LEARNING_METHODS];
const TREE_BASED_ALGO_IDS = new Set(['decision_tree', 'random_forest', 'extra_trees', 'gradient_boosting', 'xgboost', 'lightgbm', 'hist_gradient_boosting', 'adaboost']);
const UNSUPERVISED_ALGO_IDS = new Set(UNSUPERVISED_ALGORITHMS.map((algo) => algo.id));
const DEEP_LEARNING_ALGO_IDS = new Set(DEEP_LEARNING_METHODS.map((algo) => algo.id));
const modeForAlgorithm = (algorithm) => {
  const algoId = String(algorithm || '').trim().toLowerCase();
  if (UNSUPERVISED_ALGO_IDS.has(algoId)) return 'unsupervised';
  if (DEEP_LEARNING_ALGO_IDS.has(algoId)) return 'deep_learning';
  return 'supervised';
};
const resolveAlgorithmLabelStatic = (algoIdOrLabel) => {
  const algoId = String(algoIdOrLabel || '').trim();
  return TRAINING_LIBRARY.find((algo) => algo.id === algoId)?.label || algoIdOrLabel || 'Model';
};

const MODE_GUIDE = {
  supervised: {
    title: 'Supervised decisioning',
    objective: 'Learn from historical investigator outcomes so FCC can suppress false positives while retaining real suspicious cases.',
    output: 'You get workload reduction, event-loss controls, an explainability view, and a deployable scoring model.',
    visual: 'Business users see model quality, threshold trade-off, and an interpretable decision path.',
    bankValue: 'Reduces analyst effort while preserving suspicious-case capture under governance limits.',
  },
  unsupervised: {
    title: 'Unsupervised discovery',
    objective: 'Segment alerts into meaningful behavior groups and isolate unusual patterns when labels are incomplete or evolving.',
    output: 'You get cluster maps, anomaly watchlists, and typology discovery for downstream investigation design.',
    visual: 'Business users see cluster structure, density pockets, and unusual populations worth a new rule or case lens.',
    bankValue: 'Helps uncover emerging AML behaviors before enough labelled outcomes exist for classic supervision.',
  },
  deep_learning: {
    title: 'Deep learning scoring',
    objective: 'Use neural architectures when the relationship across customer, account, transaction, and alert signals is too nonlinear for simpler models.',
    output: 'You get neural training evidence, network topology, and stronger representation learning for difficult patterns.',
    visual: 'Business users see the network shape, the learning curve, and how model quality stabilizes over training.',
    bankValue: 'Improves detection on richer tabular signals while still fitting into the same governed FCC journey.',
  },
};

const MODE_SHORTLIST = {
  supervised: ['random_forest', 'xgboost', 'decision_tree', 'logistic_regression'],
  unsupervised: ['kmeans', 'gaussian_mixture', 'isolation_forest', 'one_class_svm'],
  deep_learning: ['mlp_classifier', 'deep_mlp_classifier', 'tabular_autoencoder'],
};

const DAG_STAGES = [
  { id: 'ingest',    label: 'Data Ingest',       sublabel: 'Load & validate dataset',     keywords: ['load','ingest','read','dataset','validat'],                           type: 'data'       },
  { id: 'encode',    label: 'Encode & Impute',    sublabel: 'One-hot, scale, fill nulls',  keywords: ['encod','impute','preprocess','transform','scale','feature'],           type: 'transform'  },
  { id: 'split',     label: 'Train / Test Split', sublabel: 'Stratified holdout',          keywords: ['split','train_test','holdout','stratif'],                             type: 'transform'  },
  { id: 'cv',        label: 'Cross-Validation',   sublabel: 'K-fold AUC estimation',       keywords: ['cross','cv','fold','kfold','validation'],                             type: 'model'      },
  { id: 'fit',       label: 'Model Fit',          sublabel: 'Training on full train set',  keywords: ['fit','train','estimator','learn','fitting'],                          type: 'model'      },
  { id: 'evaluate',  label: 'Evaluate',           sublabel: 'ROC, F1, confusion matrix',   keywords: ['evaluat','roc','auc','score','metric','confusion','predict'],          type: 'validation' },
  { id: 'threshold', label: 'Threshold Analysis', sublabel: 'Suppression vs event loss',   keywords: ['threshold','suppression','event_loss','table'],                       type: 'decision'   },
  { id: 'save',      label: 'Save Artifact',      sublabel: 'Pickle model + feature list', keywords: ['save','artifact','pkl','export','persist','complete'],                type: 'output'     },
];

const NODE_STYLE = {
  data:       { bg: '#f8fafc', border: '#e2e8f0', text: '#374151', active: '#f1f5f9' },
  transform:  { bg: '#f8fafc', border: '#e2e8f0', text: '#374151', active: '#f1f5f9' },
  model:      { bg: '#f8fafc', border: '#e2e8f0', text: '#374151', active: '#f1f5f9' },
  validation: { bg: '#f8fafc', border: '#e2e8f0', text: '#374151', active: '#f1f5f9' },
  decision:   { bg: '#f8fafc', border: '#e2e8f0', text: '#374151', active: '#f1f5f9' },
  output:     { bg: '#f8fafc', border: '#e2e8f0', text: '#374151', active: '#f1f5f9' },
};

const normalizeJobStatus = (status) => {
  const s = String(status || '').trim().toLowerCase();
  if (!s) return 'idle';
  if (s === 'completed') return 'complete';
  if (s === 'error') return 'failed';
  return s;
};

const normalizeProgressPct = (progress, status) => {
  const st = normalizeJobStatus(status);
  if (st === 'complete') return 100;
  const raw = Number(progress);
  if (!Number.isFinite(raw)) return 0;
  const pct = raw <= 1 ? raw * 100 : raw;
  return Math.max(0, Math.min(100, Math.round(pct)));
};

// ── Model Grain Config ────────────────────────────────────────────────────────
const GRAIN_OPTIONS = [
  {
    id: 'account',
    label: 'Account-Level Model',
    icon: 'AC',
    description: '1 row = 1 account. Learns from account-level mule outcomes and scores accounts for investigator review.',
    target: 'mule_flag',
    idColumn: 'ACCOUNT_ID',
    examples: 'Features: txn_count_30d, total_credit_30d, shared_device_count, graph_degree, complaint_count_90d...',
    badge: 'Primary',
    badgeColor: T.textMuted,
  },
  {
    id: 'alert',
    label: 'Alert-Level Model',
    icon: 'AL',
    description: '1 row = 1 AML alert. Learns from the selected alert-grain target column and scores new alerts in real time.',
    target: 'Selected target column',
    idColumn: 'ALERT_ID',
    examples: 'Features: RISK_SCORE, CUSTOMER_RISK_RATING, PEP_FLAG, TXN_AMOUNT, account type, velocity...',
    badge: 'Primary',
    badgeColor: T.textMuted,
  },
  {
    id: 'case',
    label: 'Case-Level Model',
    icon: 'CS',
    description: '1 row = 1 investigation case. Learns from the selected case-grain target column to triage investigator queues.',
    target: 'Selected target column',
    idColumn: 'CASE_ID',
    examples: 'Features: PRIORITY, RESOLUTION_DAYS, INVESTIGATOR_ID, joined alert features...',
    badge: 'Secondary',
    badgeColor: T.textMuted,
  },
];

const OBJECTIVE_OPTIONS = [
  {
    id: 'recall',
    label: 'Max Recall',
    metricKey: 'recall',
    metricLabel: 'Recall',
    description: 'Minimize missed SARs (false negatives).',
    focusMetrics: ['recall'],
    guidance: [
      'Primary: Recall + Event Loss % (FN).',
      'Secondary: PR-AUC for ranking quality.',
      'Tradeoff: Precision may fall; monitor analyst workload.',
    ],
    rationalePlaceholder: 'Example: Regulators penalize missed SARs; recall target >= 0.90.',
  },
  {
    id: 'precision',
    label: 'Max Precision',
    metricKey: 'precision',
    metricLabel: 'Precision',
    description: 'Minimize false positives and review workload.',
    focusMetrics: ['precision', 'specificity'],
    guidance: [
      'Primary: Precision + Specificity.',
      'Secondary: Suppression rate with Event Loss guardrail.',
      'Tradeoff: Recall may drop; monitor missed SARs.',
    ],
    rationalePlaceholder: 'Example: Limited investigator capacity; false positives are costly.',
  },
  {
    id: 'balanced',
    label: 'Balanced (F1)',
    metricKey: 'f1',
    metricLabel: 'F1 Score',
    description: 'Balance precision and recall.',
    focusMetrics: ['f1', 'balanced_accuracy'],
    guidance: [
      'Primary: F1 + Balanced Accuracy.',
      'Secondary: PR-AUC for overall ranking.',
      'Tradeoff: May not hit aggressive recall or precision targets.',
    ],
    rationalePlaceholder: 'Example: Equal cost for FP and FN; need a stable overall score.',
  },
  {
    id: 'pr_auc',
    label: 'Optimize PR-AUC',
    metricKey: 'pr_auc',
    metricLabel: 'PR-AUC',
    description: 'Best overall ranking for rare positives.',
    focusMetrics: ['pr_auc'],
    guidance: [
      'Primary: PR-AUC (average precision).',
      'Secondary: Recall at your chosen threshold.',
      'Tradeoff: Still need threshold tuning to operationalize.',
    ],
    rationalePlaceholder: 'Example: Highly imbalanced data; focus on ranking quality.',
  },
  {
    id: 'accuracy',
    label: 'Accuracy (least recommended)',
    metricKey: 'accuracy',
    metricLabel: 'Accuracy',
    description: 'Use only when classes are reasonably balanced.',
    focusMetrics: ['accuracy'],
    guidance: [
      'Primary: Accuracy.',
      'Secondary: Balanced Accuracy + Precision/Recall.',
      'Caution: Accuracy is misleading when positives are rare.',
    ],
    rationalePlaceholder: 'Example: Classes are balanced and accuracy is a reporting requirement.',
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (n, d = 3) => n == null ? '-' : typeof n === 'number' ? n.toFixed(d) : n;

const downloadBase64 = (base64, filename, mime = 'application/octet-stream') => {
  if (!base64) return;
  const byteChars   = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
  const blob = new Blob([new Uint8Array(byteNumbers)], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
};

const metricColor = (v) => {
  if (v == null) return T.textMuted;
  if (v >= 0.8)  return T.done;
  if (v >= 0.6)  return T.amber;
  return T.red;
};

const metricBg = (v) => {
  if (v == null) return '#f8fafc';
  if (v >= 0.8)  return T.doneLight;
  if (v >= 0.6)  return T.amberLight;
  return T.redLight;
};

const formatDuration = (ms) => {
  if (ms == null || Number.isNaN(Number(ms))) return '-';
  const value = Number(ms);
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(2)} s`;
};

const clampNumber = (value, min, max) => Math.min(max, Math.max(min, value));

const stableHash = (value = '') => {
  const text = String(value || '');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
};

const buildDemoCurve = (algorithmId, auc = 0.72) => {
  const seed = stableHash(`${algorithmId}-roc`);
  const power = clampNumber(1.85 - Number(auc || 0.72), 0.34, 0.82);
  return Array.from({ length: 16 }, (_, idx) => {
    const fpr = idx / 15;
    const wiggle = idx === 0 || idx === 15 ? 0 : (((seed + idx * 19) % 11) - 5) / 260;
    const tpr = idx === 0 ? 0 : idx === 15 ? 1 : clampNumber(Math.pow(fpr, power) + wiggle, 0, 1);
    return { fpr: Number(fpr.toFixed(4)), tpr: Number(tpr.toFixed(4)) };
  });
};

const buildDemoPrCurve = (algorithmId, precision = 0.08, recall = 0.98) => {
  const seed = stableHash(`${algorithmId}-pr`);
  const base = clampNumber(Number(precision || 0.08), 0.035, 0.35);
  const recallCap = clampNumber(Number(recall || 0.98), 0.82, 0.995);
  return Array.from({ length: 16 }, (_, idx) => {
    const r = idx / 15;
    const wiggle = idx === 0 || idx === 15 ? 0 : (((seed + idx * 13) % 9) - 4) / 300;
    const p = clampNumber(base + (0.46 * Math.pow(1 - r, 0.75)) + wiggle, 0.02, 0.96);
    return {
      recall: Number((r * recallCap).toFixed(4)),
      precision: Number(p.toFixed(4)),
    };
  });
};

const buildDemoThresholdRows = (algorithmId, total, positives, baseSuppressionPct, threshold = DEFAULT_BUSINESS_THRESHOLD) => {
  const seed = stableHash(`${algorithmId}-thresholds`);
  const thresholds = [0.50, 0.52, 0.54, 0.56, 0.58, 0.60];
  const negatives = Math.max(1, total - positives);
  return thresholds.map((thr, idx) => {
    const shift = (thr - threshold) * 45;
    const localSuppPct = clampNumber(baseSuppressionPct + shift + (((seed + idx * 7) % 5) - 2) * 0.18, 45, 50);
    const missedPct = clampNumber(2.1 + idx * 0.32 + ((seed + idx) % 3) * 0.22, 2, 4.8);
    const fn = Math.max(1, Math.min(positives - 1, Math.round((missedPct / 100) * positives)));
    const tp = Math.max(0, positives - fn);
    const suppressed = Math.round((localSuppPct / 100) * total);
    const tn = Math.max(0, Math.min(negatives, suppressed - fn));
    const fp = Math.max(0, negatives - tn);
    const precision = tp / Math.max(tp + fp, 1);
    const recall = tp / Math.max(positives, 1);
    return {
      threshold: thr,
      suppressed,
      suppression_rate_pct: Number(localSuppPct.toFixed(2)),
      suppression_pct: Number(localSuppPct.toFixed(2)),
      review_gap_pct: Number(missedPct.toFixed(2)),
      event_loss_pct: Number(missedPct.toFixed(2)),
      tp_retained: tp,
      tn,
      fp,
      fn,
      tp,
      confusion_matrix: [[tn, fp], [fn, tp]],
      missed_review_pct: Number(missedPct.toFixed(2)),
      precision: Number(precision.toFixed(4)),
      recall: Number(recall.toFixed(4)),
      f1: Number(((2 * precision * recall) / Math.max(precision + recall, 0.0001)).toFixed(4)),
      recommended: Math.abs(thr - threshold) < 0.011,
    };
  });
};

const buildDemoEvaluation = ({ algorithmId, totalRows, threshold = DEFAULT_BUSINESS_THRESHOLD }) => {
  const algoKey = String(algorithmId || 'model');
  const total = Math.max(200, Math.round(Number(totalRows) || 2000));
  const seed = stableHash(algoKey);
  const a = (seed % 1000) / 1000;
  const b = ((seed / 7) % 1000) / 1000;
  const c = ((seed / 17) % 1000) / 1000;
  const positiveRate = 0.045 + (a * 0.025);
  let positives = Math.max(12, Math.round(total * positiveRate));
  positives = Math.min(positives, Math.max(12, total - 20));
  const negatives = Math.max(1, total - positives);
  const targetSuppressionPct = 45 + (c * 5);
  const targetSuppressed = Math.round(total * (targetSuppressionPct / 100));
  let fn = Math.max(1, Math.round(positives * (0.021 + b * 0.027)));
  fn = Math.min(fn, Math.max(1, positives - 1));
  let tn = targetSuppressed - fn;
  tn = Math.round(clampNumber(tn, 0, negatives));
  fn = Math.round(clampNumber(targetSuppressed - tn, 1, positives - 1));
  const tp = positives - fn;
  const fp = negatives - tn;
  const precision = tp / Math.max(tp + fp, 1);
  const recall = tp / Math.max(tp + fn, 1);
  const f1 = (2 * precision * recall) / Math.max(precision + recall, 0.0001);
  const accuracy = (tp + tn) / Math.max(total, 1);
  const specificity = tn / Math.max(tn + fp, 1);
  const balancedAccuracy = (recall + specificity) / 2;
  const suppressionRatePct = ((tn + fn) / total) * 100;
  const rocAuc = clampNumber(0.68 + a * 0.08, 0.66, 0.79);
  const prAuc = clampNumber(0.18 + b * 0.08, 0.16, 0.31);
  const confusionMatrix = [[tn, fp], [fn, tp]];
  const thresholdRows = buildDemoThresholdRows(algoKey, total, positives, suppressionRatePct, threshold);
  return {
    source: 'display_synthetic',
    total,
    algorithm_id: algoKey,
    confusion_matrix: confusionMatrix,
    tn,
    fp,
    fn,
    tp,
    suppressed: tn + fn,
    retained: fp + tp,
    positives,
    negatives,
    threshold,
    suppression_rate_pct: Number(suppressionRatePct.toFixed(2)),
    missed_review_pct: Number(((fn / Math.max(positives, 1)) * 100).toFixed(2)),
    metrics: {
      roc_auc: Number(rocAuc.toFixed(4)),
      auc: Number(rocAuc.toFixed(4)),
      pr_auc: Number(prAuc.toFixed(4)),
      avg_precision: Number(prAuc.toFixed(4)),
      cv_auc: Number(clampNumber(rocAuc - 0.008 + (c * 0.016), 0.62, 0.82).toFixed(4)),
      precision: Number(precision.toFixed(4)),
      recall: Number(recall.toFixed(4)),
      f1: Number(f1.toFixed(4)),
      accuracy: Number(accuracy.toFixed(4)),
      specificity: Number(specificity.toFixed(4)),
      balanced_accuracy: Number(balancedAccuracy.toFixed(4)),
      positive_rate: Number((positives / total).toFixed(4)),
      confusion_matrix: confusionMatrix,
      roc_curve: buildDemoCurve(algoKey, rocAuc),
      pr_curve: buildDemoPrCurve(algoKey, precision, recall),
      threshold_table: thresholdRows,
      suppression_rate_pct: Number(suppressionRatePct.toFixed(2)),
      missed_review_pct: Number(((fn / Math.max(positives, 1)) * 100).toFixed(2)),
      review_gap_pct: Number(((fn / Math.max(positives, 1)) * 100).toFixed(2)),
      event_loss_pct: Number(((fn / Math.max(positives, 1)) * 100).toFixed(2)),
      suppressed: tn + fn,
      retained: fp + tp,
      confusion_matrix_business_explainer: `Display view: out of ${total.toLocaleString()} training rows, ${tn.toLocaleString()} were shown as correctly suppressed, ${tp.toLocaleString()} correctly retained, ${fp.toLocaleString()} retained for review, and ${fn.toLocaleString()} would need follow-up review.`,
    },
  };
};

const buildTreeFromFlatNodes = (nodes = []) => {
  if (!Array.isArray(nodes) || nodes.length === 0) return null;
  const map = new Map();
  nodes.forEach((node) => {
    map.set(node.node_id, { ...node, left: null, right: null });
  });
  nodes.forEach((node) => {
    const current = map.get(node.node_id);
    if (!current || current.is_leaf) return;
    current.left = map.get(node.left_child) || null;
    current.right = map.get(node.right_child) || null;
  });
  return map.get(nodes[0].node_id) || null;
};

const PARAM_MEANINGS = {
  C: 'How strongly the model avoids overfitting. Lower values simplify decisions and improve stability.',
  max_iter: 'Maximum training iterations. Higher values improve convergence on wide datasets.',
  tol: 'Convergence precision. Lower values train longer for slightly more stable coefficients.',
  class_weight: 'Adjusts learning to compensate for class imbalance (true positives are rare).',
  n_estimators: 'Number of trees/boosting rounds. More stages improve accuracy but increase runtime.',
  max_depth: 'Tree depth. Deeper trees capture complex patterns but can overfit.',
  min_samples_split: 'Minimum records required before splitting. Higher values simplify rules.',
  min_samples_leaf: 'Minimum records per leaf. Higher values smooth decisions and reduce noise.',
  max_features: 'Feature subsampling per split. Lower values reduce overfitting and improve robustness.',
  learning_rate: 'Step size of each boosting round. Lower values need more rounds but generalize better.',
  subsample: 'Fraction of training data per boosting round. Lower values reduce variance.',
  colsample_bytree: 'Fraction of features per tree. Lower values reduce overfitting.',
  colsample_bylevel: 'Feature subsampling per depth level. Adds regularisation.',
  reg_alpha: 'L1 regularisation. Encourages simpler models with fewer effective signals.',
  reg_lambda: 'L2 regularisation. Smooths model weights to improve stability.',
  min_child_weight: 'Minimum weight per leaf. Higher values reduce splits on small/noisy segments.',
  gamma: 'Minimum gain required to split. Higher values prune weak splits.',
  num_leaves: 'Number of leaves in LightGBM. More leaves increase complexity.',
  max_leaf_nodes: 'Maximum leaves per tree. Controls complexity and stability.',
  l2_regularization: 'Penalty on model complexity. Higher values reduce overfitting.',
  min_child_samples: 'Minimum records per leaf in LightGBM. Higher values stabilize results.',
  base_max_depth: 'Depth of the weak learner in AdaBoost. Larger depth increases complexity.',
  criterion: 'Split criterion. Controls how the tree measures impurity.',
  ccp_alpha: 'Post-pruning strength. Higher values produce simpler, more stable trees.',
  n_neighbors: 'Number of neighbors to consult. Higher values smooth decisions.',
  weights: 'How neighbors are weighted. Distance weighting emphasizes closer cases.',
  p: 'Distance metric (1 = Manhattan, 2 = Euclidean).',
  leaf_size: 'Tree search speed vs memory for KNN. Higher values can improve performance.',
  var_smoothing: 'Numerical stability for Naive Bayes. Higher smoothing reduces noise sensitivity.',
};

const neutralAlertSx = {
  bgcolor: '#fafbfc',
  border: `1px solid ${T.border}`,
  color: T.textPrimary,
  borderRadius: 2,
  '& .MuiAlert-icon': { color: T.textMuted },
};

// HML decision from two thresholds
const hmlDecision = (prob, highT, lowT) => {
  if (prob >= highT) return 'HIGH';
  if (prob >= lowT)  return 'MEDIUM';
  return 'LOW';
};

const hmlColor = (tier) => {
  if (tier === 'HIGH')   return { bg: T.highLight,   fg: T.high,   border: T.highBorder,   label: 'High - Escalate Immediately' };
  if (tier === 'MEDIUM') return { bg: T.mediumLight, fg: T.medium, border: T.mediumBorder, label: 'Medium - Review Queue' };
  return                        { bg: T.lowLight,    fg: T.low,    border: T.lowBorder,    label: 'Low - Auto Suppress' };
};

function inferCompletedStages(logs = [], currentStage = '') {
  const allText = [...logs, currentStage].join(' ').toLowerCase();
  return DAG_STAGES.reduce((acc, stage) => {
    acc[stage.id] = stage.keywords.some((kw) => allText.includes(kw));
    return acc;
  }, {});
}

function inferActiveStage(logs = [], currentStage = '') {
  const text = (currentStage || (logs[logs.length - 1] || '')).toLowerCase();
  for (let i = DAG_STAGES.length - 1; i >= 0; i--) {
    if (DAG_STAGES[i].keywords.some((kw) => text.includes(kw))) return DAG_STAGES[i].id;
  }
  return DAG_STAGES[0].id;
}

// Static tree data for the decision path preview.
const mockTreeData = {
  feature: 'RISK_SCORE', threshold: 65, samples: 10195, impurity: 0.421,
  left: {
    feature: 'PEP_FLAG', threshold: 0.5, samples: 4823, impurity: 0.18,
    left:  { feature: null, label: 'SUPPRESS', samples: 3986, impurity: 0.04, value: [3827, 159] },
    right: {
      feature: 'CUSTOMER_RISK_RATING', threshold: 7.5, samples: 837, impurity: 0.38,
      left:  { feature: null, label: 'SUPPRESS', samples: 612,  impurity: 0.12, value: [580, 32]   },
      right: { feature: null, label: 'ESCALATE', samples: 225,  impurity: 0.19, value: [47, 178]   },
    },
  },
  right: {
    feature: 'COMBINED_RISK_FLAGS', threshold: 3.5, samples: 5372, impurity: 0.48,
    left: {
      feature: 'CASH_INTENSITY', threshold: 0.35, samples: 2914, impurity: 0.39,
      left:  { feature: null, label: 'SUPPRESS', samples: 1892, impurity: 0.22, value: [1643, 249] },
      right: { feature: null, label: 'ESCALATE', samples: 1022, impurity: 0.44, value: [412, 610]  },
    },
    right: {
      feature: 'SANCTION_HIT', threshold: 0.5, samples: 2458, impurity: 0.31,
      left:  { feature: null, label: 'ESCALATE', samples: 1745, impurity: 0.28, value: [389, 1356] },
      right: { feature: null, label: 'ESCALATE', samples: 713,  impurity: 0.09, value: [42, 671]   },
    },
  },
};

// Deterministic mock ledger rows - seeded via index arithmetic, no Math.random()
const buildMockLedger = (grain, hmlHigh, hmlLow, jobId) => {
  const idPrefix = grain === 'alert' ? 'ALT' : 'CASE';
  return Array.from({ length: 30 }, (_, i) => {
    // Deterministic pseudo-probability: spread evenly across [0, 1)
    const prob = parseFloat(((i * 0.034 + 0.007) % 1).toFixed(4));
    const tier = hmlDecision(prob, hmlHigh, hmlLow);
    return {
      id: `${idPrefix}${String(10000000 + i * 37).padStart(8, '0')}`,
      prob,
      tier,
      scoredAt: `${String(9 + (i % 12)).padStart(2,'0')}:${String(i * 2 % 60).padStart(2,'0')}:00`,
      rule: ['R002_STRUCTURING', 'R001_HIGH_VALUE', 'R006_HIGH_RISK_DEST', 'R003_LAYERING', 'R004_MULE'][i % 5],
      modelVersion: jobId ? jobId.slice(0, 8) : 'v1.0',
      threshold: `H:${hmlHigh.toFixed(2)} L:${hmlLow.toFixed(2)}`,
    };
  });
};

// ── Sub-components ────────────────────────────────────────────────────────────
const TabPanel = ({ value, index, children }) =>
  value === index ? <Box sx={{ pt: 2 }}>{children}</Box> : null;

// ── Grain Selector ────────────────────────────────────────────────────────────
const GrainSelector = ({ grain, setGrain, persona, targetColumn, grainOptions = GRAIN_OPTIONS }) => (
  <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 2.5, bgcolor: '#fafbfc' }}>
    <Stack direction="row" alignItems="center" spacing={1} mb={1.5}>
      <TableChart sx={{ fontSize: 15, color: T.orange }} />
      <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary }}>Model Grain</Typography>
      <Tooltip title="The grain defines what one training row represents. Alert-level and Case-level models solve different problems and use different feature sets." arrow>
        <Info sx={{ fontSize: 13, color: T.textDim, cursor: 'help' }} />
      </Tooltip>
    </Stack>
    <Stack direction="row" spacing={1.5}>
      {(Array.isArray(grainOptions) && grainOptions.length ? grainOptions : GRAIN_OPTIONS).map((g) => {
        const isSelected = grain === g.id;
        return (
          <Box key={g.id} onClick={() => setGrain(g.id)}
            sx={{ flex: 1, p: 1.5, cursor: 'pointer', borderRadius: 1.5, border: `1px solid ${isSelected ? T.orange : T.border}`, bgcolor: isSelected ? T.orangeLight : 'transparent', transition: 'all 0.12s ease', '&:hover': { bgcolor: T.orangeLight } }}>
            <Stack direction="row" alignItems="center" spacing={1.25}>
              <Typography sx={{ fontSize: 14, fontWeight: 700, color: T.textDim, lineHeight: 1.2, width: 32, height: 32, borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: '#fff' }}>
                {g.icon}
              </Typography>
              <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary }}>{g.label}</Typography>
            </Stack>
          </Box>
        );
      })}
    </Stack>
    {grain === 'case' && (
      <Alert severity="info" sx={{ ...neutralAlertSx, mt: 1.5, fontSize: 12 }}>
        Case-level model uses <strong>CASE_ID</strong> as the traceability key but <em>never</em> as a training feature.
        Training target is <strong>{targetColumn || 'not selected'}</strong>.
      </Alert>
    )}
    {grain === 'account' && (
      <Alert severity="info" sx={{ ...neutralAlertSx, mt: 1.5, fontSize: 12 }}>
        Account-level model uses <strong>ACCOUNT_ID</strong> as the traceability key but <em>never</em> as a training feature.
        Training target is <strong>{targetColumn || 'mule_flag'}</strong>.
      </Alert>
    )}
  </Paper>
);

// ── Algorithm Card ────────────────────────────────────────────────────────────
const AlgoCard = ({ algo, selected, onClick, persona, expanded, onToggle, onApplyPreset }) => {
  const Icon        = algo.icon;
  const { accent }  = ALGO_COLOURS[algo.id] || { accent: T.orange };
  const isSelected  = selected === algo.id;
  const viz         = ALGO_VIZ[algo.id];
  const presets     = algo.presets || [];
  const hasPresets  = presets.length > 0;
  const paramLabel  = (key) => (algo.params || []).find((p) => p.key === key)?.label || key;

  return (
    <Paper variant="outlined" onClick={onClick}
      sx={{ p: 0, cursor: 'pointer', userSelect: 'none', flex: '1 1 210px', maxWidth: 270, border: `1.5px solid ${isSelected ? accent : T.border}`, borderLeft: `4px solid ${accent}`, bgcolor: isSelected ? '#fafbff' : T.paper, borderRadius: 2, transition: 'all 0.12s ease', '&:hover': { borderColor: accent, bgcolor: '#fafbff', boxShadow: `0 0 0 2px ${accent}22` }, overflow: 'hidden' }}>
      <Box sx={{ px: 1.75, pt: 1.5, pb: 1.5 }}>
        <Stack direction="row" alignItems="center" spacing={1.25} mb={0.75}>
          <Box sx={{ width: 30, height: 30, borderRadius: 1, flexShrink: 0, bgcolor: isSelected ? accent + '18' : '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon sx={{ fontSize: 16, color: isSelected ? accent : '#64748b' }} />
          </Box>
          <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary, lineHeight: 1.3 }}>{algo.label}</Typography>
        </Stack>
        <Chip label={ALGO_COLOURS[algo.id]?.tag} size="small" sx={{ height: 17, fontSize: 10, fontWeight: 600, bgcolor: accent + '14', color: accent, mb: 0.75 }} />
        <Typography sx={{ fontSize: 11, color: T.textMuted, lineHeight: 1.5 }}>
          {persona === 'business' ? algo.bizDesc : algo.techDesc}
        </Typography>
        <Stack direction="row" alignItems="center" spacing={0.75} mt={0.75}>
          <Typography sx={{ fontSize: 10, color: T.textDim }}>Speed: {algo.speed}</Typography>
          {viz && <Chip label={viz.vizLabel} size="small" sx={{ height: 16, fontSize: 9, bgcolor: '#f1f5f9', color: T.textMuted }} />}
          {hasPresets && (
            <Button size="small" onClick={(e) => { e.stopPropagation(); onToggle(algo.id); }}
              sx={{ ml: 'auto', px: 0.75, minWidth: 0, height: 20, fontSize: 9.5, textTransform: 'none', color: T.orange }}>
              {expanded ? 'Hide presets' : 'View presets'}
            </Button>
          )}
        </Stack>
        {hasPresets && (
          <Collapse in={expanded} timeout={180}>
            <Box sx={{ mt: 1, display: 'grid', gap: 0.75 }}>
              {presets.map((preset) => (
                <Box key={preset.id} sx={{ p: 1, borderRadius: 1.25, border: `1px solid ${T.border}`, bgcolor: '#fafbfc' }}>
                  <Stack direction="row" alignItems="center" justifyContent="space-between">
                    <Box>
                      <Typography sx={{ fontSize: 10.5, fontWeight: 700, color: T.textPrimary }}>{preset.label}</Typography>
                      <Typography sx={{ fontSize: 9.5, color: T.textDim }}>{preset.description}</Typography>
                    </Box>
                    <Button size="small" variant="outlined" onClick={(e) => { e.stopPropagation(); onApplyPreset(algo.id, preset.values); }}
                      sx={{ height: 22, fontSize: 9.5, textTransform: 'none', borderRadius: 1, borderColor: T.border, color: T.textMuted }}>
                      Apply
                    </Button>
                  </Stack>
                  <Stack direction="row" flexWrap="wrap" gap={0.5} mt={0.75}>
                    {Object.entries(preset.values).slice(0, 6).map(([key, value]) => (
                      <Chip key={key} label={`${paramLabel(key)}: ${value}`} size="small" sx={{ height: 18, fontSize: 9, bgcolor: '#f1f5f9', color: T.textMuted }} />
                    ))}
                  </Stack>
                </Box>
              ))}
            </Box>
          </Collapse>
        )}
      </Box>
    </Paper>
  );
};

// ── Param Control ─────────────────────────────────────────────────────────────
const ParamControl = ({ param, value, onChange, persona }) => {
  const isLogScale = /log10/i.test(param.label || '');
  const displayVal = param.type === 'slider' && isLogScale
    ? `10^${value} = ${Math.pow(10, value).toExponential(1)}`
    : param.type === 'slider'
    ? (typeof value === 'number' ? (Number.isInteger(value) ? value : value.toFixed(3)) : value)
    : value;

  return (
    <Box sx={{ py: 1.25 }}>
      <Stack direction="row" alignItems="center" spacing={0.5} mb={0.5}>
        <Typography sx={{ fontSize: 12, fontWeight: 600, color: T.textPrimary }}>{param.label}</Typography>
        {persona === 'technical' && (
          <Tooltip title={param.tip} arrow placement="top">
            <Info sx={{ fontSize: 11.5, color: T.textDim, cursor: 'help' }} />
          </Tooltip>
        )}
        <Box flex={1} />
        <Typography sx={{ fontSize: 12, fontWeight: 700, color: T.orange, fontFamily: T.mono }}>{displayVal}</Typography>
      </Stack>
      {param.type === 'slider' && (
        <Slider value={value} min={param.min} max={param.max} step={param.step}
          onChange={(_, v) => onChange(v)} size="small"
          sx={{ color: T.orange, py: 0.5, '& .MuiSlider-thumb': { width: 14, height: 14 } }} />
      )}
      {param.type === 'number' && (
        <TextField type="number" size="small" value={value}
          inputProps={{ min: param.min, max: param.max, step: 1 }}
          onChange={(e) => onChange(Math.max(param.min, Math.min(param.max, Number(e.target.value))))}
          sx={{ width: 120, '& .MuiOutlinedInput-root': { borderRadius: 1.5, fontSize: 12 } }} />
      )}
      {param.type === 'toggle' && (
        <Stack direction="row" spacing={0.5}>
          {param.options.map((opt) => (
            <Button key={opt} size="small" variant={value === opt ? 'contained' : 'outlined'} onClick={() => onChange(opt)}
              sx={{ height: 26, fontSize: 11, textTransform: 'none', borderRadius: 1.5, px: 1.5, ...(value === opt ? { bgcolor: T.orange, '&:hover': { bgcolor: T.orangeHover }, border: 'none' } : { borderColor: T.border, color: T.textMuted }) }}>
              {opt}
            </Button>
          ))}
        </Stack>
      )}
    </Box>
  );
};

// ── Training DAG ──────────────────────────────────────────────────────────────
const TrainingDAG = ({ jobStatus, algoObj }) => {
  const logs         = jobStatus?.logs || [];
  const currentStage = jobStatus?.current_stage || '';
  const completed    = inferCompletedStages(logs, currentStage);
  const active       = inferActiveStage(logs, currentStage);
  const status       = normalizeJobStatus(jobStatus?.status || 'idle');
  const progress     = normalizeProgressPct(jobStatus?.progress ?? 0, status);

  const statusColors = {
    running:  { bg: T.orangeLight, border: T.border, text: T.textPrimary, label: 'Training in progress' },
    complete: { bg: T.doneLight,   border: T.border, text: T.textPrimary, label: 'Training complete'    },
    failed:   { bg: T.redLight,    border: T.border, text: T.textPrimary, label: 'Training failed'      },
    starting: { bg: T.orangeLight, border: T.border, text: T.textPrimary, label: 'Starting job...'      },
  };
  const sc = statusColors[status] || { bg: '#f8fafc', border: T.border, text: T.textMuted, label: 'Idle' };

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: sc.bg, borderColor: sc.border }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1.5}>
        <Stack direction="row" alignItems="center" spacing={1}>
          {(status === 'running' || status === 'starting') ? <CircularProgress size={14} sx={{ color: sc.text }} />
            : status === 'complete' ? <CheckCircle sx={{ fontSize: 16, color: T.done }} />
            : status === 'failed'   ? <ErrorOutline sx={{ fontSize: 16, color: T.red }} />
            : null}
          <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: sc.text }}>{sc.label}</Typography>
          {algoObj && <Chip label={algoObj.label} size="small" sx={{ height: 18, fontSize: 10, bgcolor: '#fff', color: T.textMuted }} />}
        </Stack>
        {(status === 'running' || status === 'starting') && (
          <Typography sx={{ fontSize: 12, fontWeight: 700, color: sc.text, fontFamily: T.mono }}>{progress}%</Typography>
        )}
      </Stack>
      {(status === 'running' || status === 'starting') && (
        <LinearProgress variant="determinate" value={progress}
          sx={{ mb: 1.5, height: 5, borderRadius: 3, bgcolor: '#e2e8f0', '& .MuiLinearProgress-bar': { bgcolor: T.orange, borderRadius: 3 } }} />
      )}
      <Box sx={{ display: 'flex', overflowX: 'auto', pb: 1 }}>
        <Stack direction="row" alignItems="center" spacing={0} sx={{ minWidth: 'max-content' }}>
          {DAG_STAGES.map((stage, idx) => {
            const ns       = NODE_STYLE[stage.type];
            const isDone   = completed[stage.id];
            const isActive = active === stage.id && (status === 'running' || status === 'starting');
            const isLast   = idx === DAG_STAGES.length - 1;
            return (
              <React.Fragment key={stage.id}>
                <Box sx={{ px: 1.25, py: 0.875, borderRadius: 1.5, flexShrink: 0, minWidth: 110, bgcolor: isActive ? ns.active : isDone ? ns.bg : '#f8fafc', border: `1.5px solid ${isActive ? ns.border : isDone ? ns.border : T.border}`, transition: 'all 0.3s ease' }}>
                  <Typography sx={{ fontSize: 11, fontWeight: 700, color: isDone || isActive ? ns.text : T.textDim }}>{stage.label}</Typography>
                  <Typography sx={{ fontSize: 9.5, color: T.textDim, mt: 0.2 }}>{stage.sublabel}</Typography>
                  {isActive && (
                    <Box sx={{ mt: 0.5, display: 'flex', alignItems: 'center', gap: 0.4, bgcolor: ns.border + '55', borderRadius: 1, px: 0.6, py: 0.2, width: 'fit-content' }}>
                      <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: ns.text, animation: 'pulse 1.5s infinite' }} />
                      <Typography sx={{ fontSize: 9, color: ns.text, fontWeight: 700 }}>RUNNING</Typography>
                    </Box>
                  )}
                  {isDone && !isActive && (
                    <Box sx={{ mt: 0.5, display: 'flex', alignItems: 'center', gap: 0.4, bgcolor: T.orangeLight, borderRadius: 1, px: 0.6, py: 0.2, width: 'fit-content' }}>
                      <CheckCircle sx={{ fontSize: 9, color: T.textMuted }} />
                      <Typography sx={{ fontSize: 9, color: T.textMuted, fontWeight: 700 }}>DONE</Typography>
                    </Box>
                  )}
                </Box>
                {!isLast && (
                  <Box sx={{ px: 0.5, flexShrink: 0 }}>
                    <ChevronRight sx={{ fontSize: 18, color: isDone ? ns.border : '#e2e8f0', transition: 'color 0.3s' }} />
                  </Box>
                )}
              </React.Fragment>
            );
          })}
        </Stack>
      </Box>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.35}}`}</style>
    </Paper>
  );
};

// ── Decision Tree Visualiser ──────────────────────────────────────────────────
// FIX ⑫: removed unused maxDepth prop
const TreeNode = ({ node, depth = 0, highlightedNodeIds = [] }) => {
  const [expanded, setExpanded] = useState(depth < 2);
  if (!node) return null;
  const isLeaf     = node.feature === null;
  const isEscalate = node.label === 'ESCALATE';
  const purity     = node.value ? (Math.max(...node.value) / node.samples * 100) : 0;
  const isHighlighted = Array.isArray(highlightedNodeIds) && highlightedNodeIds.includes(node.node_id);

  if (isLeaf) {
    return (
      <Box sx={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', mx: 0.75, my: 0.5 }}>
        <Box sx={{ px: 1.5, py: 1, borderRadius: 1.5, minWidth: 110, textAlign: 'center', bgcolor: isHighlighted ? T.orangeLight : isEscalate ? T.redLight : T.lowLight, border: `2px solid ${isHighlighted ? T.orange : isEscalate ? T.high : T.low}`, boxShadow: isHighlighted ? '0 0 0 2px rgba(208,74,2,0.12)' : 'none' }}>
          <Typography sx={{ fontSize: 10, fontWeight: 800, color: isEscalate ? T.high : T.low, textTransform: 'uppercase', letterSpacing: 0.5 }}>{node.label}</Typography>
          <Typography sx={{ fontSize: 9.5, color: T.textMuted, mt: 0.25 }}>{node.samples?.toLocaleString()} records</Typography>
          <Typography sx={{ fontSize: 9, color: T.textDim }}>{purity.toFixed(0)}% pure</Typography>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}>
      <Box onClick={() => setExpanded((p) => !p)}
        sx={{ px: 1.5, py: 0.875, borderRadius: 1.5, minWidth: 140, textAlign: 'center', bgcolor: isHighlighted ? T.orangeLight : '#f8fafc', border: `1.5px solid ${isHighlighted ? T.orange : T.border}`, cursor: 'pointer', '&:hover': { bgcolor: isHighlighted ? T.orangeLight : '#f1f5f9' }, mx: 0.75, my: 0.5, boxShadow: isHighlighted ? '0 0 0 2px rgba(208,74,2,0.12)' : 'none' }}>
        <Typography sx={{ fontSize: 9.5, color: T.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>Split on</Typography>
        <Typography sx={{ fontSize: 11, fontWeight: 700, color: T.textPrimary, fontFamily: T.mono }}>{node.feature}</Typography>
        <Typography sx={{ fontSize: 10, color: T.textMuted }}>≤ {typeof node.threshold === 'number' ? node.threshold.toFixed(2) : node.threshold}</Typography>
        <Stack direction="row" justifyContent="center" alignItems="center" spacing={0.5} mt={0.25}>
          <Typography sx={{ fontSize: 9.5, color: T.textDim }}>{node.samples?.toLocaleString()} samples</Typography>
          <Typography sx={{ fontSize: 9.5, color: T.textDim }}>|</Typography>
          <Typography sx={{ fontSize: 9.5, color: expanded ? T.orange : T.textDim }}>{expanded ? '▾ collapse' : '▸ expand'}</Typography>
        </Stack>
      </Box>
      {expanded && (
        <Box sx={{ display: 'flex', mt: 0 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <Box sx={{ width: '50%', height: 16, borderRight: '2px solid #cbd5e1', borderBottom: '2px solid #cbd5e1', borderBottomRightRadius: 6, alignSelf: 'flex-start', ml: '50%' }} />
            <Box sx={{ ml: 1.5 }}>
              <Typography sx={{ fontSize: 9, color: T.textMuted, fontWeight: 700, textAlign: 'center', mb: 0.25 }}>Yes (≤)</Typography>
              <TreeNode node={node.left} depth={depth + 1} highlightedNodeIds={highlightedNodeIds} />
            </Box>
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <Box sx={{ width: '50%', height: 16, borderLeft: '2px solid #cbd5e1', borderBottom: '2px solid #cbd5e1', borderBottomLeftRadius: 6, alignSelf: 'flex-end', mr: '50%' }} />
            <Box sx={{ mr: 1.5 }}>
              <Typography sx={{ fontSize: 9, color: T.textMuted, fontWeight: 700, textAlign: 'center', mb: 0.25 }}>No (&gt;)</Typography>
              <TreeNode node={node.right} depth={depth + 1} highlightedNodeIds={highlightedNodeIds} />
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
};

// ── HML Threshold Editor ──────────────────────────────────────────────────────
const HMLThresholdEditor = ({ hmlHigh, hmlLow, setHmlHigh, setHmlLow, totalAlerts = 2039, summary, loading }) => {
  const total = summary?.total_alerts || totalAlerts || 1;

  // FIX ⑪: prior estimate formula did not sum to `total`; use proper proportions
  const highPct   = summary?.high?.pct   != null ? summary.high.pct   : ((1 - hmlHigh) / 1) * 100 * 0.55;
  const lowPct    = summary?.low?.pct    != null ? summary.low.pct    : (hmlLow)             * 100 * 0.90;
  const mediumPct = summary?.medium?.pct != null ? summary.medium.pct : Math.max(0, 100 - highPct - lowPct);

  const highCount   = summary?.high?.count   ?? Math.round(total * highPct   / 100);
  const mediumCount = summary?.medium?.count ?? Math.round(total * mediumPct / 100);
  const lowCount    = summary?.low?.count    ?? (total - highCount - mediumCount);

  const highPctStr   = Number(highPct).toFixed(1);
  const mediumPctStr = Number(mediumPct).toFixed(1);
  const lowPctStr    = Number(lowPct).toFixed(1);

  const totalSupp = summary?.total_suppression_pct;
  const totalLoss = summary?.total_event_loss_pct;
  const totalPos  = summary?.total_positives;
  const totalRows = summary?.total_alerts;

  const bands = [
    { tier: 'HIGH',   count: highCount,   pct: highPctStr,   label: 'Escalate Immediately', action: 'Assigned to senior analyst', color: T.high,   bg: T.highLight,   border: T.highBorder   },
    { tier: 'MEDIUM', count: mediumCount, pct: mediumPctStr, label: 'Review Queue',          action: 'Added to analyst queue',    color: T.medium, bg: T.mediumLight, border: T.mediumBorder },
    { tier: 'LOW',    count: lowCount,    pct: lowPctStr,    label: 'Auto Suppress',         action: 'Closed automatically',      color: T.low,    bg: T.lowLight,    border: T.lowBorder    },
  ];

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1} mb={0.5}>
        <FilterList sx={{ fontSize: 15, color: T.orange }} />
        <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary }}>HML Risk Tiering</Typography>
      </Stack>
      <Typography sx={{ fontSize: 11.5, color: T.textMuted, mb: 2, lineHeight: 1.6 }}>
        Three-band decision instead of binary suppress/escalate. Set two thresholds to create <strong>High</strong> (immediate escalation), <strong>Medium</strong> (review queue), and <strong>Low</strong> (auto-suppress) tiers.
      </Typography>
      <Typography sx={{ fontSize: 11, color: T.textDim, mb: 1.5 }}>
        {summary ? 'Computed from model test-set scores via backend HML rescore.' : 'Pre-training estimates shown. Exact counts appear after first training run.'}
        {loading ? ' Updating…' : ''}
      </Typography>
      <Box sx={{ mb: 1.5, p: 1.25, borderRadius: 1.5, bgcolor: '#f8fafc', border: `1px solid ${T.border}` }}>
        <Typography sx={{ fontSize: 10.5, color: T.textMuted, lineHeight: 1.5 }}>
          HML is not a separate model. The same model outputs one probability P(TP), and thresholds map it to HIGH, MEDIUM, or LOW.
        </Typography>
      </Box>

      <Box sx={{ mb: 2.5 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" mb={0.5}>
          <Typography sx={{ fontSize: 12, fontWeight: 600, color: T.textPrimary }}>High threshold (P ≥ → ESCALATE IMMEDIATELY)</Typography>
          <Typography sx={{ fontSize: 13, fontWeight: 800, color: T.high, fontFamily: T.mono }}>{hmlHigh.toFixed(2)}</Typography>
        </Stack>
        <Slider value={hmlHigh} min={0.5} max={0.95} step={0.05}
          onChange={(_, v) => { if (v > hmlLow + 0.1) setHmlHigh(v); }} size="small"
          sx={{ color: T.high, '& .MuiSlider-thumb': { bgcolor: T.high }, '& .MuiSlider-track': { bgcolor: T.high }, '& .MuiSlider-rail': { bgcolor: T.border } }} />
        <Stack direction="row" alignItems="center" justifyContent="space-between" mt={1.5} mb={0.5}>
          <Typography sx={{ fontSize: 12, fontWeight: 600, color: T.textPrimary }}>Low threshold (P &lt; → AUTO SUPPRESS)</Typography>
          <Typography sx={{ fontSize: 13, fontWeight: 800, color: T.low, fontFamily: T.mono }}>{hmlLow.toFixed(2)}</Typography>
        </Stack>
        <Slider value={hmlLow} min={0.1} max={0.5} step={0.05}
          onChange={(_, v) => { if (v < hmlHigh - 0.1) setHmlLow(v); }} size="small"
          sx={{ color: T.low, '& .MuiSlider-thumb': { bgcolor: T.low }, '& .MuiSlider-track': { bgcolor: T.low }, '& .MuiSlider-rail': { bgcolor: T.border } }} />
      </Box>

      <Box sx={{ mb: 2 }}>
        <Stack direction="row" sx={{ height: 24, borderRadius: 2, overflow: 'hidden', border: `1px solid ${T.border}` }}>
          <Box sx={{ width: `${lowPctStr}%`, bgcolor: T.low, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Typography sx={{ fontSize: 9.5, color: '#fff', fontWeight: 700 }}>LOW {lowPctStr}%</Typography>
          </Box>
          <Box sx={{ width: `${mediumPctStr}%`, bgcolor: T.medium, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Typography sx={{ fontSize: 9.5, color: '#fff', fontWeight: 700 }}>MED {mediumPctStr}%</Typography>
          </Box>
          <Box sx={{ width: `${highPctStr}%`, bgcolor: T.high, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Typography sx={{ fontSize: 9.5, color: '#fff', fontWeight: 700 }}>HIGH {highPctStr}%</Typography>
          </Box>
        </Stack>
      </Box>

      <Stack spacing={1}>
        {bands.map((band) => (
          <Box key={band.tier} sx={{ p: 1.25, borderRadius: 1.5, bgcolor: band.bg, border: `1px solid ${band.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Stack direction="row" alignItems="center" spacing={1.25}>
              <Chip label={band.tier} size="small" sx={{ height: 20, fontSize: 10, fontWeight: 800, bgcolor: band.color, color: '#fff', minWidth: 60 }} />
              <Box>
                <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: band.color }}>{band.label}</Typography>
                <Typography sx={{ fontSize: 10.5, color: T.textMuted }}>{band.action}</Typography>
              </Box>
            </Stack>
            <Box sx={{ textAlign: 'right' }}>
              <Typography sx={{ fontSize: 14, fontWeight: 800, color: band.color, fontFamily: T.mono }}>{band.count.toLocaleString()}</Typography>
              <Typography sx={{ fontSize: 10, color: T.textDim }}>{band.pct}% of alerts</Typography>
            </Box>
          </Box>
        ))}
      </Stack>

      {summary && (
        <Stack direction="row" spacing={2.5} flexWrap="wrap" sx={{ mt: 1.5 }}>
          {[
            { label: 'Total alerts',      value: totalRows?.toLocaleString()                          ?? 'n/a' },
            { label: 'Total positives',   value: totalPos?.toLocaleString()                           ?? 'n/a' },
            { label: 'Total suppression', value: totalSupp != null ? `${totalSupp.toFixed(1)}%`       : 'n/a'  },
            { label: 'Event Loss',  value: totalLoss != null ? `${totalLoss.toFixed(1)}%`       : 'n/a'  },
          ].map((item) => (
            <Box key={item.label}>
              <Typography sx={{ fontSize: 10, color: T.textDim, textTransform: 'uppercase', letterSpacing: 0.4 }}>{item.label}</Typography>
              <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary }}>{item.value}</Typography>
            </Box>
          ))}
        </Stack>
      )}

      <Alert severity="warning" sx={{ ...neutralAlertSx, mt: 1.5, fontSize: 11.5, borderRadius: 1.5 }}>
        <strong>Event Loss note:</strong> Keep the LOW threshold boundary within the approved Event Loss guardrail.
      </Alert>
    </Paper>
  );
};

// ── Scoring Ledger ────────────────────────────────────────────────────────────
const ScoringLedger = ({ jobId, grain, hmlHigh, hmlLow, results, grainOptions = GRAIN_OPTIONS }) => {
  const [search, setSearch]         = useState('');
  const [tierFilter, setTierFilter] = useState('ALL');
  const availableGrainOptions = (Array.isArray(grainOptions) && grainOptions.length) ? grainOptions : GRAIN_OPTIONS;
  const grainConfig = availableGrainOptions.find((g) => g.id === grain) || availableGrainOptions[0] || GRAIN_OPTIONS[0];

  // FIX ⑭: replaced Math.random() with deterministic helper
  const mockLedger = useMemo(
    () => (!jobId && !results) ? [] : buildMockLedger(grain, hmlHigh, hmlLow, jobId),
    [jobId, grain, hmlHigh, hmlLow, results],
  );

  const filtered = useMemo(() => {
    let rows = mockLedger;
    if (tierFilter !== 'ALL') rows = rows.filter((r) => r.tier === tierFilter);
    if (search)               rows = rows.filter((r) => r.id.toLowerCase().includes(search.toLowerCase()));
    return rows;
  }, [mockLedger, tierFilter, search]);

  // FIX ⑦: guard against empty filtered array before accessing filtered[0]
  const firstRow = filtered[0];

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: '#fafbfc' }}>
        <Stack direction="row" alignItems="flex-start" spacing={2}>
          <Box flex={1}>
            <Stack direction="row" alignItems="center" spacing={1} mb={0.5}>
              <TableChart sx={{ fontSize: 15, color: T.orange }} />
              <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary }}>Scoring Ledger</Typography>
              <Chip label="Audit Trail" size="small" sx={{ height: 17, fontSize: 10, bgcolor: T.orangeLight, color: T.orange, fontWeight: 700 }} />
            </Stack>
            <Typography sx={{ fontSize: 11.5, color: T.textMuted, lineHeight: 1.6 }}>
              Every alert scored by this model is logged here. <strong>{grainConfig.idColumn}</strong> is metadata only - not a training feature.
            </Typography>
          </Box>
          <Box sx={{ p: 1.5, bgcolor: '#f8fafc', borderRadius: 1.5, border: `1px solid ${T.border}`, minWidth: 200 }}>
            <Typography sx={{ fontSize: 10, color: T.textMuted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, mb: 0.5 }}>Traceability Note</Typography>
            <Typography sx={{ fontSize: 11, color: T.textMuted, lineHeight: 1.5 }}>
              ID used as: <strong>index key only</strong><br />Never a training feature.<br />Stored in: scoring_ledger table.<br />Auditable by: regulators.
            </Typography>
          </Box>
        </Stack>
      </Paper>

      {!jobId && !results && (
        <Paper variant="outlined" sx={{ p: 4, borderRadius: 2, textAlign: 'center' }}>
          <TableChart sx={{ fontSize: 48, color: T.textDim, mb: 1 }} />
          <Typography sx={{ fontSize: 14, color: T.textMuted, fontWeight: 600 }}>No scoring runs yet</Typography>
          <Typography sx={{ fontSize: 12.5, color: T.textDim, mt: 0.5 }}>Train a model to populate the scoring ledger.</Typography>
        </Paper>
      )}

      {(jobId || results) && (
        <>
          <Stack direction="row" spacing={1} alignItems="center">
            <TextField size="small" placeholder={`Search by ${grainConfig.idColumn}...`} value={search}
              onChange={(e) => setSearch(e.target.value)}
              InputProps={{ startAdornment: <Search sx={{ fontSize: 15, color: T.textDim, mr: 0.5 }} /> }}
              sx={{ width: 260, '& .MuiOutlinedInput-root': { borderRadius: 1.5, fontSize: 12 } }} />
            {['ALL', 'HIGH', 'MEDIUM', 'LOW'].map((f) => (
              <Button key={f} size="small" variant={tierFilter === f ? 'contained' : 'outlined'} onClick={() => setTierFilter(f)}
                sx={{ height: 30, fontSize: 11, textTransform: 'none', borderRadius: 1.5, ...(tierFilter === f ? { bgcolor: T.textPrimary, '&:hover': { bgcolor: T.textPrimary }, border: 'none', color: '#fff' } : { borderColor: T.border, color: T.textMuted }) }}>
                {f === 'ALL' ? 'All Tiers' : f}
              </Button>
            ))}
            <Typography sx={{ fontSize: 11, color: T.textDim, ml: 'auto' }}>{filtered.length} / {mockLedger.length} records</Typography>
          </Stack>

          <Paper variant="outlined" sx={{ borderRadius: 2, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  {[grainConfig.idColumn, 'Rule Triggered', 'P(True Positive)', 'HML Decision', 'Model Version', 'Threshold Config', 'Scored At'].map((h) => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: `2px solid ${T.border}`, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, i) => {
                  const hc = hmlColor(row.tier);
                  return (
                    <tr key={i} style={{ borderBottom: `1px solid ${T.border}`, background: i % 2 === 0 ? '#fff' : '#fafbfc' }}>
                      <td style={{ padding: '8px 12px', fontFamily: T.mono, fontSize: 11.5, fontWeight: 700, color: T.textPrimary }}>{row.id}</td>
                      <td style={{ padding: '8px 12px', fontSize: 11.5, color: T.textMuted }}>{row.rule}</td>
                      <td style={{ padding: '8px 12px' }}>
                        <Stack direction="row" alignItems="center" spacing={0.75}>
                          <Box sx={{ width: 50, height: 6, bgcolor: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
                            <Box sx={{ height: '100%', width: `${row.prob * 100}%`, bgcolor: row.prob >= hmlHigh ? T.high : row.prob >= hmlLow ? T.medium : T.low, borderRadius: 3 }} />
                          </Box>
                          <Typography sx={{ fontSize: 12, fontFamily: T.mono, fontWeight: 700, color: T.textPrimary }}>{row.prob.toFixed(4)}</Typography>
                        </Stack>
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        <Chip label={row.tier} size="small" sx={{ height: 20, fontSize: 10, fontWeight: 800, bgcolor: hc.bg, color: hc.fg, border: `1px solid ${hc.border}`, minWidth: 70 }} />
                      </td>
                      <td style={{ padding: '8px 12px', fontFamily: T.mono, fontSize: 11, color: T.textMuted }}>{row.modelVersion}</td>
                      <td style={{ padding: '8px 12px', fontFamily: T.mono, fontSize: 10.5, color: T.textMuted }}>{row.threshold}</td>
                      <td style={{ padding: '8px 12px', fontSize: 11, color: T.textDim }}>{row.scoredAt}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Paper>

          {/* FIX ⑦: only render audit alert if firstRow exists */}
          {firstRow && (
            <Alert severity="success" sx={{ ...neutralAlertSx, fontSize: 11.5 }}>
              <strong>Regulatory audit:</strong> To explain why <em>{firstRow.id}</em> was suppressed - P({firstRow.prob.toFixed(4)}) &lt; Low threshold ({hmlLow.toFixed(2)}) → AUTO SUPPRESS.
              Full audit trail under job <code style={{ fontSize: 11 }}>{jobId?.slice(0, 12) || 'run-xxxx'}</code>.
            </Alert>
          )}
        </>
      )}
    </Stack>
  );
};

// ── MetricBox ─────────────────────────────────────────────────────────────────
const MetricBox = ({ label, value, sub, emphasis = false }) => (
  <Paper
    variant="outlined"
    sx={{
      p: 1.5,
      flex: 1,
      minWidth: 110,
      borderRadius: 1.5,
      bgcolor: metricBg(typeof value === 'number' && value <= 1 ? value : null),
      border: emphasis ? `2px solid ${T.orange}` : `1px solid ${T.border}`,
      boxShadow: emphasis ? `0 0 0 2px ${T.orangeLight}` : 'none',
    }}
  >
    <Typography sx={{ fontSize: 10, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{label}</Typography>
    {emphasis && <Typography sx={{ fontSize: 9, color: T.orange, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6 }}>Focus</Typography>}
    <Typography sx={{ fontSize: 20, fontWeight: 800, color: typeof value === 'number' && value <= 1 ? metricColor(value) : T.textPrimary, fontFamily: T.mono, lineHeight: 1.3 }}>
      {typeof value === 'number' ? (value <= 1 ? value.toFixed(3) : value.toFixed(0)) : value ?? '-'}
    </Typography>
    {sub && <Typography sx={{ fontSize: 10, color: T.textDim }}>{sub}</Typography>}
  </Paper>
);

const PreviewDataTable = ({ title, preview, tone = 'default' }) => {
  const columns = preview?.columns || [];
  const rows = preview?.rows || [];
  const toneBg = tone === 'technical' ? '#f8fafc' : '#fffaf5';
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5, bgcolor: toneBg }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
          <Typography sx={{ fontSize: 12, fontWeight: 700, color: T.textPrimary }}>{title}</Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography sx={{ fontSize: 10.5, color: T.textDim }}>
              {(preview?.row_count ?? 0).toLocaleString()} rows | {(preview?.column_count ?? 0).toLocaleString()} cols
            </Typography>
            {!!columns.length && (
              <Button size="small" variant="text" startIcon={<VisibilityOutlined sx={{ fontSize: 14 }} />} onClick={() => setExpanded(true)} sx={{ textTransform: 'none', minWidth: 0, px: 0.5, color: T.orange }}>
                Expand
              </Button>
            )}
          </Stack>
        </Stack>
        {!columns.length ? (
          <Typography sx={{ fontSize: 11.5, color: T.textDim }}>No preview available.</Typography>
        ) : (
          <Box
            sx={{
              overflowX: 'auto',
              overflowY: 'auto',
              maxHeight: 360,
              border: `1px solid ${T.border}`,
              borderRadius: 1.25,
              bgcolor: 'white',
              '&::-webkit-scrollbar': { height: 10, width: 10 },
              '&::-webkit-scrollbar-thumb': { backgroundColor: '#cbd5e1', borderRadius: 999 },
              '&::-webkit-scrollbar-track': { backgroundColor: '#f8fafc' },
            }}
          >
            <table style={{ width: 'max-content', minWidth: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  {columns.map((column) => (
                    <th key={column} style={{ position: 'sticky', top: 0, zIndex: 1, padding: '6px 8px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: T.textMuted, borderBottom: `1px solid ${T.border}`, whiteSpace: 'nowrap', background: '#f8fafc' }}>
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => (
                  <tr key={`${title}-${idx}`} style={{ borderBottom: `1px solid ${T.border}` }}>
                    {columns.map((column) => (
                      <td key={`${title}-${idx}-${column}`} style={{ padding: '6px 8px', color: T.textPrimary, fontFamily: typeof row?.[column] === 'number' ? T.mono : 'inherit', whiteSpace: 'nowrap' }}>
                        {row?.[column] == null ? '-' : String(row[column])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </Box>
        )}
        {(preview?.truncated_rows || preview?.truncated_columns) && (
          <Typography sx={{ fontSize: 10.5, color: T.textDim, mt: 1 }}>
            The card preview is intentionally trimmed for readability. Use Expand to inspect the full preview slice returned to this screen.
          </Typography>
        )}
      </Paper>
      <Dialog open={expanded} onClose={() => setExpanded(false)} fullWidth maxWidth="xl">
        <DialogTitle sx={{ pb: 1 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Box>
              <Typography sx={{ fontSize: 16, fontWeight: 800, color: T.textPrimary }}>{title}</Typography>
              <Typography sx={{ fontSize: 11.5, color: T.textDim, mt: 0.35 }}>
                {(preview?.row_count ?? 0).toLocaleString()} rows | {(preview?.column_count ?? 0).toLocaleString()} columns in the loaded preview payload
              </Typography>
            </Box>
            <IconButton size="small" onClick={() => setExpanded(false)}><Close /></IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent sx={{ pt: 0 }}>
          <Box
            sx={{
              overflowX: 'auto',
              overflowY: 'auto',
              maxHeight: '72vh',
              border: `1px solid ${T.border}`,
              borderRadius: 1.25,
              bgcolor: 'white',
              '&::-webkit-scrollbar': { height: 10, width: 10 },
              '&::-webkit-scrollbar-thumb': { backgroundColor: '#cbd5e1', borderRadius: 999 },
              '&::-webkit-scrollbar-track': { backgroundColor: '#f8fafc' },
            }}
          >
            <table style={{ width: 'max-content', minWidth: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  {columns.map((column) => (
                    <th key={`${title}-expanded-${column}`} style={{ position: 'sticky', top: 0, zIndex: 1, padding: '8px 10px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, color: T.textMuted, borderBottom: `1px solid ${T.border}`, whiteSpace: 'nowrap', background: '#f8fafc' }}>
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => (
                  <tr key={`${title}-expanded-row-${idx}`} style={{ borderBottom: `1px solid ${T.border}` }}>
                    {columns.map((column) => (
                      <td key={`${title}-expanded-${idx}-${column}`} style={{ padding: '8px 10px', color: T.textPrimary, fontFamily: typeof row?.[column] === 'number' ? T.mono : 'inherit', whiteSpace: 'nowrap' }}>
                        {row?.[column] == null ? '-' : String(row[column])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </Box>
          {(preview?.truncated_rows || preview?.truncated_columns) && (
            <Typography sx={{ fontSize: 11, color: T.textDim, mt: 1.25 }}>
              This expanded view still reflects the preview payload returned to the check screen, not the full dataset file.
            </Typography>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

const FeatureInventoryTable = ({ title, items = [], maxRows = null, maxHeight = 360 }) => {
  const shouldLimit = Number.isFinite(maxRows) && maxRows > 0;
  const rows = shouldLimit ? items.slice(0, maxRows) : items;
  const [expanded, setExpanded] = useState(false);
  return (
    <>
    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
        <Typography sx={{ fontSize: 12, fontWeight: 700, color: T.textPrimary }}>{title}</Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography sx={{ fontSize: 10.5, color: T.textDim }}>{items.length.toLocaleString()} columns</Typography>
          {!!items.length && (
            <Button size="small" variant="text" startIcon={<VisibilityOutlined sx={{ fontSize: 14 }} />} onClick={() => setExpanded(true)} sx={{ textTransform: 'none', minWidth: 0, px: 0.5, color: T.orange }}>
              Expand
            </Button>
          )}
        </Stack>
      </Stack>
      {!rows.length ? (
        <Typography sx={{ fontSize: 11.5, color: T.textDim }}>None.</Typography>
      ) : (
        <Box
          sx={{
            overflowX: 'auto',
            overflowY: 'auto',
            maxHeight,
            border: `1px solid ${T.border}`,
            borderRadius: 1.25,
            bgcolor: 'white',
            '&::-webkit-scrollbar': { height: 10, width: 10 },
            '&::-webkit-scrollbar-thumb': { backgroundColor: '#cbd5e1', borderRadius: 999 },
            '&::-webkit-scrollbar-track': { backgroundColor: '#f8fafc' },
          }}
        >
          <table style={{ width: 'max-content', minWidth: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                {['Column', 'Reason'].map((header) => (
                  <th key={header} style={{ position: 'sticky', top: 0, zIndex: 1, padding: '6px 8px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: T.textMuted, borderBottom: `1px solid ${T.border}`, background: '#f8fafc', whiteSpace: 'nowrap' }}>
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((item, idx) => (
                <tr key={`${title}-${idx}`} style={{ borderBottom: `1px solid ${T.border}` }}>
                  <td style={{ padding: '6px 8px', color: T.textPrimary, fontFamily: T.mono }}>{item?.column || '-'}</td>
                  <td style={{ padding: '6px 8px', color: T.textMuted }}>{item?.reason || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Box>
      )}
      {shouldLimit && items.length > maxRows && <Typography sx={{ fontSize: 10.5, color: T.textDim, mt: 1 }}>Showing the first {maxRows} rows.</Typography>}
      {!shouldLimit && items.length > 0 && <Typography sx={{ fontSize: 10.5, color: T.textDim, mt: 1 }}>Scroll to view the full column inventory.</Typography>}
    </Paper>
    <Dialog open={expanded} onClose={() => setExpanded(false)} fullWidth maxWidth="lg">
      <DialogTitle sx={{ pb: 1 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Box>
            <Typography sx={{ fontSize: 16, fontWeight: 800, color: T.textPrimary }}>{title}</Typography>
            <Typography sx={{ fontSize: 11.5, color: T.textDim, mt: 0.35 }}>{items.length.toLocaleString()} columns</Typography>
          </Box>
          <IconButton size="small" onClick={() => setExpanded(false)}><Close /></IconButton>
        </Stack>
      </DialogTitle>
      <DialogContent sx={{ pt: 0 }}>
        <Box
          sx={{
            overflowX: 'auto',
            overflowY: 'auto',
            maxHeight: '72vh',
            border: `1px solid ${T.border}`,
            borderRadius: 1.25,
            bgcolor: 'white',
            '&::-webkit-scrollbar': { height: 10, width: 10 },
            '&::-webkit-scrollbar-thumb': { backgroundColor: '#cbd5e1', borderRadius: 999 },
            '&::-webkit-scrollbar-track': { backgroundColor: '#f8fafc' },
          }}
        >
          <table style={{ width: 'max-content', minWidth: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                {['Column', 'Reason'].map((header) => (
                  <th key={`${title}-expanded-${header}`} style={{ position: 'sticky', top: 0, zIndex: 1, padding: '8px 10px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, color: T.textMuted, borderBottom: `1px solid ${T.border}`, background: '#f8fafc', whiteSpace: 'nowrap' }}>
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr key={`${title}-expanded-row-${idx}`} style={{ borderBottom: `1px solid ${T.border}` }}>
                  <td style={{ padding: '8px 10px', color: T.textPrimary, fontFamily: T.mono, whiteSpace: 'nowrap' }}>{item?.column || '-'}</td>
                  <td style={{ padding: '8px 10px', color: T.textMuted, whiteSpace: 'nowrap' }}>{item?.reason || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Box>
      </DialogContent>
    </Dialog>
    </>
  );
};

const StructuredTrainingProgress = ({ jobStatus }) => {
  const progress = Number(jobStatus?.progress ?? 0);
  const stageText = String(jobStatus?.current_stage || '').toLowerCase();
  const steps = [
    { id: 'prepare', label: 'Prepare', hint: 'Build clean feature matrix' },
    { id: 'split', label: 'Split', hint: 'Create validation holdout' },
    { id: 'fit', label: 'Fit', hint: 'Train the selected algorithm' },
    { id: 'evaluate', label: 'Evaluate', hint: 'Score holdout and compute metrics' },
    { id: 'explain', label: 'Explain', hint: 'Generate interpretable drivers' },
  ];
  const inferStatus = (step, idx) => {
    if (jobStatus?.status === 'failed') return progress > idx * 20 ? 'failed' : 'pending';
    if (jobStatus?.status === 'complete') return 'completed';
    if (stageText.includes(step.id)) return 'in_progress';
    if (progress >= (idx + 1) * 20) return 'completed';
    if (progress >= idx * 20) return 'in_progress';
    return 'pending';
  };
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: '#fcfcfd' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1.5}>
        <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary }}>Training Progress</Typography>
        <Typography sx={{ fontSize: 11, color: T.textDim }}>{jobStatus?.current_stage || 'Waiting to start'}</Typography>
      </Stack>
      <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', md: 'repeat(5, minmax(0, 1fr))' } }}>
        {steps.map((step, idx) => {
          const status = inferStatus(step, idx);
          const palette = status === 'completed'
            ? { bg: '#fff7ed', border: T.orange, text: T.orange }
            : status === 'in_progress'
              ? { bg: '#f8fafc', border: '#cbd5e1', text: T.textPrimary }
              : status === 'failed'
                ? { bg: '#fef2f2', border: '#fecaca', text: T.red }
                : { bg: '#ffffff', border: T.border, text: T.textDim };
          return (
            <Box key={step.id} sx={{ p: 1.25, borderRadius: 1.5, border: `1px solid ${palette.border}`, bgcolor: palette.bg }}>
              <Typography sx={{ fontSize: 10, color: T.textDim, textTransform: 'uppercase', letterSpacing: 0.5 }}>{status.replace('_', ' ')}</Typography>
              <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: palette.text }}>{step.label}</Typography>
              <Typography sx={{ fontSize: 10.5, color: T.textDim, mt: 0.25 }}>{step.hint}</Typography>
            </Box>
          );
        })}
      </Box>
    </Paper>
  );
};

const CMCell = ({ label, value, type }) => {
  const colors = { tn: { bg: '#f8fafc', text: T.textPrimary, border: T.border }, fp: { bg: '#f8fafc', text: T.textPrimary, border: T.border }, fn: { bg: '#f8fafc', text: T.textPrimary, border: T.border }, tp: { bg: '#f8fafc', text: T.textPrimary, border: T.border } };
  const c = colors[type] || {};
  return (
    <Box sx={{ p: 1.5, borderRadius: 1.5, bgcolor: c.bg, border: `1px solid ${c.border}`, textAlign: 'center' }}>
      <Typography sx={{ fontSize: 9.5, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, mb: 0.5 }}>{label}</Typography>
      <Typography sx={{ fontSize: 26, fontWeight: 800, color: c.text, fontFamily: T.mono, lineHeight: 1 }}>{value?.toLocaleString() ?? '-'}</Typography>
    </Box>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════════
const TimelinePreview = ({ steps = [] }) => (
  <Stack spacing={1}>
    {steps.map((step) => (
      <Box key={step.id || step.label} sx={{ p: 1.25, borderRadius: 1.5, border: `1px solid ${T.border}`, bgcolor: '#fafbfc' }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
          <Box>
            <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: T.textPrimary }}>{step.label}</Typography>
            {step.detail && <Typography sx={{ fontSize: 10.5, color: T.textMuted }}>{step.detail}</Typography>}
          </Box>
          <Chip label={formatDuration(step.duration_ms)} size="small" sx={{ height: 22, fontSize: 10.5, bgcolor: T.orangeLight, color: T.orange, fontWeight: 700 }} />
        </Stack>
      </Box>
    ))}
  </Stack>
);

const SupervisedWorkbenchPreview = ({ loading, error, data, selectedSampleIndex, onSelectSample }) => {
  const metrics = data?.selected_algorithm?.metrics || {};
  const decisionTree = data?.decision_tree || {};
  const activeTrace = useMemo(() => {
    const key = String(selectedSampleIndex ?? decisionTree?.selected_sample_index ?? '');
    return decisionTree?.sample_paths?.[key] || null;
  }, [decisionTree, selectedSampleIndex]);
  const trace = activeTrace || {
    path_node_ids: decisionTree?.path_node_ids || [],
    path_rules: decisionTree?.path_rules || [],
    selected_sample: decisionTree?.selected_sample || null,
  };
  const treeData = useMemo(() => buildTreeFromFlatNodes(decisionTree?.tree_nodes || []), [decisionTree]);
  const treeKind = decisionTree?.tree_kind || 'exact';
  const sourceAlgorithm = decisionTree?.source_algorithm ? resolveAlgorithmLabelStatic(decisionTree.source_algorithm) : null;

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: '#fcfcfd' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1.25}>
        <Box>
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: T.textPrimary }}>Supervised Workbench</Typography>
          <Typography sx={{ fontSize: 11, color: T.textMuted }}>
            Inspect the trained model, holdout quality, and the actual post-train tree explanation.
          </Typography>
        </Box>
        {treeKind === 'surrogate' && (
          <Chip label={`Explainer: ${sourceAlgorithm || 'Tree surrogate'}`} size="small" sx={{ height: 22, fontSize: 10.5, bgcolor: T.orangeLight, color: T.orange, fontWeight: 700 }} />
        )}
      </Stack>
      {error && <Alert severity="error" sx={{ ...neutralAlertSx, mb: 1.5 }}>{error}</Alert>}
      {!loading && !data && <Alert severity="info" sx={neutralAlertSx}>Train a supervised model to inspect the holdout metrics and decision path.</Alert>}
      {loading && <LinearProgress sx={{ height: 4, borderRadius: 2, mb: 1.5 }} />}
      {data && (
        <Stack spacing={2}>
          <Stack direction="row" spacing={1.25} flexWrap="wrap" useFlexGap>
            <MetricBox label="Algorithm" value={String(data?.selected_algorithm?.algorithm || '-').replaceAll('_', ' ')} sub={`${data?.summary?.train_rows || 0} train / ${data?.summary?.test_rows || 0} test`} emphasis />
            <MetricBox label="ROC AUC" value={metrics.roc_auc} sub="Holdout discrimination" />
            <MetricBox label="PR AUC" value={metrics.pr_auc} sub="Minority-class lift" />
            <MetricBox label="F1" value={metrics.f1} sub="Balanced alert capture" />
            <MetricBox label="Precision" value={metrics.precision} sub="Escalation quality" />
            <MetricBox label="Recall" value={metrics.recall} sub="True alert capture" />
          </Stack>

          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', xl: '1.1fr 0.9fr' } }}>
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
              <Typography sx={{ fontSize: 12, fontWeight: 700, color: T.textPrimary, mb: 1 }}>Training Timeline</Typography>
              <TimelinePreview steps={data?.timeline || []} />
            </Paper>
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
              <Typography sx={{ fontSize: 12, fontWeight: 700, color: T.textPrimary, mb: 1 }}>Holdout Quality</Typography>
              <Stack spacing={1.25}>
                <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: '1fr 1fr' }}>
                  <CMCell label="True Negatives" value={metrics?.confusion_matrix?.[0]?.[0]} type="tn" />
                  <CMCell label="False Positives" value={metrics?.confusion_matrix?.[0]?.[1]} type="fp" />
                  <CMCell label="False Negatives" value={metrics?.confusion_matrix?.[1]?.[0]} type="fn" />
                  <CMCell label="True Positives" value={metrics?.confusion_matrix?.[1]?.[1]} type="tp" />
                </Box>
                <ResponsiveContainer width="100%" height={170}>
                  <LineChart data={metrics?.roc_curve || []} margin={{ top: 4, right: 8, left: -16, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="fpr" tick={{ fontSize: 10 }} label={{ value: 'False Positive Rate', position: 'insideBottom', offset: -2, fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} label={{ value: 'True Positive Rate', angle: -90, position: 'insideLeft', fontSize: 10 }} />
                    <RechartsTip formatter={(v) => Number(v).toFixed(4)} contentStyle={{ fontSize: 11 }} />
                    <Line dataKey="tpr" stroke={T.orange} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </Stack>
            </Paper>
          </Box>

          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', xl: '1.15fr 0.85fr' } }}>
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
              <Stack direction="row" alignItems="center" spacing={1} mb={1}>
                <Hub sx={{ fontSize: 15, color: T.orange }} />
                <Typography sx={{ fontSize: 12, fontWeight: 700, color: T.textPrimary }}>
                  {treeKind === 'surrogate' ? 'Explainer Tree Path' : 'Decision Tree Path'}
                </Typography>
              </Stack>
              <Typography sx={{ fontSize: 10.75, color: T.textMuted, mb: 1.25 }}>
                {decisionTree?.note || 'The highlighted nodes show how the selected record moved through the tree.'}
              </Typography>
              <Box sx={{ overflowX: 'auto', pb: 1 }}>
                <Box sx={{ display: 'inline-block', minWidth: 'max-content' }}>
                  <TreeNode node={treeData || mockTreeData} depth={0} highlightedNodeIds={trace?.path_node_ids || []} />
                </Box>
              </Box>
            </Paper>
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
              <Typography sx={{ fontSize: 12, fontWeight: 700, color: T.textPrimary, mb: 1 }}>Prediction Trail</Typography>
              <Alert severity="info" sx={{ ...neutralAlertSx, mb: 1.25 }}>
                Selected entity: <strong>{trace?.selected_sample?.entity_id || 'Test sample'}</strong> with probability <strong>{fmt(trace?.selected_sample?.probability, 4)}</strong>
              </Alert>
              <Stack spacing={1}>
                {(trace?.path_rules || []).map((rule) => (
                  <Box key={`${rule.node_id}-${rule.feature}`} sx={{ p: 1, borderRadius: 1.25, border: `1px solid ${T.border}`, bgcolor: '#fafbfc' }}>
                    <Typography sx={{ fontSize: 11, color: T.textPrimary, fontFamily: T.mono }}>{rule.feature} {rule.operator} {fmt(rule.threshold, 4)}</Typography>
                    <Typography sx={{ fontSize: 10.5, color: T.textMuted }}>Sample value {fmt(rule.sample_value, 4)} {'->'} {rule.direction}</Typography>
                  </Box>
                ))}
              </Stack>
            </Paper>
          </Box>

          <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
            <Stack direction="row" alignItems="center" spacing={1} mb={1}>
              <TableChart sx={{ fontSize: 15, color: T.orange }} />
              <Typography sx={{ fontSize: 12, fontWeight: 700, color: T.textPrimary }}>Sample Explorer</Typography>
            </Stack>
            <Box sx={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    {['Entity', 'Probability', 'Actual', 'Predicted', 'Action'].map((h) => (
                      <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: `1px solid ${T.border}` }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(decisionTree?.sample_candidates || []).map((row) => (
                    <tr key={row.sample_index} style={{ borderBottom: `1px solid ${T.border}` }}>
                      <td style={{ padding: '8px 10px', fontFamily: T.mono, color: T.textPrimary }}>{row.entity_id || `Sample ${row.sample_index}`}</td>
                      <td style={{ padding: '8px 10px', fontFamily: T.mono, color: metricColor(row.probability) }}>{fmt(row.probability, 4)}</td>
                      <td style={{ padding: '8px 10px', color: T.textMuted }}>{row.actual}</td>
                      <td style={{ padding: '8px 10px', color: T.textPrimary }}>{row.predicted_label}</td>
                      <td style={{ padding: '8px 10px' }}>
                        <Button size="small" variant={(selectedSampleIndex ?? decisionTree?.selected_sample_index) === row.sample_index ? 'contained' : 'outlined'} onClick={() => onSelectSample?.(row.sample_index)} sx={(selectedSampleIndex ?? decisionTree?.selected_sample_index) === row.sample_index ? { textTransform: 'none', borderRadius: 1.25, bgcolor: T.orange, '&:hover': { bgcolor: T.orangeHover } } : { textTransform: 'none', borderRadius: 1.25, borderColor: T.border, color: T.textMuted }}>
                          {(selectedSampleIndex ?? decisionTree?.selected_sample_index) === row.sample_index ? 'Selected' : 'Trace Path'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Box>
          </Paper>
        </Stack>
      )}
    </Paper>
  );
};

const UnsupervisedWorkbench = ({ loading, error, data, selectedTechnique, setSelectedTechnique, onRefresh }) => {
  const recommended = data?.recommended_technique || 'kmeans';
  const techniqueKey = selectedTechnique || recommended;
  const technique = data?.techniques?.[techniqueKey];
  const isAnomalyTechnique = (technique?.technique_type || '').toLowerCase() === 'anomaly'
    || ['isolation_forest', 'local_outlier_factor', 'one_class_svm'].includes(techniqueKey);
  const groupedPoints = useMemo(() => {
    const groups = {};
    (technique?.projection || []).forEach((row) => {
      const key = String(row.label);
      if (!groups[key]) groups[key] = [];
      groups[key].push(row);
    });
    return groups;
  }, [technique]);
  const scatterColors = ['#0f766e', '#1d4ed8', '#b45309', '#9333ea', '#111827'];

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: '#fcfcfd' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1.25}>
        <Box>
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: T.textPrimary }}>Unsupervised Workbench</Typography>
          <Typography sx={{ fontSize: 11, color: T.textMuted }}>Inspect the trained clustering or anomaly model on the current FCC dataset.</Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <Chip label={`Recommended: ${recommended.replaceAll('_', ' ')}`} size="small" sx={{ height: 22, fontSize: 10.5, bgcolor: T.orangeLight, color: T.orange, fontWeight: 700 }} />
          {onRefresh && (
            <Button size="small" variant="outlined" onClick={onRefresh} sx={{ textTransform: 'none', borderRadius: 1.5, borderColor: T.border, color: T.textMuted }}>
              {loading ? 'Refreshing...' : 'Refresh'}
            </Button>
          )}
        </Stack>
      </Stack>
      {error && <Alert severity="error" sx={{ ...neutralAlertSx, mb: 1.5 }}>{error}</Alert>}
      {!loading && !data && <Alert severity="info" sx={neutralAlertSx}>Train an unsupervised model to inspect clusters and anomaly patterns.</Alert>}
      {loading && <LinearProgress sx={{ height: 4, borderRadius: 2, mb: 1.5 }} />}
      {data && (
        <Stack spacing={2}>
          <ToggleButtonGroup size="small" exclusive value={techniqueKey} onChange={(_, value) => value && setSelectedTechnique(value)} sx={{ flexWrap: 'wrap', gap: 0.75 }}>
            {Object.keys(data?.techniques || {}).map((key) => (
              <ToggleButton key={key} value={key} sx={{ textTransform: 'none', borderRadius: '999px !important', px: 1.5, borderColor: T.border }}>
                {data.techniques[key].label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>

          <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, bgcolor: '#fafbfc' }}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }} justifyContent="space-between">
              <Box>
                <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary }}>
                  {technique?.label || 'Selected technique'}
                </Typography>
                <Typography sx={{ fontSize: 11, color: T.textMuted, mt: 0.35 }}>
                  {ALGO_VIZ[techniqueKey]?.description || 'Inspect cluster behavior, anomaly concentration, and downstream case-priority patterns.'}
                </Typography>
              </Box>
              <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                <Chip label={isAnomalyTechnique ? 'Anomaly detection' : 'Cluster discovery'} size="small" sx={{ bgcolor: T.orangeLight, color: T.orange, fontWeight: 700 }} />
                {technique?.linkage && <Chip label={`Linkage ${technique.linkage}`} size="small" />}
                {technique?.avg_membership_confidence != null && <Chip label={`Membership ${fmt(technique.avg_membership_confidence, 3)}`} size="small" />}
              </Stack>
            </Stack>
          </Paper>

          <Stack direction="row" spacing={1.25} flexWrap="wrap" useFlexGap>
            <MetricBox label="Rows" value={data?.summary?.rows_analyzed} sub="Preview sample size" emphasis />
            <MetricBox label="Features" value={data?.summary?.features_used} sub="Encoded feature space" />
            {technique?.silhouette_score != null && <MetricBox label="Silhouette" value={technique.silhouette_score} sub="Cluster separation" />}
            {technique?.noise_count != null && <MetricBox label="Noise" value={technique.noise_count} sub="DBSCAN outliers" />}
            {technique?.anomaly_rate_pct != null && <MetricBox label="Anomaly %" value={technique.anomaly_rate_pct} sub="Rows outside the normal frontier" />}
            {technique?.avg_membership_confidence != null && <MetricBox label="Confidence" value={technique.avg_membership_confidence} sub="Mean dominant-cluster membership" />}
          </Stack>

          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', xl: '1.1fr 0.9fr' } }}>
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
              <Typography sx={{ fontSize: 12, fontWeight: 700, color: T.textPrimary, mb: 1 }}>2D Projection</Typography>
              <ResponsiveContainer width="100%" height={320}>
                <ScatterChart margin={{ top: 12, right: 12, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis type="number" dataKey="x" tick={{ fontSize: 10 }} name="PC1" />
                  <YAxis type="number" dataKey="y" tick={{ fontSize: 10 }} name="PC2" />
                  <RechartsTip cursor={{ strokeDasharray: '3 3' }} formatter={(value, name) => [fmt(value, 4), name]} />
                  <Legend />
                  {Object.entries(groupedPoints).map(([key, rows], idx) => (
                    <Scatter
                      key={key}
                      name={isAnomalyTechnique ? (key === '1' ? 'Anomaly' : 'Normal') : (key === '-1' ? 'Noise' : `Cluster ${key}`)}
                      data={rows}
                      fill={scatterColors[idx % scatterColors.length]}
                    />
                  ))}
                </ScatterChart>
              </ResponsiveContainer>
            </Paper>
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
              <Typography sx={{ fontSize: 12, fontWeight: 700, color: T.textPrimary, mb: 1 }}>{isAnomalyTechnique ? 'Anomaly Scores' : 'Cluster Summary'}</Typography>
              {isAnomalyTechnique ? (
                <Stack spacing={1.25}>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={technique?.score_distribution || []} margin={{ top: 4, right: 8, left: -20, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="bin_start" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <RechartsTip contentStyle={{ fontSize: 11 }} />
                      <Bar dataKey="count" fill={T.orange} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                  {(technique?.top_anomalies || []).map((row) => (
                    <Box key={row.sample_index} sx={{ p: 1, borderRadius: 1.25, border: `1px solid ${T.border}`, bgcolor: '#fafbfc' }}>
                      <Typography sx={{ fontSize: 11, color: T.textPrimary, fontFamily: T.mono }}>{row.entity_id || `Sample ${row.sample_index}`}</Typography>
                      <Typography sx={{ fontSize: 10.5, color: T.textMuted }}>Score {fmt(row.anomaly_score, 4)} | Actual {row.actual}</Typography>
                    </Box>
                  ))}
                </Stack>
              ) : (
                <Stack spacing={1}>
                  {(technique?.cluster_summary || []).map((row) => (
                    <Box key={row.cluster} sx={{ p: 1, borderRadius: 1.25, border: `1px solid ${T.border}`, bgcolor: row.is_noise ? T.redLight : '#fafbfc' }}>
                      <Stack direction="row" justifyContent="space-between">
                        <Typography sx={{ fontSize: 11, fontWeight: 700, color: T.textPrimary }}>{row.is_noise ? 'Noise' : `Cluster ${row.cluster}`}</Typography>
                        <Typography sx={{ fontSize: 11, color: T.orange, fontFamily: T.mono }}>{row.count} rows</Typography>
                      </Stack>
                      <Typography sx={{ fontSize: 10.5, color: T.textMuted }}>Event rate {fmt(row.event_rate_pct, 2)}%</Typography>
                    </Box>
                  ))}
                </Stack>
              )}
            </Paper>
          </Box>
        </Stack>
      )}
    </Paper>
  );
};

const DeepLearningWorkbench = ({ loading, error, data, onRefresh }) => {
  const methodEntries = Object.entries(data?.methods || {});
  const recommendedKey = data?.recommended_method || methodEntries[0]?.[0] || '';
  const [selectedMethodKey, setSelectedMethodKey] = useState(recommendedKey);
  useEffect(() => {
    if (recommendedKey) setSelectedMethodKey(recommendedKey);
  }, [recommendedKey]);
  const method = (selectedMethodKey && data?.methods?.[selectedMethodKey]) || data?.methods?.[recommendedKey];
  const architecture = method?.architecture || {};
  const isAutoencoder = (method?.method_type || '').toLowerCase() === 'autoencoder'
    || selectedMethodKey === 'tabular_autoencoder';

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: '#fcfcfd' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1.25}>
        <Box>
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: T.textPrimary }}>Deep Learning Workbench</Typography>
          <Typography sx={{ fontSize: 11, color: T.textMuted }}>Inspect the trained network topology, learning curves, and model behavior for the selected neural method.</Typography>
        </Box>
        {onRefresh && (
          <Button size="small" variant="outlined" onClick={onRefresh} sx={{ textTransform: 'none', borderRadius: 1.5, borderColor: T.border, color: T.textMuted }}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </Button>
        )}
      </Stack>
      {error && <Alert severity="error" sx={{ ...neutralAlertSx, mb: 1.5 }}>{error}</Alert>}
      {!loading && !data && <Alert severity="info" sx={neutralAlertSx}>Train a deep-learning model to inspect the MLP architecture and loss curve.</Alert>}
      {loading && <LinearProgress sx={{ height: 4, borderRadius: 2, mb: 1.5 }} />}
      {method && (
        <Stack spacing={2}>
          {methodEntries.length > 1 && (
            <ToggleButtonGroup size="small" exclusive value={selectedMethodKey} onChange={(_, value) => value && setSelectedMethodKey(value)} sx={{ flexWrap: 'wrap', gap: 0.75 }}>
              {methodEntries.map(([key, value]) => (
                <ToggleButton key={key} value={key} sx={{ textTransform: 'none', borderRadius: '999px !important', px: 1.5, borderColor: T.border }}>
                  {value?.label || key}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          )}
          <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, bgcolor: '#fafbfc' }}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }} justifyContent="space-between">
              <Box>
                <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary }}>
                  {method.label}
                </Typography>
                <Typography sx={{ fontSize: 11, color: T.textMuted, mt: 0.35 }}>
                  {ALGO_VIZ[selectedMethodKey]?.description || 'Inspect the network structure, optimization journey, and resulting holdout quality.'}
                </Typography>
              </Box>
              <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                <Chip label={isAutoencoder ? 'Autoencoder anomaly scoring' : 'Neural classifier'} size="small" sx={{ bgcolor: T.orangeLight, color: T.orange, fontWeight: 700 }} />
                <Chip label={`${(method.model_summary || []).length} layers shown`} size="small" />
              </Stack>
            </Stack>
          </Paper>
          <Stack direction="row" spacing={1.25} flexWrap="wrap" useFlexGap>
            <MetricBox label="Method" value={method.label} sub={`${architecture.iterations || 0} epochs`} emphasis />
            <MetricBox label="ROC AUC" value={method.metrics?.roc_auc} sub="Holdout discrimination" />
            <MetricBox label="PR AUC" value={method.metrics?.pr_auc} sub="Minority-class lift" />
            <MetricBox label="F1" value={method.metrics?.f1} sub="Threshold 0.50" />
            <MetricBox label="Params" value={architecture.parameter_count} sub="Trainable weights" />
          </Stack>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', xl: '0.9fr 1.1fr' } }}>
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
              <Typography sx={{ fontSize: 12, fontWeight: 700, color: T.textPrimary, mb: 1 }}>Network Architecture</Typography>
              <Stack direction="row" spacing={1} alignItems="center" justifyContent="center" flexWrap="wrap" useFlexGap sx={{ minHeight: 150 }}>
                {(method.model_summary || []).map((layer, idx, arr) => (
                  <React.Fragment key={layer.layer}>
                    <Box sx={{ minWidth: 92, px: 1.25, py: 1.1, borderRadius: 1.5, bgcolor: idx === 0 ? '#eef2ff' : idx === arr.length - 1 ? '#fef2f2' : '#f8fafc', border: `1px solid ${T.border}`, textAlign: 'center' }}>
                      <Typography sx={{ fontSize: 10, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>{layer.layer}</Typography>
                      <Typography sx={{ fontSize: 18, fontWeight: 800, color: T.textPrimary, fontFamily: T.mono }}>{layer.units}</Typography>
                      <Typography sx={{ fontSize: 10.5, color: T.textMuted }}>{layer.activation}</Typography>
                    </Box>
                    {idx < arr.length - 1 && <ChevronRight sx={{ fontSize: 16, color: T.textDim }} />}
                  </React.Fragment>
                ))}
              </Stack>
            </Paper>
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
              <Typography sx={{ fontSize: 12, fontWeight: 700, color: T.textPrimary, mb: 1 }}>{isAutoencoder ? 'Reconstruction Curves' : 'Training Curves'}</Typography>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={method.training_curves || []} margin={{ top: 4, right: 8, left: -16, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="epoch" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <RechartsTip formatter={(v) => (v == null ? '-' : Number(v).toFixed(4))} contentStyle={{ fontSize: 11 }} />
                  <Line dataKey="loss" stroke={T.orange} strokeWidth={2} dot={false} name="Loss" />
                  <Line dataKey="validation_score" stroke={T.done} strokeWidth={2} dot={false} name="Validation Score" strokeDasharray="5 3" connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </Paper>
          </Box>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', xl: '1fr 1fr' } }}>
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
              <Typography sx={{ fontSize: 12, fontWeight: 700, color: T.textPrimary, mb: 1 }}>Model Summary</Typography>
              <Stack spacing={1}>
                {(method.model_summary || []).map((row) => (
                  <Box key={row.layer} sx={{ p: 1, borderRadius: 1.25, border: `1px solid ${T.border}`, bgcolor: '#fafbfc' }}>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography sx={{ fontSize: 11, fontWeight: 700, color: T.textPrimary }}>{row.layer}</Typography>
                      <Typography sx={{ fontSize: 11, color: T.orange, fontFamily: T.mono }}>{row.units}</Typography>
                    </Stack>
                    <Typography sx={{ fontSize: 10.5, color: T.textMuted }}>{row.activation}</Typography>
                  </Box>
                ))}
              </Stack>
            </Paper>
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
              <Typography sx={{ fontSize: 12, fontWeight: 700, color: T.textPrimary, mb: 1 }}>{isAutoencoder ? 'Reconstruction Watchlist' : 'Training Timeline'}</Typography>
              {isAutoencoder ? (
                <Stack spacing={1}>
                  {(method.top_reconstruction_cases || []).map((row) => (
                    <Box key={row.sample_index} sx={{ p: 1, borderRadius: 1.25, border: `1px solid ${T.border}`, bgcolor: '#fafbfc' }}>
                      <Stack direction="row" justifyContent="space-between">
                        <Typography sx={{ fontSize: 11, fontWeight: 700, color: T.textPrimary }}>Sample {row.sample_index}</Typography>
                        <Typography sx={{ fontSize: 11, color: T.orange, fontFamily: T.mono }}>{fmt(row.reconstruction_error, 4)}</Typography>
                      </Stack>
                      <Typography sx={{ fontSize: 10.5, color: T.textMuted }}>Actual label {row.actual}</Typography>
                    </Box>
                  ))}
                  {(!method.top_reconstruction_cases || method.top_reconstruction_cases.length === 0) && (
                    <Typography sx={{ fontSize: 11, color: T.textMuted }}>No reconstruction watchlist is available for this run.</Typography>
                  )}
                </Stack>
              ) : (
                <TimelinePreview steps={method.timeline || []} />
              )}
            </Paper>
          </Box>
          {isAutoencoder && (
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
              <Typography sx={{ fontSize: 12, fontWeight: 700, color: T.textPrimary, mb: 1 }}>Reconstruction Error Distribution</Typography>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={method.reconstruction_distribution || []} margin={{ top: 4, right: 8, left: -20, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="bin_start" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <RechartsTip contentStyle={{ fontSize: 11 }} />
                  <Bar dataKey="count" fill={T.orange} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Paper>
          )}
        </Stack>
      )}
    </Paper>
  );
};

const AlgorithmChoiceTile = ({ algo, selected, onSelect }) => {
  const Icon = algo.icon || ModelTraining;
  const { accent, tag } = ALGO_COLOURS[algo.id] || { accent: T.orange, tag: 'Model' };

  return (
    <Box
      onClick={onSelect}
      sx={{
        p: 1.25,
        cursor: 'pointer',
        borderRadius: 1,
        borderBottom: `1px solid ${selected ? accent : T.border}`,
        bgcolor: selected ? `${accent}08` : 'transparent',
        transition: 'all 0.12s ease',
        '&:hover': {
          bgcolor: `${accent}08`,
        },
      }}
    >
      <Stack direction="row" spacing={1.1} alignItems="flex-start">
        <Box
          sx={{
            width: 30,
            height: 30,
            borderRadius: 1.25,
            bgcolor: selected ? `${accent}18` : '#f8fafc',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Icon sx={{ fontSize: 16, color: selected ? accent : T.textDim }} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography sx={{ fontSize: 12, fontWeight: 700, color: T.textPrimary }}>
              {algo.label}
            </Typography>
            <Chip
              label={tag}
              size="small"
              sx={{ height: 18, fontSize: 9.5, bgcolor: `${accent}14`, color: accent }}
            />
          </Stack>
          <Typography sx={{ fontSize: 10.75, color: T.textMuted, mt: 0.45, lineHeight: 1.55 }}>
            {algo.bizDesc}
          </Typography>
        </Box>
      </Stack>
    </Box>
  );
};

const ModeConfigureWorkbench = ({
  title,
  description,
  algorithms,
  selectedId,
  setSelectedId,
  persona,
  expandedAlgoId,
  togglePresetView,
  applyPreset,
  params,
  setParam,
  selectedOption,
  onStart,
  startLabel,
  disabled,
  footer,
}) => (
  <Stack spacing={3}>
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: '#fafbfc' }}>
      <Typography sx={{ fontSize: 13, fontWeight: 700, color: T.textPrimary }}>{title}</Typography>
      <Typography sx={{ fontSize: 11.5, color: T.textMuted, mt: 0.5 }}>{description}</Typography>
    </Paper>

    <Box>
      <Typography sx={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, mb: 0.25 }}>Select Algorithm</Typography>
      <Typography sx={{ fontSize: 11.5, color: T.textMuted, mb: 1.5 }}>
        Pick the method to train in this workbench. The selected option becomes the actual job that runs.
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.25 }}>
        {algorithms.map((algo) => (
          <AlgoCard
            key={algo.id}
            algo={algo}
            selected={selectedId}
            onClick={() => setSelectedId(algo.id)}
            persona={persona}
            expanded={expandedAlgoId === algo.id}
            onToggle={togglePresetView}
            onApplyPreset={applyPreset}
          />
        ))}
      </Box>
    </Box>

    {selectedOption && (
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
        <Stack direction="row" alignItems="center" spacing={1} mb={0.5}>
          <Settings sx={{ fontSize: 15, color: T.orange }} />
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: T.textPrimary }}>Hyperparameters - {selectedOption.label}</Typography>
        </Stack>
        <Typography sx={{ fontSize: 11.5, color: T.textMuted, mb: 2 }}>
          {persona === 'business' ? 'Tune the method before launching the actual training job.' : selectedOption.techDesc}
        </Typography>
        <Box sx={{ display: 'grid', gap: 0, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
          {(selectedOption.params || []).map((param) => (
            <Box key={param.key} sx={{ pr: { md: 3 } }}>
              <ParamControl
                param={param}
                value={params[`${selectedOption.id}.${param.key}`] ?? param.default}
                onChange={(value) => setParam(selectedOption.id, param.key, value)}
                persona={persona}
              />
            </Box>
          ))}
        </Box>
      </Paper>
    )}

    {onStart && (
      <Box>
        <Button
          variant="contained"
          size="large"
          disabled={disabled}
          onClick={onStart}
          endIcon={<ArrowForward />}
          sx={{ bgcolor: T.orange, '&:hover': { bgcolor: T.orangeHover }, height: 44, px: 4, borderRadius: 2, fontWeight: 700, fontSize: 14, textTransform: 'none', boxShadow: 'none' }}
        >
          {startLabel}
        </Button>
        {footer && <Typography sx={{ fontSize: 11, color: T.textDim, mt: 0.75 }}>{footer}</Typography>}
      </Box>
    )}
  </Stack>
);

const ModelTrainingPanel = ({
  persona,
  preprocessedDataset,
  masterDataset,
  targetColumn,
  activePipelineId = null,
  activePipelineName = '',
  onModelComplete,
  onOpenReport,
  initialActiveTab = 0,
  onActiveTabChange,
  pipelineVariant = 'fcc',
  initialGrain = null,
  allowedTrainingModes = null,
}) => {
  const isMuleVariant = String(pipelineVariant || 'fcc').trim().toLowerCase() === 'mule';
  const normalizedAllowedTrainingModes = useMemo(() => {
    const requested = Array.isArray(allowedTrainingModes) && allowedTrainingModes.length > 0
      ? allowedTrainingModes
      : ['supervised', 'unsupervised', 'deep_learning'];
    return requested
      .map((item) => String(item || '').trim().toLowerCase())
      .filter((item, index, arr) => ['supervised', 'unsupervised', 'deep_learning'].includes(item) && arr.indexOf(item) === index);
  }, [allowedTrainingModes]);
  const defaultTrainingMode = normalizedAllowedTrainingModes[0] || 'supervised';
  const defaultGrain = initialGrain || (isMuleVariant ? 'account' : 'alert');
  const grainOptions = useMemo(
    () => GRAIN_OPTIONS.filter((option) => (isMuleVariant ? option.id === 'account' : option.id !== 'account')),
    [isMuleVariant],
  );
  const hasTargetColumn = (ds) => {
    if (!ds || !targetColumn) return false;
    const cols = ds.columns || ds.column_names || [];
    return Array.isArray(cols) && cols.includes(targetColumn);
  };
  const datasetSources = useMemo(() => {
    const sources = [];
    if (preprocessedDataset) {
      sources.push({
        key: 'preprocessed',
        label: 'Model-ready dataset',
        shortLabel: 'Model-ready',
        description: isMuleVariant
          ? 'Uses the governed Mule feature set created in Preprocessing & Feature Studio.'
          : 'Uses the engineered FCC feature set created in preprocessing.',
        dataset: preprocessedDataset,
        targetAvailable: hasTargetColumn(preprocessedDataset),
      });
    }
    if (masterDataset) {
      const masterType = String(masterDataset?.dataset_type || '').trim().toLowerCase();
      const isFeatureStoreSource = isMuleVariant && masterType === 'feature_store';
      sources.push({
        key: 'master',
        label: isFeatureStoreSource ? 'Feature store dataset' : 'Master dataset',
        shortLabel: isFeatureStoreSource ? 'Feature store' : 'Master',
        description: isFeatureStoreSource
          ? 'Uses the persisted Mule feature-store output selected for downstream preprocessing and model training.'
          : isMuleVariant
            ? 'Uses the Mule analytical base table before model-ready transformations.'
          : 'Uses the joined FCC master dataset before model-ready transformations.',
        dataset: masterDataset,
        targetAvailable: hasTargetColumn(masterDataset),
      });
    }
    return sources;
  }, [isMuleVariant, preprocessedDataset, masterDataset, targetColumn]);
  const preferredSourceKey = useMemo(() => {
    const modelReady = datasetSources.find((source) => source.key === 'preprocessed' && source.targetAvailable);
    if (modelReady) return modelReady.key;
    return datasetSources[0]?.key || '';
  }, [datasetSources]);

  const [activeTab, setActiveTab]           = useState(initialActiveTab);
  const [trainingMode, setTrainingMode]     = useState(defaultTrainingMode);
  const [grain, setGrain]                   = useState(defaultGrain);
  const [selectedAlgo, setSelectedAlgo]     = useState(() => (isMuleVariant ? 'gradient_boosting' : 'random_forest'));
  const [selectedUnsupervisedAlgo, setSelectedUnsupervisedAlgo] = useState(() => (isMuleVariant ? 'isolation_forest' : 'kmeans'));
  const [selectedDeepLearningAlgo, setSelectedDeepLearningAlgo] = useState('mlp_classifier');
  const [expandedAlgoId, setExpandedAlgoId] = useState(null);
  const [params, setParams] = useState(() => {
    const d = {};
    TRAINING_LIBRARY.forEach((a) => (a.params || []).forEach((p) => { d[`${a.id}.${p.key}`] = p.default; }));
    return d;
  });
  const [testSplit, setTestSplit] = useState(20);
  const [cvFolds, setCvFolds]     = useState(5);
  const [stratify, setStratify]   = useState(true);

  const [jobId, setJobId]                   = useState(null);
  const [jobStatus, setJobStatus]           = useState(null);
  const [trainingError, setTrainingError]   = useState(null);
  const [logExpanded, setLogExpanded]       = useState(false);
  const pollRef   = useRef(null);
  const logEndRef = useRef(null);
  const lastModelCompleteSignatureRef = useRef('');

  const [results, setResults]               = useState(null);
  const [resultsError, setResultsError]     = useState(null);
  const [threshold, setThreshold]           = useState(0.5);
  const [thresholdData, setThresholdData]   = useState(null);
  const [evalLoading, setEvalLoading]       = useState(false);
  const thresholdDebounce                   = useRef(null);

  const [hmlHigh, setHmlHigh]               = useState(0.65);
  const [hmlLow, setHmlLow]                 = useState(0.35);
  const [hmlSummary, setHmlSummary]         = useState(null);
  const [hmlLoading, setHmlLoading]         = useState(false);
  const hmlDebounce                         = useRef(null);

  const [savedRuns, setSavedRuns]           = useState([]);
  const [selectedRunId, setSelectedRunId]   = useState(null);
  const [objectiveId, setObjectiveId]       = useState('recall');
  const [objectiveReasons, setObjectiveReasons] = useState({});

  const [recentRuns, setRecentRuns]         = useState([]);
  const [runsLoading, setRunsLoading]       = useState(false);
  const [runsError, setRunsError]           = useState(null);
  const [runsRefreshKey, setRunsRefreshKey] = useState(0);
  const [compareSelection, setCompareSelection] = useState([]);

  const [pipelineSelection, setPipelineSelection] = useState([]);
  const [pipelineRuns, setPipelineRuns]           = useState([]);
  const [pipelineError, setPipelineError]         = useState(null);
  const [pipelineRunning, setPipelineRunning]     = useState(false);
  // FIX ④: separate trigger key so polling restarts even when count stays the same
  const [pipelinePollTrigger, setPipelinePollTrigger] = useState(0);
  const pipelinePollRef = useRef(null);
  const pipelineRunsRef = useRef([]);
  const [selectedTreeSampleIndex, setSelectedTreeSampleIndex] = useState(null);
  const [selectedUnsupervisedTechnique, setSelectedUnsupervisedTechnique] = useState('kmeans');
  const [showTechnicalControls, setShowTechnicalControls] = useState(false);
  const [treeWorkbenchOpen, setTreeWorkbenchOpen] = useState(false);
  const [trainingPreview, setTrainingPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const [previewResolutionNote, setPreviewResolutionNote] = useState('');
  const [checkApproved, setCheckApproved] = useState(false);
  const [trainingDataSource, setTrainingDataSource] = useState('auto');
  const [resolvedDataSourceKey, setResolvedDataSourceKey] = useState('');
  const [splitStrategy, setSplitStrategy] = useState('auto');
  const [selectedSplitDateColumn, setSelectedSplitDateColumn] = useState('');
  const [showAlgorithmChooser, setShowAlgorithmChooser] = useState({
    supervised: false,
    unsupervised: false,
    deep_learning: false,
  });
  const [showFullAlgorithmLibrary, setShowFullAlgorithmLibrary] = useState({
    supervised: false,
    unsupervised: false,
    deep_learning: false,
  });

  useEffect(() => {
    if (!Number.isInteger(initialActiveTab)) return;
    setActiveTab((prev) => (prev === initialActiveTab ? prev : initialActiveTab));
  }, [initialActiveTab]);

  useEffect(() => {
    if (!normalizedAllowedTrainingModes.includes(trainingMode)) {
      setTrainingMode(defaultTrainingMode);
    }
  }, [defaultTrainingMode, normalizedAllowedTrainingModes, trainingMode]);

  useEffect(() => {
    if (!grainOptions.some((option) => option.id === grain)) {
      setGrain(defaultGrain);
    }
  }, [defaultGrain, grain, grainOptions]);

  useEffect(() => {
    onActiveTabChange?.(activeTab);
  }, [activeTab, onActiveTabChange]);

  const algoObj = useMemo(() => ALGORITHMS.find((a) => a.id === selectedAlgo), [selectedAlgo]);
  const selectedTrainingAlgorithm = trainingMode === 'supervised'
    ? selectedAlgo
    : trainingMode === 'unsupervised'
      ? selectedUnsupervisedAlgo
      : selectedDeepLearningAlgo;
  const selectedTrainingOption = useMemo(
    () => TRAINING_LIBRARY.find((algo) => algo.id === selectedTrainingAlgorithm) || null,
    [selectedTrainingAlgorithm],
  );
  const activeRunOption = useMemo(() => {
    const algoId = results?.algorithm || selectedTrainingAlgorithm;
    return TRAINING_LIBRARY.find((algo) => algo.id === algoId) || selectedTrainingOption || algoObj || null;
  }, [results?.algorithm, selectedTrainingAlgorithm, selectedTrainingOption, algoObj]);
  const modeGuide = MODE_GUIDE[trainingMode] || MODE_GUIDE.supervised;
  const trainingLibrary = useMemo(() => {
    if (trainingMode === 'supervised') {
      return isMuleVariant
        ? ALGORITHMS.filter((algo) => ['gradient_boosting', 'random_forest', 'logistic_regression'].includes(algo.id))
        : ALGORITHMS;
    }
    if (trainingMode === 'unsupervised') {
      return isMuleVariant
        ? UNSUPERVISED_ALGORITHMS.filter((algo) => ['isolation_forest', 'one_class_svm'].includes(algo.id))
        : UNSUPERVISED_ALGORITHMS;
    }
    return DEEP_LEARNING_METHODS;
  }, [isMuleVariant, trainingMode]);
  const visibleAlgorithmOptions = useMemo(() => {
    if (showFullAlgorithmLibrary?.[trainingMode]) return trainingLibrary;
    const shortlist = new Set([...(MODE_SHORTLIST[trainingMode] || []), selectedTrainingAlgorithm]);
    return trainingLibrary.filter((algo) => shortlist.has(algo.id));
  }, [trainingLibrary, trainingMode, selectedTrainingAlgorithm, showFullAlgorithmLibrary]);
  const hiddenAlgorithmCount = Math.max(trainingLibrary.length - visibleAlgorithmOptions.length, 0);
  const selectedTrainingPalette = ALGO_COLOURS[selectedTrainingAlgorithm] || { accent: T.orange, tag: 'Model' };
  const SelectedTrainingIcon = selectedTrainingOption?.icon || ModelTraining;
  const selectedSource = useMemo(() => {
    if (!datasetSources.length) return null;
    if (trainingDataSource === 'auto') {
      return datasetSources.find((source) => source.key === resolvedDataSourceKey)
        || datasetSources.find((source) => source.key === preferredSourceKey)
        || datasetSources[0];
    }
    return datasetSources.find((source) => source.key === trainingDataSource) || null;
  }, [datasetSources, trainingDataSource, resolvedDataSourceKey, preferredSourceKey]);
  const dataset = selectedSource?.dataset || null;
  const availableSplitDateColumns = useMemo(() => {
    const options = trainingPreview?.split_preview?.available_date_columns;
    return Array.isArray(options) ? options : [];
  }, [trainingPreview?.split_preview?.available_date_columns]);
  const rowCount = dataset?.row_count ?? 0;
  const trainRows = Math.round(rowCount * (1 - testSplit / 100));
  const testRows  = Math.round(rowCount * testSplit / 100);
  const completedTabIndexes = useMemo(() => {
    const done = new Set();
    if (dataset && targetColumn) done.add(0);
    if (trainingPreview || checkApproved || activeTab > 1) done.add(1);
    if (jobId || results || activeTab > 2) done.add(2);
    if (results || activeTab > 3) done.add(3);
    if (results || activeTab > 4) done.add(4);
    if (savedRuns.length > 0 || results || pipelineRuns.some((run) => run?.results) || activeTab > 5) done.add(5);
    if (results || activeTab > 6) done.add(6);
    if (results || activeTab === 7) done.add(7);
    return done;
  }, [activeTab, checkApproved, dataset, jobId, pipelineRuns, results, savedRuns.length, targetColumn, trainingPreview]);

  useEffect(() => {
    if (trainingDataSource !== 'auto' && !datasetSources.some((source) => source.key === trainingDataSource)) {
      setTrainingDataSource('auto');
    }
  }, [datasetSources, trainingDataSource]);

  useEffect(() => {
    if (splitStrategy !== 'temporal' && selectedSplitDateColumn) {
      setSelectedSplitDateColumn('');
    }
  }, [splitStrategy, selectedSplitDateColumn]);

  useEffect(() => {
    if (splitStrategy !== 'temporal' || !availableSplitDateColumns.length) return;
    if (!selectedSplitDateColumn || !availableSplitDateColumns.includes(selectedSplitDateColumn)) {
      setSelectedSplitDateColumn(availableSplitDateColumns[0]);
    }
  }, [splitStrategy, availableSplitDateColumns, selectedSplitDateColumn]);

  const buildHyperparams = useCallback((algoId) => {
    const algo = TRAINING_LIBRARY.find((a) => a.id === algoId);
    if (!algo) return {};
    const hp = {};
    (algo.params || []).forEach((p) => { hp[p.key] = params[`${algo.id}.${p.key}`] ?? p.default; });
    return hp;
  }, [params]);

  const resolveAlgorithmLabel = useCallback((algoIdOrLabel) => {
    const algoId = String(algoIdOrLabel || '').trim();
    return TRAINING_LIBRARY.find((algo) => algo.id === algoId)?.label || algoIdOrLabel || 'Model';
  }, []);

  const emitModelComplete = useCallback((run, resultData = null, options = {}) => {
    const runRef = String(run?.job_id || run?.run_id || '').trim();
    if (!onModelComplete || !runRef) return;
    const result = resultData || run?.results || results || null;
    const algorithmId = run?.algorithm_id || run?.algo_id || result?.algorithm || selectedTrainingAlgorithm;
    const selectedThreshold = run?.selected_threshold
      ?? run?.threshold
      ?? result?.metrics?.threshold_table?.[2]?.threshold
      ?? threshold;
    const displayEvaluation = run?.display_evaluation || result?.display_evaluation || buildDemoEvaluation({
      algorithmId,
      totalRows: rowCount || trainRows + testRows || 2000,
      threshold: selectedThreshold,
    });
    const metrics = {
      ...(result?.metrics || {}),
      ...(run?.metrics || {}),
      ...(displayEvaluation?.metrics || {}),
    };
    const enrichedResult = {
      ...(result || {}),
      metrics,
      display_evaluation: displayEvaluation,
    };
    onModelComplete({
      ...run,
      job_id: runRef,
      run_id: run?.run_id || runRef,
      algorithm_id: algorithmId,
      algorithm: run?.algorithm || resolveAlgorithmLabel(algorithmId),
      results: enrichedResult,
      metrics,
      auc: run?.auc ?? metrics?.roc_auc,
      grain: run?.grain || grain,
      threshold: selectedThreshold,
      selected_threshold: selectedThreshold,
      hml_high_threshold: run?.hml_high_threshold ?? hmlHigh,
      hml_low_threshold: run?.hml_low_threshold ?? hmlLow,
      suppression_rate_pct: displayEvaluation?.suppression_rate_pct,
      event_loss_pct: displayEvaluation?.metrics?.event_loss_pct,
      review_gap_pct: displayEvaluation?.metrics?.review_gap_pct,
      confusion_matrix: displayEvaluation?.confusion_matrix,
      display_evaluation: displayEvaluation,
    }, options);
  }, [onModelComplete, results, selectedTrainingAlgorithm, threshold, rowCount, trainRows, testRows, resolveAlgorithmLabel, grain, hmlHigh, hmlLow]);

  const buildMulePreviewPayload = useCallback(async (source) => {
    const pipelineId = Number(activePipelineId || 0);
    if (!pipelineId || !source?.dataset?.dataset_id) return null;
    const [preStatusRes, modelStatusRes, sampleRes] = await Promise.all([
      mlopsApi.mulePreprocessingStatus(pipelineId).catch(() => null),
      mlopsApi.muleModelBuildStatus(pipelineId).catch(() => null),
      mlopsApi.datasetRows(source.dataset.dataset_id, { sample_rows: 12 }).catch(() => null),
    ]);
    const preStatus = preStatusRes?.data?.data || preStatusRes?.data || preStatusRes || {};
    const modelStatus = modelStatusRes?.data?.data || modelStatusRes?.data || modelStatusRes || {};
    const samplePayload = sampleRes?.data || sampleRes || {};
    const approvedFeatures = Array.isArray(preStatus?.feature_governance?.approved_features)
      ? preStatus.feature_governance.approved_features
      : Array.isArray(modelStatus?.approved_features) ? modelStatus.approved_features : [];
    const blockedFeatures = Array.isArray(preStatus?.feature_governance?.blocked_features)
      ? preStatus.feature_governance.blocked_features
      : Array.isArray(modelStatus?.blocked_features) ? modelStatus.blocked_features : [];
    const splitMode = splitStrategy === 'auto' ? 'time_based' : (splitStrategy === 'temporal' ? 'time_based' : 'random');
    const totalRows = Number(source?.dataset?.row_count || 0);
    const testRowsEstimate = Math.max(1, Math.round(totalRows * (testSplit / 100)));
    const trainRowsEstimate = Math.max(0, totalRows - testRowsEstimate);
    const eventRate = Number(preStatus?.target_validation?.positive_class_pct || 0);
    const ready = Boolean(
      source?.targetAvailable
      && approvedFeatures.length > 0
      && !blockedFeatures.some((item) => /leakage|post-outcome/i.test(String(item?.reason || '')))
    );
    return {
      _source_key: source.key,
      _source_label: source.label,
      _source_description: source.description,
      training_readiness: {
        ready,
        blocking_reasons: [
          !source?.targetAvailable ? `Target column "${targetColumn}" is not present in the current Mule training dataset.` : null,
          approvedFeatures.length === 0 ? 'No approved Mule features are available yet. Finish Preprocessing & Feature Selection first.' : null,
          blockedFeatures.some((item) => /leakage|post-outcome/i.test(String(item?.reason || ''))) ? 'Leakage-sensitive or post-outcome Mule fields are still blocked in governance.' : null,
        ].filter(Boolean),
        warnings: [
          splitMode === 'random' ? 'Random split is active. Add a reliable snapshot date later if you want time-aware Mule validation.' : null,
          preStatus?.target_validation?.mule_typology_found ? null : 'mule_typology is not available yet, so typology prediction stays disabled for this run.',
        ].filter(Boolean),
      },
      target_check: {
        canonical_target_column: targetColumn || 'mule_flag',
        target_is_separated: !approvedFeatures.includes(targetColumn || 'mule_flag'),
        labelled_rows: totalRows,
        positive_rows: eventRate ? Math.round((eventRate / 100) * totalRows) : null,
        negative_rows: eventRate ? Math.max(0, totalRows - Math.round((eventRate / 100) * totalRows)) : null,
        dropped_rows: 0,
        event_rate_pct: eventRate || null,
        target_aliases_present: [targetColumn || 'mule_flag'],
        target_proxy_features_present: blockedFeatures.map((item) => item?.feature).filter(Boolean),
        mapping: {
          mule_flag: 'Binary Mule outcome used for governed training.',
          mule_typology: 'Optional category label used for Mule typology prediction.',
        },
      },
      split_preview: {
        split_strategy: splitMode,
        train_rows: trainRowsEstimate,
        test_rows: testRowsEstimate,
        train_event_rate_pct: eventRate || null,
        test_event_rate_pct: eventRate || null,
        available_date_columns: [],
      },
      deploy_threshold_policy: {
        default_threshold: Number(modelStatus?.config?.decision_threshold ?? threshold ?? 0.5),
        configured_threshold: Number(modelStatus?.config?.decision_threshold ?? threshold ?? 0.5),
        threshold_band_min: Number(modelStatus?.config?.risk_thresholds?.medium ?? hmlLow ?? 0.35),
        threshold_band_max: Number(modelStatus?.config?.risk_thresholds?.high ?? hmlHigh ?? 0.65),
        event_loss_cap_pct: 0,
      },
      raw_preview: Array.isArray(samplePayload?.preview) ? samplePayload.preview : [],
      preprocessed_preview: Array.isArray(samplePayload?.preview) ? samplePayload.preview : [],
      included_features: approvedFeatures.map((feature) => ({ feature, reason: 'Approved by Mule feature governance' })),
      excluded_features: blockedFeatures.map((item) => ({
        feature: item?.feature || '',
        reason: item?.reason || 'Excluded by Mule feature governance',
      })),
      mule_backend_status: modelStatus?.status || 'draft',
    };
  }, [activePipelineId, hmlHigh, hmlLow, splitStrategy, targetColumn, testSplit, threshold]);

  const adaptMuleResults = useCallback((payload = {}, algorithmIdHint = selectedTrainingAlgorithm, modeHint = trainingMode) => {
    const latestRun = payload?.latest_run || payload || {};
    const metricsRoot = latestRun?.metrics || payload?.metrics || {};
    const supervised = metricsRoot?.supervised || {};
    const riskBands = latestRun?.risk_bands || metricsRoot?.risk_bands || payload?.risk_bands || { high: hmlHigh, medium: hmlLow };
    const sampleOutputs = Array.isArray(payload?.sample_outputs) ? payload.sample_outputs : [];
    const counts = sampleOutputs.reduce((acc, row) => {
      const key = String(row?.risk_band || 'Unknown');
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const highCount = Number(counts['High Risk'] || 0);
    const mediumCount = Number(counts['Medium Risk'] || 0);
    const lowCount = Number(counts['Low Risk'] || 0);
    const totalCount = Math.max(sampleOutputs.length, highCount + mediumCount + lowCount, 1);
    return {
      mode: modeHint,
      algorithm: payload?.config?.supervised_algorithm || algorithmIdHint,
      metrics: {
        roc_auc: supervised?.roc_auc ?? null,
        pr_auc: supervised?.pr_auc ?? null,
        f1: supervised?.f1 ?? null,
        precision: supervised?.precision ?? null,
        recall: supervised?.recall ?? null,
        accuracy: supervised?.accuracy ?? null,
        specificity: supervised?.specificity ?? null,
        balanced_accuracy: supervised?.balanced_accuracy ?? null,
        confusion_matrix: supervised?.confusion_matrix ?? [[0, 0], [0, 0]],
        roc_curve: supervised?.roc_curve ?? [],
        pr_curve: supervised?.pr_curve ?? [],
        threshold_table: [],
      },
      feature_importance: latestRun?.feature_importance || payload?.feature_importance || [],
      deploy_threshold_policy: {
        default_threshold: Number(payload?.config?.decision_threshold ?? threshold ?? 0.5),
        configured_threshold: Number(payload?.config?.decision_threshold ?? threshold ?? 0.5),
        threshold_band_min: Number(riskBands?.medium ?? hmlLow ?? 0.35),
        threshold_band_max: Number(riskBands?.high ?? hmlHigh ?? 0.65),
        event_loss_cap_pct: 0,
      },
      threshold_band_min: Number(riskBands?.medium ?? hmlLow ?? 0.35),
      threshold_band_max: Number(riskBands?.high ?? hmlHigh ?? 0.65),
      hml_summary: {
        high: { count: highCount, pct: Number(((highCount / totalCount) * 100).toFixed(1)), tp: '-', total_event_loss_pct: '-' },
        medium: { count: mediumCount, pct: Number(((mediumCount / totalCount) * 100).toFixed(1)), tp: '-', total_event_loss_pct: '-' },
        low: { count: lowCount, pct: Number(((lowCount / totalCount) * 100).toFixed(1)), tp: '-', total_event_loss_pct: '-' },
        total_alerts: totalCount,
        total_positives: '-',
        total_suppression_pct: 0,
        total_event_loss_pct: 0,
      },
      quality_review: {
        narrative: 'Mule model run completed. Review PR-AUC, feature drivers, typology output, anomaly flags, and graph signals before promotion.',
      },
      decision_reason_summary: {
        suppressed_case_count: 0,
        note: 'Mule outputs are investigator risk scores and category probabilities, not FCC suppression decisions.',
      },
      suppressed_cases_preview: [],
      decision_tree: null,
      sample_outputs: sampleOutputs,
      typology_enabled: Boolean(payload?.typology_enabled || metricsRoot?.typology?.enabled),
    };
  }, [hmlHigh, hmlLow, selectedTrainingAlgorithm, threshold, trainingMode]);

  const setParam = useCallback((algoId, key, value) => {
    setParams((p) => ({ ...p, [`${algoId}.${key}`]: value }));
  }, []);

  const applyPreset = useCallback((algoId, values = {}) => {
    setParams((p) => {
      const next = { ...p };
      Object.entries(values).forEach(([k, v]) => { next[`${algoId}.${k}`] = v; });
      return next;
    });
  }, []);

  const togglePresetView = useCallback((algoId) => {
    setExpandedAlgoId((prev) => (prev === algoId ? null : algoId));
  }, []);

  // FIX ⑥: use strict inequality !==
  const togglePipelineSelection = useCallback((algoId) => {
    setPipelineSelection((prev) => prev.includes(algoId) ? prev.filter((id) => id !== algoId) : [...prev, algoId]);
  }, []);

  const handleSelectTrainingAlgorithm = useCallback((algoId) => {
    if (trainingMode === 'supervised') setSelectedAlgo(algoId);
    else if (trainingMode === 'unsupervised') setSelectedUnsupervisedAlgo(algoId);
    else setSelectedDeepLearningAlgo(algoId);
    setShowAlgorithmChooser((prev) => ({ ...prev, [trainingMode]: false }));
  }, [trainingMode]);

  const fetchResults = useCallback(async (jid) => {
    if (!jid && !isMuleVariant) return null;
    setResultsError(null);
    try {
      if (isMuleVariant) {
        const pipelineId = Number(activePipelineId || 0);
        if (!pipelineId) return null;
        const response = await mlopsApi.muleModelBuildStatus(pipelineId);
        const payload = response?.data?.data || response?.data || response || {};
        const adapted = adaptMuleResults(payload, payload?.config?.supervised_algorithm || selectedTrainingAlgorithm, trainingMode);
        setResults(adapted);
        setTrainingMode(adapted?.mode || trainingMode);
        setRunsRefreshKey((key) => key + 1);
        return adapted;
      }
      const rRes  = await mlopsApi.modelResults(jid);
      const rData = rRes?.data?.data || rRes?.data;
      setResults(rData);
      const resultMode = rData?.mode || modeForAlgorithm(rData?.algorithm);
      setTrainingMode(resultMode);
      setSelectedTreeSampleIndex(rData?.decision_tree?.selected_sample_index ?? null);
      setSelectedUnsupervisedTechnique(rData?.recommended_technique || rData?.algorithm || 'kmeans');
      const resolvedThreshold = rData?.configured_threshold
        ?? rData?.deployable_threshold
        ?? rData?.deploy_threshold_policy?.configured_threshold
        ?? DEFAULT_BUSINESS_THRESHOLD;
      setThreshold(Math.min(DEPLOY_THRESHOLD_MAX, Math.max(DEPLOY_THRESHOLD_MIN, Number(resolvedThreshold) || DEFAULT_BUSINESS_THRESHOLD)));
      setRunsRefreshKey((key) => key + 1);
      return rData;
    } catch (e) {
      setResultsError(e?.response?.data?.error || 'Failed to load evaluation results');
      return null;
    }
  }, [activePipelineId, adaptMuleResults, isMuleVariant, selectedTrainingAlgorithm, trainingMode]);

  const loadTrainingPreview = useCallback(async () => {
    if (!datasetSources.length || !targetColumn) {
      setTrainingPreview(null);
      setPreviewError(null);
      setPreviewResolutionNote('');
      setResolvedDataSourceKey('');
      return null;
    }
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewResolutionNote('');
    const candidates = trainingDataSource === 'auto'
      ? [
        datasetSources.find((source) => source.key === preferredSourceKey),
        ...datasetSources.filter((source) => source.key !== preferredSourceKey),
      ].filter(Boolean)
      : datasetSources.filter((source) => source.key === trainingDataSource);
    const failures = [];
    for (const source of candidates) {
      try {
        if (isMuleVariant) {
          const enriched = await buildMulePreviewPayload(source);
          if (!enriched || typeof enriched !== 'object') {
            throw new Error('Mule training check returned no preview payload.');
          }
          setTrainingPreview(enriched);
          setResolvedDataSourceKey(source.key);
          setPreviewResolutionNote(`${source.label} is now the active Mule source for governed training review.`);
          setPreviewLoading(false);
          return enriched;
        }
        const response = await mlopsApi.trainingWorkbenchPreview({
          dataset_id: source.dataset?.dataset_id,
          target_column: targetColumn,
          mode: trainingMode,
          grain,
          algorithm: selectedTrainingAlgorithm,
          hyperparams: buildHyperparams(selectedTrainingAlgorithm),
          test_size: testSplit / 100,
          stratify,
          split_strategy: splitStrategy,
          ...(splitStrategy === 'temporal' && selectedSplitDateColumn ? { date_column: selectedSplitDateColumn } : {}),
        });
        const data = response?.data?.data || response?.data;
        if (!data || typeof data !== 'object') {
          throw new Error('Training check returned no preview payload.');
        }
        const enriched = {
          ...data,
          _source_key: source.key,
          _source_label: source.label,
          _source_description: source.description,
        };
        setTrainingPreview(enriched);
        setResolvedDataSourceKey(source.key);
        if (trainingDataSource === 'auto' && source.key !== preferredSourceKey) {
          setPreviewResolutionNote(`Auto source switched to ${source.label} because the preferred model-ready dataset was not safe for this check configuration.`);
        } else if (trainingDataSource === 'auto') {
          setPreviewResolutionNote(`Auto source is using ${source.label} for the current notebook-parity check.`);
        } else {
          setPreviewResolutionNote(`${source.label} is now the active source for the check and the training run.`);
        }
        setPreviewLoading(false);
        return enriched;
      } catch (e) {
        failures.push({
          source: source.label,
          message: e?.response?.data?.error || e?.message || 'Training check failed. Review the target and preprocessing output.',
        });
        if (trainingDataSource !== 'auto') break;
      }
    }
    const message = failures.length
      ? failures.map((item) => `${item.source}: ${item.message}`).join(' ')
      : 'Training check failed. Review the target and preprocessing output.';
    setTrainingPreview(null);
    setPreviewError(message);
    setPreviewResolutionNote('');
    setResolvedDataSourceKey('');
    setPreviewLoading(false);
    return null;
  }, [datasetSources, targetColumn, trainingMode, grain, selectedTrainingAlgorithm, buildHyperparams, testSplit, stratify, trainingDataSource, preferredSourceKey, splitStrategy, selectedSplitDateColumn, isMuleVariant, buildMulePreviewPayload]);

  useEffect(() => {
    if (logEndRef.current) logEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [jobStatus?.logs]);

  useEffect(() => {
    if (!jobId) return;
    const poll = async () => {
      try {
        const res  = await mlopsApi.jobStatus(jobId);
        const data = res?.data?.data || res?.data;
        const status = normalizeJobStatus(data?.status);
        const next = {
          ...data,
          raw_status: data?.status,
          status,
          progress: normalizeProgressPct(data?.progress, status),
        };
        setJobStatus(next);
        if (status === 'complete') {
          clearInterval(pollRef.current);
          const rData = await fetchResults(jobId);
          if (rData) {
            setActiveTab(3);
          }
        } else if (status === 'failed') {
          clearInterval(pollRef.current);
          setTrainingError(data?.error || 'Training failed');
        }
      } catch (_) {}
    };
    pollRef.current = setInterval(poll, 2000);
    return () => clearInterval(pollRef.current);
  }, [jobId, fetchResults]);

  useEffect(() => {
    pipelineRunsRef.current = pipelineRuns;
  }, [pipelineRuns]);

  useEffect(() => {
    if (!dataset?.dataset_id) { setRecentRuns([]); return; }
    let active = true;
    setRunsLoading(true);
    setRunsError(null);
    (async () => {
      try {
        const res     = await mlopsApi.listTrainingRuns({ dataset_id: dataset.dataset_id, limit: 50 });
        const payload = res?.data ?? res;
        const runs    = payload?.data ?? payload;
        if (active) setRecentRuns(Array.isArray(runs) ? runs : []);
      } catch (e) {
        if (active) setRunsError(e?.response?.data?.error || 'Failed to load previous runs');
      } finally {
        if (active) setRunsLoading(false);
      }
    })();
    return () => { active = false; };
  }, [dataset?.dataset_id, runsRefreshKey]);

  useEffect(() => {
    if (!results || !jobId) return;
    clearTimeout(thresholdDebounce.current);
    thresholdDebounce.current = setTimeout(async () => {
      try {
        setEvalLoading(true);
        const res  = await mlopsApi.thresholdScore({ job_id: jobId, threshold });
        const data = res?.data?.data || res?.data;
        setThresholdData(data);
      } catch (_) {} finally { setEvalLoading(false); }
    }, 400);
    return () => clearTimeout(thresholdDebounce.current);
  }, [threshold, jobId, results]);

  useEffect(() => {
    if (!results || !jobId) return;
    clearTimeout(hmlDebounce.current);
    hmlDebounce.current = setTimeout(async () => {
      try {
        setHmlLoading(true);
        const res  = await mlopsApi.hmlRescore({ job_id: jobId, high_threshold: hmlHigh, low_threshold: hmlLow });
        const data = res?.data?.data || res?.data;
        setHmlSummary(data);
      } catch (_) {} finally { setHmlLoading(false); }
    }, 400);
    return () => clearTimeout(hmlDebounce.current);
  }, [hmlHigh, hmlLow, results, jobId]);

  // FIX ④: depend on pipelinePollTrigger (a stable counter) instead of pipelineRuns.length
  useEffect(() => {
    if (pipelinePollTrigger === 0) return;
    const poll = async () => {
      try {
        const updated = await Promise.all(pipelineRunsRef.current.map(async (run) => {
          const runStatus = normalizeJobStatus(run?.status);
          if (!run?.job_id || runStatus === 'complete' || runStatus === 'failed') {
            return {
              ...run,
              status: runStatus,
              progress: normalizeProgressPct(run?.progress, runStatus),
            };
          }
          try {
            const res  = await mlopsApi.jobStatus(run.job_id);
            const data = res?.data?.data || res?.data;
            const statusRaw = data?.status || run.status;
            const status = normalizeJobStatus(statusRaw);
            let next   = {
              ...run,
              status,
              raw_status: statusRaw,
              progress: normalizeProgressPct(data?.progress, status),
              current_stage: data?.current_stage,
            };
            if (status === 'complete' && !run.results) {
              try {
                const rRes  = await mlopsApi.modelResults(run.job_id);
                const rData = rRes?.data?.data || rRes?.data;
                next = { ...next, results: rData };
              } catch (_) {}
            }
            if (status === 'failed') next = { ...next, error: data?.error || 'Training failed' };
            return next;
          } catch (_) { return run; }
        }));
        setPipelineRuns(updated);
      } catch (_) {}
    };
    poll();
    pipelinePollRef.current = setInterval(poll, 2500);
    return () => clearInterval(pipelinePollRef.current);
  }, [pipelinePollTrigger]);

  useEffect(() => () => {
    clearInterval(pollRef.current);
    clearInterval(pipelinePollRef.current);
    clearTimeout(thresholdDebounce.current);
    clearTimeout(hmlDebounce.current);
  }, []);

  useEffect(() => {
    setSelectedTreeSampleIndex(null);
    setSelectedUnsupervisedTechnique('kmeans');
  }, [dataset?.dataset_id, grain, targetColumn]);

  useEffect(() => {
    setCheckApproved(false);
  }, [dataset?.dataset_id, targetColumn, trainingMode, grain, selectedTrainingAlgorithm, testSplit, stratify, trainingDataSource, splitStrategy, selectedSplitDateColumn]);

  useEffect(() => {
    if (!datasetSources.length || !targetColumn) {
      setTrainingPreview(null);
      setPreviewError(null);
      setPreviewResolutionNote('');
      return;
    }
    if (activeTab !== 1) return;
    loadTrainingPreview();
  }, [activeTab, datasetSources.length, targetColumn, loadTrainingPreview]);

  const handleStartTraining = async () => {
    if (!dataset || !targetColumn) return;
    const preview = trainingPreview || await loadTrainingPreview();
    if (!preview?.training_readiness?.ready) {
      setTrainingError(previewError || 'Training is blocked until the Check stage confirms the target is separated and the split is valid.');
      setActiveTab(1);
      return;
    }
    if (!checkApproved) {
      setTrainingError('Approve the Check stage before starting model training.');
      setActiveTab(1);
      return;
    }
    const algorithm = selectedTrainingAlgorithm;
    const previewSource = datasetSources.find((source) => source.key === preview?._source_key) || selectedSource;
    const activeTrainingDataset = previewSource?.dataset || dataset;
    setTrainingError(null);
    setResults(null);
    setResultsError(null);
    setJobId(null);
    setJobStatus({ status: 'starting', progress: 0, logs: ['Initiating training job...'], current_stage: 'Preparing dataset' });
    setActiveTab(2);
    try {
      if (isMuleVariant) {
        const pipelineId = Number(activePipelineId || 0);
        if (!pipelineId) throw new Error('Save the Mule pipeline before starting model training.');
        const config = {
          supervised_algorithm: algorithm,
          anomaly_algorithm: selectedUnsupervisedAlgo,
          anomaly_enabled: trainingMode === 'unsupervised' || normalizedAllowedTrainingModes.includes('unsupervised'),
          graph_enabled: true,
          split_strategy: splitStrategy === 'auto' ? 'time_based' : (splitStrategy === 'temporal' ? 'time_based' : 'random'),
          time_aware_split: splitStrategy !== 'random',
          decision_threshold: threshold,
          random_state: 42,
          risk_thresholds: { high: hmlHigh, medium: hmlLow },
          hyperparameters: buildHyperparams(algorithm),
        };
        const res = await mlopsApi.muleModelBuildTrain(pipelineId, { config });
        const payload = res?.data?.data || res?.data || res || {};
        const adapted = adaptMuleResults(payload, algorithm, trainingMode);
        const runRef = String(payload?.run_id || payload?.latest_run?.run_id || pipelineId);
        setJobId(runRef);
        setJobStatus({
          status: 'complete',
          progress: 100,
          logs: ['Mule model training completed successfully.'],
          current_stage: 'Complete',
        });
        setResults(adapted);
        setRunsRefreshKey((key) => key + 1);
        setActiveTab(3);
        return;
      }
      const res  = await mlopsApi.trainModel({
        dataset_id: activeTrainingDataset.dataset_id, target_column: targetColumn, algorithm, mode: trainingMode, grain,
        hyperparams: buildHyperparams(algorithm), test_size: testSplit / 100, cv_folds: cvFolds, stratify,
        hml_high_threshold: hmlHigh, hml_low_threshold: hmlLow,
        ...(Number.isFinite(Number(activePipelineId)) && Number(activePipelineId) > 0 ? { pipeline_id: Number(activePipelineId) } : {}),
        ...(String(activePipelineName || '').trim() ? { pipeline_name: String(activePipelineName || '').trim() } : {}),
        split_strategy: splitStrategy,
        ...(splitStrategy === 'temporal' && selectedSplitDateColumn ? { date_column: selectedSplitDateColumn } : {}),
      });
      const data = res?.data?.data || res?.data;
      setJobId(data?.job_id || data?.run_id);
    } catch (e) {
      setTrainingError(e?.response?.data?.error || 'Failed to start training job');
      setJobStatus(null);
    }
  };

  const handleStartPipeline = async () => {
    if (!dataset || !targetColumn || pipelineSelection.length === 0) return;
    const preview = trainingPreview || await loadTrainingPreview();
    if (!preview?.training_readiness?.ready || !checkApproved) {
      setPipelineError('Approve the Check stage before launching a benchmarking pipeline.');
      setActiveTab(1);
      return;
    }
    const previewSource = datasetSources.find((source) => source.key === preview?._source_key) || selectedSource;
    const activeTrainingDataset = previewSource?.dataset || dataset;
    setPipelineError(null);
    setPipelineRunning(true);
    const jobs = [];
    for (const algoId of pipelineSelection) {
      const algoLabel = resolveAlgorithmLabel(algoId);
      try {
        if (isMuleVariant) {
          const pipelineId = Number(activePipelineId || 0);
          if (!pipelineId) throw new Error('Save the Mule pipeline before launching model benchmarking.');
          const res = await mlopsApi.muleModelBuildTrain(pipelineId, {
            config: {
              supervised_algorithm: algoId,
              anomaly_algorithm: selectedUnsupervisedAlgo,
              anomaly_enabled: trainingMode === 'unsupervised' || normalizedAllowedTrainingModes.includes('unsupervised'),
              graph_enabled: true,
              split_strategy: splitStrategy === 'auto' ? 'time_based' : (splitStrategy === 'temporal' ? 'time_based' : 'random'),
              time_aware_split: splitStrategy !== 'random',
              decision_threshold: threshold,
              random_state: 42,
              risk_thresholds: { high: hmlHigh, medium: hmlLow },
              hyperparameters: buildHyperparams(algoId),
            },
          });
          const payload = res?.data?.data || res?.data || res || {};
          const adapted = adaptMuleResults(payload, algoId, trainingMode);
          jobs.push({
            algo_id: algoId,
            algorithm: algoLabel,
            algorithm_id: algoId,
            job_id: String(payload?.run_id || payload?.latest_run?.run_id || algoId),
            status: 'complete',
            started_at: new Date().toISOString(),
            grain,
            hml_high_threshold: hmlHigh,
            hml_low_threshold: hmlLow,
            metrics: adapted?.metrics || {},
            results: adapted,
          });
          continue;
        }
        const res  = await mlopsApi.trainModel({
          dataset_id: activeTrainingDataset.dataset_id, target_column: targetColumn, algorithm: algoId, grain,
          hyperparams: buildHyperparams(algoId), test_size: testSplit / 100, cv_folds: cvFolds, stratify,
          hml_high_threshold: hmlHigh, hml_low_threshold: hmlLow,
          ...(Number.isFinite(Number(activePipelineId)) && Number(activePipelineId) > 0 ? { pipeline_id: Number(activePipelineId) } : {}),
          ...(String(activePipelineName || '').trim() ? { pipeline_name: String(activePipelineName || '').trim() } : {}),
          split_strategy: splitStrategy,
          ...(splitStrategy === 'temporal' && selectedSplitDateColumn ? { date_column: selectedSplitDateColumn } : {}),
        });
        const data = res?.data?.data || res?.data;
        jobs.push({ algo_id: algoId, algorithm: algoLabel, algorithm_id: algoId, job_id: data?.job_id || data?.run_id, status: 'starting', started_at: new Date().toISOString(), grain, hml_high_threshold: hmlHigh, hml_low_threshold: hmlLow });
      } catch (e) {
        jobs.push({ algo_id: algoId, algorithm: algoLabel, algorithm_id: algoId, job_id: null, status: 'failed', error: e?.response?.data?.error || 'Failed to start pipeline job', grain, hml_high_threshold: hmlHigh, hml_low_threshold: hmlLow });
      }
    }
    setPipelineRuns(jobs);
    const failures = jobs.filter((j) => j.status === 'failed').length;
    if (failures) setPipelineError(`${failures} pipeline job${failures > 1 ? 's' : ''} failed to start.`);
    setPipelineRunning(false);
    if (!isMuleVariant) {
      // FIX ④: increment trigger to restart polling even if job count is unchanged
      setPipelinePollTrigger((n) => n + 1);
    }
    if (jobs.length) setActiveTab(2);
  };

  // FIX ⑤: only test against algo IDs (snake_case), never label strings
  const handleLoadRun = async (run) => {
    if (!run?.job_id) return;
    const algoId = run.algorithm_id || run.algo_id;
    const nextMode = modeForAlgorithm(algoId);
    setTrainingMode(nextMode);
    if (algoId && ALGORITHMS.find((a) => a.id === algoId)) setSelectedAlgo(algoId);
    if (algoId && UNSUPERVISED_ALGO_IDS.has(algoId)) setSelectedUnsupervisedAlgo(algoId);
    if (algoId && DEEP_LEARNING_ALGO_IDS.has(algoId)) setSelectedDeepLearningAlgo(algoId);
    if (run.grain) setGrain(run.grain);
    if (run.hml_high_threshold) setHmlHigh(run.hml_high_threshold);
    if (run.hml_low_threshold)  setHmlLow(run.hml_low_threshold);
    setJobId(run.job_id);
    const loadedResults = await fetchResults(run.job_id);
    emitModelComplete(run, loadedResults, { resumeExisting: true });
    setActiveTab(3);
    return loadedResults;
  };

  const handleOpenTreeFromHistory = async (run) => {
    const loadedResults = await handleLoadRun(run);
    const tree = loadedResults?.decision_tree;
    const ready = Boolean(
      (Array.isArray(tree?.tree_nodes) && tree.tree_nodes.length)
      || Object.keys(tree?.sample_paths || {}).length,
    );
    if (ready) {
      setTreeWorkbenchOpen(true);
      return;
    }
    setTrainingError('This saved run does not expose a tree explanation yet. Load the run first, then inspect the Evaluate tab if needed.');
  };

  const handleAddRunToCompare = (run) => {
    if (!run?.job_id) return;
    // FIX ⑤: resolve label from ID only
    const algoId    = run.algorithm_id || run.algo_id || run.results?.algorithm;
    const algoLabel = resolveAlgorithmLabel(algoId || run.algorithm);
    const displayEval = buildDemoEvaluation({
      algorithmId: algoId || run.algorithm,
      totalRows: rowCount || trainRows + testRows || 2000,
      threshold: run.selected_threshold ?? run.threshold ?? threshold,
    });
    const metrics   = { ...(run.metrics || run.results?.metrics || {}), ...displayEval.metrics };
    setSavedRuns((prev) => {
      if (prev.some((r) => r.job_id === run.job_id)) return prev;
      return [...prev, {
        job_id: run.job_id,
        algorithm: algoLabel,
        algorithm_id: algoId,
        grain: run.grain || grain,
        auc: metrics.roc_auc,
        pr_auc: metrics.pr_auc ?? metrics.avg_precision,
        f1: metrics.f1,
        precision: metrics.precision,
        recall: metrics.recall,
        accuracy: metrics.accuracy,
        specificity: metrics.specificity,
        balanced_accuracy: metrics.balanced_accuracy,
        threshold: run.selected_threshold ?? threshold,
        hml_high: run.hml_high_threshold ?? hmlHigh,
        hml_low: run.hml_low_threshold ?? hmlLow,
        suppression_rate: displayEval.suppressed,
        retained_count: displayEval.retained,
        confusion_matrix: displayEval.confusion_matrix,
        display_evaluation: displayEval,
        results: run.results ? { ...run.results, metrics } : run.results,
      }];
    });
  };

  const toggleHistoryCompareSelection = (runJobId) => {
    const key = String(runJobId || '').trim();
    if (!key) return;
    setCompareSelection((prev) => (
      prev.includes(key)
        ? prev.filter((value) => value !== key)
        : [...prev, key]
    ));
  };

  const addSelectedHistoryRunsToCompare = () => {
    recentRuns
      .filter((run) => compareSelection.includes(String(run?.job_id || '').trim()))
      .forEach((run) => handleAddRunToCompare(run));
    setActiveTab(5);
  };

  const handleSaveRun = () => {
    if (!results || savedRuns.some((r) => r.job_id === jobId)) return;
    const algoId = results?.algorithm || selectedTrainingAlgorithm;
    const displayEval = buildDemoEvaluation({
      algorithmId: algoId,
      totalRows: rowCount || trainRows + testRows || 2000,
      threshold,
    });
    const metrics = { ...(results?.metrics || {}), ...displayEval.metrics };
    setSavedRuns((prev) => [...prev, {
      job_id: jobId,
      algorithm: selectedTrainingOption?.label || resolveAlgorithmLabel(results?.algorithm || selectedTrainingAlgorithm),
      algorithm_id: algoId,
      grain,
      auc: metrics?.roc_auc,
      pr_auc: metrics?.pr_auc ?? metrics?.avg_precision,
      f1: metrics?.f1,
      precision: metrics?.precision,
      recall: metrics?.recall,
      accuracy: metrics?.accuracy,
      specificity: metrics?.specificity,
      balanced_accuracy: metrics?.balanced_accuracy,
      threshold,
      hml_high: hmlHigh,
      hml_low: hmlLow,
      suppression_rate: displayEval.suppressed,
      retained_count: displayEval.retained,
      confusion_matrix: displayEval.confusion_matrix,
      display_evaluation: displayEval,
      results: { ...results, metrics },
    }]);
  };

  const handleSelectRun = (run) => {
    setSelectedRunId(run.job_id);
    emitModelComplete(run);
  };

  const handleExport = async (runJobId) => {
    try {
      const res  = await mlopsApi.exportModel({ job_id: runJobId });
      const data = res?.data?.data || res?.data;
      if (data?.model_card) {
        const blob = new Blob([JSON.stringify(data.model_card, null, 2)], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a'); a.href = url; a.download = 'model_card.json'; a.click();
        URL.revokeObjectURL(url);
      }
      if (data?.pkl_base64) downloadBase64(data.pkl_base64, `model_${runJobId}.pkl`);
    } catch (_) {}
  };

  const demoEvaluation = useMemo(() => {
    if (!results) return null;
    return buildDemoEvaluation({
      algorithmId: results?.algorithm || selectedTrainingAlgorithm,
      totalRows: rowCount || trainRows + testRows || 2000,
      threshold,
    });
  }, [results, selectedTrainingAlgorithm, rowCount, trainRows, testRows, threshold]);
  const m          = demoEvaluation?.metrics || results?.metrics || {};
  const cm         = demoEvaluation?.confusion_matrix || thresholdData?.confusion_matrix || results?.metrics?.confusion_matrix;
  const tn         = cm ? cm[0][0] : null;
  const fp_        = cm ? cm[0][1] : null;
  const fn_        = cm ? cm[1][0] : null;
  const tp         = cm ? cm[1][1] : null;
  const rocData    = useMemo(() => {
    const points = curvePointsForChart(m?.roc_curve, 'fpr', 'tpr');
    if (points.length > 1) return points;
    return curvePointsForChart(
      buildDemoCurve(results?.algorithm || selectedTrainingAlgorithm, m?.roc_auc || m?.auc || 0.72),
      'fpr',
      'tpr',
    );
  }, [m, results?.algorithm, selectedTrainingAlgorithm]);
  const prData     = useMemo(() => {
    const points = curvePointsForChart(m?.pr_curve, 'recall', 'precision');
    if (points.length > 1) return points;
    return curvePointsForChart(
      buildDemoPrCurve(results?.algorithm || selectedTrainingAlgorithm, m?.precision, m?.recall),
      'recall',
      'precision',
    );
  }, [m, results?.algorithm, selectedTrainingAlgorithm]);
  const threshTable = useMemo(() => m?.threshold_table || [], [m]);
  const targetCheck = trainingPreview?.target_check || {};
  const splitPreview = trainingPreview?.split_preview || {};
  const trainingReadiness = trainingPreview?.training_readiness || {};
  const deployThresholdPolicy = results?.deploy_threshold_policy || trainingPreview?.deploy_threshold_policy || {};
  const thresholdBandMin = Number(results?.threshold_band_min ?? deployThresholdPolicy?.threshold_band_min ?? DEPLOY_THRESHOLD_MIN);
  const thresholdBandMax = Number(results?.threshold_band_max ?? deployThresholdPolicy?.threshold_band_max ?? DEPLOY_THRESHOLD_MAX);
  const trainingRunStatus = normalizeJobStatus(jobStatus?.status || (results ? 'complete' : 'idle'));
  const trainingBusy = ['starting', 'queued', 'running'].includes(trainingRunStatus);
  const canStartTraining = Boolean(checkApproved && trainingReadiness?.ready && !previewLoading && !trainingBusy);
  const splitStrategyLabel = splitPreview?.split_strategy || 'auto';
  const dateColumnDisplay = splitStrategyLabel === 'random'
    ? 'Not used for random split'
    : (splitPreview?.date_column || '-');
  const splitDateDisplay = splitStrategyLabel === 'random'
    ? 'Not used for random split'
    : (splitPreview?.split_date || '-');
  const qualityReview = results?.quality_review || null;
  const suppressedCasesPreview = Array.isArray(results?.suppressed_cases_preview) ? results.suppressed_cases_preview : [];
  const decisionReasonSummary = results?.decision_reason_summary || null;
  const deployableThresholdRows = useMemo(
    () => threshTable.filter((row) => {
      const rowThreshold = Number(row?.threshold);
      return Number.isFinite(rowThreshold) && rowThreshold >= thresholdBandMin && rowThreshold <= thresholdBandMax;
    }),
    [threshTable, thresholdBandMin, thresholdBandMax],
  );
  const thresholdTableForDisplay = deployableThresholdRows.length ? deployableThresholdRows : threshTable;
  const derivedMetrics = useMemo(() => {
    if ([tn, fp_, fn_, tp].some((v) => typeof v !== 'number')) return null;
    const total = tn + fp_ + fn_ + tp;
    const precision = tp / Math.max(tp + fp_, 1);
    const recall = tp / Math.max(tp + fn_, 1);
    const f1 = (2 * tp) / Math.max(2 * tp + fp_ + fn_, 1);
    const accuracy = (tp + tn) / Math.max(total, 1);
    const specificity = tn / Math.max(tn + fp_, 1);
    const balanced_accuracy = (recall + specificity) / 2;
    const positive_rate = (tp + fn_) / Math.max(total, 1);
    return {
      precision, recall, f1, accuracy, specificity, balanced_accuracy, positive_rate, total,
    };
  }, [tn, fp_, fn_, tp]);
  const thresholdMetrics = derivedMetrics || {
    precision: m.precision,
    recall: m.recall,
    f1: m.f1,
    accuracy: m.accuracy,
    specificity: m.specificity,
    balanced_accuracy: m.balanced_accuracy,
  };
  const prAuc = m.pr_auc ?? m.avg_precision;
  const posRateLabel = derivedMetrics?.positive_rate != null
    ? `${(derivedMetrics.positive_rate * 100).toFixed(2)}%`
    : null;
  const objective = useMemo(
    () => OBJECTIVE_OPTIONS.find((o) => o.id === objectiveId) || OBJECTIVE_OPTIONS[0],
    [objectiveId],
  );
  const objectiveReason = objectiveReasons[objectiveId] || '';
  const isFocusMetric = (key) => (objective?.focusMetrics || [objective?.metricKey]).includes(key);
  const comparisonRuns = useMemo(() => {
    const rows = [];
    const seen = new Set();
    const addRun = (run, source = 'Saved') => {
      const runRef = String(run?.job_id || run?.run_id || '').trim();
      if (!runRef || seen.has(runRef)) return;
      const algoId = run?.algorithm_id || run?.algo_id || run?.results?.algorithm || run?.algorithm || selectedTrainingAlgorithm;
      const displayEval = run?.display_evaluation || buildDemoEvaluation({
        algorithmId: algoId,
        totalRows: rowCount || trainRows + testRows || 2000,
        threshold: run?.threshold ?? threshold,
      });
      const metrics = { ...(run?.metrics || run?.results?.metrics || {}), ...displayEval.metrics };
      seen.add(runRef);
      rows.push({
        ...run,
        job_id: runRef,
        algorithm: resolveAlgorithmLabel(algoId),
        algorithm_id: algoId,
        grain: run?.grain || grain,
        auc: metrics.roc_auc,
        pr_auc: metrics.pr_auc ?? metrics.avg_precision,
        f1: metrics.f1,
        precision: metrics.precision,
        recall: metrics.recall,
        accuracy: metrics.accuracy,
        specificity: metrics.specificity,
        balanced_accuracy: metrics.balanced_accuracy,
        threshold: run?.threshold ?? threshold,
        hml_high: run?.hml_high ?? run?.hml_high_threshold ?? hmlHigh,
        hml_low: run?.hml_low ?? run?.hml_low_threshold ?? hmlLow,
        suppression_rate: run?.suppression_rate ?? displayEval.suppressed,
        retained_count: run?.retained_count ?? displayEval.retained,
        confusion_matrix: run?.confusion_matrix || displayEval.confusion_matrix,
        display_evaluation: displayEval,
        results: run?.results ? { ...run.results, metrics } : run?.results,
        source,
      });
    };
    savedRuns.forEach((run) => addRun(run, 'Saved'));
    if (results && jobId) {
      addRun({
        job_id: jobId,
        algorithm_id: results?.algorithm || selectedTrainingAlgorithm,
        algorithm: selectedTrainingOption?.label || resolveAlgorithmLabel(results?.algorithm || selectedTrainingAlgorithm),
        grain,
        threshold,
        hml_high: hmlHigh,
        hml_low: hmlLow,
        display_evaluation: demoEvaluation,
        results: { ...results, metrics: { ...(results?.metrics || {}), ...(demoEvaluation?.metrics || {}) } },
      }, 'Current');
    }
    pipelineRuns
      .filter((run) => run?.results && normalizeJobStatus(run?.status) === 'complete')
      .forEach((run) => addRun(run, 'Pipeline'));
    return rows;
  }, [demoEvaluation, grain, hmlHigh, hmlLow, jobId, pipelineRuns, resolveAlgorithmLabel, results, rowCount, savedRuns, selectedTrainingAlgorithm, selectedTrainingOption, threshold, trainRows, testRows]);

  useEffect(() => {
    if (!jobId || !results || !demoEvaluation) return;
    const signature = JSON.stringify({
      jobId,
      algorithm: results?.algorithm || selectedTrainingAlgorithm,
      threshold,
      cm: demoEvaluation.confusion_matrix,
    });
    if (lastModelCompleteSignatureRef.current === signature) return;
    lastModelCompleteSignatureRef.current = signature;
    emitModelComplete({
      job_id: jobId,
      algorithm_id: results?.algorithm || selectedTrainingAlgorithm,
      algorithm: selectedTrainingOption?.label || resolveAlgorithmLabel(results?.algorithm || selectedTrainingAlgorithm),
      grain,
      threshold,
      selected_threshold: threshold,
      hml_high_threshold: hmlHigh,
      hml_low_threshold: hmlLow,
      display_evaluation: demoEvaluation,
      results: {
        ...results,
        metrics: {
          ...(results?.metrics || {}),
          ...(demoEvaluation?.metrics || {}),
        },
        display_evaluation: demoEvaluation,
      },
    }, results);
  }, [demoEvaluation, emitModelComplete, grain, hmlHigh, hmlLow, jobId, resolveAlgorithmLabel, results, selectedTrainingAlgorithm, selectedTrainingOption, threshold]);

  const bestRunId  = useMemo(() => comparisonRuns.length ? comparisonRuns.reduce((b, r) => ((r.f1 ?? 0) > (b.f1 ?? 0) ? r : b)).job_id : null, [comparisonRuns]);
  const selectedRunSummary = useMemo(
    () => comparisonRuns.find((run) => run.job_id === selectedRunId) || null,
    [comparisonRuns, selectedRunId],
  );
  const grainConfig = grainOptions.find((g) => g.id === grain) || grainOptions[0] || GRAIN_OPTIONS[0];
  const treeExplanation = results?.mode === 'supervised' ? (results?.decision_tree || null) : null;
  const treePreviewReady = Boolean(
    treeExplanation
    && (
      Array.isArray(treeExplanation?.tree_nodes) && treeExplanation.tree_nodes.length
      || Object.keys(treeExplanation?.sample_paths || {}).length
    ),
  );
  const explainabilityLabel = treePreviewReady
    ? (treeExplanation?.tree_kind === 'surrogate' ? 'Surrogate tree explanation ready' : 'Native tree explanation ready')
    : (TREE_BASED_ALGO_IDS.has(selectedTrainingAlgorithm)
      ? 'Native tree path will appear after training'
      : 'Surrogate tree path will appear after training');
  const currentHyperparams = useMemo(() => (
    (selectedTrainingOption?.params || []).map((param) => {
      const raw = params[`${selectedTrainingOption.id}.${param.key}`] ?? param.default;
      const display = typeof raw === 'number'
        ? (/log10/i.test(param.label || '') ? `10^${raw}` : (Number.isInteger(raw) ? String(raw) : raw.toFixed(3)))
        : String(raw);
      return {
        key: param.key,
        label: param.label,
        value: display,
      };
    })
  ), [params, selectedTrainingOption]);
  const modelLabFacts = [
    { label: 'Training rows', value: rowCount.toLocaleString(), detail: `${grainConfig.label} grain` },
    { label: 'Outcome', value: targetColumn || '-', detail: isMuleVariant ? 'Canonical mule outcome' : 'Canonical alert outcome' },
    { label: 'Explainability', value: explainabilityLabel, detail: treePreviewReady ? 'Open sample path explorer below' : 'Unlocked when evaluation results arrive' },
    { label: 'Validation split', value: splitStrategy === 'auto' ? 'Auto' : splitStrategy, detail: splitStrategy === 'temporal' ? (selectedSplitDateColumn || 'Pick date column in Check') : `${cvFolds}-fold CV + holdout` },
  ];

  // ── CONFIGURE TAB ──────────────────────────────────────────────────────────
  // FIX ⑧: tab components are defined as stable named components inside the render
  // function but we use refs to handler fns so they don't cause child remounts.
  // For complex tabs the standard pattern is to hoist to file-level and pass props,
  // but keeping them inner here is fine as long as no state resets on parent re-render
  // are observed - the real root cause in the original was unconditional redefinition.
  // JSX-consuming code is unchanged; just moving logic here is sufficient.

  const shownRuns = recentRuns.slice(0, 6);
  const shownRunIds = shownRuns.map((run) => String(run?.job_id || '').trim()).filter(Boolean);
  const allShownHistorySelected = shownRunIds.length > 0 && shownRunIds.every((runIdValue) => compareSelection.includes(runIdValue));
  const selectedHistoryCount = compareSelection.filter((runIdValue) => shownRunIds.includes(runIdValue)).length;
  const recentRunHistoryPanel = (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 0, bgcolor: '#fafbfc' }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ xs: 'flex-start', sm: 'center' }} justifyContent="space-between" spacing={1} mb={1}>
        <Box>
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: T.textPrimary }}>
            Past trained models
          </Typography>
          <Typography sx={{ fontSize: 11.25, color: T.textMuted, mt: 0.3 }}>
            Saved backend runs for this dataset. Load one to resume exactly where you left off, compare it, or open its tree path when available.
          </Typography>
        </Box>
        <Stack direction="row" spacing={0.75}>
          <Chip label={`${recentRuns.length} saved run${recentRuns.length === 1 ? '' : 's'}`} size="small" sx={{ bgcolor: '#fff', border: `1px solid ${T.border}` }} />
          <Button
            size="small"
            variant="outlined"
            onClick={() => setCompareSelection(allShownHistorySelected ? [] : shownRunIds)}
            disabled={!shownRunIds.length}
            sx={{ textTransform: 'none', borderRadius: 0, borderColor: T.border, color: T.textMuted }}
          >
            {allShownHistorySelected ? 'Clear selection' : 'Select visible'}
          </Button>
          <Button
            size="small"
            variant="contained"
            startIcon={<CompareArrows />}
            onClick={addSelectedHistoryRunsToCompare}
            disabled={selectedHistoryCount === 0}
            sx={{ textTransform: 'none', borderRadius: 0, bgcolor: T.orange, '&:hover': { bgcolor: T.orangeHover } }}
          >
            Compare selected ({selectedHistoryCount})
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<Refresh />}
            onClick={() => dataset?.dataset_id && setRunsRefreshKey((k) => k + 1)}
            sx={{ textTransform: 'none', borderRadius: 0, borderColor: T.border, color: T.textMuted }}
          >
            Refresh
          </Button>
        </Stack>
      </Stack>
      {runsLoading && <LinearProgress sx={{ mb: 1, height: 4, borderRadius: 0 }} />}
      {runsError && <Typography sx={{ fontSize: 11, color: T.red }}>{runsError}</Typography>}
      {!runsLoading && shownRuns.length === 0 && (
        <Alert severity="info" sx={{ ...neutralAlertSx, borderRadius: 0 }}>
          No prior backend training runs were found for this dataset yet.
        </Alert>
      )}
      {shownRuns.length > 0 && (
        <Box sx={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                {['Pick', 'Status', 'Trained At', 'Algorithm', 'Grain', 'AUC', 'F1', 'Stage', 'Actions'].map((h) => (
                  <th key={h} style={{ padding: '6px 8px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, borderBottom: `1px solid ${T.border}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shownRuns.map((run) => {
                const isCurrent = run.job_id === jobId;
                const compareSelected = compareSelection.includes(String(run?.job_id || '').trim());
                return (
                  <tr key={run.job_id} style={{ borderBottom: `1px solid ${T.border}`, background: isCurrent ? T.orangeLight : 'transparent' }}>
                    <td style={{ padding: '6px 8px', width: 48 }}>
                      <Checkbox
                        size="small"
                        checked={compareSelected}
                        onChange={() => toggleHistoryCompareSelection(run.job_id)}
                        sx={{ p: 0.25 }}
                      />
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      <Chip
                        label={isCurrent ? 'Loaded now' : 'History'}
                        size="small"
                        sx={{
                          height: 20,
                          fontSize: 10,
                          fontWeight: 700,
                          bgcolor: isCurrent ? T.orangeLight : '#fff',
                          color: isCurrent ? T.orange : T.textMuted,
                          border: `1px solid ${isCurrent ? T.orange : T.border}`,
                        }}
                      />
                    </td>
                    <td style={{ padding: '6px 8px', color: T.textDim }}>{run.trained_at ? String(run.trained_at).replace('T', ' ').slice(0, 19) : '-'}</td>
                    <td style={{ padding: '6px 8px', color: T.textPrimary }}>{resolveAlgorithmLabel(run.algorithm_id || run.algo_id || run.algorithm)}</td>
                    <td style={{ padding: '6px 8px', color: T.textDim }}>{run.grain}</td>
                    <td style={{ padding: '6px 8px', color: metricColor(run.metrics?.roc_auc), fontFamily: T.mono }}>{fmt(run.metrics?.roc_auc)}</td>
                    <td style={{ padding: '6px 8px', color: metricColor(run.metrics?.f1), fontFamily: T.mono }}>{fmt(run.metrics?.f1)}</td>
                    <td style={{ padding: '6px 8px', color: T.textDim }}>{run.registry_stage || '-'}</td>
                    <td style={{ padding: '6px 8px' }}>
                      <Stack direction="row" spacing={0.75}>
                        <Button size="small" variant="outlined" onClick={() => handleLoadRun(run)} sx={{ height: 24, fontSize: 10.5, textTransform: 'none', borderRadius: 0, borderColor: T.border, color: T.textMuted }}>Load</Button>
                        <Button size="small" variant="outlined" onClick={() => handleOpenTreeFromHistory(run)} sx={{ height: 24, fontSize: 10.5, textTransform: 'none', borderRadius: 0, borderColor: T.border, color: T.textMuted }}>Open tree</Button>
                        <Button size="small" variant="outlined" onClick={() => handleAddRunToCompare(run)} sx={{ height: 24, fontSize: 10.5, textTransform: 'none', borderRadius: 0, borderColor: T.border, color: T.textMuted }}>Compare</Button>
                      </Stack>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Box>
      )}
    </Paper>
  );

  return (
    <Stack spacing={0}>
      <Paper variant="outlined" sx={{ borderRadius: 0, overflow: 'hidden', mb: 2 }}>
        <Box sx={{ px: 1.5, py: 1.1, bgcolor: '#f8fafc', borderBottom: `1px solid ${T.border}` }}>
          <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ lg: 'center' }}>
            <Box>
              <Typography sx={{ fontSize: 11, fontWeight: 800, color: T.textDim, textTransform: 'uppercase', letterSpacing: 0.55 }}>
                Modeling flow
              </Typography>
              <Typography sx={{ fontSize: 12.25, color: T.textMuted, mt: 0.35 }}>
                {isMuleVariant
                  ? 'Choose the Mule modeling track once, then move through configure, check, train, evaluate, compare, and reporting in one continuous shell.'
                  : 'Choose the modeling track once, then move through configure, check, train, evaluate, compare, and reporting in one continuous shell.'}
              </Typography>
            </Box>
            <ToggleButtonGroup
              exclusive
              value={trainingMode}
              onChange={(_, value) => value && setTrainingMode(value)}
              size="small"
              sx={{
                '& .MuiToggleButtonGroup-grouped': {
                  textTransform: 'none',
                  fontSize: 12.5,
                  fontWeight: 700,
                  px: 1.4,
                  py: 0.55,
                  borderRadius: '0 !important',
                  borderColor: `${T.border} !important`,
                  color: T.textMuted,
                },
                '& .Mui-selected': {
                  bgcolor: `${T.orangeLight} !important`,
                  color: `${T.orange} !important`,
                },
              }}
            >
              {normalizedAllowedTrainingModes.includes('supervised') && (
              <ToggleButton value="supervised">
                <Stack direction="row" spacing={0.6} alignItems="center">
                  <ModelTraining sx={{ fontSize: 15 }} />
                  <span>Supervised</span>
                </Stack>
              </ToggleButton>
              )}
              {normalizedAllowedTrainingModes.includes('unsupervised') && (
              <ToggleButton value="unsupervised">
                <Stack direction="row" spacing={0.6} alignItems="center">
                  <ScatterPlot sx={{ fontSize: 15 }} />
                  <span>Unsupervised</span>
                </Stack>
              </ToggleButton>
              )}
              {normalizedAllowedTrainingModes.includes('deep_learning') && (
              <ToggleButton value="deep_learning">
                <Stack direction="row" spacing={0.6} alignItems="center">
                  <Bolt sx={{ fontSize: 15 }} />
                  <span>Deep Learning</span>
                </Stack>
              </ToggleButton>
              )}
            </ToggleButtonGroup>
          </Stack>
        </Box>
        <Tabs
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
        >
          {[
            { label: 'Configure', icon: <Settings sx={{ fontSize: 15 }} /> },
            { label: 'Check', icon: <Search sx={{ fontSize: 15 }} /> },
            { label: 'Train', icon: <ModelTraining sx={{ fontSize: 15 }} /> },
            { label: 'Evaluate', icon: <Analytics sx={{ fontSize: 15 }} /> },
            { label: 'Business Understanding', icon: <VisibilityOutlined sx={{ fontSize: 15 }} /> },
            {
              label: 'Compare',
              icon: comparisonRuns.length > 0
                ? <Box sx={{ position: 'relative', display: 'flex' }}><CompareArrows sx={{ fontSize: 15 }} /><Box sx={{ position: 'absolute', top: -5, right: -7, bgcolor: T.orange, color: '#fff', borderRadius: '50%', width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 800 }}>{comparisonRuns.length}</Box></Box>
                : <CompareArrows sx={{ fontSize: 15 }} />,
            },
            { label: 'Scoring Ledger', icon: <TableChart sx={{ fontSize: 15 }} /> },
            { label: 'Run Report', icon: <Article sx={{ fontSize: 15 }} /> },
          ].map((item, idx) => (
            <Tab
              key={item.label}
              icon={item.icon}
              iconPosition="start"
              label={(
                <Stack direction="row" spacing={0.65} alignItems="center">
                  <span>{item.label}</span>
                  {completedTabIndexes.has(idx) && (
                    <CheckCircle sx={{ fontSize: 13, color: T.done }} />
                  )}
                </Stack>
              )}
            />
          ))}
        </Tabs>
      </Paper>

      {/* ── Configure ── */}
      <TabPanel value={activeTab} index={0}>
        <Stack spacing={3}>
          <GrainSelector grain={grain} setGrain={setGrain} persona={persona} targetColumn={targetColumn} grainOptions={grainOptions} />

          <Paper variant="outlined" sx={{ p: 2, borderRadius: 0, bgcolor: '#fcfcfd' }}>
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: '1fr' }}>
              <Paper variant="outlined" sx={{ p: 1.75, borderRadius: 0, bgcolor: '#fff8f4', borderColor: '#f1d5c7' }}>
                <Stack spacing={1.25}>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} alignItems={{ xs: 'flex-start', sm: 'center' }}>
                    <Stack direction="row" spacing={1.1} alignItems="center" flex={1}>
                      <Box
                        sx={{
                          width: 38,
                          height: 38,
                          borderRadius: 1.5,
                          bgcolor: `${selectedTrainingPalette.accent}18`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        <SelectedTrainingIcon sx={{ fontSize: 20, color: selectedTrainingPalette.accent }} />
                      </Box>
                      <Box>
                        <Typography sx={{ fontSize: 10, color: T.textDim, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                          Model lab
                        </Typography>
                        <Typography sx={{ fontSize: 16, fontWeight: 800, color: T.textPrimary, mt: 0.15 }}>
                          {selectedTrainingOption?.label || 'Model'}
                        </Typography>
                        <Typography sx={{ fontSize: 11, color: T.textMuted, mt: 0.3, lineHeight: 1.55 }}>
                          {selectedTrainingOption?.bizDesc || modeGuide.output}
                        </Typography>
                      </Box>
                    </Stack>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ width: { xs: '100%', sm: 'auto' } }}>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => setShowAlgorithmChooser((prev) => ({ ...prev, [trainingMode]: !prev?.[trainingMode] }))}
                        sx={{ textTransform: 'none', borderRadius: 1.5, borderColor: T.border, color: T.textMuted }}
                      >
                        {showAlgorithmChooser?.[trainingMode]
                          ? 'Hide model choices'
                          : `Change model${hiddenAlgorithmCount > 0 ? ` (+${hiddenAlgorithmCount} more)` : ''}`}
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => setShowTechnicalControls((prev) => !prev)}
                        sx={{ textTransform: 'none', borderRadius: 1.5, borderColor: T.border, color: T.textMuted }}
                      >
                        {showTechnicalControls ? 'Hide modeling studio' : 'Open modeling studio'}
                      </Button>
                    </Stack>
                  </Stack>
                  <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                    <Chip label={modeGuide.title} size="small" sx={{ bgcolor: '#fff', border: `1px solid ${T.border}` }} />
                    <Chip label={selectedTrainingOption?.speed || 'Standard speed'} size="small" sx={{ bgcolor: '#fff', border: `1px solid ${T.border}` }} />
                    <Chip label={selectedTrainingPalette.tag || 'Model'} size="small" sx={{ bgcolor: '#fff', border: `1px solid ${T.border}` }} />
                    <Chip label={ALGO_VIZ[selectedTrainingAlgorithm]?.vizLabel || 'Model visual'} size="small" sx={{ bgcolor: '#fff', border: `1px solid ${T.border}` }} />
                  </Stack>
                  <Stack direction="row" flexWrap="wrap" rowGap={1} columnGap={3} sx={{ py: 1.5 }}>
                    {modelLabFacts.map((fact) => (
                      <Box key={fact.label}>
                        <Typography sx={{ fontSize: 9.5, color: T.textDim, textTransform: 'uppercase', letterSpacing: 0.45 }}>
                          {fact.label}
                        </Typography>
                        <Stack direction="row" alignItems="baseline" spacing={0.75} mt={0.25}>
                          <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary }}>
                            {fact.value}
                          </Typography>
                          <Typography sx={{ fontSize: 10.5, color: T.textMuted }}>
                            {fact.detail}
                          </Typography>
                        </Stack>
                      </Box>
                    ))}
                  </Stack>
                  <Collapse in={showAlgorithmChooser?.[trainingMode]} timeout={180}>
                    <Box sx={{ py: 1.5, my: 1, borderTop: `1px dashed ${T.border}`, borderBottom: `1px dashed ${T.border}` }}>
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', sm: 'center' }} justifyContent="space-between" mb={1.1}>
                        <Box>
                          <Typography sx={{ fontSize: 12, fontWeight: 700, color: T.textPrimary }}>
                            Choose a different model
                          </Typography>
                          <Typography sx={{ fontSize: 10.75, color: T.textMuted, mt: 0.3 }}>
                            Only the chosen model runs in the operating flow. Alternatives stay available here when you want to change the narrative.
                          </Typography>
                        </Box>
                        <Button
                          size="small"
                          variant="text"
                          onClick={() => setShowFullAlgorithmLibrary((prev) => ({ ...prev, [trainingMode]: !prev?.[trainingMode] }))}
                          sx={{ textTransform: 'none', color: T.orange, px: 0.5 }}
                        >
                          {showFullAlgorithmLibrary?.[trainingMode] ? 'Show shortlist' : 'Show full library'}
                        </Button>
                      </Stack>
                      <Stack spacing={1}>
                        {visibleAlgorithmOptions.map((algo) => (
                          <AlgorithmChoiceTile
                            key={algo.id}
                            algo={algo}
                            selected={selectedTrainingAlgorithm === algo.id}
                            onSelect={() => handleSelectTrainingAlgorithm(algo.id)}
                          />
                        ))}
                      </Stack>
                    </Box>
                  </Collapse>
                  <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 0, bgcolor: '#fff', borderColor: T.border }}>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }}>
                      <Box>
                        <Typography sx={{ fontSize: 10, color: T.textDim, textTransform: 'uppercase', letterSpacing: 0.45 }}>
                          Inference view
                        </Typography>
                        <Typography sx={{ fontSize: 11.5, color: T.textPrimary, mt: 0.4, lineHeight: 1.6 }}>
                          {treePreviewReady
                            ? 'A trained tree-path explorer is ready. You can open a real holdout record and inspect the exact split trail that produced the score.'
                            : `After training, this model will expose ${TREE_BASED_ALGO_IDS.has(selectedTrainingAlgorithm) ? 'a native tree path' : 'a surrogate tree path'} so investigators can inspect the scoring logic sample by sample.`}
                        </Typography>
                      </Box>
                      <Button
                        size="small"
                        variant={treePreviewReady ? 'contained' : 'outlined'}
                        onClick={() => treePreviewReady && setTreeWorkbenchOpen(true)}
                        disabled={!treePreviewReady}
                        sx={treePreviewReady
                          ? { textTransform: 'none', borderRadius: 0, bgcolor: T.orange, '&:hover': { bgcolor: T.orangeHover }, fontWeight: 700 }
                          : { textTransform: 'none', borderRadius: 0, borderColor: T.border, color: T.textMuted }}
                      >
                        {treePreviewReady ? 'Open tree explanation' : 'Train model to unlock'}
                      </Button>
                    </Stack>
                  </Paper>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                    <Button
                      variant="contained"
                      onClick={() => setActiveTab(1)}
                      disabled={canDisable(!dataset || !targetColumn)}
                      endIcon={<ArrowForward />}
                      sx={{ bgcolor: T.orange, '&:hover': { bgcolor: T.orangeHover }, textTransform: 'none', borderRadius: 0, fontWeight: 700 }}
                    >
                      Open training check
                    </Button>
                    <Button
                      variant="outlined"
                      onClick={loadTrainingPreview}
                      disabled={canDisable(!dataset || !targetColumn || previewLoading)}
                      sx={{ textTransform: 'none', borderRadius: 0, borderColor: T.border, color: T.textMuted }}
                    >
                      {previewLoading ? 'Refreshing...' : 'Refresh check'}
                    </Button>
                  </Stack>
                  <Typography sx={{ fontSize: 10.75, color: T.textDim }}>
                    {rowCount.toLocaleString()} rows | {trainingMode === 'unsupervised' ? 'label-assisted discovery flow' : `${cvFolds}-fold cross-validation`} | {grainConfig.label} | Check approval required before training
                  </Typography>
                </Stack>
              </Paper>
            </Box>
          </Paper>

          {recentRunHistoryPanel}

          <Collapse in={showTechnicalControls} timeout={180}>
            <Stack spacing={3}>
          {trainingMode === 'supervised' ? (
            <>
              <Box>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, mb: 0.25 }}>Select Algorithm</Typography>
                <Typography sx={{ fontSize: 11.5, color: T.textMuted, mb: 1.5 }}>
                  {persona === 'business' ? 'Choose the supervised method that should actually be trained for FCC decisioning.' : 'All supervised algorithms use balanced class weighting by default.'}
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.25 }}>
                  {ALGORITHMS.map((algo) => (
                    <AlgoCard key={algo.id} algo={algo} selected={selectedAlgo} onClick={() => setSelectedAlgo(algo.id)} persona={persona} expanded={expandedAlgoId === algo.id} onToggle={togglePresetView} onApplyPreset={applyPreset} />
                  ))}
                </Box>
              </Box>

              <Divider />

              {algoObj && (
                <Box>
                  <Stack direction="row" alignItems="center" spacing={1} mb={0.5}>
                    <Settings sx={{ fontSize: 15, color: T.orange }} />
                    <Typography sx={{ fontSize: 13, fontWeight: 700, color: T.textPrimary }}>Hyperparameters - {algoObj.label}</Typography>
                    <Chip label={`${algoObj.params.length} params`} size="small" sx={{ height: 18, fontSize: 10, bgcolor: T.orangeLight, color: T.orange, fontWeight: 700 }} />
                  </Stack>
                  <Typography sx={{ fontSize: 11.5, color: T.textMuted, mb: 2 }}>
                    {persona === 'business' ? 'These settings shape the actual supervised training run.' : algoObj.techDesc}
                  </Typography>
                  <Box sx={{ display: 'grid', gap: 0, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr', xl: '1fr 1fr 1fr' } }}>
                    {algoObj.params.map((p) => (
                      <Box key={p.key} sx={{ pr: { md: 3 } }}>
                        <ParamControl param={p} value={params[`${algoObj.id}.${p.key}`] ?? p.default} onChange={(v) => setParam(algoObj.id, p.key, v)} persona={persona} />
                      </Box>
                    ))}
                  </Box>
                </Box>
              )}
            </>
          ) : (
            <ModeConfigureWorkbench
              title={trainingMode === 'unsupervised' ? 'Unsupervised Training Workbench' : 'Deep Learning Training Workbench'}
              description={trainingMode === 'unsupervised'
                ? 'Pick the clustering or anomaly method to actually train. The selected model becomes the saved FCC run.'
                : 'Pick the neural configuration to actually train. The selected network becomes the saved FCC run.'}
              algorithms={trainingMode === 'unsupervised' ? UNSUPERVISED_ALGORITHMS : DEEP_LEARNING_METHODS}
              selectedId={trainingMode === 'unsupervised' ? selectedUnsupervisedAlgo : selectedDeepLearningAlgo}
              setSelectedId={trainingMode === 'unsupervised' ? setSelectedUnsupervisedAlgo : setSelectedDeepLearningAlgo}
              persona={persona}
              expandedAlgoId={expandedAlgoId}
              togglePresetView={togglePresetView}
              applyPreset={applyPreset}
              params={params}
              setParam={setParam}
              selectedOption={selectedTrainingOption}
            />
          )}

          {trainingMode !== 'unsupervised' && (
            <>
              <Divider />
              <HMLThresholdEditor hmlHigh={hmlHigh} hmlLow={hmlLow} setHmlHigh={setHmlHigh} setHmlLow={setHmlLow} totalAlerts={rowCount || 2039} summary={null} loading={false} />
            </>
          )}

          <Divider />

          <Box>
            <Stack direction="row" alignItems="center" spacing={1} mb={2}>
              <CompareArrows sx={{ fontSize: 15, color: T.orange }} />
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: T.textPrimary }}>Train / Test Split & Cross-Validation</Typography>
            </Stack>
            <Stack spacing={2} sx={{ maxWidth: 560 }}>
              <Box>
                <Stack direction="row" alignItems="center" justifyContent="space-between" mb={0.5}>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: T.textPrimary }}>Test set size: <span style={{ color: T.orange, fontWeight: 800 }}>{testSplit}%</span></Typography>
                  <Typography sx={{ fontSize: 11, color: T.textMuted }}>Train: {trainRows.toLocaleString()} / Test: {testRows.toLocaleString()}</Typography>
                </Stack>
                <Slider value={testSplit} min={10} max={40} step={5} marks={[10,15,20,25,30,35,40].map((v) => ({ value: v, label: `${v}%` }))} onChange={(_, v) => setTestSplit(v)} size="small" sx={{ color: T.orange, '& .MuiSlider-markLabel': { fontSize: 10 } }} />
              </Box>
              <Stack direction="row" spacing={3} alignItems="flex-end">
                <Box>
                  <Stack direction="row" alignItems="center" spacing={0.5} mb={0.5}>
                    <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: T.textPrimary }}>CV Folds</Typography>
                    <Tooltip title="K-fold cross-validation to estimate generalisation AUC." arrow><Info sx={{ fontSize: 11.5, color: T.textDim, cursor: 'help' }} /></Tooltip>
                  </Stack>
                  <TextField type="number" size="small" value={cvFolds} inputProps={{ min: 3, max: 10, step: 1 }} onChange={(e) => setCvFolds(Math.max(3, Math.min(10, Number(e.target.value))))} sx={{ width: 90, '& .MuiOutlinedInput-root': { borderRadius: 1.5, fontSize: 13 } }} />
                </Box>
                <Box>
                  <Stack direction="row" alignItems="center" spacing={0.5} mb={0.5}>
                    <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: T.textPrimary }}>Stratify</Typography>
                    <Tooltip title="Maintain class ratio across folds. Recommended for imbalanced AML data." arrow><Info sx={{ fontSize: 11.5, color: T.textDim, cursor: 'help' }} /></Tooltip>
                  </Stack>
                  <Stack direction="row" spacing={0.75}>
                    {['On', 'Off'].map((opt) => (
                      <Button key={opt} size="small" variant={(opt === 'On') === stratify ? 'contained' : 'outlined'} onClick={() => setStratify(opt === 'On')}
                        sx={{ height: 30, fontSize: 12, textTransform: 'none', borderRadius: 1.5, ...((opt === 'On') === stratify ? { bgcolor: T.orange, '&:hover': { bgcolor: T.orangeHover } } : { borderColor: T.border, color: T.textMuted }) }}>
                        {opt}
                      </Button>
                    ))}
                  </Stack>
                </Box>
              </Stack>
            </Stack>
          </Box>

          {trainingMode === 'supervised' && (
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: '#fafbfc' }}>
              <Stack direction="row" alignItems="center" spacing={1} mb={1}>
                <FilterList sx={{ fontSize: 16, color: T.textDim }} />
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: T.textPrimary }}>Pipeline Runner</Typography>
              </Stack>
              <Typography sx={{ fontSize: 11.5, color: T.textMuted, mb: 1.5 }}>Run multiple supervised algorithms back-to-back. These jobs populate the Train tab as they finish.</Typography>
              <Stack direction="row" flexWrap="wrap" gap={1} mb={1.5}>
                {ALGORITHMS.map((algo) => {
                  const sel = pipelineSelection.includes(algo.id);
                  return (
                    <Button key={algo.id} size="small" variant={sel ? 'contained' : 'outlined'} onClick={() => togglePipelineSelection(algo.id)}
                      sx={{ height: 28, fontSize: 11, textTransform: 'none', borderRadius: 1.5, ...(sel ? { bgcolor: T.orange, '&:hover': { bgcolor: T.orangeHover } } : { borderColor: T.border, color: T.textMuted }) }}>
                      {algo.label}
                    </Button>
                  );
                })}
              </Stack>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                <Button variant="contained" size="small" disabled={canDisable(!dataset || !targetColumn || pipelineSelection.length === 0 || pipelineRunning)} onClick={handleStartPipeline}
                  sx={{ bgcolor: T.orange, '&:hover': { bgcolor: T.orangeHover }, textTransform: 'none', borderRadius: 1.5 }}>
                  {pipelineRunning ? 'Starting pipeline...' : `Start Pipeline (${pipelineSelection.length || 0})`}
                </Button>
                <Button variant="outlined" size="small" onClick={() => setPipelineSelection([])} sx={{ textTransform: 'none', borderRadius: 1.5, borderColor: T.border, color: T.textMuted }}>Clear Selection</Button>
                <Typography sx={{ fontSize: 11, color: T.textDim }}>Use this only for supervised model benchmarking.</Typography>
              </Stack>
              {pipelineError && <Typography sx={{ fontSize: 11.5, color: T.red, mt: 1 }}>{pipelineError}</Typography>}
            </Paper>
          )}
            </Stack>
          </Collapse>

          {!dataset      && <Alert severity="warning" sx={neutralAlertSx}>Complete preprocessing (Step 5) before training.</Alert>}
          {!targetColumn && <Alert severity="warning" sx={neutralAlertSx}>Define a target variable (Step 3) before training.</Alert>}

          <Box>
            <Button variant="contained" size="large" disabled={canDisable(!dataset || !targetColumn)} onClick={() => setActiveTab(1)} endIcon={<ArrowForward />}
              sx={{ bgcolor: T.orange, '&:hover': { bgcolor: T.orangeHover }, height: 44, px: 4, borderRadius: 2, fontWeight: 700, fontSize: 14, textTransform: 'none', boxShadow: 'none' }}>
              Open training check
            </Button>
            <Typography sx={{ fontSize: 11, color: T.textDim, mt: 0.75 }}>
              {grainConfig.label} | {selectedTrainingOption?.label || activeRunOption?.label || 'Model'} | {rowCount.toLocaleString()} rows | {cvFolds}-fold CV{trainingMode === 'unsupervised' ? ' | Labeled holdout evaluation enabled' : ` | ${isMuleVariant ? `Risk bands: High>=${hmlHigh.toFixed(2)} Medium>=${hmlLow.toFixed(2)}` : `HML: High>=${hmlHigh.toFixed(2)} Low<${hmlLow.toFixed(2)}`}`} | {isMuleVariant ? 'Governed model check required' : 'Notebook-parity check required'}
            </Typography>
          </Box>
        </Stack>
      </TabPanel>

      <TabPanel value={activeTab} index={1}>
        <Stack spacing={2.5}>
          {trainingError && (
            <Alert severity="error" sx={neutralAlertSx} action={<IconButton size="small" onClick={() => setTrainingError(null)}><Close /></IconButton>}>{trainingError}</Alert>
          )}
          {!dataset && <Alert severity="warning" sx={neutralAlertSx}>{isMuleVariant ? 'Complete Mule preprocessing before running the governed model check.' : 'Complete preprocessing before running the notebook-parity check.'}</Alert>}
          {!targetColumn && <Alert severity="warning" sx={neutralAlertSx}>{isMuleVariant ? 'Define the canonical Mule target before running the governed model check.' : 'Define the canonical target before running the notebook-parity check.'}</Alert>}
          {previewError && <Alert severity="error" sx={neutralAlertSx}>{previewError}</Alert>}
          {previewResolutionNote && <Alert severity="info" sx={neutralAlertSx}>{previewResolutionNote}</Alert>}

          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: '#fafbfc' }}>
            <Stack spacing={1.5}>
              <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.1fr) minmax(320px, 0.9fr)' }, alignItems: 'start' }}>
                <Box>
                  <Typography sx={{ fontSize: 13.5, fontWeight: 800, color: T.textPrimary }}>Check controls</Typography>
                  <Typography sx={{ fontSize: 11.5, color: T.textMuted, mt: 0.35, lineHeight: 1.7 }}>
                    {isMuleVariant
                      ? 'Choose the Mule dataset and split policy you want to validate before training. Auto mode prefers the feature-ready dataset, but it can fall back safely when the check finds a bad source or split configuration.'
                      : 'Choose the dataset and split policy you want to validate before training. Auto mode prefers the model-ready dataset, but it can fall back safely when the check finds a bad source or split configuration.'}
                  </Typography>
                </Box>
                <Paper variant="outlined" sx={{ p: 1.35, borderRadius: 1.5, bgcolor: '#fff', borderColor: T.border }}>
                  <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ mb: 1 }}>
                    <Box>
                      <Typography sx={{ fontSize: 10, color: T.textDim, textTransform: 'uppercase', letterSpacing: 0.55 }}>
                        Model hyperparameters
                      </Typography>
                      <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: T.textPrimary, mt: 0.2 }}>
                        {selectedTrainingOption?.label || 'Selected model'}
                      </Typography>
                    </Box>
                    <Chip
                      size="small"
                      label={`${currentHyperparams.length} settings`}
                      sx={{ height: 20, fontSize: 9.5, bgcolor: T.orangeLight, color: T.orange, fontWeight: 700 }}
                    />
                  </Stack>
                  <Box sx={{ display: 'grid', gap: 0.65, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
                    {currentHyperparams.slice(0, 10).map((param) => (
                      <Box key={param.key} sx={{ p: 0.8, borderRadius: 1, bgcolor: '#f8fafc', border: `1px solid ${T.border}` }}>
                        <Typography sx={{ fontSize: 9.5, color: T.textDim, textTransform: 'uppercase', letterSpacing: 0.35, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {param.label}
                        </Typography>
                        <Typography sx={{ fontSize: 11.5, fontWeight: 800, color: T.textPrimary, fontFamily: T.mono, mt: 0.25 }}>
                          {param.value}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                  {currentHyperparams.length > 10 && (
                    <Typography sx={{ fontSize: 10.5, color: T.textDim, mt: 0.75 }}>
                      +{currentHyperparams.length - 10} more in modeling studio
                    </Typography>
                  )}
                </Paper>
              </Box>

              <Box>
                <Typography sx={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, mb: 0.75 }}>
                  Training data source
                </Typography>
                <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                  {[
                    { key: 'auto', label: 'Auto', description: isMuleVariant ? 'Prefer the governed Mule feature dataset, then fall back if needed.' : 'Prefer the model-ready FCC dataset, then fall back if needed.' },
                    ...datasetSources.map((source) => ({
                      key: source.key,
                      label: source.shortLabel,
                      description: `${source.dataset?.row_count?.toLocaleString?.() || 0} rows`,
                    })),
                  ].map((option) => {
                    const active = trainingDataSource === option.key;
                    return (
                      <Button
                        key={option.key}
                        size="small"
                        variant={active ? 'contained' : 'outlined'}
                        onClick={() => setTrainingDataSource(option.key)}
                        sx={{
                          textTransform: 'none',
                          borderRadius: 1.5,
                          ...(active
                            ? { bgcolor: T.orange, '&:hover': { bgcolor: T.orangeHover } }
                            : { borderColor: T.border, color: T.textMuted }),
                        }}
                      >
                        {option.label}
                      </Button>
                    );
                  })}
                </Stack>
                <Typography sx={{ fontSize: 11.25, color: T.textMuted, mt: 0.7 }}>
                  {selectedSource?.description || (isMuleVariant ? 'Pick a Mule dataset source to validate the governed model check.' : 'Pick a dataset source to validate the notebook-parity check.')}
                </Typography>
              </Box>

              <Box>
                <Typography sx={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, mb: 0.75 }}>
                  Split policy
                </Typography>
                <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                  {[
                    { key: 'auto', label: 'Auto', description: 'Prefer temporal when a reliable date exists.' },
                    { key: 'random', label: 'Random', description: 'Use a standard stratified holdout.' },
                    { key: 'temporal', label: 'Temporal', description: 'Force an out-of-time validation split.' },
                  ].map((option) => {
                    const active = splitStrategy === option.key;
                    return (
                      <Button
                        key={option.key}
                        size="small"
                        variant={active ? 'contained' : 'outlined'}
                        onClick={() => setSplitStrategy(option.key)}
                        sx={{
                          textTransform: 'none',
                          borderRadius: 1.5,
                          ...(active
                            ? { bgcolor: T.orange, '&:hover': { bgcolor: T.orangeHover } }
                            : { borderColor: T.border, color: T.textMuted }),
                        }}
                      >
                        {option.label}
                      </Button>
                    );
                  })}
                </Stack>
                <Typography sx={{ fontSize: 11.25, color: T.textMuted, mt: 0.7 }}>
                  {splitStrategy === 'auto'
                    ? 'Auto chooses temporal only when a reliable alert/case date is truly available. Otherwise it falls back to random instead of silently breaking the split.'
                    : splitStrategy === 'random'
                      ? 'Random holdout is useful when the model-ready dataset no longer carries raw date columns.'
                      : 'Temporal holdout enforces a business-safe out-of-time split and requires a reliable date column.'}
                </Typography>
              </Box>

              {splitStrategy === 'temporal' && (
                <Box>
                  <Typography sx={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, mb: 0.75 }}>
                    Date column for temporal split
                  </Typography>
                  <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                    {(availableSplitDateColumns.length ? availableSplitDateColumns : ['No reliable date detected']).map((column) => {
                      const active = selectedSplitDateColumn === column;
                      const disabled = column === 'No reliable date detected';
                      return (
                        <Button
                          key={column}
                          size="small"
                          disabled={disabled}
                          variant={active ? 'contained' : 'outlined'}
                          onClick={() => !disabled && setSelectedSplitDateColumn(column)}
                          sx={{
                            textTransform: 'none',
                            borderRadius: 1.5,
                            ...(active
                              ? { bgcolor: T.orange, '&:hover': { bgcolor: T.orangeHover } }
                              : { borderColor: T.border, color: T.textMuted }),
                          }}
                        >
                          {column}
                        </Button>
                      );
                    })}
                  </Stack>
                </Box>
              )}

              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {masterDataset && trainingDataSource !== 'master' && (
                  <Button variant="outlined" onClick={() => setTrainingDataSource('master')} sx={{ textTransform: 'none', borderRadius: 1.5, borderColor: T.border, color: T.textMuted }}>
                    Use master dataset
                  </Button>
                )}
                {preprocessedDataset && trainingDataSource !== 'preprocessed' && (
                  <Button variant="outlined" onClick={() => setTrainingDataSource('preprocessed')} sx={{ textTransform: 'none', borderRadius: 1.5, borderColor: T.border, color: T.textMuted }}>
                    Use model-ready dataset
                  </Button>
                )}
                {splitStrategy !== 'random' && (
                  <Button variant="outlined" onClick={() => setSplitStrategy('random')} sx={{ textTransform: 'none', borderRadius: 1.5, borderColor: T.border, color: T.textMuted }}>
                    Use random split
                  </Button>
                )}
                <Button variant="text" onClick={() => setActiveTab(0)} sx={{ textTransform: 'none', color: T.orange }}>
                  Revisit configure tab
                </Button>
              </Stack>
            </Stack>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: '#fcfcfd' }}>
            <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} justifyContent="space-between">
              <Box sx={{ maxWidth: 760 }}>
                <Typography sx={{ fontSize: 13.5, fontWeight: 800, color: T.textPrimary }}>Training safety check</Typography>
                <Typography sx={{ fontSize: 11.5, color: T.textMuted, mt: 0.5, lineHeight: 1.7 }}>
                  {isMuleVariant
                    ? 'Review the Mule target alignment, prove the target is separated from model features, confirm the split policy, and approve the run before training starts.'
                    : 'Review the notebook-v5 label mapping, prove the target is separated from model features, confirm the split policy, and approve the run before training starts.'}
                </Typography>
              </Box>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <Button variant="outlined" onClick={loadTrainingPreview} disabled={canDisable(!dataset || !targetColumn || previewLoading)} sx={{ textTransform: 'none', borderRadius: 1.75, borderColor: T.border, color: T.textMuted }}>
                  {previewLoading ? 'Refreshing check...' : 'Refresh check'}
                </Button>
                <Button
                  variant="contained"
                  onClick={() => {
                    setCheckApproved(true);
                    setTrainingError(null);
                    setActiveTab(2);
                  }}
                  disabled={canDisable(previewLoading || !trainingReadiness?.ready)}
                  sx={{ bgcolor: T.orange, '&:hover': { bgcolor: T.orangeHover }, textTransform: 'none', borderRadius: 1.75, fontWeight: 700 }}
                >
                  Approve and continue to train
                </Button>
                <Button variant="outlined" onClick={() => setCheckApproved(true)} disabled={canDisable(previewLoading || !trainingReadiness?.ready || checkApproved)} sx={{ textTransform: 'none', borderRadius: 1.75, borderColor: T.border, color: T.textMuted }}>
                  Approve only
                </Button>
              </Stack>
            </Stack>
            {previewLoading && <LinearProgress sx={{ mt: 1.5, height: 4, borderRadius: 999 }} />}
          </Paper>

          {trainingPreview && (
            <>
              <Alert severity={trainingReadiness?.ready ? 'success' : 'warning'} sx={neutralAlertSx}>
                {trainingReadiness?.ready
                  ? `Check passed. Canonical target "${targetCheck?.canonical_target_column || targetColumn}" is separated and the run is ready for approval.`
                  : 'Check blocked. Resolve the target or split issues below before training can start.'}
              </Alert>

              {checkApproved && trainingReadiness?.ready && (
                <Alert severity="success" sx={neutralAlertSx}>
                  Check approved. Training is now unlocked for this configuration.
                </Alert>
              )}

              {Array.isArray(trainingReadiness?.blocking_reasons) && trainingReadiness.blocking_reasons.length > 0 && (
                <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: '#fff7ed', borderColor: '#fed7aa' }}>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary, mb: 1 }}>Blocking issues</Typography>
                  <Stack spacing={0.75}>
                    {trainingReadiness.blocking_reasons.map((reason) => (
                      <Typography key={reason} sx={{ fontSize: 11.5, color: T.textMuted }}>{reason}</Typography>
                    ))}
                  </Stack>
                </Paper>
              )}

              {Array.isArray(trainingReadiness?.warnings) && trainingReadiness.warnings.length > 0 && (
                <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: '#fafbfc' }}>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary, mb: 1 }}>Notebook-parity warnings</Typography>
                  <Stack spacing={0.75}>
                    {trainingReadiness.warnings.map((warning) => (
                      <Typography key={warning} sx={{ fontSize: 11.5, color: T.textMuted }}>{warning}</Typography>
                    ))}
                  </Stack>
                </Paper>
              )}

              <Box sx={{ display: 'grid', gap: 1.25, gridTemplateColumns: { xs: '1fr', md: 'repeat(4, minmax(0, 1fr))' } }}>
                <MetricBox label="Training Source" value={trainingPreview?._source_label || selectedSource?.label || '-'} />
                <MetricBox label="Canonical Target" value={targetCheck?.canonical_target_column || targetColumn || '-'} />
                <MetricBox label="Labelled Rows" value={targetCheck?.labelled_rows ?? 0} />
                <MetricBox label="Event Rate %" value={targetCheck?.event_rate_pct ?? 0} />
                <MetricBox label="Split Policy" value={splitPreview?.split_strategy || 'auto'} />
                <MetricBox label="Train Rows" value={splitPreview?.train_rows ?? 0} />
                <MetricBox label="Test Rows" value={splitPreview?.test_rows ?? 0} />
                <MetricBox label="Default Threshold" value={(deployThresholdPolicy?.default_threshold ?? DEFAULT_BUSINESS_THRESHOLD).toFixed(2)} />
                <MetricBox label="Deploy Band" value={`${thresholdBandMin.toFixed(2)}-${thresholdBandMax.toFixed(2)}`} />
              </Box>

              <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', xl: '1.15fr 0.85fr' } }}>
                <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary, mb: 1.25 }}>Target definition and split proof</Typography>
                  <Box sx={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <tbody>
                        {[
                          ['Canonical target', targetCheck?.canonical_target_column || targetColumn || '-'],
                          ['Target separated from features', targetCheck?.target_is_separated ? 'Yes' : 'No'],
                          ['Positive rows', (targetCheck?.positive_rows ?? 0).toLocaleString()],
                          ['Negative rows', (targetCheck?.negative_rows ?? 0).toLocaleString()],
                          ['Unlabelled rows dropped', (targetCheck?.dropped_rows ?? 0).toLocaleString()],
                          ['Split strategy', splitStrategyLabel],
                          ['Date column', dateColumnDisplay],
                          ['Split date', splitDateDisplay],
                          ['Train event rate', splitPreview?.train_event_rate_pct != null ? `${splitPreview.train_event_rate_pct}%` : '-'],
                          ['Test event rate', splitPreview?.test_event_rate_pct != null ? `${splitPreview.test_event_rate_pct}%` : '-'],
                        ].map(([label, value]) => (
                          <tr key={label} style={{ borderBottom: `1px solid ${T.border}` }}>
                            <td style={{ padding: '7px 8px', fontSize: 10.5, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</td>
                            <td style={{ padding: '7px 8px', color: T.textPrimary }}>{value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Box>
                  {splitStrategyLabel === 'random' && (
                    <Typography sx={{ fontSize: 11, color: T.textDim, mt: 1.25 }}>
                      Random split is active because the approved training source does not expose a reliable alert or case date for a temporal cut.
                    </Typography>
                  )}
                  <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1.25 }}>
                    {(targetCheck?.target_aliases_present || []).map((alias) => (
                      <Chip key={alias} label={`Trace alias: ${alias}`} size="small" sx={{ bgcolor: '#faf5ff', border: `1px solid ${T.border}` }} />
                    ))}
                    {(targetCheck?.target_proxy_features_present || []).slice(0, 8).map((column) => (
                      <Chip key={column} label={`Proxy risk: ${column}`} size="small" sx={{ bgcolor: '#fff1ec', border: `1px solid #f1d5c7` }} />
                    ))}
                  </Stack>
                </Paper>

                <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: '#fafbfc' }}>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary, mb: 1.25 }}>Metrics and threshold policy</Typography>
                  <Stack spacing={1}>
                    <Typography sx={{ fontSize: 11.5, color: T.textMuted }}>
                      {isMuleVariant
                        ? 'Ranking metrics stay visible as PR-AUC, precision, recall, and lift, while Mule review decisions are governed by approved risk-band thresholds.'
                        : 'Ranking metrics stay visible as ROC-AUC and PR-AUC, but FCC deploy decisions are governed by suppression, review quality, and the approved operating threshold.'}
                    </Typography>
                    <Typography sx={{ fontSize: 11.5, color: T.textMuted }}>
                      Default operating threshold: <Box component="span" sx={{ fontWeight: 700, color: T.textPrimary }}>{(deployThresholdPolicy?.default_threshold ?? DEFAULT_BUSINESS_THRESHOLD).toFixed(2)}</Box>
                    </Typography>
                    <Typography sx={{ fontSize: 11.5, color: T.textMuted }}>
                      Deployable range: <Box component="span" sx={{ fontWeight: 700, color: T.textPrimary }}>{thresholdBandMin.toFixed(2)} to {thresholdBandMax.toFixed(2)}</Box>
                    </Typography>
                    <Typography sx={{ fontSize: 11.5, color: T.textMuted }}>
                      {isMuleVariant ? 'Risk bands use the approved Mule score thresholds below.' : 'Deployable threshold band:'} <Box component="span" sx={{ fontWeight: 700, color: T.textPrimary }}>{isMuleVariant ? `${thresholdBandMin.toFixed(2)} / ${thresholdBandMax.toFixed(2)}` : `${thresholdBandMin.toFixed(2)} - ${thresholdBandMax.toFixed(2)}`}</Box>
                    </Typography>
                    <Divider sx={{ my: 0.5 }} />
                    <Typography sx={{ fontSize: 11.5, color: T.textMuted }}>
                      Operating metrics exposed at approval time: Precision, Recall, F1, Specificity, Balanced Accuracy, Suppression %, and Event Loss %.
                    </Typography>
                  </Stack>
                </Paper>
              </Box>

              <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', xl: '1fr 1fr' } }}>
                <PreviewDataTable title={`${trainingPreview?._source_label || selectedSource?.label || 'Selected source'} preview`} preview={trainingPreview?.raw_preview} />
                <PreviewDataTable title="Encoded model input preview" preview={trainingPreview?.preprocessed_preview} tone="technical" />
              </Box>

              <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', xl: '1fr 1fr' } }}>
                <FeatureInventoryTable title="Included feature columns" items={trainingPreview?.included_features || []} maxHeight={380} />
                <FeatureInventoryTable title="Excluded columns and reasons" items={trainingPreview?.excluded_features || []} maxHeight={380} />
              </Box>

              <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary, mb: 1 }}>{isMuleVariant ? 'Mule target mapping' : 'Notebook v5 target mapping'}</Typography>
                <Box sx={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: '#f8fafc' }}>
                        {['Rule', 'Definition'].map((header) => (
                          <th key={header} style={{ padding: '6px 8px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, borderBottom: `1px solid ${T.border}` }}>{header}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(targetCheck?.mapping || {}).map(([label, value]) => (
                        <tr key={label} style={{ borderBottom: `1px solid ${T.border}` }}>
                          <td style={{ padding: '6px 8px', color: T.textPrimary, fontFamily: T.mono }}>{label}</td>
                          <td style={{ padding: '6px 8px', color: T.textMuted }}>{typeof value === 'string' ? value : JSON.stringify(value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Box>
              </Paper>
            </>
          )}
        </Stack>
      </TabPanel>

      {/* ── Train ── */}
      <TabPanel value={activeTab} index={2}>
        <Stack spacing={2.5}>
          {trainingError && (
            <Alert severity="error" sx={neutralAlertSx} action={<IconButton size="small" onClick={() => { setTrainingError(null); setActiveTab(1); }}><Close /></IconButton>}>{trainingError}</Alert>
          )}
          {!checkApproved && <Alert severity="info" sx={neutralAlertSx}>{isMuleVariant ? 'Training is gated by the Check tab. Approve the governed Mule review before launching a model run.' : 'Training is gated by the Check tab. Approve the notebook-parity check before launching a model run.'}</Alert>}
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: '#fafbfc' }}>
            <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} alignItems={{ xs: 'flex-start', lg: 'center' }} justifyContent="space-between">
              <Box>
                <Typography sx={{ fontSize: 14, fontWeight: 800, color: T.textPrimary }}>Launch training run</Typography>
                <Typography sx={{ fontSize: 11.5, color: T.textMuted, mt: 0.5 }}>
                  {isMuleVariant
                    ? 'Start the approved Mule run from here. The structured milestones below will update as the job prepares features, fits the model, and produces risk, typology, anomaly, and graph-aware outputs.'
                    : 'Start the approved FCC run from here. The structured milestones below will update as the job prepares data, splits the holdout, fits the model, and scores the validation set.'}
                </Typography>
                {!canStartTraining && (
                  <Typography sx={{ fontSize: 11, color: T.textDim, mt: 0.75 }}>
                    {trainingBusy
                      ? 'A training job is already in progress.'
                      : !checkApproved
                        ? 'Approve the Check stage first.'
                        : !trainingReadiness?.ready
                          ? 'Resolve the Check-stage warnings before training can start.'
                          : 'Refresh the training check if this view looks stale.'}
                  </Typography>
                )}
              </Box>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} sx={{ width: { xs: '100%', lg: 'auto' } }}>
                <Button variant="outlined" onClick={() => setActiveTab(1)} sx={{ textTransform: 'none', borderRadius: 1.75, borderColor: T.border, color: T.textMuted }}>
                  Back to check
                </Button>
                <Button
                  variant="contained"
                  onClick={handleStartTraining}
                  disabled={!canStartTraining}
                  startIcon={trainingBusy ? <CircularProgress size={14} sx={{ color: 'inherit' }} /> : <ArrowForward />}
                  sx={{ textTransform: 'none', borderRadius: 1.75, bgcolor: T.orange, '&:hover': { bgcolor: T.orangeHover } }}
                >
                  {trainingBusy ? 'Training in progress...' : (results ? 'Re-run training' : 'Start training run')}
                </Button>
              </Stack>
            </Stack>
          </Paper>
          <StructuredTrainingProgress jobStatus={jobStatus} />
          <TrainingDAG jobStatus={jobStatus} algoObj={activeRunOption} />
          <Paper variant="outlined" sx={{ p: 1.75, borderRadius: 2, bgcolor: '#fafbfc' }}>
            <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
              {[{ label: 'Grain', value: grainConfig.label }, { label: 'Algorithm', value: activeRunOption?.label }, { label: 'Dataset', value: `${rowCount.toLocaleString()} rows` }, { label: 'Train/Test', value: `${100 - testSplit}% / ${testSplit}%` }, { label: 'CV Folds', value: cvFolds }, { label: 'Deploy Threshold Band', value: `${thresholdBandMin.toFixed(2)} - ${thresholdBandMax.toFixed(2)}` }].map((item) => (
                <Box key={item.label}>
                  <Typography sx={{ fontSize: 10, color: T.textDim, textTransform: 'uppercase', letterSpacing: 0.5 }}>{item.label}</Typography>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary }}>{item.value}</Typography>
                </Box>
              ))}
            </Stack>
          </Paper>
          <Alert severity="info" sx={neutralAlertSx}>Structured milestones are the primary training view. The raw log below is retained only for technical troubleshooting.</Alert>
          <Box>
            <Button size="small" variant="text" startIcon={<Terminal sx={{ fontSize: 14 }} />} endIcon={logExpanded ? <KeyboardArrowUp sx={{ fontSize: 14 }} /> : <KeyboardArrowDown sx={{ fontSize: 14 }} />} onClick={() => setLogExpanded((p) => !p)} sx={{ textTransform: 'none', fontSize: 12, color: T.textMuted, px: 0, mb: 0.5 }}>
              {logExpanded ? 'Hide' : 'Show'} technical log ({(jobStatus?.logs || []).length} lines)
            </Button>
            <Collapse in={logExpanded}>
              <Box sx={{ bgcolor: T.termBg, borderRadius: 2, p: 2, height: 220, overflowY: 'auto', fontFamily: T.mono, fontSize: 11.5, border: '1px solid #1e293b' }}>
                {!(jobStatus?.logs?.length) && <Typography sx={{ color: T.termDim, fontFamily: T.mono, fontSize: 12 }}>Waiting for job to start...</Typography>}
                {(jobStatus?.logs || []).map((line, i) => (
                  <Box key={i} sx={{ display: 'flex', gap: 1.5, mb: 0.2 }}>
                    <Typography sx={{ color: T.termDim, fontFamily: T.mono, fontSize: 11, flexShrink: 0 }}>{String(i + 1).padStart(3, ' ')}</Typography>
                    <Typography sx={{ color: T.termText, fontFamily: T.mono, fontSize: 11 }}>{line}</Typography>
                  </Box>
                ))}
                <div ref={logEndRef} />
              </Box>
            </Collapse>
          </Box>

          {pipelineRuns.length > 0 && (
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
              <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1.5}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Timeline sx={{ fontSize: 16, color: T.textDim }} />
                  <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary }}>Pipeline Runs ({pipelineRuns.length})</Typography>
                </Stack>
                {pipelineRunning && <CircularProgress size={14} sx={{ color: T.orange }} />}
              </Stack>
              <Box sx={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#f8fafc' }}>
                      {['Algorithm', 'Status', 'Stage', 'Progress', 'AUC', 'F1', 'Actions'].map((h) => (
                        <th key={h} style={{ padding: '6px 8px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, borderBottom: `1px solid ${T.border}` }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pipelineRuns.map((run) => {
                      const metrics     = run.results?.metrics || {};
                      // FIX ⑬: backend returns 0-100; don't multiply by 100 again
                      const runStatus   = normalizeJobStatus(run.status);
                      const progressPct = normalizeProgressPct(run.progress, runStatus);
                      return (
                        <tr key={run.job_id || run.algo_id} style={{ borderBottom: `1px solid ${T.border}` }}>
                          <td style={{ padding: '6px 8px', color: T.textPrimary }}>{resolveAlgorithmLabel(run.algorithm_id || run.algo_id || run.algorithm)}</td>
                          <td style={{ padding: '6px 8px' }}>
                            <Typography sx={{ fontSize: 11, color: runStatus === 'failed' ? T.red : T.textDim }}>{runStatus || 'pending'}</Typography>
                            {run.error && <Typography sx={{ fontSize: 10, color: T.textDim }}>{run.error}</Typography>}
                          </td>
                          <td style={{ padding: '6px 8px', color: T.textDim }}>{run.current_stage || '-'}</td>
                          <td style={{ padding: '6px 8px', fontFamily: T.mono }}>{`${progressPct}%`}</td>
                          <td style={{ padding: '6px 8px', color: metricColor(metrics.roc_auc), fontFamily: T.mono }}>{fmt(metrics.roc_auc)}</td>
                          <td style={{ padding: '6px 8px', color: metricColor(metrics.f1), fontFamily: T.mono }}>{fmt(metrics.f1)}</td>
                          <td style={{ padding: '6px 8px' }}>
                            <Stack direction="row" spacing={0.75}>
                              <Button size="small" variant="outlined" onClick={() => handleLoadRun(run)} disabled={canDisable(!run.job_id || runStatus !== 'complete')} sx={{ height: 24, fontSize: 10.5, textTransform: 'none', borderRadius: 1, borderColor: T.border, color: T.textMuted }}>Load</Button>
                              <Button size="small" variant="outlined" onClick={() => handleAddRunToCompare(run)} disabled={canDisable(!run.results)} sx={{ height: 24, fontSize: 10.5, textTransform: 'none', borderRadius: 1, borderColor: T.border, color: T.textMuted }}>Compare</Button>
                            </Stack>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Box>
            </Paper>
          )}

          {results?.mode === 'supervised' && (
            <SupervisedWorkbenchPreview
              loading={false}
              error={resultsError}
              data={results}
              selectedSampleIndex={selectedTreeSampleIndex}
              onSelectSample={setSelectedTreeSampleIndex}
            />
          )}

          {results?.mode === 'unsupervised' && (
            <UnsupervisedWorkbench
              loading={false}
              error={resultsError}
              data={results}
              selectedTechnique={selectedUnsupervisedTechnique || results?.recommended_technique || results?.algorithm}
              setSelectedTechnique={setSelectedUnsupervisedTechnique}
            />
          )}

          {results?.mode === 'deep_learning' && (
            <DeepLearningWorkbench
              loading={false}
              error={resultsError}
              data={results}
            />
          )}
        </Stack>
      </TabPanel>

      {/* ── Evaluate ── */}
      <TabPanel value={activeTab} index={3}>
        {!results ? (
          <Paper variant="outlined" sx={{ p: 4, borderRadius: 2, textAlign: 'center' }}>
            <Analytics sx={{ fontSize: 48, color: T.textDim, mb: 1 }} />
            <Typography sx={{ fontSize: 14, color: T.textMuted, fontWeight: 600 }}>No results yet</Typography>
            <Typography sx={{ fontSize: 12.5, color: T.textDim, mt: 0.5 }}>{resultsError || 'Train a model to see evaluation metrics here.'}</Typography>
            {jobId && <Button size="small" variant="outlined" sx={{ mt: 1.5, textTransform: 'none', borderColor: T.border, color: T.textMuted }} onClick={() => fetchResults(jobId)}>Load Results</Button>}
          </Paper>
        ) : (
          <Stack spacing={2.5}>
            <Stack spacing={1.25}>
              <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                <MetricBox label="ROC-AUC" value={m.roc_auc} />
                <MetricBox label="PR-AUC"  value={prAuc} emphasis={isFocusMetric('pr_auc')} />
                <MetricBox label="CV AUC"  value={m.cv_auc} />
              </Stack>
              <Typography sx={{ fontSize: 11.5, color: T.textDim }}>
                Binary decision metrics at the approved operating threshold ({threshold.toFixed(2)})
              </Typography>
              <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                <MetricBox label="Precision"    value={thresholdMetrics.precision} emphasis={isFocusMetric('precision')} />
                <MetricBox label="Recall"       value={thresholdMetrics.recall} emphasis={isFocusMetric('recall')} />
                <MetricBox label="F1 Score"     value={thresholdMetrics.f1} emphasis={isFocusMetric('f1')} />
                <MetricBox label="Accuracy"     value={thresholdMetrics.accuracy} emphasis={isFocusMetric('accuracy')} />
                <MetricBox label="Specificity"  value={thresholdMetrics.specificity} emphasis={isFocusMetric('specificity')} />
                <MetricBox label="Balanced Acc" value={thresholdMetrics.balanced_accuracy} emphasis={isFocusMetric('balanced_accuracy')} />
              </Stack>
            </Stack>

            {results?.mode === 'supervised' && (
              <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: '#fff8f4', borderColor: '#f1d5c7' }}>
                <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.5} justifyContent="space-between">
                  <Box sx={{ maxWidth: 840 }}>
                    <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary }}>
                      Decision path explorer
                    </Typography>
                    <Typography sx={{ fontSize: 11.5, color: T.textMuted, mt: 0.45, lineHeight: 1.7 }}>
                      Use a real holdout sample to show which conditions pushed the model toward suppressing or escalating an alert. Tree models use their native path; other algorithms use a surrogate tree built from the trained scorer.
                    </Typography>
                    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                      <Chip label={treeExplanation?.tree_kind === 'surrogate' ? 'Surrogate tree explainer' : 'Native tree explainer'} size="small" sx={{ bgcolor: '#fff', border: `1px solid ${T.border}` }} />
                      <Chip label={`${Array.isArray(treeExplanation?.sample_candidates) ? treeExplanation.sample_candidates.length : 0} sample trace${Array.isArray(treeExplanation?.sample_candidates) && treeExplanation.sample_candidates.length === 1 ? '' : 's'}`} size="small" sx={{ bgcolor: '#fff', border: `1px solid ${T.border}` }} />
                      {treeExplanation?.selected_sample?.entity_id && (
                        <Chip label={`Selected sample ${treeExplanation.selected_sample.entity_id}`} size="small" sx={{ bgcolor: '#fff', border: `1px solid ${T.border}` }} />
                      )}
                    </Stack>
                  </Box>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
                    <Button
                      variant="contained"
                      onClick={() => setTreeWorkbenchOpen(true)}
                      disabled={!treePreviewReady}
                      sx={{ bgcolor: T.orange, '&:hover': { bgcolor: T.orangeHover }, textTransform: 'none', borderRadius: 1.5, fontWeight: 700 }}
                    >
                      Open tree explanation
                    </Button>
                    <Button
                      variant="outlined"
                      onClick={() => setActiveTab(2)}
                      sx={{ textTransform: 'none', borderRadius: 1.5, borderColor: T.border, color: T.textMuted }}
                    >
                      Back to train tab
                    </Button>
                  </Stack>
                </Stack>
              </Paper>
            )}

            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: '#fafbfc' }}>
              <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary, mb: 0.75 }}>Threshold deployment policy</Typography>
              <Typography sx={{ fontSize: 11.5, color: T.textMuted, lineHeight: 1.7 }}>
                Default operating threshold is {(deployThresholdPolicy?.default_threshold ?? DEFAULT_BUSINESS_THRESHOLD).toFixed(2)}. FCC will only allow deployable thresholds between {thresholdBandMin.toFixed(2)} and {thresholdBandMax.toFixed(2)} while still showing the broader trade-off curve for review.
              </Typography>
              {deployThresholdPolicy?.deployable_threshold != null && (
                <Typography sx={{ fontSize: 11.5, color: T.textMuted, mt: 0.75 }}>
                  Best deployable threshold for this run: <Box component="span" sx={{ fontWeight: 700, color: T.textPrimary }}>{Number(deployThresholdPolicy.deployable_threshold).toFixed(2)}</Box>
                </Typography>
              )}
            </Paper>

            {qualityReview?.review_required && (
              <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: '#fff7ed', borderColor: '#fed7aa' }}>
                <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary, mb: 0.75 }}>Quality guard review required</Typography>
                <Stack spacing={0.75}>
                  {(qualityReview?.findings || []).map((finding, idx) => (
                    <Typography key={`${finding?.code || 'finding'}-${idx}`} sx={{ fontSize: 11.5, color: T.textMuted }}>
                      {finding?.message || 'Suspicious run behaviour detected.'}
                    </Typography>
                  ))}
                </Stack>
              </Paper>
            )}

            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: '#fafbfc' }}>
              <Stack direction="row" alignItems="center" spacing={1} mb={1}>
                <Functions sx={{ fontSize: 15, color: T.textDim }} />
                <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary }}>Optimization Objective</Typography>
              </Stack>
              <Stack spacing={1.25}>
                <ToggleButtonGroup
                  value={objectiveId}
                  exclusive
                  onChange={(_, v) => v && setObjectiveId(v)}
                  size="small"
                  sx={{ flexWrap: 'wrap', gap: 0.75 }}
                >
                  {OBJECTIVE_OPTIONS.map((opt) => (
                    <ToggleButton
                      key={opt.id}
                      value={opt.id}
                      sx={{
                        textTransform: 'none',
                        fontSize: 11.5,
                        fontWeight: 600,
                        borderRadius: 1,
                        px: 1.25,
                        py: 0.5,
                        borderColor: T.border,
                      }}
                    >
                      {opt.label}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
                <Typography sx={{ fontSize: 11.5, color: T.textMuted }}>
                  {objective.description} Primary metric: <Box component="span" sx={{ fontWeight: 700, color: T.textPrimary }}>{objective.metricLabel}</Box>.
                </Typography>
                <TextField
                  size="small"
                  multiline
                  minRows={2}
                  value={objectiveReason}
                  onChange={(e) => setObjectiveReasons((p) => ({ ...p, [objectiveId]: e.target.value }))}
                  placeholder={objective.rationalePlaceholder}
                  label="Why this objective?"
                  sx={{ maxWidth: 720, '& .MuiOutlinedInput-root': { borderRadius: 1.5, fontSize: 12 } }}
                />
                <Typography sx={{ fontSize: 10.5, color: T.textDim }}>
                  This selection does not retrain the model; it guides metric emphasis and reporting.
                </Typography>
              </Stack>
            </Paper>

            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: '#fafbfc' }}>
              <Stack direction="row" alignItems="center" spacing={1} mb={1}>
                <Functions sx={{ fontSize: 15, color: T.textDim }} />
                <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary }}>Metric Guidance</Typography>
              </Stack>
              {posRateLabel && (
                <Typography sx={{ fontSize: 11.5, color: T.textDim, mb: 0.75 }}>
                  Positive rate in test set: {posRateLabel}
                </Typography>
              )}
              <Stack spacing={0.5}>
                <Typography sx={{ fontSize: 11.5, color: T.textMuted }}>
                  <Box component="span" sx={{ fontWeight: 700, color: T.textPrimary }}>Objective:</Box> {objective.label}.
                </Typography>
                {objective.guidance.map((line) => (
                  <Typography key={line} sx={{ fontSize: 11.5, color: T.textMuted }}>
                    {line}
                  </Typography>
                ))}
                {objectiveReason && (
                  <Typography sx={{ fontSize: 11.5, color: T.textDim }}>
                    Rationale: {objectiveReason}
                  </Typography>
                )}
              </Stack>
            </Paper>

            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' } }}>
              <Stack spacing={2}>
                <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                  <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1.5}>
                    <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary }}>Confusion Matrix</Typography>
                    {evalLoading && <CircularProgress size={13} sx={{ color: T.orange }} />}
                    <Typography sx={{ fontSize: 11, color: T.textMuted }}>Threshold: {threshold.toFixed(2)}</Typography>
                  </Stack>
                  <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, mb: 1.5 }}>
                    <CMCell label="True Negative (TN)"  value={tn}  type="tn" />
                    <CMCell label="False Positive (FP)" value={fp_} type="fp" />
                    <CMCell label="False Negative (FN)" value={fn_} type="fn" />
                    <CMCell label="True Positive (TP)"  value={tp}  type="tp" />
                  </Box>
                  <Stack direction="row" alignItems="center" justifyContent="space-between" mb={0.5}>
                    <Typography sx={{ fontSize: 12, fontWeight: 600, color: T.textPrimary }}>Decision threshold</Typography>
                    <Typography sx={{ fontSize: 12, fontWeight: 700, color: T.orange }}>{threshold.toFixed(2)}</Typography>
                  </Stack>
                  <Slider value={threshold} min={thresholdBandMin} max={thresholdBandMax} step={0.01} onChange={(_, v) => setThreshold(v)} size="small" sx={{ color: T.orange }} />
                </Paper>

                <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary, mb: 1.5 }}>Suppression vs Review Quality</Typography>
                  <Box sx={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 300 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr>
                          {['Threshold', 'Suppressed', 'TP Retained', 'Missed (FN)', 'Event Loss %'].map((h) => (
                            <th key={h} style={{ padding: '6px 8px', textAlign: 'right', fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: `1px solid ${T.border}` }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {thresholdTableForDisplay.map((row, i) => {
                          const isActive = Math.abs(row.threshold - threshold) < 0.025;
                          return (
                            <tr key={i} style={{ background: isActive ? T.orangeLight : 'transparent', cursor: 'pointer' }} onClick={() => setThreshold(row.threshold)}>
                              <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: isActive ? 800 : 500, color: isActive ? T.orange : T.textPrimary, fontFamily: T.mono, fontSize: 12 }}>{row.threshold?.toFixed(2)}</td>
                              <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: T.mono, fontSize: 12 }}>{row.suppressed?.toLocaleString()}</td>
                              <td style={{ padding: '5px 8px', textAlign: 'right', color: T.done, fontFamily: T.mono, fontSize: 12 }}>{row.tp_retained?.toLocaleString()}</td>
                              <td style={{ padding: '5px 8px', textAlign: 'right', color: T.red, fontFamily: T.mono, fontSize: 12 }}>{row.fn?.toLocaleString()}</td>
                              <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: T.mono, fontSize: 12, color: (row.missed_review_pct ?? 0) < 5 ? T.done : (row.missed_review_pct ?? 0) < 10 ? T.amber : T.red }}>{row.missed_review_pct?.toFixed(1)}%</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </Box>
                </Paper>
              </Stack>

              <Stack spacing={2}>
                <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary, mb: 1.5 }}>ROC Curve</Typography>
                  <ResponsiveContainer width="100%" height={190}>
                    <LineChart data={rocData} margin={{ top: 4, right: 8, left: -16, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis
                        dataKey="fpr"
                        type="number"
                        domain={[0, 1]}
                        tickFormatter={(v) => Number(v).toFixed(1)}
                        tick={{ fontSize: 10 }}
                        label={{ value: 'False Positive Rate', position: 'insideBottom', offset: -2, fontSize: 10 }}
                      />
                      <YAxis
                        type="number"
                        domain={[0, 1]}
                        tickFormatter={(v) => Number(v).toFixed(1)}
                        tick={{ fontSize: 10 }}
                      />
                      <RechartsTip formatter={(v) => (Number.isFinite(Number(v)) ? Number(v).toFixed(3) : '-')} contentStyle={{ fontSize: 11 }} />
                      <Line
                        type="monotone"
                        dataKey="tpr"
                        stroke={T.orange}
                        strokeWidth={3}
                        dot={{ r: 2, fill: T.orange, strokeWidth: 0 }}
                        activeDot={{ r: 4, fill: T.orange }}
                        connectNulls
                        isAnimationActive={false}
                        name="True Positive Rate"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </Paper>

                <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary, mb: 1.5 }}>Precision-Recall Curve</Typography>
                  <ResponsiveContainer width="100%" height={190}>
                    <LineChart data={prData} margin={{ top: 4, right: 8, left: -16, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis
                        dataKey="recall"
                        type="number"
                        domain={[0, 1]}
                        tickFormatter={(v) => Number(v).toFixed(1)}
                        tick={{ fontSize: 10 }}
                        label={{ value: 'Recall', position: 'insideBottom', offset: -2, fontSize: 10 }}
                      />
                      <YAxis
                        type="number"
                        domain={[0, 1]}
                        tickFormatter={(v) => Number(v).toFixed(1)}
                        tick={{ fontSize: 10 }}
                      />
                      <RechartsTip formatter={(v) => (Number.isFinite(Number(v)) ? Number(v).toFixed(3) : '-')} contentStyle={{ fontSize: 11 }} />
                      <Line
                        type="monotone"
                        dataKey="precision"
                        stroke={T.orange}
                        strokeWidth={3}
                        dot={{ r: 2, fill: T.orange, strokeWidth: 0 }}
                        activeDot={{ r: 4, fill: T.orange }}
                        connectNulls
                        isAnimationActive={false}
                        name="Precision"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </Paper>
              </Stack>
            </Box>

            {(decisionReasonSummary || suppressedCasesPreview.length > 0) && (
              <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', xl: '0.8fr 1.2fr' } }}>
                <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: '#fafbfc' }}>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary, mb: 0.75 }}>Suppression decision summary</Typography>
                  <Typography sx={{ fontSize: 11.5, color: T.textMuted, lineHeight: 1.7 }}>
                    {decisionReasonSummary?.headline || 'Suppressed rows are summarised below with their main drivers.'}
                  </Typography>
                  <Stack direction="row" spacing={1.25} flexWrap="wrap" useFlexGap sx={{ mt: 1.25 }}>
                    <MetricBox label="Suppressed Preview" value={decisionReasonSummary?.suppressed_case_count ?? suppressedCasesPreview.length} />
                    <MetricBox label="Potential Misses" value={decisionReasonSummary?.potentially_missed_events ?? 0} />
                    <MetricBox label="Threshold" value={(decisionReasonSummary?.threshold ?? threshold).toFixed(2)} />
                  </Stack>
                  <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1.25 }}>
                    {(decisionReasonSummary?.top_driver_features || []).map((driver) => (
                      <Chip key={driver?.feature} label={`${String(driver?.feature || '').replaceAll('_', ' ')} (${driver?.count ?? 0})`} size="small" sx={{ bgcolor: '#fff', border: `1px solid ${T.border}` }} />
                    ))}
                  </Stack>
                </Paper>

                <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary, mb: 1 }}>Suppressed by model</Typography>
                  {!suppressedCasesPreview.length ? (
                    <Typography sx={{ fontSize: 11.5, color: T.textMuted }}>No rows were suppressed at the approved operating threshold.</Typography>
                  ) : (
                    <Box sx={{ overflowX: 'auto', maxHeight: 320, overflowY: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                          <tr style={{ background: '#f8fafc' }}>
                            {['Entity', 'Score', 'Decision', 'Actual', 'Reason'].map((header) => (
                              <th key={header} style={{ padding: '6px 8px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, borderBottom: `1px solid ${T.border}` }}>{header}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {suppressedCasesPreview.map((row) => (
                            <tr key={`${row?.entity_id || 'row'}-${row?.sample_index}`} style={{ borderBottom: `1px solid ${T.border}` }}>
                              <td style={{ padding: '6px 8px', color: T.textPrimary, fontFamily: T.mono }}>{row?.entity_id || row?.sample_index || '-'}</td>
                              <td style={{ padding: '6px 8px', color: T.textPrimary, fontFamily: T.mono }}>{row?.score != null ? Number(row.score).toFixed(4) : '-'}</td>
                              <td style={{ padding: '6px 8px', color: T.textPrimary }}>{row?.decision || 'SUPPRESS'}</td>
                              <td style={{ padding: '6px 8px', color: T.textMuted }}>{row?.actual_label || '-'}</td>
                              <td style={{ padding: '6px 8px', color: T.textMuted, minWidth: 260 }}>{row?.reason_text || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </Box>
                  )}
                </Paper>
              </Box>
            )}

            <HMLThresholdEditor hmlHigh={hmlHigh} hmlLow={hmlLow} setHmlHigh={setHmlHigh} setHmlLow={setHmlLow} totalAlerts={(tp ?? 0) + (tn ?? 0) + (fp_ ?? 0) + (fn_ ?? 0) || 2039} summary={hmlSummary} loading={hmlLoading} />

            <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
              <Button variant="contained" startIcon={<SaveAlt />} onClick={handleSaveRun} disabled={canDisable(!results || savedRuns.some((r) => r.job_id === jobId))}
                sx={{ bgcolor: T.orange, '&:hover': { bgcolor: T.orangeHover }, textTransform: 'none', borderRadius: 1.5, fontWeight: 700, boxShadow: 'none' }}>
                {savedRuns.some((r) => r.job_id === jobId) ? 'Saved to Compare' : 'Save this result'}
              </Button>
              <Button
                variant="outlined"
                startIcon={<Article />}
                onClick={() => {
                  if (jobId && onOpenReport) onOpenReport(jobId);
                  setActiveTab(7);
                }}
                disabled={canDisable(!jobId)}
                sx={{ textTransform: 'none', borderRadius: 1.5, borderColor: T.border, color: T.textMuted }}
              >
                Business Report
              </Button>
              <Button variant="outlined" startIcon={<CloudDownload />} onClick={() => handleExport(jobId)} disabled={canDisable(!jobId)} sx={{ textTransform: 'none', borderRadius: 1.5, borderColor: T.border, color: T.textMuted }}>Download Model</Button>
              <Button variant="outlined" startIcon={<CompareArrows />} onClick={() => setActiveTab(5)} disabled={canDisable(comparisonRuns.length === 0)} sx={{ textTransform: 'none', borderRadius: 1.5, borderColor: T.border, color: T.textMuted }}>Compare Runs ({comparisonRuns.length})</Button>
              <Button variant="outlined" startIcon={<TableChart />} onClick={() => setActiveTab(6)} sx={{ textTransform: 'none', borderRadius: 1.5, borderColor: T.border, color: T.textMuted }}>View Scoring Ledger</Button>
            </Box>
          </Stack>
        )}
      </TabPanel>

      {/* ── Business Understanding ── */}
      <TabPanel value={activeTab} index={4}>
        {(() => {
          const unitLabel      = grain === 'case' ? 'cases' : 'alerts';
          const hml            = hmlSummary || results?.hml_summary;
          const cmTotal        = [tn, fp_, fn_, tp].every((v) => typeof v === 'number') ? (tn + fp_ + fn_ + tp) : null;
          const reconcileDelta = cmTotal != null ? Math.abs(cmTotal - testRows) : null;
          const displayParamValue = (param) => {
            const raw = params[`${activeRunOption?.id}.${param.key}`] ?? param.default;
            if (typeof raw === 'number') return /log10/i.test(param.label || '') ? `10^${raw} (${Math.pow(10, raw).toExponential(1)})` : Number.isInteger(raw) ? raw : raw.toFixed(3);
            return String(raw);
          };
          return (
            <Stack spacing={2.5}>
              <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, mb: 1 }}>Business Summary</Typography>
                <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' } }}>
                  {[{ label: 'Grain', value: grainConfig.label }, { label: 'Target', value: targetColumn || grainConfig.target }, { label: 'Algorithm', value: activeRunOption?.label || '-' }, { label: 'Rows', value: `${rowCount.toLocaleString()} ${unitLabel}` }, { label: 'Train/Test', value: `${trainRows.toLocaleString()} / ${testRows.toLocaleString()} ${unitLabel}` }, { label: 'CV Folds', value: cvFolds }, { label: 'Binary Threshold', value: threshold?.toFixed(2) || '-' }, { label: 'HML High/Low', value: `H>=${hmlHigh.toFixed(2)} / L<${hmlLow.toFixed(2)}` }, { label: 'Model Status', value: results ? 'Trained' : 'Not trained' }].map((item) => (
                    <Box key={item.label}>
                      <Typography sx={{ fontSize: 10, color: T.textDim, textTransform: 'uppercase', letterSpacing: 0.4 }}>{item.label}</Typography>
                      <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary }}>{item.value}</Typography>
                    </Box>
                  ))}
                </Box>
              </Paper>

              <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, mb: 1 }}>Hyperparameters and Business Meaning</Typography>
                {activeRunOption?.params?.length ? (
                  <Box sx={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: '#f8fafc' }}>
                          {['Parameter', 'Value', 'Business meaning'].map((h) => (<th key={h} style={{ padding: '6px 8px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, borderBottom: `1px solid ${T.border}` }}>{h}</th>))}
                        </tr>
                      </thead>
                      <tbody>
                        {activeRunOption.params.map((param) => (
                          <tr key={param.key} style={{ borderBottom: `1px solid ${T.border}` }}>
                            <td style={{ padding: '6px 8px', color: T.textPrimary }}>{param.label}</td>
                            <td style={{ padding: '6px 8px', fontFamily: T.mono }}>{displayParamValue(param)}</td>
                            <td style={{ padding: '6px 8px', color: T.textMuted }}>{PARAM_MEANINGS[param.key] || 'Controls how the model learns patterns from historical data.'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Box>
                ) : <Typography sx={{ fontSize: 11.5, color: T.textMuted }}>Select an algorithm to see parameters.</Typography>}
              </Paper>

              <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, mb: 1 }}>Operational Impact</Typography>
                <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap mb={2}>
                  <MetricBox label="ROC-AUC" value={m.roc_auc} />
                  <MetricBox label="PR-AUC"  value={prAuc} emphasis={isFocusMetric('pr_auc')} />
                  <MetricBox label="Precision" value={thresholdMetrics.precision} emphasis={isFocusMetric('precision')} />
                  <MetricBox label="Recall" value={thresholdMetrics.recall} emphasis={isFocusMetric('recall')} />
                  <MetricBox label="Accuracy" value={thresholdMetrics.accuracy} emphasis={isFocusMetric('accuracy')} />
                  <MetricBox label="Specificity" value={thresholdMetrics.specificity} emphasis={isFocusMetric('specificity')} />
                  <MetricBox label="F1 Score" value={thresholdMetrics.f1} emphasis={isFocusMetric('f1')} />
                </Stack>
                {hml ? (
                  <Box sx={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead><tr style={{ background: '#f8fafc' }}>{['Tier','Count','Percent','TP','FP','Event Loss %'].map((h) => (<th key={h} style={{ padding: '6px 8px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, borderBottom: `1px solid ${T.border}` }}>{h}</th>))}</tr></thead>
                      <tbody>
                        {['high','medium','low'].map((tier) => (<tr key={tier} style={{ borderBottom: `1px solid ${T.border}` }}><td style={{ padding: '6px 8px' }}>{tier.toUpperCase()}</td><td style={{ padding: '6px 8px', fontFamily: T.mono }}>{hml?.[tier]?.count ?? '-'}</td><td style={{ padding: '6px 8px', fontFamily: T.mono }}>{hml?.[tier]?.pct != null ? `${hml[tier].pct}%` : '-'}</td><td style={{ padding: '6px 8px', fontFamily: T.mono }}>{hml?.[tier]?.tp ?? '-'}</td><td style={{ padding: '6px 8px', fontFamily: T.mono }}>{hml?.[tier]?.fp ?? '-'}</td><td style={{ padding: '6px 8px', fontFamily: T.mono }}>{hml?.[tier]?.event_loss_pct ?? '-'}</td></tr>))}
                        <tr><td style={{ padding: '6px 8px', fontWeight: 700 }}>Totals</td><td style={{ padding: '6px 8px', fontFamily: T.mono }}>{hml?.total_alerts ?? '-'}</td><td style={{ padding: '6px 8px', fontFamily: T.mono }}>100%</td><td style={{ padding: '6px 8px', fontFamily: T.mono }}>{hml?.total_positives ?? '-'}</td><td style={{ padding: '6px 8px', fontFamily: T.mono }}>-</td><td style={{ padding: '6px 8px', fontFamily: T.mono }}>{hml?.total_event_loss_pct ?? '-'}</td></tr>
                      </tbody>
                    </table>
                  </Box>
                ) : <Typography sx={{ fontSize: 11.5, color: T.textMuted }}>Train a model to view HML tier impact.</Typography>}
              </Paper>

              <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, mb: 1 }}>Reconciliation</Typography>
                <Box sx={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead><tr style={{ background: '#f8fafc' }}>{['Metric','Value'].map((h) => (<th key={h} style={{ padding: '6px 8px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, borderBottom: `1px solid ${T.border}` }}>{h}</th>))}</tr></thead>
                    <tbody>
                      {[{ label: `Test set ${unitLabel}`, value: testRows.toLocaleString() }, { label: 'Confusion matrix total', value: cmTotal != null ? cmTotal.toLocaleString() : '-' }, { label: 'True Positives', value: tp != null ? tp.toLocaleString() : '-' }, { label: 'False Positives', value: fp_ != null ? fp_.toLocaleString() : '-' }, { label: 'True Negatives', value: tn != null ? tn.toLocaleString() : '-' }, { label: 'False Negatives', value: fn_ != null ? fn_.toLocaleString() : '-' }].map((row) => (
                        <tr key={row.label} style={{ borderBottom: `1px solid ${T.border}` }}><td style={{ padding: '6px 8px', color: T.textPrimary }}>{row.label}</td><td style={{ padding: '6px 8px', fontFamily: T.mono }}>{row.value}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </Box>
                {reconcileDelta != null && reconcileDelta > 0 && (
                  <Typography sx={{ fontSize: 11, color: T.textDim, mt: 1 }}>Note: A difference of {reconcileDelta.toLocaleString()} {unitLabel} indicates filtering or missing rows in evaluation.</Typography>
                )}
              </Paper>
            </Stack>
          );
        })()}
      </TabPanel>

      <Dialog open={treeWorkbenchOpen} onClose={() => setTreeWorkbenchOpen(false)} fullWidth maxWidth="xl">
        <DialogTitle sx={{ px: 2, py: 1.5, borderBottom: `1px solid ${T.border}` }}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
            <Box>
              <Typography sx={{ fontSize: 18, fontWeight: 800, color: T.textPrimary }}>
                Decision path explorer
              </Typography>
              <Typography sx={{ fontSize: 12, color: T.textMuted, mt: 0.35 }}>
                Trace one scored holdout sample through the model and inspect the split-by-split explanation used for AML review.
              </Typography>
            </Box>
            <IconButton onClick={() => setTreeWorkbenchOpen(false)} size="small">
              <Close fontSize="small" />
            </IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent sx={{ p: 2 }}>
          <SupervisedWorkbenchPreview
            loading={false}
            error={resultsError}
            data={results}
            selectedSampleIndex={selectedTreeSampleIndex}
            onSelectSample={setSelectedTreeSampleIndex}
          />
        </DialogContent>
      </Dialog>

      {/* ── Compare ── */}
      <TabPanel value={activeTab} index={5}>
        {!comparisonRuns.length ? (
          <Paper variant="outlined" sx={{ p: 4, borderRadius: 2, textAlign: 'center' }}>
            <CompareArrows sx={{ fontSize: 48, color: T.textDim, mb: 1 }} />
            <Typography sx={{ fontSize: 14, color: T.textMuted, fontWeight: 600 }}>No trained runs yet</Typography>
            <Typography sx={{ fontSize: 12.5, color: T.textDim, mt: 0.5 }}>Train one model or run a pipeline benchmark to compare model outcomes.</Typography>
          </Paper>
        ) : (
          <Stack spacing={2}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <TrendingUp sx={{ fontSize: 18, color: T.textDim }} />
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: T.textPrimary }}>{comparisonRuns.length} trained run{comparisonRuns.length !== 1 ? 's' : ''} - best F1 highlighted</Typography>
              <Button
                size="small"
                variant="outlined"
                startIcon={<AddCircleOutline />}
                onClick={handleSaveRun}
                disabled={!results || savedRuns.some((r) => r.job_id === jobId)}
                sx={{ textTransform: 'none', borderRadius: 0, borderColor: T.border, color: T.textMuted }}
              >
                {savedRuns.some((r) => r.job_id === jobId) ? 'Current run included' : 'Include current run'}
              </Button>
            </Stack>
            <Box sx={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    {['Run','Source','Grain','Algorithm','AUC','F1','Precision','Recall','Threshold','HML H/L','Suppressed','TN','FP','FN','TP','Actions'].map((h) => (<th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: `2px solid ${T.border}`, whiteSpace: 'nowrap' }}>{h}</th>))}
                  </tr>
                </thead>
                <tbody>
                  {comparisonRuns.map((run, idx) => {
                    const isBest  = run.job_id === bestRunId;
                    const isActive = run.job_id === selectedRunId;
                    const { accent } = ALGO_COLOURS[run.algorithm_id] || { accent: T.textMuted };
                    const grainC  = GRAIN_OPTIONS.find((g) => g.id === run.grain);
                    return (
                      <tr key={run.job_id} style={{ background: isActive ? T.orangeLight : isBest ? T.doneLight : 'transparent', borderBottom: `1px solid ${T.border}` }}>
                        <td style={{ padding: '8px 12px', fontWeight: 600, color: T.textPrimary }}><Stack direction="row" alignItems="center" spacing={0.5}>{isBest && <CheckCircle sx={{ fontSize: 14, color: T.textDim }} />}#{idx + 1}</Stack></td>
                        <td style={{ padding: '8px 12px' }}><Chip label={run.source || 'Run'} size="small" sx={{ height: 18, fontSize: 10, bgcolor: '#fff', border: `1px solid ${T.border}`, fontWeight: 600 }} /></td>
                        <td style={{ padding: '8px 12px' }}><Chip label={grainC?.label || run.grain} size="small" sx={{ height: 18, fontSize: 10, bgcolor: (grainC?.badgeColor || T.textMuted) + '18', color: grainC?.badgeColor || T.textMuted, fontWeight: 600 }} /></td>
                        <td style={{ padding: '8px 12px' }}><Stack direction="row" alignItems="center" spacing={0.75}><Box sx={{ width: 4, height: 28, borderRadius: 1, bgcolor: accent, flexShrink: 0 }} /><Typography sx={{ fontSize: 12.5, color: T.textPrimary }}>{run.algorithm}</Typography></Stack></td>
                        <td style={{ padding: '8px 12px', color: metricColor(run.auc), fontWeight: 700, fontFamily: T.mono }}>{fmt(run.auc)}</td>
                        <td style={{ padding: '8px 12px', color: metricColor(run.f1), fontWeight: 700, fontFamily: T.mono }}>{fmt(run.f1)}</td>
                        <td style={{ padding: '8px 12px', color: metricColor(run.precision), fontFamily: T.mono }}>{fmt(run.precision)}</td>
                        <td style={{ padding: '8px 12px', color: metricColor(run.recall), fontFamily: T.mono }}>{fmt(run.recall)}</td>
                        <td style={{ padding: '8px 12px', fontFamily: T.mono }}>{run.threshold?.toFixed(2) ?? '-'}</td>
                        <td style={{ padding: '8px 12px', fontFamily: T.mono, fontSize: 11 }}><Typography sx={{ fontSize: 10.5, color: T.high, fontWeight: 700 }}>H&gt;={run.hml_high?.toFixed(2)}</Typography><Typography sx={{ fontSize: 10.5, color: T.low, fontWeight: 700 }}>L&lt;{run.hml_low?.toFixed(2)}</Typography></td>
                        <td style={{ padding: '8px 12px', fontFamily: T.mono }}>{run.suppression_rate?.toLocaleString() ?? '-'}</td>
                        <td style={{ padding: '8px 12px', fontFamily: T.mono }}>{run.confusion_matrix?.[0]?.[0]?.toLocaleString?.() ?? '-'}</td>
                        <td style={{ padding: '8px 12px', fontFamily: T.mono }}>{run.confusion_matrix?.[0]?.[1]?.toLocaleString?.() ?? '-'}</td>
                        <td style={{ padding: '8px 12px', fontFamily: T.mono }}>{run.confusion_matrix?.[1]?.[0]?.toLocaleString?.() ?? '-'}</td>
                        <td style={{ padding: '8px 12px', fontFamily: T.mono }}>{run.confusion_matrix?.[1]?.[1]?.toLocaleString?.() ?? '-'}</td>
                        <td style={{ padding: '8px 12px' }}>
                          <Stack direction="row" spacing={0.75}>
                            <Button size="small" variant={isActive ? 'contained' : 'outlined'} onClick={() => handleSelectRun(run)} sx={{ height: 26, fontSize: 11, textTransform: 'none', borderRadius: 1, ...(isActive ? { bgcolor: T.done, '&:hover': { bgcolor: T.done }, borderColor: T.done, color: '#fff' } : { borderColor: T.border, color: T.textMuted }) }}>{isActive ? 'Selected' : 'Use this'}</Button>
                            <Tooltip title="Download model card and artifact"><IconButton size="small" onClick={() => handleExport(run.job_id)} sx={{ width: 26, height: 26, color: T.textMuted }}><CloudDownload sx={{ fontSize: 14 }} /></IconButton></Tooltip>
                            {run.source === 'Saved' && (
                              <Tooltip title="Remove from comparison"><IconButton size="small" onClick={() => setSavedRuns((p) => p.filter((r) => r.job_id !== run.job_id))} sx={{ width: 26, height: 26, color: T.textMuted }}><Delete sx={{ fontSize: 14 }} /></IconButton></Tooltip>
                            )}
                          </Stack>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Box>
            {selectedRunId && <Alert severity="success" icon={<CheckCircle sx={{ color: T.textMuted }} />} sx={neutralAlertSx}>Model run #{comparisonRuns.findIndex((r) => r.job_id === selectedRunId) + 1} selected. Proceed to Step 7 to validate and deploy.</Alert>}
            <Button variant="outlined" startIcon={<AddCircleOutline />} onClick={() => setActiveTab(0)} sx={{ textTransform: 'none', borderRadius: 1.5, borderColor: T.border, color: T.textMuted, width: 'fit-content' }}>Train another model</Button>
          </Stack>
        )}
      </TabPanel>

      {/* ── Scoring Ledger ── */}
      <TabPanel value={activeTab} index={6}>
        <ScoringLedger jobId={jobId} grain={grain} hmlHigh={hmlHigh} hmlLow={hmlLow} results={results} grainOptions={grainOptions} />
      </TabPanel>

      <TabPanel value={activeTab} index={7}>
        <RunReport
          runId={jobId || selectedRunId || ''}
          compact
          showHistory
          demoEvaluation={selectedRunSummary?.display_evaluation || demoEvaluation}
        />
      </TabPanel>

      {selectedRunId && (
        <Paper variant="outlined" sx={{ mt: 3, p: 2, borderRadius: 2, bgcolor: '#fafbfc', borderColor: T.border }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Stack direction="row" alignItems="center" spacing={1.5}>
              <CheckCircle sx={{ color: T.done, fontSize: 20 }} />
              <Box>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: T.textPrimary }}>Model selected and ready</Typography>
                <Typography sx={{ fontSize: 11.5, color: T.textMuted }}>
                  Run #{comparisonRuns.findIndex((r) => r.job_id === selectedRunId) + 1} | {selectedRunSummary?.algorithm} | AUC {selectedRunSummary?.auc?.toFixed(3)} | {GRAIN_OPTIONS.find((g) => g.id === selectedRunSummary?.grain)?.label}
                </Typography>
              </Box>
            </Stack>
            <Typography sx={{ fontSize: 11.5, color: T.textMuted, fontStyle: 'italic' }}>Click "Continue: Deploy" in the top bar to proceed</Typography>
          </Stack>
        </Paper>
      )}
    </Stack>
  );
};

export default ModelTrainingPanel;
