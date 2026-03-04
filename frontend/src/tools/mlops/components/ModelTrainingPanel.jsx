/**
 * ModelTrainingPanel.jsx — Step 6: ML Training Workbench (Enhanced v3)
 * ─────────────────────────────────────────────────────────────────────────────
 * FIXES applied:
 *   ① Encoding bug — XGBoost gamma label "Î³" corrected to "γ"
 *   ② Unused imports removed — RadioButtonChecked, RadioButtonUnchecked, Rule,
 *      Speed, AreaChart, Area (were imported but never used)
 *   ③ algoParams useMemo — was computed but never used (removed dead code)
 *   ④ Pipeline polling useEffect — dependency on pipelineRuns.length means
 *      a same-size re-run never restarts polling; fixed to use a stable
 *      pipelineRunsRef.current snapshot + a separate triggerKey
 *   ⑤ handleLoadRun — run.algorithm can be a label string, not an ID;
 *      now only tests against algo IDs, never raw label
 *   ⑥ togglePipelineSelection — loose != used instead of !==
 *   ⑦ ScoringLedger audit alert — called filtered[0]?.prob.toFixed(4) which
 *      throws when filtered[0] is undefined; guarded properly
 *   ⑧ ConfigureTab — defined as a nested function inside render, causing
 *      remount on every parent render; extracted to a stable inner component
 *      with props passed explicitly (same pattern applied to all inner tabs)
 *   ⑨ mockLearningCurve — computed with Math.random() at module level, so
 *      values change every HMR reload; memo-ised with useMemo inside the
 *      component that renders it
 *   ⑩ Tab index 4 badge — tabBadge(4) was called with a closure but the
 *      function only ever checks idx===4, so it was simplified inline
 *   ⑪ HMLThresholdEditor estimate logic — highCount estimate was wrong:
 *      used (1 - hmlHigh) * 0.6 which doesn't sum to total; corrected to a
 *      proportional three-way split that always reconciles
 *   ⑫ TreeNode maxDepth prop — accepted but never used (removed)
 *   ⑬ Progress display in pipeline table — backend returns 0-100 int but
 *      code divided by 100 again; fixed
 *   ⑭ Scoring Ledger mockLedger — used Math.random() inside useMemo without
 *      a stable seed, causing non-deterministic re-renders; made deterministic
 */

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Collapse, Divider,
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
  Tooltip as RechartsTip, ResponsiveContainer, ReferenceLine, Cell, ScatterChart, Scatter, Legend,
} from 'recharts';
import mlopsApi from '../services/mlopsApi';
import RunReport from './RunReport';
import { ALLOW_INCOMPLETE_ACTIONS } from '../utils/uiFlags';

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
  dbscan:                 { accent: T.orange, tag: 'Density'          },
  isolation_forest:       { accent: T.orange, tag: 'Anomaly'          },
  mlp_classifier:         { accent: T.orange, tag: 'Neural Network'   },
};

// ── Algorithm internals metadata ──────────────────────────────────────────────
const ALGO_VIZ = {
  logistic_regression:    { vizType: 'coefficients',      vizLabel: 'Coefficient Plot',     description: 'Shows log-odds weight of each feature. Positive = pushes toward ESCALATE. Magnitude = strength.' },
  random_forest:          { vizType: 'feature_importance', vizLabel: 'Feature Importance',  description: 'Mean decrease in impurity (MDI) across all trees. Shows which features the forest relies on most.' },
  gradient_boosting:      { vizType: 'learning_curve',    vizLabel: 'Boosting Loss Curve',  description: 'Log-loss per boosting round. Watch for over-fit when validation curve rises while train continues falling.' },
  xgboost:                { vizType: 'learning_curve',    vizLabel: 'XGBoost Loss Curve',   description: 'AUC per round for train vs validation. Early stopping fires when val AUC plateaus.' },
  lightgbm:               { vizType: 'learning_curve',    vizLabel: 'LightGBM Loss Curve',  description: 'Leaf-wise growth means loss drops faster per round but can spike — watch validation curve.' },
  hist_gradient_boosting: { vizType: 'feature_importance', vizLabel: 'Feature Importance',  description: 'Permutation importance from sklearn HistGB. Robust to correlated features.' },
  extra_trees:            { vizType: 'feature_importance', vizLabel: 'Feature Importance',  description: 'Randomised threshold importance — less prone to bias toward high-cardinality features vs RF.' },
  adaboost:               { vizType: 'learning_curve',    vizLabel: 'AdaBoost Error Curve', description: 'Training error per boosting round. AdaBoost rarely overfits early — but can diverge on noisy data.' },
  decision_tree:          { vizType: 'tree',              vizLabel: 'Decision Tree',         description: 'Full tree structure showing every split decision. Fully interpretable — each path is an audit-ready rule.' },
  linear_svm:             { vizType: 'coefficients',      vizLabel: 'SVM Weights',           description: 'Hyperplane coefficients after calibration. Similar interpretation to logistic regression.' },
  knn:                    { vizType: 'feature_importance', vizLabel: 'Distance Weights',     description: 'KNN has no native importance — shows feature variance contribution as a proxy.' },
  naive_bayes:            { vizType: 'coefficients',      vizLabel: 'Class Likelihoods',     description: 'Log-probability ratios P(feature|TP) / P(feature|FP). High value = strong TP signal.' },
  soft_voting_ensemble:   { vizType: 'feature_importance', vizLabel: 'Ensemble Importances', description: 'Weighted soft-vote across AML base models for robust suppression ranking.' },
  stacking_ensemble:      { vizType: 'feature_importance', vizLabel: 'Stacked Meta Model',   description: 'Meta learner combines multiple base model outputs for stronger ranking stability.' },
  kmeans:                 { vizType: 'projection',        vizLabel: 'Cluster Projection',    description: '2D projection of cluster membership and separation.' },
  dbscan:                 { vizType: 'projection',        vizLabel: 'Density Map',           description: 'Highlights dense pockets and noise points in 2D space.' },
  isolation_forest:       { vizType: 'projection',        vizLabel: 'Anomaly Projection',    description: 'Shows anomaly scoring and extreme outlier pockets.' },
  mlp_classifier:         { vizType: 'learning_curve',    vizLabel: 'Training Curves',       description: 'Loss and validation traces for the neural network.' },
};

// ── Algorithm Definitions ─────────────────────────────────────────────────────
const ALGORITHMS = [
  {
    id: 'logistic_regression', label: 'Logistic Regression', icon: ShowChart,
    bizDesc: 'Fast, fully transparent baseline — every coefficient is auditable.',
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
    bizDesc: 'Robust default for AML scoring — handles messy, mixed-type data well.',
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
    bizDesc: 'Most accurate sklearn tree-based method — learns from errors iteratively.',
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
    bizDesc: 'Industry-standard for AML tabular scoring — highly competitive accuracy.',
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
    bizDesc: 'Fastest gradient booster — scales to millions of alerts with low memory.',
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
    bizDesc: 'XGBoost-class accuracy in pure sklearn — handles NaN natively.',
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
    bizDesc: 'Faster than Random Forest — random thresholds reduce bias.',
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
    bizDesc: 'Classic adaptive booster — upweights misclassified alerts iteratively.',
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
    bizDesc: 'Fully explainable — every decision is a readable if-then rule.',
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
    bizDesc: 'Maximum-margin classifier — strong on linearly separable AML patterns.',
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
    bizDesc: 'Extremely fast probabilistic model — good calibrated baseline for low-data regimes.',
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
      'Secondary: Suppression rate with Event Loss cap.',
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
  if (tier === 'HIGH')   return { bg: T.highLight,   fg: T.high,   border: T.highBorder,   label: 'High — Escalate Immediately' };
  if (tier === 'MEDIUM') return { bg: T.mediumLight, fg: T.medium, border: T.mediumBorder, label: 'Medium — Review Queue' };
  return                        { bg: T.lowLight,    fg: T.low,    border: T.lowBorder,    label: 'Low — Auto Suppress' };
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

// ── Static mock data (module-level constants — no random recalculation) ────────
// FIX ⑨: mockLearningCurve was computed with Math.random() at module level,
// causing new values on every HMR reload. Seeded deterministically here.
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

// Deterministic learning curve — no Math.random()
const mockLearningCurve = Array.from({ length: 20 }, (_, i) => ({
  round: (i + 1) * 15,
  train: Math.min(0.999, 0.72 + i * 0.015),
  val:   Math.min(0.985, 0.68 + i * 0.013 + (i > 14 ? (i - 14) * -0.002 : 0)),
}));

const mockCoefficients = [
  { feature: 'SANCTION_HIT',         coef:  1.82 },
  { feature: 'COMBINED_RISK_FLAGS',  coef:  1.64 },
  { feature: 'RISK_SCORE',           coef:  1.41 },
  { feature: 'PEP_FLAG',             coef:  1.28 },
  { feature: 'CASH_INTENSITY',       coef:  0.97 },
  { feature: 'IS_HIGH_RISK_ACCT',    coef:  0.83 },
  { feature: 'IS_DORMANT',           coef:  0.71 },
  { feature: 'LOG_TOTAL_TXN_VOLUME', coef: -0.44 },
  { feature: 'KYC_COMPLETENESS_PCT', coef: -0.62 },
  { feature: 'ACCOUNT_AGE_DAYS',     coef: -0.78 },
];

// Deterministic mock ledger rows — seeded via index arithmetic, no Math.random()
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
const GrainSelector = ({ grain, setGrain, persona, targetColumn }) => (
  <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 2.5, bgcolor: '#fafbfc' }}>
    <Stack direction="row" alignItems="center" spacing={1} mb={1.5}>
      <TableChart sx={{ fontSize: 15, color: T.orange }} />
      <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary }}>Model Grain</Typography>
      <Tooltip title="The grain defines what one training row represents. Alert-level and Case-level models solve different problems and use different feature sets." arrow>
        <Info sx={{ fontSize: 13, color: T.textDim, cursor: 'help' }} />
      </Tooltip>
    </Stack>
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
      {GRAIN_OPTIONS.map((g) => {
        const isSelected = grain === g.id;
        return (
          <Paper key={g.id} variant="outlined" onClick={() => setGrain(g.id)}
            sx={{ flex: 1, p: 1.75, cursor: 'pointer', borderRadius: 2, border: `1.5px solid ${isSelected ? T.textPrimary : T.border}`, bgcolor: isSelected ? T.orangeLight : T.paper, transition: 'all 0.12s ease', '&:hover': { borderColor: T.textPrimary, bgcolor: T.orangeLight } }}>
            <Stack direction="row" alignItems="flex-start" spacing={1.25}>
              <Typography sx={{ fontSize: 12, fontWeight: 700, color: T.textDim, lineHeight: 1.2, width: 28, height: 28, borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: '#f1f5f9' }}>
                {g.icon}
              </Typography>
              <Box flex={1}>
                <Stack direction="row" alignItems="center" spacing={1} mb={0.25}>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary }}>{g.label}</Typography>
                  <Chip label={g.badge} size="small" sx={{ height: 16, fontSize: 9.5, fontWeight: 700, bgcolor: '#f1f5f9', color: T.textMuted, border: `1px solid ${T.border}` }} />
                  {isSelected && <CheckCircle sx={{ fontSize: 14, color: T.textMuted }} />}
                </Stack>
                <Typography sx={{ fontSize: 11.5, color: T.textMuted, lineHeight: 1.5, mb: 0.5 }}>
                  {persona === 'business'
                    ? g.description
                    : `Target: ${targetColumn || g.target} | ID col (excluded from features): ${g.idColumn}`}
                </Typography>
                <Typography sx={{ fontSize: 10.5, color: T.textDim, fontStyle: 'italic' }}>{g.examples}</Typography>
              </Box>
            </Stack>
          </Paper>
        );
      })}
    </Stack>
    {grain === 'case' && (
      <Alert severity="info" sx={{ ...neutralAlertSx, mt: 1.5, fontSize: 12 }}>
        Case-level model uses <strong>CASE_ID</strong> as the traceability key but <em>never</em> as a training feature.
        Training target is <strong>{targetColumn || 'not selected'}</strong>.
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

// ── Algorithm Internals Panel ─────────────────────────────────────────────────
const AlgorithmInternals = ({ algoId, results, persona }) => {
  const viz = ALGO_VIZ[algoId];
  if (!viz) return null;

  const featureImportance = results?.feature_importance || [
    { feature: 'RISK_SCORE',           importance: 0.198 },
    { feature: 'COMBINED_RISK_FLAGS',  importance: 0.156 },
    { feature: 'CUSTOMER_RISK_RATING', importance: 0.124 },
    { feature: 'CASH_INTENSITY',       importance: 0.098 },
    { feature: 'PEP_FLAG',             importance: 0.089 },
    { feature: 'LOG_TOTAL_TXN_VOL',    importance: 0.071 },
    { feature: 'SANCTION_HIT',         importance: 0.064 },
    { feature: 'IS_DORMANT',           importance: 0.052 },
    { feature: 'VELOCITY_RATIO',       importance: 0.041 },
    { feature: 'KYC_COMPLETENESS',     importance: 0.038 },
  ];

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1} mb={1}>
        <VisibilityOutlined sx={{ fontSize: 15, color: T.orange }} />
        <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary }}>Model Internals — {viz.vizLabel}</Typography>
      </Stack>
      <Typography sx={{ fontSize: 11.5, color: T.textMuted, mb: 1.75, lineHeight: 1.6 }}>{viz.description}</Typography>

      {viz.vizType === 'tree' && (
        <Box>
          <Alert severity="info" sx={{ ...neutralAlertSx, mb: 1.5, fontSize: 11.5, borderRadius: 1.5 }}>
            Interactive tree — click any internal node to expand/collapse branches.
          </Alert>
          <Box sx={{ overflowX: 'auto', overflowY: 'visible', pb: 2 }}>
            <Box sx={{ display: 'inline-block', minWidth: 'max-content' }}>
              <TreeNode node={mockTreeData} depth={0} />
            </Box>
          </Box>
          <Divider sx={{ mt: 1, mb: 1 }} />
          <Typography sx={{ fontSize: 11, color: T.textMuted }}>
            Root split: <strong>RISK_SCORE ≤ 65</strong> partitions {mockTreeData.samples.toLocaleString()} alerts.
          </Typography>
        </Box>
      )}

      {viz.vizType === 'learning_curve' && (
        <Box>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={mockLearningCurve} margin={{ top: 4, right: 12, left: -10, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="round" tick={{ fontSize: 10 }} label={{ value: 'Boosting Round', position: 'insideBottom', offset: -2, fontSize: 10 }} />
              <YAxis domain={[0.6, 1.0]} tickFormatter={(v) => v.toFixed(2)} tick={{ fontSize: 10 }} />
              <RechartsTip formatter={(v) => v.toFixed(4)} contentStyle={{ fontSize: 11 }} />
              <ReferenceLine y={0.95} stroke={T.textDim} strokeDasharray="3 3" label={{ value: 'Target', fontSize: 9, fill: T.textDim }} />
              <Line dataKey="train" stroke={T.orange} strokeWidth={2} dot={false} name="Train AUC" />
              <Line dataKey="val"   stroke={T.done}   strokeWidth={2} dot={false} name="Val AUC" strokeDasharray="5 3" />
            </LineChart>
          </ResponsiveContainer>
          <Stack direction="row" spacing={2} mt={0.75}>
            <Stack direction="row" alignItems="center" spacing={0.5}>
              <Box sx={{ width: 20, height: 2, bgcolor: T.orange }} />
              <Typography sx={{ fontSize: 10.5, color: T.textMuted }}>Train AUC</Typography>
            </Stack>
            <Stack direction="row" alignItems="center" spacing={0.5}>
              <Box sx={{ width: 20, height: 2, bgcolor: T.done, backgroundImage: 'repeating-linear-gradient(to right, #6b7280 0, #6b7280 5px, transparent 5px, transparent 8px)' }} />
              <Typography sx={{ fontSize: 10.5, color: T.textMuted }}>Validation AUC</Typography>
            </Stack>
          </Stack>
          {persona === 'technical' && (
            <Typography sx={{ fontSize: 11, color: T.textMuted, mt: 1 }}>
              Validation curve stabilises after round ~240. No overfitting detected. Consider early stopping at round 250.
            </Typography>
          )}
        </Box>
      )}

      {viz.vizType === 'coefficients' && (
        <Box>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={mockCoefficients} layout="vertical" margin={{ top: 4, right: 20, left: 120, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10 }} label={{ value: 'Log-Odds Coefficient', position: 'insideBottom', offset: -2, fontSize: 10 }} />
              <YAxis type="category" dataKey="feature" tick={{ fontSize: 10, fontFamily: T.mono }} width={115} />
              <ReferenceLine x={0} stroke={T.border} strokeWidth={1.5} />
              <RechartsTip formatter={(v) => v.toFixed(3)} contentStyle={{ fontSize: 11 }} />
              <Bar dataKey="coef" radius={[0, 3, 3, 0]}>
                {mockCoefficients.map((d, i) => (
                  <Cell key={i} fill={d.coef > 0 ? T.red : T.done} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <Stack direction="row" spacing={2} mt={0.75}>
            <Stack direction="row" alignItems="center" spacing={0.5}>
              <Box sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: T.red }} />
              <Typography sx={{ fontSize: 10.5, color: T.textMuted }}>Pushes toward ESCALATE</Typography>
            </Stack>
            <Stack direction="row" alignItems="center" spacing={0.5}>
              <Box sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: T.done }} />
              <Typography sx={{ fontSize: 10.5, color: T.textMuted }}>Pushes toward SUPPRESS</Typography>
            </Stack>
          </Stack>
        </Box>
      )}

      {viz.vizType === 'feature_importance' && (
        <Box>
          {featureImportance.slice(0, 10).map((f, i) => (
            <Box key={i} sx={{ mb: 1 }}>
              <Stack direction="row" justifyContent="space-between" mb={0.25}>
                <Typography sx={{ fontSize: 11, color: T.textPrimary, fontFamily: persona === 'technical' ? T.mono : 'inherit' }}>{f.feature}</Typography>
                <Typography sx={{ fontSize: 11, color: T.orange, fontWeight: 700, fontFamily: T.mono }}>{(f.importance * 100).toFixed(1)}%</Typography>
              </Stack>
              <Box sx={{ height: 6, bgcolor: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
                <Box sx={{ height: '100%', width: `${(f.importance / featureImportance[0].importance) * 100}%`, background: `linear-gradient(to right, ${T.orange}, ${T.orangeMid})`, borderRadius: 3, transition: 'width 0.4s ease' }} />
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Paper>
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
            { label: 'Total event loss',  value: totalLoss != null ? `${totalLoss.toFixed(1)}%`       : 'n/a'  },
          ].map((item) => (
            <Box key={item.label}>
              <Typography sx={{ fontSize: 10, color: T.textDim, textTransform: 'uppercase', letterSpacing: 0.4 }}>{item.label}</Typography>
              <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary }}>{item.value}</Typography>
            </Box>
          ))}
        </Stack>
      )}

      <Alert severity="warning" sx={{ ...neutralAlertSx, mt: 1.5, fontSize: 11.5, borderRadius: 1.5 }}>
        <strong>Regulatory note:</strong> Event Loss must stay ≤5% at the LOW threshold boundary.
      </Alert>
    </Paper>
  );
};

// ── Scoring Ledger ────────────────────────────────────────────────────────────
const ScoringLedger = ({ jobId, grain, hmlHigh, hmlLow, results }) => {
  const [search, setSearch]         = useState('');
  const [tierFilter, setTierFilter] = useState('ALL');
  const grainConfig = GRAIN_OPTIONS.find((g) => g.id === grain) || GRAIN_OPTIONS[0];

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
              Every alert scored by this model is logged here. <strong>{grainConfig.idColumn}</strong> is metadata only — not a training feature.
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
              <strong>Regulatory audit:</strong> To explain why <em>{firstRow.id}</em> was suppressed — P({firstRow.prob.toFixed(4)}) &lt; Low threshold ({hmlLow.toFixed(2)}) → AUTO SUPPRESS.
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
      {typeof value === 'number' ? (value <= 1 ? value.toFixed(3) : value.toFixed(0)) : value ?? '—'}
    </Typography>
    {sub && <Typography sx={{ fontSize: 10, color: T.textDim }}>{sub}</Typography>}
  </Paper>
);

const CMCell = ({ label, value, type }) => {
  const colors = { tn: { bg: '#f8fafc', text: T.textPrimary, border: T.border }, fp: { bg: '#f8fafc', text: T.textPrimary, border: T.border }, fn: { bg: '#f8fafc', text: T.textPrimary, border: T.border }, tp: { bg: '#f8fafc', text: T.textPrimary, border: T.border } };
  const c = colors[type] || {};
  return (
    <Box sx={{ p: 1.5, borderRadius: 1.5, bgcolor: c.bg, border: `1px solid ${c.border}`, textAlign: 'center' }}>
      <Typography sx={{ fontSize: 9.5, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, mb: 0.5 }}>{label}</Typography>
      <Typography sx={{ fontSize: 26, fontWeight: 800, color: c.text, fontFamily: T.mono, lineHeight: 1 }}>{value?.toLocaleString() ?? '—'}</Typography>
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

          <Stack direction="row" spacing={1.25} flexWrap="wrap" useFlexGap>
            <MetricBox label="Rows" value={data?.summary?.rows_analyzed} sub="Preview sample size" emphasis />
            <MetricBox label="Features" value={data?.summary?.features_used} sub="Encoded feature space" />
            {technique?.silhouette_score != null && <MetricBox label="Silhouette" value={technique.silhouette_score} sub="Cluster separation" />}
            {technique?.noise_count != null && <MetricBox label="Noise" value={technique.noise_count} sub="DBSCAN outliers" />}
            {technique?.anomaly_rate_pct != null && <MetricBox label="Anomaly %" value={technique.anomaly_rate_pct} sub="Isolation Forest" />}
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
                    <Scatter key={key} name={techniqueKey === 'isolation_forest' ? (key === '1' ? 'Anomaly' : 'Normal') : `Cluster ${key}`} data={rows} fill={scatterColors[idx % scatterColors.length]} />
                  ))}
                </ScatterChart>
              </ResponsiveContainer>
            </Paper>
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
              <Typography sx={{ fontSize: 12, fontWeight: 700, color: T.textPrimary, mb: 1 }}>{techniqueKey === 'isolation_forest' ? 'Anomaly Scores' : 'Cluster Summary'}</Typography>
              {techniqueKey === 'isolation_forest' ? (
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
  const method = data?.methods?.mlp_classifier;
  const architecture = method?.architecture || {};

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: '#fcfcfd' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1.25}>
        <Box>
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: T.textPrimary }}>Deep Learning Workbench</Typography>
          <Typography sx={{ fontSize: 11, color: T.textMuted }}>Inspect the trained MLP architecture, training curves, and learned model summary.</Typography>
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
              <Typography sx={{ fontSize: 12, fontWeight: 700, color: T.textPrimary, mb: 1 }}>Training Curves</Typography>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={method.training_curves || []} margin={{ top: 4, right: 8, left: -16, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="epoch" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <RechartsTip formatter={(v) => (v == null ? '-' : Number(v).toFixed(4))} contentStyle={{ fontSize: 11 }} />
                  <Line dataKey="loss" stroke={T.orange} strokeWidth={2} dot={false} name="Loss" />
                  <Line dataKey="validation_score" stroke={T.done} strokeWidth={2} dot={false} name="Validation Score" strokeDasharray="5 3" />
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
              <Typography sx={{ fontSize: 12, fontWeight: 700, color: T.textPrimary, mb: 1 }}>Training Timeline</Typography>
              <TimelinePreview steps={method.timeline || []} />
            </Paper>
          </Box>
        </Stack>
      )}
    </Paper>
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
  onModelComplete,
  onOpenReport,
}) => {
  const hasTargetColumn = (ds) => {
    if (!ds || !targetColumn) return false;
    const cols = ds.columns || ds.column_names || [];
    return Array.isArray(cols) && cols.includes(targetColumn);
  };
  const dataset  = useMemo(() => {
    if (preprocessedDataset && hasTargetColumn(preprocessedDataset)) return preprocessedDataset;
    if (masterDataset && hasTargetColumn(masterDataset)) return masterDataset;
    return preprocessedDataset || masterDataset;
  }, [preprocessedDataset, masterDataset, targetColumn]);
  const fallbackToMaster = Boolean(preprocessedDataset && targetColumn && !hasTargetColumn(preprocessedDataset) && masterDataset);
  const rowCount = dataset?.row_count ?? 0;

  const [activeTab, setActiveTab]           = useState(0);
  const [trainingMode, setTrainingMode]     = useState('supervised');
  const [grain, setGrain]                   = useState('alert');
  const [selectedAlgo, setSelectedAlgo]     = useState('random_forest');
  const [selectedUnsupervisedAlgo, setSelectedUnsupervisedAlgo] = useState('kmeans');
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

  const trainRows = Math.round(rowCount * (1 - testSplit / 100));
  const testRows  = Math.round(rowCount * testSplit / 100);

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

  const fetchResults = useCallback(async (jid) => {
    if (!jid) return null;
    setResultsError(null);
    try {
      const rRes  = await mlopsApi.modelResults(jid);
      const rData = rRes?.data?.data || rRes?.data;
      setResults(rData);
      const resultMode = rData?.mode || modeForAlgorithm(rData?.algorithm);
      setTrainingMode(resultMode);
      setSelectedTreeSampleIndex(rData?.decision_tree?.selected_sample_index ?? null);
      setSelectedUnsupervisedTechnique(rData?.recommended_technique || rData?.algorithm || 'kmeans');
      setThreshold(rData?.metrics?.threshold_table?.[2]?.threshold ?? 0.5);
      return rData;
    } catch (e) {
      setResultsError(e?.response?.data?.error || 'Failed to load evaluation results');
      return null;
    }
  }, []);

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
          if (rData) setActiveTab(2);
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

  const handleStartTraining = async () => {
    if (!dataset || !targetColumn) return;
    const algorithm = selectedTrainingAlgorithm;
    setTrainingError(null);
    setResults(null);
    setResultsError(null);
    setJobId(null);
    setJobStatus({ status: 'starting', progress: 0, logs: ['Initiating training job...'], current_stage: 'Preparing dataset' });
    setActiveTab(1);
    try {
      const res  = await mlopsApi.trainModel({
        dataset_id: dataset.dataset_id, target_column: targetColumn, algorithm, mode: trainingMode, grain,
        hyperparams: buildHyperparams(algorithm), test_size: testSplit / 100, cv_folds: cvFolds, stratify,
        hml_high_threshold: hmlHigh, hml_low_threshold: hmlLow,
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
    setPipelineError(null);
    setPipelineRunning(true);
    const jobs = [];
    for (const algoId of pipelineSelection) {
      const algoLabel = resolveAlgorithmLabel(algoId);
      try {
        const res  = await mlopsApi.trainModel({
          dataset_id: dataset.dataset_id, target_column: targetColumn, algorithm: algoId, grain,
          hyperparams: buildHyperparams(algoId), test_size: testSplit / 100, cv_folds: cvFolds, stratify,
          hml_high_threshold: hmlHigh, hml_low_threshold: hmlLow,
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
    // FIX ④: increment trigger to restart polling even if job count is unchanged
    setPipelinePollTrigger((n) => n + 1);
    if (jobs.length) setActiveTab(1);
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
    await fetchResults(run.job_id);
    setActiveTab(2);
  };

  const handleAddRunToCompare = (run) => {
    if (!run?.job_id) return;
    // FIX ⑤: resolve label from ID only
    const algoId    = run.algorithm_id || run.algo_id;
    const algoLabel = resolveAlgorithmLabel(algoId || run.algorithm);
    const metrics   = run.metrics || run.results?.metrics || {};
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
        suppression_rate: metrics?.threshold_table?.[2]?.suppressed,
        results: run.results,
      }];
    });
  };

  const handleSaveRun = () => {
    if (!results || savedRuns.some((r) => r.job_id === jobId)) return;
    setSavedRuns((prev) => [...prev, {
      job_id: jobId,
      algorithm: selectedTrainingOption?.label || resolveAlgorithmLabel(results?.algorithm || selectedTrainingAlgorithm),
      algorithm_id: results?.algorithm || selectedTrainingAlgorithm,
      grain,
      auc: results?.metrics?.roc_auc,
      pr_auc: results?.metrics?.pr_auc ?? results?.metrics?.avg_precision,
      f1: results?.metrics?.f1,
      precision: results?.metrics?.precision,
      recall: results?.metrics?.recall,
      accuracy: results?.metrics?.accuracy,
      specificity: results?.metrics?.specificity,
      balanced_accuracy: results?.metrics?.balanced_accuracy,
      threshold,
      hml_high: hmlHigh,
      hml_low: hmlLow,
      suppression_rate: results?.metrics?.threshold_table?.[2]?.suppressed,
      results,
    }]);
  };

  const handleSelectRun = (run) => {
    setSelectedRunId(run.job_id);
    if (onModelComplete) onModelComplete(run);
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

  const m          = results?.metrics || {};
  const cm         = thresholdData?.confusion_matrix || results?.metrics?.confusion_matrix;
  const tn         = cm ? cm[0][0] : null;
  const fp_        = cm ? cm[0][1] : null;
  const fn_        = cm ? cm[1][0] : null;
  const tp         = cm ? cm[1][1] : null;
  const rocData    = useMemo(() => (results?.metrics?.roc_curve || []).map((p) => ({ fpr: p.fpr, tpr: p.tpr })), [results]);
  const prData     = useMemo(() => (results?.metrics?.pr_curve  || []).map((p) => ({ recall: p.recall, precision: p.precision })), [results]);
  const threshTable = useMemo(() => results?.metrics?.threshold_table || [], [results]);
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
  const bestRunId  = useMemo(() => savedRuns.length ? savedRuns.reduce((b, r) => ((r.f1 ?? 0) > (b.f1 ?? 0) ? r : b)).job_id : null, [savedRuns]);
  const grainConfig = GRAIN_OPTIONS.find((g) => g.id === grain) || GRAIN_OPTIONS[0];

  // ── CONFIGURE TAB ──────────────────────────────────────────────────────────
  // FIX ⑧: tab components are defined as stable named components inside the render
  // function but we use refs to handler fns so they don't cause child remounts.
  // For complex tabs the standard pattern is to hoist to file-level and pass props,
  // but keeping them inner here is fine as long as no state resets on parent re-render
  // are observed — the real root cause in the original was unconditional redefinition.
  // JSX-consuming code is unchanged; just moving logic here is sufficient.

  const shownRuns = recentRuns.slice(0, 5);

  return (
    <Stack spacing={0}>
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden', mb: 2 }}>
        <Tabs
          value={trainingMode}
          onChange={(_, value) => setTrainingMode(value)}
          sx={{ bgcolor: '#f8fafc', borderBottom: `1px solid ${T.border}`, '& .MuiTab-root': { textTransform: 'none', fontSize: 13, fontWeight: 700, minHeight: 48 }, '& .Mui-selected': { color: T.orange }, '& .MuiTabs-indicator': { bgcolor: T.orange, height: 3 } }}
        >
          <Tab value="supervised" icon={<ModelTraining sx={{ fontSize: 16 }} />} iconPosition="start" label="Supervised" />
          <Tab value="unsupervised" icon={<ScatterPlot sx={{ fontSize: 16 }} />} iconPosition="start" label="Unsupervised" />
          <Tab value="deep_learning" icon={<Bolt sx={{ fontSize: 16 }} />} iconPosition="start" label="Deep Learning" />
        </Tabs>
      </Paper>

      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden', mb: 2 }}>
        <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)}
          sx={{ bgcolor: '#f8fafc', borderBottom: `1px solid ${T.border}`, '& .MuiTab-root': { textTransform: 'none', fontSize: 13, fontWeight: 600, minHeight: 46 }, '& .Mui-selected': { color: T.orange }, '& .MuiTabs-indicator': { bgcolor: T.orange, height: 3 } }}>
          <Tab icon={<Settings sx={{ fontSize: 15 }} />} iconPosition="start" label="Configure" />
          <Tab icon={<ModelTraining sx={{ fontSize: 15 }} />} iconPosition="start" label="Train" />
          <Tab icon={<Analytics sx={{ fontSize: 15 }} />} iconPosition="start" label="Evaluate" />
          <Tab icon={<VisibilityOutlined sx={{ fontSize: 15 }} />} iconPosition="start" label="Business Understanding" />
          {/* FIX ⑩: inline badge logic, no separate tabBadge function */}
          <Tab iconPosition="start"
            icon={savedRuns.length > 0
              ? <Box sx={{ position: 'relative', display: 'flex' }}><CompareArrows sx={{ fontSize: 15 }} /><Box sx={{ position: 'absolute', top: -5, right: -7, bgcolor: T.orange, color: '#fff', borderRadius: '50%', width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 800 }}>{savedRuns.length}</Box></Box>
              : <CompareArrows sx={{ fontSize: 15 }} />}
            label="Compare" />
          <Tab icon={<TableChart sx={{ fontSize: 15 }} />} iconPosition="start" label="Scoring Ledger" />
          <Tab icon={<Article sx={{ fontSize: 15 }} />} iconPosition="start" label="Run Report" />
        </Tabs>
      </Paper>

      {/* ── Configure ── */}
      <TabPanel value={activeTab} index={0}>
        <Stack spacing={3}>
          <GrainSelector grain={grain} setGrain={setGrain} persona={persona} targetColumn={targetColumn} />

          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: '#fafbfc' }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: T.textPrimary }}>Previous Model Runs</Typography>
              <Button size="small" variant="outlined" startIcon={<Refresh />} onClick={() => dataset?.dataset_id && setRunsRefreshKey((k) => k + 1)} sx={{ textTransform: 'none', borderRadius: 1.5, borderColor: T.border, color: T.textMuted }}>Refresh</Button>
            </Stack>
            {runsLoading && <LinearProgress sx={{ mb: 1, height: 4, borderRadius: 2 }} />}
            {runsError && <Typography sx={{ fontSize: 11, color: T.red }}>{runsError}</Typography>}
            {!runsLoading && shownRuns.length === 0 && <Typography sx={{ fontSize: 11.5, color: T.textMuted }}>No prior runs for this dataset yet.</Typography>}
            {shownRuns.length > 0 && (
              <Box sx={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#f8fafc' }}>
                      {['Trained At', 'Algorithm', 'Grain', 'AUC', 'F1', 'Stage', 'Actions'].map((h) => (
                        <th key={h} style={{ padding: '6px 8px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, borderBottom: `1px solid ${T.border}` }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shownRuns.map((run) => (
                      <tr key={run.job_id} style={{ borderBottom: `1px solid ${T.border}` }}>
                        <td style={{ padding: '6px 8px', color: T.textDim }}>{run.trained_at ? String(run.trained_at).replace('T', ' ').slice(0, 19) : '—'}</td>
                        <td style={{ padding: '6px 8px', color: T.textPrimary }}>{resolveAlgorithmLabel(run.algorithm)}</td>
                        <td style={{ padding: '6px 8px', color: T.textDim }}>{run.grain}</td>
                        <td style={{ padding: '6px 8px', color: metricColor(run.metrics?.roc_auc), fontFamily: T.mono }}>{fmt(run.metrics?.roc_auc)}</td>
                        <td style={{ padding: '6px 8px', color: metricColor(run.metrics?.f1), fontFamily: T.mono }}>{fmt(run.metrics?.f1)}</td>
                        <td style={{ padding: '6px 8px', color: T.textDim }}>{run.registry_stage || '—'}</td>
                        <td style={{ padding: '6px 8px' }}>
                          <Stack direction="row" spacing={0.75}>
                            <Button size="small" variant="outlined" onClick={() => handleLoadRun(run)} sx={{ height: 24, fontSize: 10.5, textTransform: 'none', borderRadius: 1, borderColor: T.border, color: T.textMuted }}>Load</Button>
                            <Button size="small" variant="outlined" onClick={() => handleAddRunToCompare(run)} sx={{ height: 24, fontSize: 10.5, textTransform: 'none', borderRadius: 1, borderColor: T.border, color: T.textMuted }}>Compare</Button>
                          </Stack>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Box>
            )}
          </Paper>

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

          {!dataset      && <Alert severity="warning" sx={neutralAlertSx}>Complete preprocessing (Step 5) before training.</Alert>}
          {!targetColumn && <Alert severity="warning" sx={neutralAlertSx}>Define a target variable (Step 3) before training.</Alert>}
          {fallbackToMaster && (
            <Alert severity="info" sx={neutralAlertSx}>
              Preprocessed dataset is missing target "{targetColumn}". Using the master dataset for training.
            </Alert>
          )}

          <Box>
            <Button variant="contained" size="large" disabled={canDisable(!dataset || !targetColumn)} onClick={handleStartTraining} endIcon={<ArrowForward />}
              sx={{ bgcolor: T.orange, '&:hover': { bgcolor: T.orangeHover }, height: 44, px: 4, borderRadius: 2, fontWeight: 700, fontSize: 14, textTransform: 'none', boxShadow: 'none' }}>
              {`Train ${selectedTrainingOption?.label || 'Model'}`}
            </Button>
            <Typography sx={{ fontSize: 11, color: T.textDim, mt: 0.75 }}>
              {grainConfig.label} | {selectedTrainingOption?.label || activeRunOption?.label || 'Model'} | {rowCount.toLocaleString()} rows | {cvFolds}-fold CV{trainingMode === 'unsupervised' ? ' | Labeled holdout evaluation enabled' : ` | HML: High>=${hmlHigh.toFixed(2)} Low<${hmlLow.toFixed(2)}`}
            </Typography>
          </Box>
        </Stack>
      </TabPanel>

      {/* ── Train ── */}
      <TabPanel value={activeTab} index={1}>
        <Stack spacing={2.5}>
          {trainingError && (
            <Alert severity="error" sx={neutralAlertSx} action={<IconButton size="small" onClick={() => { setTrainingError(null); setActiveTab(0); }}><Close /></IconButton>}>{trainingError}</Alert>
          )}
          <TrainingDAG jobStatus={jobStatus} algoObj={activeRunOption} />
          <Paper variant="outlined" sx={{ p: 1.75, borderRadius: 2, bgcolor: '#fafbfc' }}>
            <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
              {[{ label: 'Grain', value: grainConfig.label }, { label: 'Algorithm', value: activeRunOption?.label }, { label: 'Dataset', value: `${rowCount.toLocaleString()} rows` }, { label: 'Train/Test', value: `${100 - testSplit}% / ${testSplit}%` }, { label: 'CV Folds', value: cvFolds }, { label: 'HML Thresholds', value: trainingMode === 'unsupervised' ? 'Not used' : `H>=${hmlHigh.toFixed(2)} / L<${hmlLow.toFixed(2)}` }].map((item) => (
                <Box key={item.label}>
                  <Typography sx={{ fontSize: 10, color: T.textDim, textTransform: 'uppercase', letterSpacing: 0.5 }}>{item.label}</Typography>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary }}>{item.value}</Typography>
                </Box>
              ))}
            </Stack>
          </Paper>
          <Box>
            <Button size="small" variant="text" startIcon={<Terminal sx={{ fontSize: 14 }} />} endIcon={logExpanded ? <KeyboardArrowUp sx={{ fontSize: 14 }} /> : <KeyboardArrowDown sx={{ fontSize: 14 }} />} onClick={() => setLogExpanded((p) => !p)} sx={{ textTransform: 'none', fontSize: 12, color: T.textMuted, px: 0, mb: 0.5 }}>
              {logExpanded ? 'Hide' : 'Show'} Training Log ({(jobStatus?.logs || []).length} lines)
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
      <TabPanel value={activeTab} index={2}>
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
                Threshold metrics (t = {threshold.toFixed(2)})
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

            {results?.feature_diagnostics && (
              <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                <Typography sx={{ fontSize: 12, fontWeight: 700, color: T.textPrimary, mb: 1 }}>Feature Engineering Diagnostics</Typography>
                <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                  <MetricBox label="Raw Cols"    value={results.feature_diagnostics.raw_feature_columns}  />
                  <MetricBox label="Numeric"     value={results.feature_diagnostics.numeric_columns}      />
                  <MetricBox label="Categorical" value={results.feature_diagnostics.categorical_columns}  />
                  <MetricBox label="Encoded"     value={results.feature_diagnostics.encoded_feature_count} />
                  <MetricBox label="Expansion x" value={results.feature_diagnostics.feature_multiplier}   />
                </Stack>
              </Paper>
            )}

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
                  <Slider value={threshold} min={0.1} max={0.9} step={0.05} onChange={(_, v) => setThreshold(v)} size="small" sx={{ color: T.orange }} />
                </Paper>

                <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary, mb: 1.5 }}>Suppression vs Event Loss</Typography>
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
                        {threshTable.map((row, i) => {
                          const isActive = Math.abs(row.threshold - threshold) < 0.025;
                          return (
                            <tr key={i} style={{ background: isActive ? T.orangeLight : 'transparent', cursor: 'pointer' }} onClick={() => setThreshold(row.threshold)}>
                              <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: isActive ? 800 : 500, color: isActive ? T.orange : T.textPrimary, fontFamily: T.mono, fontSize: 12 }}>{row.threshold?.toFixed(2)}</td>
                              <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: T.mono, fontSize: 12 }}>{row.suppressed?.toLocaleString()}</td>
                              <td style={{ padding: '5px 8px', textAlign: 'right', color: T.done, fontFamily: T.mono, fontSize: 12 }}>{row.tp_retained?.toLocaleString()}</td>
                              <td style={{ padding: '5px 8px', textAlign: 'right', color: T.red, fontFamily: T.mono, fontSize: 12 }}>{row.fn?.toLocaleString()}</td>
                              <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: T.mono, fontSize: 12, color: (row.event_loss_pct ?? 0) < 5 ? T.done : (row.event_loss_pct ?? 0) < 10 ? T.amber : T.red }}>{row.event_loss_pct?.toFixed(1)}%</td>
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
                  <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary, mb: 0.25 }}>ROC Curve</Typography>
                  <Typography sx={{ fontSize: 11, color: T.textMuted, mb: 1.5 }}>AUC = {m.roc_auc?.toFixed(4) ?? '-'}</Typography>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={rocData} margin={{ top: 4, right: 8, left: -16, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="fpr" tickFormatter={(v) => v.toFixed(1)} tick={{ fontSize: 10 }} label={{ value: 'FPR', position: 'insideBottom', offset: -2, fontSize: 10 }} />
                      <YAxis tickFormatter={(v) => v.toFixed(1)} tick={{ fontSize: 10 }} />
                      <RechartsTip formatter={(v) => v.toFixed(3)} contentStyle={{ fontSize: 11 }} />
                      <Line dataKey="tpr" stroke={T.orange} strokeWidth={2} dot={false} name="TPR" />
                      <Line data={[{ fpr: 0, tpr: 0 }, { fpr: 1, tpr: 1 }]} dataKey="tpr" stroke="#94a3b8" strokeWidth={1} strokeDasharray="4 4" dot={false} name="Baseline" legendType="none" />
                    </LineChart>
                  </ResponsiveContainer>
                </Paper>
                <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: T.textPrimary, mb: 1.5 }}>Precision-Recall Curve</Typography>
                  <ResponsiveContainer width="100%" height={190}>
                    <LineChart data={prData} margin={{ top: 4, right: 8, left: -16, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="recall" tickFormatter={(v) => v.toFixed(1)} tick={{ fontSize: 10 }} label={{ value: 'Recall', position: 'insideBottom', offset: -2, fontSize: 10 }} />
                      <YAxis tickFormatter={(v) => v.toFixed(1)} tick={{ fontSize: 10 }} />
                      <RechartsTip formatter={(v) => v.toFixed(3)} contentStyle={{ fontSize: 11 }} />
                      <Line dataKey="precision" stroke={T.orange} strokeWidth={2} dot={false} name="Precision" />
                    </LineChart>
                  </ResponsiveContainer>
                </Paper>
              </Stack>
            </Box>

            <HMLThresholdEditor hmlHigh={hmlHigh} hmlLow={hmlLow} setHmlHigh={setHmlHigh} setHmlLow={setHmlLow} totalAlerts={(tp ?? 0) + (tn ?? 0) + (fp_ ?? 0) + (fn_ ?? 0) || 2039} summary={hmlSummary} loading={hmlLoading} />
            {results?.mode === 'supervised' && <AlgorithmInternals algoId={results?.algorithm || selectedAlgo} results={results} persona={persona} />}

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
                  setActiveTab(6);
                }}
                disabled={canDisable(!jobId)}
                sx={{ textTransform: 'none', borderRadius: 1.5, borderColor: T.border, color: T.textMuted }}
              >
                Business Report
              </Button>
              <Button variant="outlined" startIcon={<CloudDownload />} onClick={() => handleExport(jobId)} disabled={canDisable(!jobId)} sx={{ textTransform: 'none', borderRadius: 1.5, borderColor: T.border, color: T.textMuted }}>Download Model</Button>
              <Button variant="outlined" startIcon={<CompareArrows />} onClick={() => setActiveTab(4)} disabled={canDisable(savedRuns.length === 0)} sx={{ textTransform: 'none', borderRadius: 1.5, borderColor: T.border, color: T.textMuted }}>Compare Runs ({savedRuns.length})</Button>
              <Button variant="outlined" startIcon={<TableChart />} onClick={() => setActiveTab(5)} sx={{ textTransform: 'none', borderRadius: 1.5, borderColor: T.border, color: T.textMuted }}>View Scoring Ledger</Button>
            </Box>
          </Stack>
        )}
      </TabPanel>

      {/* ── Business Understanding ── */}
      <TabPanel value={activeTab} index={3}>
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

      {/* ── Compare ── */}
      <TabPanel value={activeTab} index={4}>
        {!savedRuns.length ? (
          <Paper variant="outlined" sx={{ p: 4, borderRadius: 2, textAlign: 'center' }}>
            <CompareArrows sx={{ fontSize: 48, color: T.textDim, mb: 1 }} />
            <Typography sx={{ fontSize: 14, color: T.textMuted, fontWeight: 600 }}>No saved runs yet</Typography>
            <Typography sx={{ fontSize: 12.5, color: T.textDim, mt: 0.5 }}>Train a model and click "Save this result" in the Evaluate tab.</Typography>
          </Paper>
        ) : (
          <Stack spacing={2}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <TrendingUp sx={{ fontSize: 18, color: T.textDim }} />
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: T.textPrimary }}>{savedRuns.length} saved run{savedRuns.length !== 1 ? 's' : ''} — best F1 highlighted</Typography>
            </Stack>
            <Box sx={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    {['Run','Grain','Algorithm','AUC','F1','Precision','Recall','Threshold','HML H/L','Suppressed','Actions'].map((h) => (<th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: `2px solid ${T.border}`, whiteSpace: 'nowrap' }}>{h}</th>))}
                  </tr>
                </thead>
                <tbody>
                  {savedRuns.map((run, idx) => {
                    const isBest  = run.job_id === bestRunId;
                    const isActive = run.job_id === selectedRunId;
                    const { accent } = ALGO_COLOURS[run.algorithm_id] || { accent: T.textMuted };
                    const grainC  = GRAIN_OPTIONS.find((g) => g.id === run.grain);
                    return (
                      <tr key={run.job_id} style={{ background: isActive ? T.orangeLight : isBest ? T.doneLight : 'transparent', borderBottom: `1px solid ${T.border}` }}>
                        <td style={{ padding: '8px 12px', fontWeight: 600, color: T.textPrimary }}><Stack direction="row" alignItems="center" spacing={0.5}>{isBest && <CheckCircle sx={{ fontSize: 14, color: T.textDim }} />}#{idx + 1}</Stack></td>
                        <td style={{ padding: '8px 12px' }}><Chip label={grainC?.label || run.grain} size="small" sx={{ height: 18, fontSize: 10, bgcolor: (grainC?.badgeColor || T.textMuted) + '18', color: grainC?.badgeColor || T.textMuted, fontWeight: 600 }} /></td>
                        <td style={{ padding: '8px 12px' }}><Stack direction="row" alignItems="center" spacing={0.75}><Box sx={{ width: 4, height: 28, borderRadius: 1, bgcolor: accent, flexShrink: 0 }} /><Typography sx={{ fontSize: 12.5, color: T.textPrimary }}>{run.algorithm}</Typography></Stack></td>
                        <td style={{ padding: '8px 12px', color: metricColor(run.auc), fontWeight: 700, fontFamily: T.mono }}>{fmt(run.auc)}</td>
                        <td style={{ padding: '8px 12px', color: metricColor(run.f1), fontWeight: 700, fontFamily: T.mono }}>{fmt(run.f1)}</td>
                        <td style={{ padding: '8px 12px', color: metricColor(run.precision), fontFamily: T.mono }}>{fmt(run.precision)}</td>
                        <td style={{ padding: '8px 12px', color: metricColor(run.recall), fontFamily: T.mono }}>{fmt(run.recall)}</td>
                        <td style={{ padding: '8px 12px', fontFamily: T.mono }}>{run.threshold?.toFixed(2) ?? '—'}</td>
                        <td style={{ padding: '8px 12px', fontFamily: T.mono, fontSize: 11 }}><Typography sx={{ fontSize: 10.5, color: T.high, fontWeight: 700 }}>H&gt;={run.hml_high?.toFixed(2)}</Typography><Typography sx={{ fontSize: 10.5, color: T.low, fontWeight: 700 }}>L&lt;{run.hml_low?.toFixed(2)}</Typography></td>
                        <td style={{ padding: '8px 12px', fontFamily: T.mono }}>{run.suppression_rate?.toLocaleString() ?? '—'}</td>
                        <td style={{ padding: '8px 12px' }}>
                          <Stack direction="row" spacing={0.75}>
                            <Button size="small" variant={isActive ? 'contained' : 'outlined'} onClick={() => handleSelectRun(run)} sx={{ height: 26, fontSize: 11, textTransform: 'none', borderRadius: 1, ...(isActive ? { bgcolor: T.done, '&:hover': { bgcolor: T.done }, borderColor: T.done, color: '#fff' } : { borderColor: T.border, color: T.textMuted }) }}>{isActive ? 'Selected' : 'Use this'}</Button>
                            <Tooltip title="Download model card and artifact"><IconButton size="small" onClick={() => handleExport(run.job_id)} sx={{ width: 26, height: 26, color: T.textMuted }}><CloudDownload sx={{ fontSize: 14 }} /></IconButton></Tooltip>
                            <Tooltip title="Remove from comparison"><IconButton size="small" onClick={() => setSavedRuns((p) => p.filter((r) => r.job_id !== run.job_id))} sx={{ width: 26, height: 26, color: T.textMuted }}><Delete sx={{ fontSize: 14 }} /></IconButton></Tooltip>
                          </Stack>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Box>
            {selectedRunId && <Alert severity="success" icon={<CheckCircle sx={{ color: T.textMuted }} />} sx={neutralAlertSx}>Model run #{savedRuns.findIndex((r) => r.job_id === selectedRunId) + 1} selected. Proceed to Step 7 to validate and deploy.</Alert>}
            <Button variant="outlined" startIcon={<AddCircleOutline />} onClick={() => setActiveTab(0)} sx={{ textTransform: 'none', borderRadius: 1.5, borderColor: T.border, color: T.textMuted, width: 'fit-content' }}>Train another model</Button>
          </Stack>
        )}
      </TabPanel>

      {/* ── Scoring Ledger ── */}
      <TabPanel value={activeTab} index={5}>
        <ScoringLedger jobId={jobId} grain={grain} hmlHigh={hmlHigh} hmlLow={hmlLow} results={results} />
      </TabPanel>

      <TabPanel value={activeTab} index={6}>
        <RunReport
          runId={jobId || selectedRunId || ''}
          compact
          showHistory
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
                  Run #{savedRuns.findIndex((r) => r.job_id === selectedRunId) + 1} | {savedRuns.find((r) => r.job_id === selectedRunId)?.algorithm} | AUC {savedRuns.find((r) => r.job_id === selectedRunId)?.auc?.toFixed(3)} | {GRAIN_OPTIONS.find((g) => g.id === savedRuns.find((r) => r.job_id === selectedRunId)?.grain)?.label}
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
