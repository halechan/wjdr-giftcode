# 环境设置脚本 - Windows PowerShell
# 检查 Python 3.12+，创建虚拟环境，安装依赖

$ErrorActionPreference = "Stop"

Write-Host "=== 环境设置脚本 ===" -ForegroundColor Cyan

# 检查 Python 是否安装
Write-Host "`n[1/3] 检查 Python 版本..." -ForegroundColor Yellow
try {
    $pythonVersion = python --version 2>&1
    Write-Host "找到 Python: $pythonVersion" -ForegroundColor Green

    # 提取版本号并检查是否 >= 3.12
    $versionMatch = $pythonVersion -match '(\d+)\.(\d+)\.(\d+)'
    if ($versionMatch) {
        $major = [int]$Matches[1]
        $minor = [int]$Matches[2]

        if ($major -lt 3 -or ($major -eq 3 -and $minor -lt 12)) {
            Write-Host "错误: 需要 Python 3.12 或更高版本" -ForegroundColor Red
            Write-Host "当前版本: $pythonVersion" -ForegroundColor Red
            Write-Host "请从 https://www.python.org/downloads/ 下载并安装 Python 3.12+" -ForegroundColor Yellow
            exit 1
        }
    } else {
        Write-Host "错误: 无法解析 Python 版本号" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "错误: 未找到 Python" -ForegroundColor Red
    Write-Host "请从 https://www.python.org/downloads/ 下载并安装 Python 3.12+" -ForegroundColor Yellow
    exit 1
}

# 创建虚拟环境
Write-Host "`n[2/3] 创建虚拟环境..." -ForegroundColor Yellow
if (Test-Path ".venv") {
    Write-Host "虚拟环境已存在，跳过创建" -ForegroundColor Green
} else {
    python -m venv .venv
    if ($LASTEXITCODE -eq 0) {
        Write-Host "虚拟环境创建成功" -ForegroundColor Green
    } else {
        Write-Host "错误: 创建虚拟环境失败" -ForegroundColor Red
        exit 1
    }
}

# 安装依赖
Write-Host "`n[3/3] 安装依赖..." -ForegroundColor Yellow
if (Test-Path "requirements.txt") {
    & .\.venv\Scripts\python.exe -m pip install --upgrade pip
    & .\.venv\Scripts\pip.exe install -r requirements.txt
    if ($LASTEXITCODE -eq 0) {
        Write-Host "依赖安装成功" -ForegroundColor Green
    } else {
        Write-Host "错误: 安装依赖失败" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "警告: 未找到 requirements.txt，跳过依赖安装" -ForegroundColor Yellow
}

Write-Host "`n=== 设置完成 ===" -ForegroundColor Cyan
Write-Host "激活虚拟环境: .\.venv\Scripts\Activate.ps1" -ForegroundColor Green
Write-Host "运行脚本: python main.py -c '你的礼包码'" -ForegroundColor Green