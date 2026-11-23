@echo off
title Audio Studio Local
cd /d "%~dp0"
set NODE_BIN=%~dp0runtime\node\node.exe
if not exist "%NODE_BIN%" set NODE_BIN=node
start "" http://127.0.0.1:4350
"%NODE_BIN%" server.js
pause
