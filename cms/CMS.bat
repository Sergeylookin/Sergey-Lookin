@echo off
chcp 65001 >nul
title CMS - Portfolio
cd /d "%~dp0.."
start "" http://localhost:8150
node cms/server.mjs
pause
