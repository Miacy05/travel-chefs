# Travel Chefs · 测试运行脚本
# 用法：  powershell -ExecutionPolicy Bypass -File tests\run.ps1
#        powershell -ExecutionPolicy Bypass -File tests\run.ps1 calc     # 只跑含 calc 的文件
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# 找 node：优先托管版本，其次 PATH
$candidates = @(
  "$env:USERPROFILE\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
) + (Get-ChildItem "$env:USERPROFILE\.workbuddy\binaries\node\versions" -Directory -ErrorAction SilentlyContinue |
     ForEach-Object { Join-Path $_.FullName 'node.exe' })
$node = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $node) { $node = (Get-Command node -ErrorAction SilentlyContinue).Source }
if (-not $node) { Write-Host "找不到 node.exe" -ForegroundColor Red; exit 1 }

# jsdom 在托管 node 工作区里
$env:NODE_PATH = "$env:USERPROFILE\.workbuddy\binaries\node\workspace\node_modules"

Push-Location (Split-Path $PSScriptRoot -Parent)
try {
  & $node (Join-Path $PSScriptRoot 'run.js') @Args
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
