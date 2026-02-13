$base = "http://127.0.0.1:5001/api/v2/mule"
$sample = Invoke-RestMethod -Method Get -Uri "$base/data/sample?table=accounts"
"Sample account"
$sample.rows[0] | Format-List | Out-String

$body = @{
  mode = "custom_feature"
  custom_feature = @{
    feature_name = "fw_smoke_ratio_7d"
    aggregation = "sum"
    direction = "both"
    window_days = 7
  }
  feature_metadata = @{
    business_description = "smoke test"
    owner = "workbench"
    window = "7d"
    data_source = "accounts"
    aggregation = "sum"
    direction = "both"
    built_by = "workbench"
    origin_module = "workbench"
  }
} | ConvertTo-Json -Depth 6

$job = Invoke-RestMethod -Method Post -Uri "$base/features/engineer" -ContentType "application/json" -Body $body
"Feature build job"
$job | Format-List | Out-String

$state = "queued"
for ($i = 0; $i -lt 15 -and $state -notin @("completed","failed"); $i++) {
  Start-Sleep -Seconds 2
  $status = Invoke-RestMethod -Method Get -Uri "$base/features/engineer/status?job_id=$($job.job_id)"
  $state = $status.state
  $status | Format-List | Out-String
}

$features = Invoke-RestMethod -Method Get -Uri "$base/features/accounts?limit=5"
"Feature preview"
$features.accounts[0] | Format-List | Out-String
