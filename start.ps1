# ============================================================
# Hello Site Bot - PowerShell 启动脚本
# 用法：
#   双击 start.bat（推荐，免配置）
#   或 PowerShell 执行：
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#   & "C:\Users\a\Desktop\hello\start.ps1"
# ============================================================

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $ProjectRoot

$Port = 3000
$EnvFile = Join-Path $ProjectRoot ".env"
# 从 .env 读 PORT（若配置了）
if (Test-Path $EnvFile) {
    $portLine = (Get-Content $EnvFile | Where-Object { $_ -match '^PORT=' } | Select-Object -First 1)
    if ($portLine) {
        $p = ($portLine -split '=', 2)[1].Trim()
        if ($p -and ($p -match '^\d+$')) { $Port = [int]$p }
    }
}

Write-Host ""
Write-Host "  ============================================" -ForegroundColor Green
Write-Host "   Hello Site Bot 启动脚本" -ForegroundColor Green
Write-Host "  ============================================" -ForegroundColor Green

# ---------- 1. 检查 Node ----------
$nodeOk = $false
try {
    $nodeVer = & node -v 2>$null
    if ($LASTEXITCODE -eq 0) { $nodeOk = $true; Write-Host "  Node: $nodeVer" -ForegroundColor DarkGray }
} catch { }
if (-not $nodeOk) {
    # 尝试常见安装路径
    foreach ($candidate in @("C:\Program Files\nodejs\node.exe", "C:\Program Files (x86)\nodejs\node.exe")) {
        if (Test-Path $candidate) {
            $env:Path = [System.IO.Path]::GetDirectoryName($candidate) + ';' + $env:Path
            $nodeVer = & $candidate -v
            if ($LASTEXITCODE -eq 0) { $nodeOk = $true; Write-Host "  Node: $nodeVer ($candidate)" -ForegroundColor DarkGray }
        }
    }
}
if (-not $nodeOk) {
    Write-Host "[ERROR] 找不到 node。请安装 Node.js 或将其加入 PATH。" -ForegroundColor Red
    Read-Host "按回车退出"
    exit 1
}

# ---------- 2. 安装依赖（仅缺失时）----------
$needInstall = -not (Test-Path (Join-Path $ProjectRoot "node_modules")) -or
              -not (Test-Path (Join-Path $ProjectRoot "node_modules\express"))
if ($needInstall) {
    Write-Host "  正在安装依赖（首次运行）..." -ForegroundColor Yellow
    $npmCmd = "C:\Program Files\nodejs\npm.cmd"
    if (Test-Path $npmCmd) { & $npmCmd install } else { npm install }
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] 依赖安装失败，请检查网络或手动执行 npm install" -ForegroundColor Red
        Read-Host "按回车退出"
        exit 1
    }
}

# ---------- 3. 检测 .env 中的 key 配置 ----------
$provider = "未配置"
if (Test-Path $EnvFile) {
    $lines = Get-Content $EnvFile
    function Get-EnvValue([string]$name) {
        $v = ($lines | Where-Object { $_ -match ('^' + $name + '=') } | Select-Object -First 1)
        if ($v) { return (($v -split '=', 2)[1]).Trim() }
        return ''
    }
    $dsKey = Get-EnvValue 'DEEPSEEK_API_KEY'
    $agKey = Get-EnvValue 'AGNES_API_KEY'
    if ($dsKey) { $provider = "DeepSeek (model: " + (Get-EnvValue 'DEEPSEEK_MODEL') + ")" }
    elseif ($agKey) { $provider = "Agnes (model: " + (Get-EnvValue 'AGNES_MODEL') + ")" }
}

# ---------- 4. 端口占用检测：自动清理 ----------
$connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($connections) {
    $pids = $connections | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($pid2 in $pids) {
        try {
            $p = Get-Process -Id $pid2 -ErrorAction SilentlyContinue
            Write-Host "  端口 $Port 被占用（PID $pid2，$($p.ProcessName)），正在关闭..." -ForegroundColor Yellow
            Stop-Process -Id $pid2 -Force -ErrorAction SilentlyContinue
            Start-Sleep -Milliseconds 500
        } catch { }
    }
    # 再确认一次
    $still = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($still) {
        Write-Host "[ERROR] 端口 $Port 无法释放，请手动关闭占用程序后重试。" -ForegroundColor Red
        Read-Host "按回车退出"
        exit 1
    }
}

# ---------- 5. 启动服务（前台，Ctrl+C 停止）+ 延迟开浏览器 ----------
$browserJob = Start-Job {
    param($url)
    Start-Sleep -Seconds 2
    Start-Process $url
} -ArgumentList "http://localhost:$Port"

Write-Host ""
Write-Host "  ============================================" -ForegroundColor Green
Write-Host "   服务: http://localhost:$Port" -ForegroundColor Green
Write-Host "   LLM Provider: $provider" -ForegroundColor $(if ($provider -eq '未配置') { 'Red' } else { 'Green' })
if (-not $provider.StartsWith('DeepSeek')) {
    Write-Host "   [提示] 未在 .env 配置 DEEPSEEK_API_KEY，当前走 $provider" -ForegroundColor DarkYellow
    Write-Host "   启动后点右上角 🔑 API Key，在 DeepSeek 行粘贴 key 保存即切换" -ForegroundColor DarkYellow
}
Write-Host "   按 Ctrl+C 停止服务" -ForegroundColor DarkGray
Write-Host "  ============================================" -ForegroundColor Green
Write-Host ""

# 前台运行 node；Ctrl+C 终止 node 后自动清理后台 job
try {
    & node server/index.js
} finally {
    Stop-Job $browserJob -ErrorAction SilentlyContinue
    Remove-Job $browserJob -ErrorAction SilentlyContinue
    Get-Job | Remove-Job -ErrorAction SilentlyContinue
    Write-Host "服务已停止。" -ForegroundColor Yellow
}
