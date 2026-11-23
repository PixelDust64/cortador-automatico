@echo off
title Instalar IA Demucs com CUDA (Audio Studio)
cd /d "%~dp0"
echo Instalando PyTorch 2.8.0 (CUDA 12.6 - compativel com Pascal sm_61)...
uv pip install --link-mode=copy --python .venv\Scripts\python.exe --reinstall "torch==2.8.0+cu126" "torchvision==0.23.0+cu126" "torchaudio==2.8.0+cu126" --index-url https://download.pytorch.org/whl/cu126
echo.
echo Instalando Demucs + Soundfile...
uv pip install --link-mode=copy --python .venv\Scripts\python.exe demucs soundfile --no-deps
uv pip install --link-mode=copy --python .venv\Scripts\python.exe dora-search einops julius lameenc openunmix pyyaml tqdm
echo.
echo Verificando instalacao (deve mostrar "cuda": true):
.venv\Scripts\python.exe py\audio_engine.py status
pause
