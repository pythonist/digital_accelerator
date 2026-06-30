import sys

filepath = 'e:/Trae/AI_AML_tool/frontend/src/tools/mlops/screens/MLOpsWorkbench.jsx'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add trainedModels state
old_state = '''  const [building,          setBuilding]          = useState(false);
  const [modelRun,          setModelRun]          = useState(null);'''
new_state = '''  const [building,          setBuilding]          = useState(false);
  const [modelRun,          setModelRun]          = useState(null);
  const [trainedModels,     setTrainedModels]     = useState(saved.trainedModels || []);'''
content = content.replace(old_state, new_state)

# 2. Persist trainedModels to localStorage
old_persist = '''  useEffect(() => { lsWrite({ experimentName }); },  [experimentName]);
  useEffect(() => { lsWrite({ railCollapsed }); },   [railCollapsed]);
  useEffect(() => { lsWrite({ showContext }); },     [showContext]);'''
new_persist = '''  useEffect(() => { lsWrite({ experimentName }); },  [experimentName]);
  useEffect(() => { lsWrite({ railCollapsed }); },   [railCollapsed]);
  useEffect(() => { lsWrite({ showContext }); },     [showContext]);
  useEffect(() => { lsWrite({ trainedModels }); },   [trainedModels]);'''
content = content.replace(old_persist, new_persist)

# 3. Clear trainedModels on reset
old_reset = '''      setPreprocessPreview(null);
      setPreprocessDataset(null);
      setModelRun(null);
      setValidationReport(null);'''
new_reset = '''      setPreprocessPreview(null);
      setPreprocessDataset(null);
      setModelRun(null);
      setTrainedModels([]);
      setValidationReport(null);'''
content = content.replace(old_reset, new_reset)

old_reset2 = '''    setPreprocessDataset(null);
    setBuilding(false);
    setModelRun(null);
    setActiveModelRun(null);'''
new_reset2 = '''    setPreprocessDataset(null);
    setBuilding(false);
    setModelRun(null);
    setTrainedModels([]);
    setActiveModelRun(null);'''
content = content.replace(old_reset2, new_reset2)

# 4. In adoptModelRun, append to trainedModels
old_adopt = '''    setModelRun((prev) => {
      const nextModelRun = {
        job_id: normalizedRun.job_id,
        algorithm: normalizedRun.algorithm,
        algorithm_id: normalizedRun.algorithm_id,
        auc: normalizedRun.auc,
        metrics: normalizedRun.metrics || {},
        results: normalizedRun.results,
        display_evaluation: normalizedRun.display_evaluation || null,
        confusion_matrix: normalizedRun.confusion_matrix || null,
        suppression_rate_pct: normalizedRun.suppression_rate_pct ?? null,
        event_loss_pct: normalizedRun.event_loss_pct ?? null,
        review_gap_pct: normalizedRun.review_gap_pct ?? null,
        grain: normalizedRun.grain,
        threshold: normalizedRun.selected_threshold ?? normalizedRun.threshold,
      };
      return JSON.stringify(prev) === JSON.stringify(nextModelRun) ? prev : nextModelRun;
    });'''

new_adopt = '''    setModelRun((prev) => {
      const nextModelRun = {
        job_id: normalizedRun.job_id,
        algorithm: normalizedRun.algorithm,
        algorithm_id: normalizedRun.algorithm_id,
        auc: normalizedRun.auc,
        metrics: normalizedRun.metrics || {},
        results: normalizedRun.results,
        display_evaluation: normalizedRun.display_evaluation || null,
        confusion_matrix: normalizedRun.confusion_matrix || null,
        suppression_rate_pct: normalizedRun.suppression_rate_pct ?? null,
        event_loss_pct: normalizedRun.event_loss_pct ?? null,
        review_gap_pct: normalizedRun.review_gap_pct ?? null,
        grain: normalizedRun.grain,
        threshold: normalizedRun.selected_threshold ?? normalizedRun.threshold,
      };
      return JSON.stringify(prev) === JSON.stringify(nextModelRun) ? prev : nextModelRun;
    });
    setTrainedModels((prev) => {
      const existingIndex = prev.findIndex(m => String(m.job_id) === String(normalizedRun.job_id));
      if (existingIndex >= 0) {
        const nextArr = [...prev];
        nextArr[existingIndex] = { ...nextArr[existingIndex], ...normalizedRun };
        return nextArr;
      }
      return [...prev, normalizedRun];
    });'''
content = content.replace(old_adopt, new_adopt)

# 5. Pass trainedModels to ModelTrainingPanel
old_panel = '''                      activePipelineName={activePipelineName}
                      onModelComplete={handleModelComplete} onOpenReport={handleOpenReport}
                      initialActiveTab={modelActiveTab}'''
new_panel = '''                      activePipelineName={activePipelineName}
                      trainedModels={trainedModels}
                      activeModelRun={effectiveActiveModelRun || modelRun}
                      onModelComplete={handleModelComplete} onOpenReport={handleOpenReport}
                      onActiveModelSelect={(model) => adoptModelRun(model, { resumeExisting: true })}
                      initialActiveTab={modelActiveTab}'''
content = content.replace(old_panel, new_panel)

# 6. Pass trainedModels to ModelValidationScreen (optional, but good if we compare)
old_val = '''                      datasetId={preprocessDataset?.dataset_id || masterDataset?.dataset_id || null}
                      activeModelRun={effectiveActiveModelRun || modelRun}
                      validationReport={effectiveValidationReport}'''
new_val = '''                      datasetId={preprocessDataset?.dataset_id || masterDataset?.dataset_id || null}
                      activeModelRun={effectiveActiveModelRun || modelRun}
                      trainedModels={trainedModels}
                      validationReport={effectiveValidationReport}'''
content = content.replace(old_val, new_val)

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)
print("Updated MLOpsWorkbench.jsx")
