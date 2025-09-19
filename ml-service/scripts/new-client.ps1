param(
  [Parameter(Mandatory=$true)] [string]$Slug,            # e.g. "acme"
  [Parameter(Mandatory=$true)] [string]$ProjectName,     # e.g. "Acme Corp"
  [Parameter(Mandatory=$true)] [string]$ModelUrl,        # storage URL to model.joblib
  [Parameter(Mandatory=$true)] [string]$FeatureColumns,  # e.g. "f1,f2,f3"
  [Parameter(Mandatory=$true)] [string]$SupabaseUrl,
  [Parameter(Mandatory=$true)] [string]$ServiceRoleKey,  # server-side key
  [Parameter(Mandatory=$true)] [string]$AnonKey          # for Streamlit
)

# 1) Create project row (id, slug, name) via Supabase REST
$ProjectId = [guid]::NewGuid().ToString()
$resp = Invoke-RestMethod -Method Post `
  -Uri "$SupabaseUrl/rest/v1/projects" `
  -Headers @{
    "apikey" = $ServiceRoleKey
    "Authorization" = "Bearer $ServiceRoleKey"
    "Content-Type" = "application/json"
    "Prefer" = "return=representation"
  } `
  -Body (@{ id=$ProjectId; slug=$Slug; name=$ProjectName } | ConvertTo-Json)
"Created project $ProjectName ($Slug) id=$ProjectId"

# (Optional) add yourself as a member so you can see metrics
# $UserId = "<your-auth-user-uuid>"
# Invoke-RestMethod -Method Post -Uri "$SupabaseUrl/rest/v1/memberships" -Headers @{...} -Body (@{ project_id=$ProjectId; user_id=$UserId } | ConvertTo-Json)

# 2) Create a Modal secret unique to this client
$SecretName = "Supabase-$Slug"
modal secret create $SecretName `
  SUPABASE_URL="$SupabaseUrl" `
  SUPABASE_ANON_KEY="$AnonKey" `
  SUPABASE_SERVICE_ROLE_KEY="$ServiceRoleKey" `
  MODEL_NAME="rf-regressor" `
  MODEL_URL="$ModelUrl" `
  FEATURE_COLUMNS="$FeatureColumns" `
  PROJECT_ID="$ProjectId" `
  --force

# 3) Deploy a unique Modal app and bind it to this secret
$env:APP_NAME = "ml-service-$Slug"
$env:SUPABASE_SECRET_NAME = $SecretName
modal deploy ..\modal_app.py

# Print the endpoint for this client
"---"
"Client: $ProjectName ($Slug)"
"Project ID: $ProjectId"
"Modal App Name: $env:APP_NAME"
"Modal Endpoint: https://$($env:USERNAME.ToLower())--$($env:APP_NAME).modal.run (check deploy output for the exact URL)"
"Streamlit secrets to set:"
"  SUPABASE_URL       = $SupabaseUrl"
"  SUPABASE_ANON_KEY  = $AnonKey"
"  MODAL_API_BASE     = <paste Modal endpoint>"
"  PROJECT_ID         = $ProjectId"
