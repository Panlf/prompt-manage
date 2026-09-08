@echo off
REM ============================================================
REM  PromptHub Windows 10 一键打包脚本
REM
REM  用法:
REM    双击运行, 或在命令行执行:
REM      scripts\package-win10.bat              完整流程(检查+测试+构建+打包)
REM      scripts\package-win10.bat --skip-tests 跳过测试, 直接构建打包
REM      scripts\package-win10.bat --no-open    结束后不自动打开产物文件夹
REM
REM  产物:
REM    build\PromptHub\          绿色版目录(运行 bin\PromptHub.exe)
REM    build\PromptHub.zip       绿色版压缩包
REM    build\stable-win-x64\prompt-manage-Setup.zip   安装包
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

REM ---- Step 1: 检查 Bun ----
echo [1/5] 检查构建工具链...
where bun >nul 2>nul
if errorlevel 1 goto :no_bun
echo   bun 版本:
call bun --version
echo.

REM ---- Step 2: 安装依赖 ----
echo [2/5] 安装依赖...
call bun install
if errorlevel 1 goto :install_fail
echo   [OK] 依赖就绪
echo.

REM ---- Step 3: 类型检查 + 单元测试 ----
if "%SKIP_TESTS%"=="1" goto :skip_tests
echo [3/5] 类型检查 + 单元测试...
call bun run typecheck
if errorlevel 1 goto :test_fail
call bun test
if errorlevel 1 goto :test_fail
echo   [OK] 检查与测试全部通过
echo.
goto :step4

:skip_tests
echo [3/5] 跳过测试 (--skip-tests)
echo.

:step4
REM ---- Step 4: Electrobun 构建 ----
echo [4/5] Electrobun 构建...
call bun run build
if errorlevel 1 goto :build_fail
echo   [OK] 构建完成
echo.

REM ---- Step 5: 生成绿色版 ----
echo [5/5] 生成 Windows 绿色版 (解包 + 嵌入图标 + zip)...
call bun run scripts/build-portable.ts
if errorlevel 1 goto :build_fail

echo.
echo ============================================================
echo    打包成功!
echo ============================================================
echo    绿色版目录 : build\PromptHub\bin\PromptHub.exe
echo    绿色版压缩 : build\PromptHub.zip
echo    安装包     : build\stable-win-x64\prompt-manage-Setup.zip
echo.

if not "%OPEN_DIR%"=="1" goto :done
start "" explorer "build"
goto :done

:no_bun
echo   [错误] 未找到 bun, 请先安装: https://bun.sh
echo          安装后重新打开本窗口再运行.
goto :fail

:install_fail
echo   [错误] 依赖安装失败, 请检查网络后重试.
goto :fail

:test_fail
echo   [错误] 类型检查或单元测试未通过, 打包中止.
echo          如需强制打包可使用: scripts\package-win10.bat --skip-tests
goto :fail

:build_fail
echo   [错误] 构建或打包失败, 请根据上方日志排查.
goto :fail

:fail
echo.
echo ***********************************************************
echo    打包失败
echo ***********************************************************
pause
endlocal
exit /b 1

:done
endlocal
exit /b 0
