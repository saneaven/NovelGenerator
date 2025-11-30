@echo off
title Novel Generator Backend

call .venv\Scripts\activate

:: 프로젝트 폴더 경로로 이동합니다. 아래 경로를 수정하세요.

:: npm 명령어 실행 (예: npm start)
echo.
echo =================================
echo  Start FastAPI Backend...
echo =================================
echo.
call uvicorn App.backend.main:app --reload --host 0.0.0.0 --port 8000
:: 작업이 끝나면 잠시 대기
pause