<#
 ================================================================================
 install.ps1 - 将 dsh-attention 离线安装到 DeepSeek Harness 的某个 profile
 ================================================================================
 用法（在插件目录下执行）：
   powershell -ExecutionPolicy Bypass -File install.ps1
   powershell -ExecutionPolicy Bypass -File install.ps1 -Profile webtest
   powershell -ExecutionPolicy Bypass -File install.ps1 -DshHome D:\data\.dsh

 行为：
   1. 把插件复制到 <DshHome>\profiles\<Profile>\node_modules\dsh-attention
   2. 在 profile 的 package.json 中注册 dependencies 与 dsh.profile.bundles
   3. 提示重启 DSH Web

 注意：之后若执行 `dsh plugin`（pnpm）导致该目录被清理，重新运行本脚本即可。
 ================================================================================
#>
param(
    [string]$Profile = 'web',
    [string]$DshHome = '',
    [string]$Source = ''
)

$ErrorActionPreference = 'Stop'

if (-not $DshHome) { $DshHome = Join-Path $HOME '.dsh' }
if (-not $Source)  { $Source  = $PSScriptRoot }

$pluginName = 'dsh-attention'
$profileDir = Join-Path $DshHome "profiles\$Profile"
$pluginDir  = Join-Path $profileDir "node_modules\$pluginName"
$manifest   = Join-Path $profileDir 'package.json'

# 1) 校验
if (-not (Test-Path (Join-Path $Source 'package.json'))) {
    Write-Error "找不到 $Source\package.json —— 请在插件根目录执行本脚本，或用 -Source 指定插件目录"
    exit 1
}
if (-not (Test-Path $profileDir)) {
    Write-Error "profile 目录不存在: $profileDir （请先启动过该 profile，或检查 -Profile / -DshHome）"
    exit 1
}

# 2) 复制插件（跳过自身已位于目标位置的情况）
$alreadyThere = (Test-Path $pluginDir) -and ((Resolve-Path $Source).Path -eq (Resolve-Path $pluginDir).Path)
if ($alreadyThere) {
    Write-Host "插件已位于目标位置，跳过复制。"
}
else {
    New-Item -ItemType Directory -Force -Path (Split-Path $pluginDir -Parent) | Out-Null
    if (Test-Path $pluginDir) { Remove-Item $pluginDir -Recurse -Force }
    Copy-Item $Source $pluginDir -Recurse -Force
    Write-Host "已复制插件 -> $pluginDir"
}

# 3) 注册到 profile manifest
$json = Get-Content $manifest -Raw | ConvertFrom-Json
if (-not $json.dependencies) { $json.dependencies = @{} }
if (-not $json.dependencies.PSObject.Properties[$pluginName]) {
    $json.dependencies | Add-Member -NotePropertyName $pluginName -NotePropertyValue "file:node_modules/$pluginName"
}
$bundles = $json.dsh.profile.bundles
if ($bundles -notcontains $pluginName) {
    $bundles += $pluginName
    $json.dsh.profile.bundles = $bundles
}
$body = $json | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText($manifest, $body + "`n", (New-Object System.Text.UTF8Encoding($false)))
Write-Host "已在 $manifest 注册 dsh-attention（bundles + dependencies）"

Write-Host ""
Write-Host "安装完成。请重启 DSH Web（运行你的启动脚本或重启 dsh web），然后刷新浏览器。"
Write-Host "验证: 打开设置 -> 确认提醒 分区，点击「授权系统通知」并「发送测试通知」。"
