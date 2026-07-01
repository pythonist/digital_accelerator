@echo off
echo ==================================================
echo        Stopping All Ghost Python/Node Processes      
echo ==================================================
echo.
echo Killing Python processes...
taskkill /F /IM python.exe /T >nul 2>&1

echo Killing Node processes...
taskkill /F /IM node.exe /T >nul 2>&1

echo Checking for any lingering processes on backend port 5000...
FOR /F "tokens=5" %%T IN ('netstat -a -n -o ^| findstr :5000') DO (
    taskkill /F /PID %%T >nul 2>&1
)

echo Checking for any lingering processes on frontend port 5173...
FOR /F "tokens=5" %%T IN ('netstat -a -n -o ^| findstr :5173') DO (
    taskkill /F /PID %%T >nul 2>&1
)

echo.
echo ✅ All ghost processes have been terminated!
echo You can now safely run .\start-dev.bat
echo ==================================================
