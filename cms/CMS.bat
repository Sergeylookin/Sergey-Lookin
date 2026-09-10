@echo off
chcp 65001 >nul
title CMS - Portfolio
cd /d "%~dp0.."

rem Locate node.exe: when launched from Explorer, PATH often does not include it.
set "NODE="
for %%P in (node.exe) do if not defined NODE if not "%%~$PATH:P"=="" set "NODE=%%~$PATH:P"
if not defined NODE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE if exist "%USERPROFILE%\scoop\apps\nodejs\current\node.exe" set "NODE=%USERPROFILE%\scoop\apps\nodejs\current\node.exe"

if not defined NODE (
  echo.
  echo   Node.js not found. Install LTS from https://nodejs.org and run this file again.
  echo.
  pause
  exit /b 1
)

"%NODE%" cms/server.mjs
echo.
pause
