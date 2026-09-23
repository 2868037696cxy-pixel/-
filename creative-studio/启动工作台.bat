@echo off
chcp 65001 >nul
title JEV Creative Workbench
cd /d "%~dp0"

echo ================================================
echo    JEV Creative Workbench 跨境素材评分工作台
echo ================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [X] 未检测到 Node.js，请先安装：
  echo.
  echo     打开 https://nodejs.org/zh-cn 下载 LTS 长期支持版
  echo     一路下一步安装完成后，重新双击本文件即可。
  echo.
  pause
  exit /b 1
)

for /f %%v in ('node -v') do set NODEVER=%%v

node -e "const[ma]=process.versions.node.split('.').map(Number);if(ma<23){console.log('[X] 当前 Node 版本 '+process.versions.node+' 过低');console.log('    本应用需要 Node 23 及以上（推荐安装 24 LTS）');process.exit(1)}"
if errorlevel 1 (
  echo.
  pause
  exit /b 1
)

echo [OK] 已检测到 Node %NODEVER%
echo.
echo 正在启动服务，浏览器将在几秒后自动打开 http://localhost:8700
echo 使用完毕后：直接关闭本窗口即可停止服务。
echo.

start "" /min cmd /c "timeout /t 3 /nobreak >nul & start "" http://localhost:8700"

node server.js
if errorlevel 1 (
  echo.
  echo [!] 启动失败：最常见原因是 8700 端口已被占用。
  echo     若浏览器已能打开 http://localhost:8700 ，说明工作台已在运行，直接使用即可。
  echo.
  pause
  exit /b 1
)

echo.
echo 服务已停止。
pause
