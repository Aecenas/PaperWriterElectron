@echo off
setlocal
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Launch-PaperWriter.ps1" -Dev
exit /b %errorlevel%
