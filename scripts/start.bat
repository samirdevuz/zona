@echo off
setlocal
cd /d "%~dp0\.."
title ZONA server

where node >nul 2>nul
if errorlevel 1 goto :nonode
node -e "process.exit(+process.versions.node.split('.')[0] >= 20 ? 0 : 1)"
if errorlevel 1 goto :oldnode

if exist node_modules goto :deps_ok
echo [ZONA] Birinchi ishga tushirish: kutubxonalar o'rnatilmoqda - internet kerak...
echo [ZONA] First run: installing dependencies - needs internet...
call npm install
if errorlevel 1 goto :fail
:deps_ok

node scripts\needs-build.mjs
if errorlevel 1 goto :run
echo [ZONA] O'yin yig'ilmoqda - build...
call npm run build
if errorlevel 1 goto :fail

:run
echo.
echo [ZONA] Server ishga tushmoqda. Windows Firewall so'rasa: "Private networks" ga ruxsat bering.
echo [ZONA] Starting server. If Windows Firewall asks, allow access on PRIVATE networks.
echo [ZONA] To'xtatish uchun shu oynani yoping yoki Ctrl+C bosing.
call npm start
pause
exit /b 0

:nonode
echo [ZONA] Node.js topilmadi. https://nodejs.org saytidan Node.js 22 LTS ni o'rnating, keyin qayta ishga tushiring.
echo [ZONA] Node.js not found. Install Node.js 22 LTS from https://nodejs.org and run this again.
pause
exit /b 1

:oldnode
echo [ZONA] Node.js versiyasi eski. Node.js 22 LTS ni o'rnating: https://nodejs.org
echo [ZONA] Node.js is too old. Install Node.js 22 LTS from https://nodejs.org
pause
exit /b 1

:fail
echo [ZONA] Xatolik yuz berdi - yuqoridagi xabarlarni o'qing.
echo [ZONA] Something went wrong - see the messages above.
pause
exit /b 1
