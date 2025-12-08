@echo off
cd /d "%~dp0"
chcp 65001 >nul
echo ==========================================
echo DGSS Data Viewer - One Click Start
echo ==========================================

:: Check if Python is installed
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not found in PATH. Please install Python.
    echo [错误] 未找到 Python，请先安装 Python。
    pause
    exit /b
)

echo Checking dependencies...
pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo [WARNING] Failed to install dependencies.
    echo [警告] 依赖安装失败，程序可能无法正常运行。
)

echo Starting application...
python app.py

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Application exited with error.
    echo [错误] 程序异常退出。
    pause
)
