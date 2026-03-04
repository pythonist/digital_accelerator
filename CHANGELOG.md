# Change History

## 2026-03-04 - Model identity and EDA fixes

Commit scope:
- Keep the trained MLOps run as the single source of truth across training, validation, threshold tuning, registry, and downstream deployment screens.
- Fix the EDA Alert Health tab runtime error caused by an invalid `alive` cleanup reference.

Files changed:
- `frontend/src/tools/mlops/screens/MLOpsWorkbench.jsx`
- `frontend/src/tools/mlops/components/ModelTrainingPanel.jsx`
- `frontend/src/tools/mlops/components/ModelValidationScreen.jsx`
- `frontend/src/tools/mlops/components/ModelRegistryScreen.jsx`
- `frontend/src/tools/mlops/components/validation/ThresholdTuningTab.jsx`
- `frontend/src/tools/mlops/components/EDAScreen.jsx`

Summary:
- Added a central active-model adoption path in the MLOps workbench.
- Ensured a newly trained model becomes the active model automatically.
- Synced validation run selection back to the parent workbench so later steps do not drift to another run.
- Removed registry fallback behavior that could show a different model than the one actually trained/selected.
- Fixed `alive is not defined` in the EDA Alert Health tab.
