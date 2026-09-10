@echo off
REM ============================================================
REM  PromptHub Windows 10 one-click packaging script
REM
REM  Usage (double-click, or from a terminal):
REM    scripts\package-win10.bat              full flow (check + build + pack)
REM    scripts\package-win10.bat --skip-tests skip tests, build and pack only
REM    scripts\package-win10.bat --no-open    do not open the output folder
REM
REM  Toolchain: prefers bun; falls back to node/npm/npx when bun is absent.
REM  (node must be v22.6+ to run the TypeScript packaging script directly.
REM   bun:test based unit tests are skipped in the node environment.)
REM
REM  Artifacts:
REM    build\PromptHub\                      portable dir (run bin\PromptHub.exe)
REM    build\PromptHub.zip                   portable zip
REM    build\stable-win-x64\PromptHub-Setup.zip   installer
REM
REM  NOTE: this file is intentionally ASCII-only so that cmd parses it
REM  identically under any console codepage (936 / 65001 / ...).
REM ============================================================

setlocal
cd /d "%~dp0.."

set "SKIP_TESTS=0"
set "OPEN_DIR=1"
if "%1"=="--skip-tests" set "SKIP_TESTS=1"
if "%1"=="--no-open" set "OPEN_DIR=0"
if "%2"=="--skip-tests" set "SKIP_TESTS=1"
if "%2"=="--no-open" set "OPEN_DIR=0"

echo.
echo ============================================================
echo    PromptHub for Windows 10  -  Package Build
echo ============================================================
echo.

REM ---- Step 1: detect toolchain (prefer bun, fallback to node/npm) ----
echo [1/5] Detecting toolchain...
set "PKG=bun"
where bun >nul 2>nul
if not errorlevel 1 (
    echo   Using bun:
    call bun --version
    goto :install
)
set "PKG=node"
where node >nul 2>nul
if errorlevel 1 (
    echo   [ERROR] Neither bun nor node found. Install either:
    echo           bun  : https://bun.sh
    echo           node : https://nodejs.org  - requires v22.6+
    goto :fail
)
for /f "delims=" %%v in ('node --version') do echo   Using node %%v - bun not found, unit tests will be skipped
echo.

:install
REM ---- Step 2: install dependencies ----
echo [2/5] Installing dependencies...
if "%PKG%"=="bun" (
    call bun install
) else (
    call npm install
)
if errorlevel 1 goto :install_fail
echo   [OK] Dependencies ready
echo.

REM ---- Step 3: typecheck + unit tests ----
if "%SKIP_TESTS%"=="1" goto :skip_tests
echo [3/5] Typecheck + unit tests...
if "%PKG%"=="bun" (
    call bun run typecheck
    if errorlevel 1 goto :test_fail
    call bun test
    if errorlevel 1 goto :test_fail
) else (
    call npx tsc --noEmit
    if errorlevel 1 goto :test_fail
    echo    node environment: bun:test based unit tests skipped
)
echo   [OK] All checks passed
echo.
goto :step4

:skip_tests
echo [3/5] Tests skipped (--skip-tests)
echo.

:step4
REM ---- Step 4: electrobun build ----
echo [4/5] Electrobun build...
if "%PKG%"=="bun" (
    call bun run build
) else (
    call npx electrobun build --env=stable --platform=win
)
if errorlevel 1 goto :build_fail
echo   [OK] Build finished
echo.

REM ---- Step 5: portable package ----
echo [5/5] Building portable package (extract + icons + zip)...
if "%PKG%"=="bun" (
    call bun run scripts/build-portable.ts
) else (
    call node scripts/build-portable.ts
)
if errorlevel 1 goto :build_fail

echo.
echo ============================================================
echo    Package OK!
echo ============================================================
echo    Portable dir : build\PromptHub\bin\PromptHub.exe
echo    Portable zip : build\PromptHub.zip
echo    Installer    : build\stable-win-x64\PromptHub-Setup.zip
echo.

if not "%OPEN_DIR%"=="1" goto :done
start "" explorer "build"
goto :done

:install_fail
echo   [ERROR] Dependency install failed. Check your network and retry.
goto :fail

:test_fail
echo   [ERROR] Typecheck or unit tests failed, packaging aborted.
echo           To force packaging: scripts\package-win10.bat --skip-tests
goto :fail

:build_fail
echo   [ERROR] Build or packaging failed. Check the log above.
goto :fail

:fail
echo.
echo ***********************************************************
echo    PACKAGE FAILED
echo ***********************************************************
pause
endlocal
exit /b 1

:done
endlocal
exit /b 0
