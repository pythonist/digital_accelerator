param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectId,

  [string]$Region = "us-central1",
  [string]$ServiceName = "fcc-aml-workbench",
  [string]$Repository = "ai-aml-images",
  [switch]$CreateProject,
  [string]$BillingAccount,
  [string]$OpenAIApiKey,
  [string]$OpenAIModel = "gpt-4o-mini",
  [string]$CustomDomain
)

$ErrorActionPreference = "Stop"

function Test-GcloudResource {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Args
  )
  $oldPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    & gcloud @Args 1>$null 2>$null
    return ($LASTEXITCODE -eq 0)
  } finally {
    $ErrorActionPreference = $oldPreference
  }
}

if ($ProjectId -match "(?i)adviso") {
  throw "Refusing to deploy to '$ProjectId'. Use a new project id that is not related to Adviso."
}

if ($CreateProject) {
  gcloud projects create $ProjectId --name "AI AML FCC Workbench"
  if ($BillingAccount) {
    gcloud billing projects link $ProjectId --billing-account $BillingAccount
  }
}

gcloud config set project $ProjectId
$activeProject = (gcloud config get-value project).Trim()
if ($activeProject -ne $ProjectId) {
  throw "gcloud did not switch to '$ProjectId'. Active project is '$activeProject'."
}

gcloud services enable `
  run.googleapis.com `
  cloudbuild.googleapis.com `
  artifactregistry.googleapis.com `
  secretmanager.googleapis.com `
  storage.googleapis.com `
  --project $ProjectId
if ($LASTEXITCODE -ne 0) { throw "Failed to enable required GCP services." }

$secretName = "openai-api-key"
$useOpenAI = $false
if (-not $OpenAIApiKey -and $env:OPENAI_API_KEY) {
  $OpenAIApiKey = $env:OPENAI_API_KEY
}
$secretExists = $false
Start-Sleep -Seconds 10
if (Test-GcloudResource -Args @("secrets", "describe", $secretName, "--project", $ProjectId)) {
  $secretExists = $true
}
if ($OpenAIApiKey) {
  $useOpenAI = $true
  if (-not $secretExists) {
    gcloud secrets create $secretName --project $ProjectId --replication-policy automatic
    if ($LASTEXITCODE -ne 0) { throw "Failed to create Secret Manager secret '$secretName'." }
    $secretExists = $true
  }
  $secretTempFile = New-TemporaryFile
  try {
    [System.IO.File]::WriteAllText($secretTempFile.FullName, $OpenAIApiKey.Trim())
    gcloud secrets versions add $secretName --project $ProjectId --data-file=$($secretTempFile.FullName)
    if ($LASTEXITCODE -ne 0) { throw "Failed to add OpenAI API key to Secret Manager." }
  } finally {
    Remove-Item -LiteralPath $secretTempFile.FullName -Force -ErrorAction SilentlyContinue
  }
} elseif ($secretExists) {
  $useOpenAI = $true
}

if ($useOpenAI) {
  $projectNumber = (gcloud projects describe $ProjectId --format "value(projectNumber)").Trim()
  $runtimeServiceAccount = "${projectNumber}-compute@developer.gserviceaccount.com"
  gcloud secrets add-iam-policy-binding $secretName `
    --project $ProjectId `
    --member "serviceAccount:${runtimeServiceAccount}" `
    --role "roles/secretmanager.secretAccessor" 1>$null
  if ($LASTEXITCODE -ne 0) { throw "Failed to grant Cloud Run access to OpenAI secret." }
}

$stateBucket = "${ProjectId}-${ServiceName}-state".ToLower()
$stateBucket = $stateBucket -replace "[^a-z0-9._-]", "-"
if ($stateBucket.Length -gt 63) {
  $stateBucket = $stateBucket.Substring(0, 63) -replace "[-_.]+$", ""
}
if (-not (Test-GcloudResource -Args @("storage", "buckets", "describe", "gs://$stateBucket", "--project", $ProjectId))) {
  gcloud storage buckets create "gs://$stateBucket" `
    --project $ProjectId `
    --location $Region `
    --uniform-bucket-level-access
  if ($LASTEXITCODE -ne 0) { throw "Failed to create Cloud Storage state bucket '$stateBucket'." }
}

$repoExists = $false
$repositories = gcloud artifacts repositories list `
  --project $ProjectId `
  --location $Region `
  --format "value(name)"
if (($repositories -split "\r?\n" | ForEach-Object { $_.Trim() }) -contains $Repository) {
  $repoExists = $true
}
if (-not $repoExists) {
  gcloud artifacts repositories create $Repository `
    --project $ProjectId `
    --repository-format docker `
    --location $Region `
    --description "AI AML container images"
  if ($LASTEXITCODE -ne 0) { throw "Failed to create Artifact Registry repository '$Repository'." }
}

$image = "${Region}-docker.pkg.dev/${ProjectId}/${Repository}/${ServiceName}:latest"
gcloud builds submit --project $ProjectId --tag $image .
if ($LASTEXITCODE -ne 0) { throw "Cloud Build failed. Cloud Run deployment was not attempted." }

$envVars = "AML_AUTO_BOOTSTRAP_VENV=0,AML_BACKEND_PROFILE=full,LLM_ENABLE_OLLAMA_FALLBACK=false,OPENAI_MODEL=${OpenAIModel},WEB_CONCURRENCY=1,GUNICORN_THREADS=16,CLOUD_STATE_BUCKET=${stateBucket},CLOUD_STATE_PREFIX=workbench,CLOUD_STATE_PATHS=data;env,CLOUD_STATE_SYNC_MODE=async,CLOUD_STATE_DEBOUNCE_SECONDS=2,CLOUD_STATE_SYNC_ON_SHUTDOWN=false"
if ($useOpenAI) {
  $envVars += ",LLM_PROVIDER=openai"
} else {
  $envVars += ",LLM_PROVIDER=gpt4all,LLM_ALLOW_DOWNLOAD=true"
}

$deployArgs = @(
  "run", "deploy", $ServiceName,
  "--project", $ProjectId,
  "--image", $image,
  "--region", $Region,
  "--platform", "managed",
  "--allow-unauthenticated",
  "--port", "5000",
  "--cpu", "2",
  "--memory", "4Gi",
  "--timeout", "900",
  "--concurrency", "80",
  "--max-instances", "1",
  "--no-cpu-throttling",
  "--set-env-vars", $envVars
)
if ($useOpenAI) {
  $deployArgs += @("--set-secrets", "OPENAI_API_KEY=${secretName}:latest")
}

gcloud @deployArgs
if ($LASTEXITCODE -ne 0) { throw "Cloud Run deployment failed." }

$serviceUrl = (gcloud run services describe $ServiceName --project $ProjectId --region $Region --format "value(status.url)").Trim()
Write-Output $serviceUrl

if ($CustomDomain) {
  gcloud beta run domain-mappings create `
    --project $ProjectId `
    --region $Region `
    --service $ServiceName `
    --domain $CustomDomain
  if ($LASTEXITCODE -eq 0) {
    Write-Output "Custom domain mapping requested for https://${CustomDomain}. Complete the DNS records shown by gcloud if prompted."
  } else {
    Write-Output "Custom domain mapping failed or requires verified domain ownership. The Cloud Run URL remains: $serviceUrl"
  }
}
