@echo off
cd /d "%~dp0"
chcp 65001 >nul
echo ==========================================
echo DGSS Data Viewer Build Script
echo ==========================================

echo [1/4] Installing dependencies...
pip install -r requirements.txt
pip install pyinstaller

echo [2/4] Generating Icon...
python -c "import os; from PIL import Image; Image.open('static/LOGO.png').save('logo.ico') if os.path.exists('static/LOGO.png') else print('Warning: Logo not found')"

echo [3/4] Cleaning up previous builds...
if exist build rmdir /s /q build
if exist dist rmdir /s /q dist
if exist *.spec del /q *.spec

echo [4/4] Building EXE...
pyinstaller --noconfirm --onefile --windowed --add-data "templates;templates" --add-data "static;static" --icon "logo.ico" --name "DGSS野外手图数据Ai智能管理平台" app.py

echo ==========================================
if exist dist\DGSS野外手图数据Ai智能管理平台.exe (
    echo Build SUCCESS! 
    echo Executable is located at: dist\DGSS野外手图数据Ai智能管理平台.exe
) else (
    echo Build FAILED!
)
:: Clean up temporary icon
if exist logo.ico del logo.ico
echo ==========================================
pause
