@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist data mkdir data
(
  echo [%date% %time%] collect-kr 시작
  call npx playwright install chromium
  node src\collect-kr.js %*
  echo [%date% %time%] collect-kr 종료
) > data\collect-kr.log 2>&1
