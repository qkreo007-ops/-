@echo off
chcp 65001 > nul
echo ========================================================
echo   과외/멘토링 사진 과제 첨삭 시스템 (TutorMark)
echo   [DB & 파일 스토리지: Supabase / 로컬 SQLite 지원]
echo ========================================================
echo.
echo [1/2] 필수 패키지 확인 중 (FastAPI, Supabase, Pillow 등)...
python -m pip install fastapi uvicorn python-multipart pillow supabase python-dotenv httpx > nul 2>&1

echo.
echo [2/2] TutorMark 웹 서버를 실행합니다...
echo.
echo 브라우저 주소: http://localhost:8000
echo (선생님과 학생 모두 위 주소로 접속하시면 됩니다.)
echo.
echo [단축키 안내]
echo - 마우스 휠: 사진 확대/축소 (Zoom In/Out)
echo - Space 키 + 드래그: 사진 화면 이동 (Pan)
echo - Ctrl+Z / Ctrl+Y: 실행 취소 / 다시 실행
echo.
echo 서버를 종료하려면 이 창에서 Ctrl+C를 누르세요.
echo ========================================================
echo.

start http://localhost:8000
python app.py
pause
