# Change History

## 2026-06-27 - Evaluate Tab Redesign and Progress Stepper

Commit scope:
- Redesign the Evaluate tab and the Training Progress tracker in the MLOps Model Training panel.
- Update the layout to replace boxy dashboard cards with a sleek, full-width design matching updated mockups.

Files changed:
- `frontend/src/tools/mlops/components/ModelTrainingPanel.jsx`
- `frontend/src/tools/mlops/screens/MLOpsWorkbench.jsx`

Summary:
- Removed the old `StructuredTrainingProgress` blocky design and replaced it with a modern horizontal stepper with circles, custom icons, and animated connecting lines.
- Redesigned the "Evaluate" tab to eliminate outer paper boxes, replacing them with full-width orange decorative header bars.
- Ensured header text is styled cleanly in white inside the orange header bars.
- Resolved multiple syntax and unbalanced JSX tag errors introduced during the iterative layout restructuring.
- Implemented logic in MLOpsWorkbench and ModelTrainingPanel to allow multiple models to be trained and compared in the same pipeline session.

## 2026-03-04 - Cortex V2 naming restore

Commit scope:
- Restore the user-facing name of the bank-threshold module from `BTSY` back to `Cortex V2`.
- Update the module selector icon to match the restored naming while keeping internal routes and module keys unchanged.

Files changed:
- `frontend/src/screens/admin/ToolSelectScreen.jsx`
- `frontend/src/tools/btsy/layout/MainLayout.jsx`
- `frontend/src/tools/btsy/layout/Header.jsx`

Summary:
- Changed the module card label to `Cortex V2`.
- Updated the visible module chrome/header label to `Cortex V2`.
- Swapped the module card icon to a more suitable circular workflow icon.
- Preserved internal `/btsy` routing and implementation names so no functional wiring changed.

## 2026-03-04 - Global layout and startup fixes

Commit scope:
- Make the shared module shell and the MLOps shell behave better across laptops and larger desktop monitors.
- Fix the Windows dev launcher so it uses the correct backend virtual environment instead of a random global Python.
- Revert the Tool Selection screen to the earlier simpler layout.

Files changed:
- `frontend/src/app.jsx`
- `frontend/src/tools/shared/layout/SharedWorkbenchLayout.jsx`
- `frontend/src/tools/mlops/screens/MLOpsWorkbench.jsx`
- `frontend/src/screens/admin/ToolSelectScreen.jsx`
- `start-dev.ps1`

Summary:
- Added responsive navigation behavior to the shared workbench shell with a mobile drawer and compact desktop collapse behavior.
- Added matching responsive shell behavior to the custom MLOps workbench layout.
- Fixed nested flex sizing in the app route shell so module canvases scroll correctly.
- Restored the older Tool Selection screen layout.
- Updated `start-dev.ps1` to prefer the active or local backend virtual environment and verify `Flask` before launching the backend.

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
