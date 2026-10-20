@echo off
setlocal
set "PY=C:\wbscm-venv\Scripts\python.exe"
echo ============================================
echo  Excel -^> Supabase import (weekly update)
echo ============================================
echo  Drag the Excel file into this window, then press ENTER:
set /p XLSX=
"%PY%" "%~dp0scripts\import_to_supabase.py" "%XLSX%"
echo.
echo Finished. If errors appear above, send a screenshot to your assistant.
pause
