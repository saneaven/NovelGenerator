@echo off
title Novel Generator frontend

:: 프로젝트 폴더 경로로 이동합니다. 아래 경로를 수정하세요.
cd ./App/frontend

:: npm 명령어 실행 (예: npm start)
echo.
echo =================================
echo  Start React Application...
echo =================================
echo.
call npm run dev

:: 작업이 끝나면 잠시 대기
pause