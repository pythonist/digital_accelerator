import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, request } from 'playwright';

const AUTOMATION_ROOT = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_DIR = path.join(AUTOMATION_ROOT, 'artifacts');
const SUMMARY_PATH = path.join(ARTIFACTS_DIR, 'backend_summary.json');
const UI_SUMMARY_PATH = path.join(ARTIFACTS_DIR, 'ui_summary.json');
const SCREENSHOTS_DIR = path.join(ARTIFACTS_DIR, 'screenshots');
const VIDEOS_DIR = path.join(ARTIFACTS_DIR, 'videos');

const APP_ORIGIN = process.env.FCC_E2E_APP_ORIGIN || 'http://localhost:5173';
const API_ORIGIN = process.env.FCC_E2E_API_ORIGIN || 'http://localhost:5000';
const LOGIN_EMAIL = process.env.FCC_E2E_EMAIL || 'automation.bot@fccanalytics.com';
const LOGIN_PASSWORD = process.env.FCC_E2E_PASSWORD || 'BotPass123!';
const NAV_STORAGE_KEY = 'fcc.workbench.navigation.v1';
const HANDOFF_STORAGE_KEY = 'fcc.sentinel.handoff.v1';

const STEP_SPECS = {
  pipelines: { heading: 'Pipelines', navLabel: 'Pipelines' },
  data: { heading: 'Load Data', navLabel: 'Load Data' },
  master: { heading: 'Master Dataset', navLabel: 'Combine Tables' },
  target: { heading: 'Target Variable', navLabel: 'What to Predict' },
  eda: { heading: 'Explore Data', navLabel: 'Understand Data' },
  preprocess: { heading: 'Preprocessing', navLabel: 'Clean & Transform' },
  model: { heading: 'Model Training', navLabel: 'Train Model' },
  validation: { heading: 'Model Validation', navLabel: 'Validate' },
  registry: { heading: 'Model Release', navLabel: 'Release & Deploy' },
  dashboard: { heading: 'Live Dashboard', navLabel: 'Monitor' },
  reports: { heading: 'Reports', navLabel: 'Reports' },
};

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function readBackendSummary() {
  const raw = await fs.readFile(SUMMARY_PATH, 'utf-8');
  return JSON.parse(raw);
}

async function loginAndSelectEnv(apiContext, envId) {
  const loginResponse = await apiContext.post(`${API_ORIGIN}/api/login`, {
    data: { username: LOGIN_EMAIL, password: LOGIN_PASSWORD },
  });
  if (!loginResponse.ok()) {
    throw new Error(`Login failed with status ${loginResponse.status()}`);
  }
  const loginJson = await loginResponse.json();
  if (!loginJson?.success || !loginJson?.token) {
    throw new Error(`Login did not return a usable token: ${JSON.stringify(loginJson)}`);
  }

  const contextResponse = await apiContext.post(`${API_ORIGIN}/api/select-context`, {
    headers: {
      Authorization: `Bearer ${loginJson.token}`,
      'Content-Type': 'application/json',
    },
    data: { env_id: envId },
  });
  if (!contextResponse.ok()) {
    throw new Error(`Context select failed for ${envId} with status ${contextResponse.status()}`);
  }
  const contextJson = await contextResponse.json();
  if (!contextJson?.success || !contextJson?.token) {
    throw new Error(`Context select did not return a usable token: ${JSON.stringify(contextJson)}`);
  }
  return contextJson.token;
}

async function hydrateStorage(page, token, envId) {
  await page.goto(`${APP_ORIGIN}/login`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ tokenValue, envValue, navKey, handoffKey }) => {
    localStorage.setItem('auth_token', tokenValue);
    localStorage.removeItem(navKey);
    sessionStorage.setItem('active_env', envValue);
    sessionStorage.removeItem(handoffKey);
  }, {
    tokenValue: token,
    envValue: envId,
    navKey: NAV_STORAGE_KEY,
    handoffKey: HANDOFF_STORAGE_KEY,
  });
}

async function switchEnv(page, apiContext, envId) {
  const token = await loginAndSelectEnv(apiContext, envId);
  await hydrateStorage(page, token, envId);
  await page.goto(`${APP_ORIGIN}/tools`, { waitUntil: 'domcontentloaded' });
  return token;
}

async function saveShot(page, name) {
  const targetPath = path.join(SCREENSHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: targetPath, fullPage: true });
  return targetPath;
}

async function waitForHeading(page, text) {
  await page.getByText(text, { exact: true }).first().waitFor({ state: 'visible', timeout: 30000 });
}

async function waitForAnyText(page, texts) {
  const candidates = (texts || []).filter(Boolean);
  if (!candidates.length) {
    throw new Error('waitForAnyText called without candidates');
  }
  for (const text of candidates) {
    const locator = page.getByText(text, { exact: true }).first();
    try {
      await locator.waitFor({ state: 'visible', timeout: 10000 });
      return text;
    } catch {
      // Try the next label.
    }
  }
  throw new Error(`None of the expected labels became visible: ${candidates.join(', ')}`);
}

async function clickText(page, label) {
  await page.getByText(label, { exact: true }).first().click({ timeout: 30000 });
}

async function expectUrlTail(page, expectedTail) {
  await page.waitForURL((url) => url.pathname.endsWith(expectedTail), { timeout: 30000 });
}

async function main() {
  await ensureDir(ARTIFACTS_DIR);
  await ensureDir(SCREENSHOTS_DIR);
  await ensureDir(VIDEOS_DIR);

  const backendSummary = await readBackendSummary();
  const apiContext = await request.newContext({ ignoreHTTPSErrors: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    recordVideo: { dir: VIDEOS_DIR, size: { width: 1600, height: 1000 } },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  const apiCounts = {
    workflowSessionGet: 0,
    pipelineScreenStatePost: 0,
  };
  page.on('requestfinished', (req) => {
    const url = req.url();
    const method = req.method().toUpperCase();
    if (method === 'GET' && url.includes('/api/v2/fcc-workflow/session')) {
      apiCounts.workflowSessionGet += 1;
    }
    if (method === 'POST' && /\/api\/mlops\/pipeline\/\d+\/screen-state/.test(url)) {
      apiCounts.pipelineScreenStatePost += 1;
    }
  });

  const fccRouteBase = `${APP_ORIGIN}/mlops/runs/${backendSummary.pipeline_id}`;

  try {
    await switchEnv(page, apiContext, backendSummary.fcc_env_id);
    await waitForHeading(page, 'Module Selection');
    const toolsShot = await saveShot(page, '01_tools_module_selection');

    await page.goto(`${APP_ORIGIN}/mlops/runs`, { waitUntil: 'domcontentloaded' });
    await expectUrlTail(page, '/mlops/runs');
    await saveShot(page, '02_mlops_runs');

    await page.goBack({ waitUntil: 'domcontentloaded' });
    await waitForHeading(page, 'Module Selection');
    const backToToolsShot = await saveShot(page, '03_back_to_tools');

    await page.goForward({ waitUntil: 'domcontentloaded' });
    await expectUrlTail(page, '/mlops/runs');

    await page.goto(`${fccRouteBase}/pipelines`, { waitUntil: 'domcontentloaded' });
    await waitForAnyText(page, ['Pipelines', 'Pipeline Hub']);
    const pipelineHubShot = await saveShot(page, '04_fcc_pipeline_hub');

    const visitedSteps = [];
    for (const [stepId, spec] of Object.entries(STEP_SPECS)) {
      await page.goto(`${fccRouteBase}/${stepId}`, { waitUntil: 'domcontentloaded' });
      await expectUrlTail(page, `/${stepId}`);
      await waitForAnyText(page, [spec.heading, spec.navLabel]);
      await saveShot(page, `fcc_${stepId}`);
      visitedSteps.push({ stepId, heading: spec.heading, navLabel: spec.navLabel, url: page.url() });
    }

    await page.goto(`${fccRouteBase}/preprocess`, { waitUntil: 'domcontentloaded' });
    await waitForAnyText(page, ['Preprocessing', 'Clean & Transform']);
    await page.goto(`${fccRouteBase}/model`, { waitUntil: 'domcontentloaded' });
    await waitForAnyText(page, ['Model Training', 'Train Model']);
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await expectUrlTail(page, '/preprocess');
    const browserBackToPreprocess = page.url();
    await page.goForward({ waitUntil: 'domcontentloaded' });
    await expectUrlTail(page, '/model');
    const browserForwardToModel = page.url();

    await page.goto(`${fccRouteBase}/validation`, { waitUntil: 'domcontentloaded' });
    await waitForAnyText(page, ['Model Validation', 'Validate']);
    const modelBackButton = page.getByRole('button', { name: /Back to Model Training/i });
    const inAppBackVisible = await modelBackButton.isVisible();
    if (inAppBackVisible) {
      await modelBackButton.click();
      await expectUrlTail(page, '/model');
    }
    const inAppBackUrl = page.url();

    await switchEnv(page, apiContext, backendSummary.sentinel_env_id);
    await waitForHeading(page, 'Module Selection');
    await page.goto(`${APP_ORIGIN}/investigation`, { waitUntil: 'domcontentloaded' });

    await clickText(page, 'FCC Bridge');
    await waitForHeading(page, 'FCC Bridge');
    const bridgeShot = await saveShot(page, '05_sentinel_fcc_bridge');

    await clickText(page, 'Priority Inbox');
    await waitForHeading(page, 'Priority Inbox');
    const priorityShot = await saveShot(page, '06_sentinel_priority_inbox');

    await clickText(page, 'Case Queue');
    await waitForHeading(page, 'Case Queue');
    const queueShot = await saveShot(page, '07_sentinel_case_queue');

    await clickText(page, 'Copilot Investigation');
    await waitForHeading(page, 'Copilot Investigation');
    const investigateShot = await saveShot(page, '08_sentinel_copilot_investigation');

    await clickText(page, 'Case Resolution');
    await waitForHeading(page, 'Case Resolution & SAR Workspace');
    const resolutionShot = await saveShot(page, '09_sentinel_case_resolution');

    const backToToolsButton = page.getByRole('button', { name: /Back to Tools/i });
    let investigationBackToTools = false;
    if (await backToToolsButton.isVisible()) {
      await backToToolsButton.click();
      await waitForHeading(page, 'Module Selection');
      investigationBackToTools = true;
    }
    const finalToolsShot = await saveShot(page, '10_final_tools');

    const uiSummary = {
      app_origin: APP_ORIGIN,
      api_origin: API_ORIGIN,
      fcc: {
        pipeline_id: backendSummary.pipeline_id,
        pipeline_name: backendSummary.pipeline_name,
        visited_steps: visitedSteps,
        browser_back_preprocess_url: browserBackToPreprocess,
        browser_forward_model_url: browserForwardToModel,
        in_app_back_visible: inAppBackVisible,
        in_app_back_result_url: inAppBackUrl,
      },
      sentinel: {
        sample_case_id: backendSummary?.sentinel?.sample_case_id || null,
        investigation_back_to_tools: investigationBackToTools,
      },
      api_counts: apiCounts,
      screenshots: {
        tools_module_selection: toolsShot,
        tools_back_return: backToToolsShot,
        fcc_pipeline_hub: pipelineHubShot,
        sentinel_bridge: bridgeShot,
        sentinel_priority: priorityShot,
        sentinel_queue: queueShot,
        sentinel_investigation: investigateShot,
        sentinel_resolution: resolutionShot,
        final_tools: finalToolsShot,
      },
    };

    await fs.writeFile(UI_SUMMARY_PATH, JSON.stringify(uiSummary, null, 2), 'utf-8');
    console.log(`[fcc-e2e-ui] Wrote UI summary to ${UI_SUMMARY_PATH}`);
  } finally {
    await page.close();
    await context.close();
    await browser.close();
    await apiContext.dispose();
  }
}

main().catch((error) => {
  console.error('[fcc-e2e-ui] Failed:', error);
  process.exitCode = 1;
});
