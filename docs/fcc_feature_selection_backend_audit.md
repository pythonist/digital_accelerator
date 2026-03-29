# FCC Feature Selection Backend Audit

Date: March 26, 2026

## What is truly computed in the backend today

The FCC feature-governance payload is backed by real computed techniques in [`backend/api/tools/mlops/eda_service.py`](e:/VS%20CODE%20Backup/Trae/AI_AML_tool/backend/api/tools/mlops/eda_service.py).

The current library exposed to the frontend is assembled from:

- `FEATURE_SELECTION_FILTER_TECHNIQUES` at [`eda_service.py`](e:/VS%20CODE%20Backup/Trae/AI_AML_tool/backend/api/tools/mlops/eda_service.py#L50)
- `FEATURE_SELECTION_SCORE_TECHNIQUES` at [`eda_service.py`](e:/VS%20CODE%20Backup/Trae/AI_AML_tool/backend/api/tools/mlops/eda_service.py#L60)
- returned by `feature_selection_workbench()` at [`eda_service.py`](e:/VS%20CODE%20Backup/Trae/AI_AML_tool/backend/api/tools/mlops/eda_service.py#L1494)

## Real techniques currently in payload

### Filter / governance-style techniques

1. `leakage_name_scan`
2. `leakage_target_corr`
3. `vif_multicollinearity`
4. `variance_threshold`
5. `mean_abs_deviation`
6. `dispersion_ratio`
7. `correlation_filter`

### Score / ranking techniques

1. `information_gain`
2. `information_value`
3. `uncertainty_coefficient`
4. `pearson_abs`
5. `spearman_abs`
6. `kendall_abs`
7. `point_biserial_abs`
8. `fisher_score`
9. `anova_f_score`
10. `t_statistic_abs`
11. `ks_statistic`
12. `roc_auc_univariate`
13. `gini_gain`
14. `chi_square`
15. `likelihood_ratio`
16. `cramers_v`
17. `target_rate_range`
18. `target_rate_lift`
19. `event_rate_std`
20. `woe_peak_abs`
21. `missingness_delta`

Total currently returned by the backend workbench payload: 28 techniques.

## What the backend also returns

The same payload also includes:

- `available_techniques`
- `technique_results`
- `governance_profiles`
- `firewall` / leakage checks
- thresholds such as `top_n`, variance threshold, correlation threshold, and VIF thresholds

These are returned from [`eda_service.py`](e:/VS%20CODE%20Backup/Trae/AI_AML_tool/backend/api/tools/mlops/eda_service.py#L2112).

## Important gap

The current FCC governance payload does **not** yet compute the following advanced families inside this screen:

- wrapper search like RFECV, forward selection, backward elimination
- embedded regularisation methods like L1 or Elastic Net
- tree explainer importance like SHAP
- permutation importance
- Boruta
- mRMR
- model-driven tournament consensus from trained models

So the current comparative vote matrix can honestly use many real backend techniques, but it must not claim the full advanced tournament is already live.

## Current UI implication

The governance UI should:

- treat the current backend payload as real
- let users compare any returned techniques side by side
- explain that score techniques contribute shortlist votes
- explain that filter techniques contribute pass / flagged votes
- clearly separate current live backend methods from future advanced methods

## Recommended next backend step

If FCC needs the full “20+ technique tournament” for production sign-off, the next backend enhancement should add a second-stage feature-selection service that computes:

1. wrapper methods
2. embedded model methods
3. tree-explainer importance
4. model-agnostic permutation importance
5. consensus voting across those additional methods

That second-stage service should then be merged into the existing `feature_selection_workbench()` response rather than simulated in the frontend.
