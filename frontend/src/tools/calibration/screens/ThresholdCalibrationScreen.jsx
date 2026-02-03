import React, { useEffect } from 'react';
import { useCalibrationState } from "@calibration/hooks/useCalibrationState"; 
import { AlertCircle } from 'lucide-react';

// Components
import BaselineViewer from "@calibration/components/BaselineViewer";
import RiskAppetitePanel from "@calibration/components/RiskAppetitePanel";
import ScenarioBuilder from "@calibration/components/ScenarioBuilder";
import ImpactComparison from "@calibration/components/ImpactComparison";
import CalibrationRunHistory from "@calibration/components/CalibrationRunHistory";
import ThresholdApprovalWorkflow from "@calibration/components/ThresholdApprovalWorkflow";

const ThresholdCalibrationScreen = () => {
  const calibration = useCalibrationState();
  const [selectedEnvironment, setSelectedEnvironment] = React.useState('Deutsche Bank');
  const [activeTab, setActiveTab] = React.useState('workflow');

  // Auto-load baseline on mount
  useEffect(() => {
    calibration.loadBaseline(selectedEnvironment).catch(console.error);
  }, [selectedEnvironment]);

  // Load history
  useEffect(() => {
    calibration.loadCalibrationHistory(selectedEnvironment).catch(console.error);
  }, [selectedEnvironment]);

  return (
    <div className="space-y-6 p-6 bg-gray-50 min-h-screen">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">
          Threshold Calibration Framework
        </h1>
        <p className="text-gray-600 mt-1">
          Production-grade threshold optimization with governance controls
        </p>
      </div>

      {/* Environment Selector */}
      <div className="flex items-center gap-4 p-4 bg-white rounded border border-gray-200">
        <label className="text-sm font-medium text-gray-900">Environment:</label>
        <select
          value={selectedEnvironment}
          onChange={(e) => setSelectedEnvironment(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded font-medium"
        >
          <option>Deutsche Bank</option>
          <option>HDFC</option>
          <option>ICICI</option>
          <option>LB</option>
        </select>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-2 border-b bg-white">
        <button
          onClick={() => setActiveTab('workflow')}
          className={`px-4 py-2 font-medium transition border-b-2 ${
            activeTab === 'workflow'
              ? 'text-blue-600 border-blue-600'
              : 'text-gray-600 border-transparent hover:text-gray-900'
          }`}
        >
          Calibration Workflow
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`px-4 py-2 font-medium transition border-b-2 ${
            activeTab === 'history'
              ? 'text-blue-600 border-blue-600'
              : 'text-gray-600 border-transparent hover:text-gray-900'
          }`}
        >
          History & Rollback
        </button>
      </div>

      {/* Workflow Tab */}
      {activeTab === 'workflow' && (
        <div className="space-y-6">
          {/* Step 1: Baseline */}
          <Section
            step={1}
            title="1. Review Baseline (Frozen Reference)"
            description="Baseline metrics are locked and serve as your benchmark for all decisions"
          >
            <BaselineViewer
              baseline={calibration.baseline}
              loading={calibration.baselineLoading}
            />
          </Section>

          {calibration.baseline && (
            <>
              {/* Step 2: Risk Appetite */}
              <Section
                step={2}
                title="2. Set Risk Appetite (Governance Guardrails)"
                description="Define acceptable risk boundaries before scenario creation"
              >
                <RiskAppetitePanel
                  riskAppetite={calibration.riskAppetite}
                  onUpdate={calibration.setRiskAppetite}
                  scenarioResults={calibration.scenarioResults}
                />
              </Section>

              {/* Step 3: Scenario Builder */}
              <Section
                step={3}
                title="3. Build Scenario (What-If Simulation)"
                description="Configure threshold overrides and run calibration"
              >
                <ScenarioBuilder
                  scenario={calibration.scenario}
                  baseline={calibration.baseline}
                  onCreateScenario={calibration.createScenario}
                  onSetThreshold={calibration.setThresholdOverride}
                  onSetSegmentation={calibration.setSegmentationFilter}
                  onRunCalibration={calibration.runCalibration}
                  onDiscard={calibration.discardScenario}
                  loading={calibration.scenarioLoading}
                />
              </Section>

              {/* Step 4: Impact Review */}
              {calibration.scenarioResults && (
                <Section
                  step={4}
                  title="4. Review Impact (Decision Board)"
                  description="All metrics side-by-side: baseline vs scenario"
                >
                  <ImpactComparison
                    baseline={calibration.baseline}
                    scenarioResults={calibration.scenarioResults}
                    riskAppetite={calibration.riskAppetite}
                  />
                </Section>
              )}

              {/* Step 5: Approval Workflow */}
              {calibration.scenarioResults && (
                <Section
                  step={5}
                  title="5. Submit & Approve (Governance Gate)"
                  description="Route to approver and manage sign-off"
                >
                  <ThresholdApprovalWorkflow
                    approval={calibration.approval}
                    scenario={calibration.scenario}
                    scenarioResults={calibration.scenarioResults}
                    onSubmit={calibration.submitForApproval}
                    onApprove={calibration.approveCalibration}
                    isDirty={calibration.isDirty}
                  />
                </Section>
              )}
            </>
          )}
        </div>
      )}

      {/* History Tab */}
      {activeTab === 'history' && (
        <Section
          title="Calibration History & Rollback"
          description="All past runs with instant revert capability"
        >
          <CalibrationRunHistory
            runs={calibration.calibrationRuns}
            currentRun={calibration.scenario}
            onRollback={calibration.rollbackToRun}
            loading={false}
          />
        </Section>
      )}
    </div>
  );
};

// Simple Section Component Wrapper
const Section = ({ step, title, description, children }) => (
  <div className="bg-white rounded border border-gray-200 overflow-hidden shadow-sm">
    <div className="flex items-start gap-4 p-6 border-b bg-gray-50">
      {step && (
        <div className="flex-shrink-0 w-10 h-10 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold text-lg">
          {step}
        </div>
      )}
      <div className="flex-1">
        <h2 className="text-lg font-bold text-gray-900">{title}</h2>
        <p className="text-sm text-gray-600 mt-0.5">{description}</p>
      </div>
    </div>
    <div className="p-6">{children}</div>
  </div>
);

export default ThresholdCalibrationScreen;