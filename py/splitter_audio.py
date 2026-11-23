#!/usr/bin/env python3
"""
Motor Python do Splitter Studio integrado ao Mega Cortes HD.
Inclui deteccao adaptativa de GPU (serie + compute capability) com requirements
variaveis para PyTorch/CUDA e fallback automatico para CPU.

Comandos:
  - detect-gpu                   -> Detecta GPU NVIDIA/AMD/CPU e calcula requirements ideais
  - status                       -> Verifica python, numpy, torch, cuda (teste real), demucs e perfil GPU
  - install-ia                   -> Instala PyTorch (CUDA compativel com a serie da GPU ou CPU) + Demucs
  - analyze <arquivo> <ffmpeg>   -> Detecta Tom (Key), Escala, Camelot, BPM e volume medio
  - separate <arq> <out> <modo> <ffmpeg> -> Separa faixas via Demucs com fallback automatico para CPU
"""
import json
import math
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path


def detectar_gpu_hardware():
    """Consulta nvidia-smi para descobrir nome da GPU, Compute Capability (sm_XX) e driver."""
    info = {
        "temNvidia": False,
        "nome": None,
        "computeCap": None,
        "driver": None,
        "vramMb": None,
        "arquitetura": "cpu",
        "perfil": "cpu",
        "indexUrl": "https://download.pytorch.org/whl/cpu",
        "pacotesTorch": ["torch", "torchaudio"],
        "motivo": "Nenhuma GPU NVIDIA detectada — usando modo CPU leve.",
    }
    nvidia_smi = shutil.which("nvidia-smi")
    if not nvidia_smi and os.name == "nt":
        candidato = r"C:\Windows\System32\nvidia-smi.exe"
        if os.path.exists(candidato):
            nvidia_smi = candidato
    if not nvidia_smi:
        return info

    try:
        out = subprocess.check_output(
            [
                nvidia_smi,
                "--query-gpu=name,compute_cap,driver_version,memory.total",
                "--format=csv,noheader,nounits",
            ],
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=5,
        ).strip()
        if not out:
            return info
        primeira = out.splitlines()[0]
        partes = [p.strip() for p in primeira.split(",")]
        nome = partes[0] if len(partes) > 0 else "NVIDIA GPU"
        cc_str = partes[1] if len(partes) > 1 else "0.0"
        driver = partes[2] if len(partes) > 2 else "0"
        vram = int(float(partes[3])) if len(partes) > 3 and partes[3].replace(".", "").isdigit() else None

        cc = float(cc_str) if re.match(r"^\d+(\.\d+)?$", cc_str) else 0.0
        driver_major = int(driver.split(".")[0]) if driver and driver.split(".")[0].isdigit() else 0

        info["temNvidia"] = True
        info["nome"] = nome
        info["computeCap"] = cc_str
        info["driver"] = driver
        info["vramMb"] = vram

        # Mapeamento dinamico de requirements por serie/arquitetura da GPU
        if cc < 6.0:
            info["arquitetura"] = "legacy (< sm_60)"
            info["perfil"] = "cpu"
            info["indexUrl"] = "https://download.pytorch.org/whl/cpu"
            info["pacotesTorch"] = ["torch", "torchaudio"]
            info["motivo"] = f"GPU {nome} (sm_{cc_str.replace('.', '')}) anterior a Pascal — usando fallback CPU."
        elif cc < 7.0:
            # Pascal (GTX 10xx, P104-100, P106, Titan X/Xp): cu126 e o build CUDA 12.x compativel com sm_61
            info["arquitetura"] = "Pascal (sm_61)"
            if driver_major >= 525 or driver_major == 0:
                info["perfil"] = "pascal-cu126"
                info["indexUrl"] = "https://download.pytorch.org/whl/cu126"
                info["pacotesTorch"] = ["torch==2.8.0+cu126", "torchaudio==2.8.0+cu126", "torchvision==0.23.0+cu126"]
                info["motivo"] = f"GPU {nome} (Pascal sm_{cc_str.replace('.', '')}) — selecionando PyTorch cu126 compativel."
            else:
                info["perfil"] = "cpu"
                info["indexUrl"] = "https://download.pytorch.org/whl/cpu"
                info["pacotesTorch"] = ["torch", "torchaudio"]
                info["motivo"] = f"Driver NVIDIA ({driver}) muito antigo para CUDA 12 — usando fallback CPU."
        elif cc < 10.0:
            # Volta / Turing / Ampere / Ada (GTX 16xx, RTX 20xx/30xx/40xx)
            info["arquitetura"] = f"Turing/Ampere/Ada (sm_{cc_str.replace('.', '')})"
            if driver_major >= 550 or driver_major == 0:
                info["perfil"] = "rtx-cu126"
                info["indexUrl"] = "https://download.pytorch.org/whl/cu126"
                info["pacotesTorch"] = ["torch==2.8.0+cu126", "torchaudio==2.8.0+cu126", "torchvision==0.23.0+cu126"]
                info["motivo"] = f"GPU {nome} (sm_{cc_str.replace('.', '')}) — selecionando PyTorch cu126."
            elif driver_major >= 525:
                info["perfil"] = "rtx-cu121"
                info["indexUrl"] = "https://download.pytorch.org/whl/cu121"
                info["pacotesTorch"] = ["torch==2.5.1+cu121", "torchaudio==2.5.1+cu121"]
                info["motivo"] = f"GPU {nome} com driver {driver} — selecionando PyTorch cu121."
            else:
                info["perfil"] = "cpu"
                info["indexUrl"] = "https://download.pytorch.org/whl/cpu"
                info["pacotesTorch"] = ["torch", "torchaudio"]
                info["motivo"] = f"Driver NVIDIA ({driver}) antigo — usando fallback CPU."
        else:
            # Blackwell (RTX 50xx, sm_100/sm_120)
            info["arquitetura"] = f"Blackwell (sm_{cc_str.replace('.', '')})"
            info["perfil"] = "blackwell-cu128"
            info["indexUrl"] = "https://download.pytorch.org/whl/cu128"
            info["pacotesTorch"] = ["torch==2.8.0+cu128", "torchaudio==2.8.0+cu128", "torchvision==0.23.0+cu128"]
            info["motivo"] = f"GPU {nome} (Blackwell sm_{cc_str.replace('.', '')}) — selecionando PyTorch cu128."
    except Exception as e:
        info["motivo"] = f"Nao foi possivel consultar nvidia-smi ({e}) — fallback CPU."

    return info


def testar_cuda_seguro():
    """Executa uma operacao real na GPU para garantir que o kernel CUDA funciona neste hardware."""
    try:
        import torch
        if not torch.cuda.is_available():
            return False, "CUDA indisponivel no PyTorch instalado"
        x = torch.zeros((4, 4), device="cuda")
        y = (x + 1.0).sum().item()
        if y != 16.0:
            return False, "Falha na validacao do tensor CUDA"
        nome = torch.cuda.get_device_name(0)
        return True, nome
    except Exception as e:
        return False, str(e)


def cmd_status():
    hw = detectar_gpu_hardware()
    info = {
        "python": sys.version.split()[0],
        "numpy": False,
        "demucs": False,
        "torch": False,
        "torchVersao": None,
        "cuda": False,
        "gpu": None,
        "cudaAviso": None,
        "hardware": hw,
    }
    try:
        import numpy  # noqa: F401
        info["numpy"] = True
    except Exception:
        pass
    try:
        import torch
        info["torch"] = True
        info["torchVersao"] = getattr(torch, "__version__", None)
        ok, msg = testar_cuda_seguro()
        info["cuda"] = ok
        info["gpu"] = msg if ok else None
        if not ok:
            info["cudaAviso"] = msg
    except Exception:
        pass
    try:
        import demucs.separate  # noqa: F401
        info["demucs"] = True
    except Exception:
        pass
    print(json.dumps(info, ensure_ascii=False))


def cmd_install_ia():
    """Instala Demucs (com todas as dependencias) e depois PyTorch compativel com a serie da GPU (ou CPU)."""
    hw = detectar_gpu_hardware()
    print(json.dumps({
        "evento": "progresso",
        "progresso": 10,
        "etapa": f"Hardware detectado: {hw['motivo']}",
    }), flush=True)

    uv_bin = shutil.which("uv")
    if not uv_bin and os.name == "nt":
        cand = os.path.join(os.path.expanduser("~"), ".local", "bin", "uv.exe")
        if os.path.exists(cand):
            uv_bin = cand

    def rodar_instalacao(pacotes, index_url=None, extra_args=None):
        if uv_bin:
            cmd = [uv_bin, "pip", "install", "--link-mode=copy", "--python", sys.executable]
        else:
            cmd = [sys.executable, "-m", "pip", "install"]
        if extra_args:
            cmd += extra_args
        if index_url:
            cmd += ["--index-url", index_url]
        cmd += pacotes
        proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace"
        )
        ultima = ""
        for linha in proc.stdout:
            linha = linha.strip()
            if linha:
                ultima = linha
                if any(k in linha for k in ("Downloading", "Installing", "Installed", "Prepared", "Resolved")):
                    print(json.dumps({"evento": "progresso", "etapa": linha[:110]}), flush=True)
        ret = proc.wait()
        if ret != 0:
            raise RuntimeError(f"Falha na instalacao ({ret}): {ultima}")

    print(json.dumps({
        "evento": "progresso",
        "progresso": 20,
        "etapa": "Instalando Demucs, Soundfile e dependências de áudio...",
    }), flush=True)

    # Instala demucs primeiro com TODAS as dependencias (sphn, einops, julius, etc.)
    rodar_instalacao(["demucs", "soundfile", "sphn", "numpy"])

    print(json.dumps({
        "evento": "progresso",
        "progresso": 50,
        "etapa": f"Instalando PyTorch ({hw['perfil']}) compatível com sua GPU...",
    }), flush=True)

    # Depois substitui apenas torch/torchaudio/torchvision pelo build exato da serie da GPU
    try:
        rodar_instalacao(hw["pacotesTorch"], index_url=hw["indexUrl"], extra_args=["--reinstall", "--no-deps"])
    except Exception as e:
        if hw["perfil"] != "cpu":
            print(json.dumps({
                "evento": "progresso",
                "progresso": 70,
                "etapa": f"Falha no build CUDA ({e}). Aplicando fallback para PyTorch CPU...",
            }), flush=True)
            rodar_instalacao(["torch", "torchaudio"], index_url="https://download.pytorch.org/whl/cpu", extra_args=["--reinstall", "--no-deps"])
        else:
            raise

    # Valida se CUDA funciona de verdade; se nao funcionar, informa que rodara em CPU
    ok_cuda, msg_cuda = testar_cuda_seguro()
    print(json.dumps({
        "evento": "concluido",
        "perfil": hw["perfil"],
        "cuda": ok_cuda,
        "gpu": msg_cuda if ok_cuda else None,
        "fallbackCpu": not ok_cuda,
    }, ensure_ascii=False), flush=True)


def carregar_mono_pcm(arquivo, ffmpeg_bin, sr=22050, max_segundos=180):
    import numpy as np

    cmd = [
        ffmpeg_bin, "-v", "error",
        "-i", str(arquivo),
        "-t", str(max_segundos),
        "-ac", "1", "-ar", str(sr),
        "-f", "f32le", "pipe:1",
    ]
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if proc.returncode != 0 or not proc.stdout:
        raise RuntimeError(proc.stderr.decode("utf-8", errors="ignore") or "Falha ao decodificar audio")
    return np.frombuffer(proc.stdout, dtype=np.float32), sr


def detectar_bpm(y, sr):
    import numpy as np

    hop = 512
    n_fft = 2048
    if len(y) < n_fft * 4:
        return 120.0, 0.0

    n_frames = 1 + (len(y) - n_fft) // hop
    idx = np.arange(n_fft)[None, :] + hop * np.arange(n_frames)[:, None]
    frames = y[idx] * np.hanning(n_fft)[None, :]
    mag = np.abs(np.fft.rfft(frames, axis=1))

    diff = np.diff(mag, axis=0, prepend=mag[:1])
    flux = np.maximum(0.0, diff).sum(axis=1)
    flux = flux - np.mean(flux)
    if np.std(flux) < 1e-8:
        return 120.0, 0.0

    n_ac = 1 << int(math.ceil(math.log2(len(flux) * 2)))
    f_fft = np.fft.rfft(flux, n=n_ac)
    ac = np.fft.irfft(f_fft * np.conj(f_fft), n=n_ac)[:len(flux)]
    if ac[0] > 0:
        ac = ac / ac[0]

    fps = sr / hop
    min_lag = max(1, int(round(fps * 60.0 / 190.0)))
    max_lag = min(len(ac) - 1, int(round(fps * 60.0 / 60.0)))
    if max_lag <= min_lag:
        return 120.0, 0.0

    regiao = ac[min_lag:max_lag + 1].copy()
    lags = np.arange(min_lag, max_lag + 1)
    bpms = 60.0 * fps / lags
    peso = np.exp(-0.5 * ((np.log2(bpms / 118.0)) / 0.65) ** 2)
    score = regiao * peso

    best_i = int(np.argmax(score))
    best_lag = min_lag + best_i
    best_bpm = 60.0 * fps / best_lag
    conf = float(max(0.0, min(1.0, regiao[best_i])))
    return round(float(best_bpm), 1), round(conf, 2)


def detectar_tom(y, sr):
    import numpy as np

    hop = 2048
    n_fft = 4096
    if len(y) < n_fft:
        return "C", "maior", "8B", 0.0

    n_frames = 1 + (len(y) - n_fft) // hop
    if n_frames > 1500:
        step = max(1, n_frames // 1500)
        starts = np.arange(0, len(y) - n_fft, hop * step)
    else:
        starts = np.arange(0, len(y) - n_fft, hop)

    idx = np.arange(n_fft)[None, :] + starts[:, None]
    frames = y[idx] * np.hanning(n_fft)[None, :]
    spec = np.abs(np.fft.rfft(frames, axis=1)) ** 2
    freqs = np.fft.rfftfreq(n_fft, 1.0 / sr)

    mask = (freqs >= 65.0) & (freqs <= 2100.0)
    f_valid = freqs[mask]
    s_valid = spec[:, mask]
    midi = np.round(69.0 + 12.0 * np.log2(f_valid / 440.0)).astype(int)
    pc = midi % 12

    chroma = np.zeros(12, dtype=np.float64)
    for c in range(12):
        chroma[c] = s_valid[:, pc == c].sum()

    if chroma.sum() <= 0:
        return "C", "maior", "8B", 0.0
    chroma = chroma / np.linalg.norm(chroma)

    major_profile = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
    minor_profile = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
    major_profile /= np.linalg.norm(major_profile)
    minor_profile /= np.linalg.norm(minor_profile)

    notas = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
    camelot_maj = ["8B", "3B", "10B", "5B", "12B", "7B", "2B", "9B", "4B", "11B", "6B", "1B"]
    camelot_min = ["5A", "12A", "7A", "2A", "9A", "4A", "11A", "6A", "1A", "8A", "3A", "10A"]

    melhor = (-999.0, "C", "maior", "8B")
    for i in range(12):
        rot = np.roll(chroma, -i)
        c_maj = float(np.corrcoef(rot, major_profile)[0, 1])
        c_min = float(np.corrcoef(rot, minor_profile)[0, 1])
        if c_maj > melhor[0]:
            melhor = (c_maj, notas[i], "maior", camelot_maj[i])
        if c_min > melhor[0]:
            melhor = (c_min, notas[i], "menor", camelot_min[i])

    conf = round(max(0.0, min(1.0, (melhor[0] + 1.0) / 2.0)), 2)
    return melhor[1], melhor[2], melhor[3], conf


def cmd_analyze(arquivo, ffmpeg_bin):
    y, sr = carregar_mono_pcm(arquivo, ffmpeg_bin)
    bpm, bpm_conf = detectar_bpm(y, sr)
    nota, escala, camelot, tom_conf = detectar_tom(y, sr)
    rms = float((y ** 2).mean() ** 0.5) if len(y) else 0.0
    db = round(20.0 * math.log10(max(rms, 1e-6)), 1)
    print(json.dumps({
        "bpm": bpm,
        "bpmConfianca": bpm_conf,
        "tom": f"{nota} {escala}",
        "nota": nota,
        "escala": escala,
        "camelot": camelot,
        "tomConfianca": tom_conf,
        "loudnessDb": db,
    }, ensure_ascii=False))


def rodar_demucs_em(device, model, mode, wav_in, out_dir):
    cmd = [sys.executable, "-m", "demucs.separate", "-n", model, "-d", device, "-o", out_dir]
    if mode == "vocal":
        cmd += ["--two-stems", "vocals"]
    cmd.append(wav_in)

    print(json.dumps({"evento": "progresso", "etapa": f"Separando faixas com IA ({model} / {device.upper()})..."}), flush=True)
    proc = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace"
    )
    ultima = ""
    for line in proc.stdout:
        line = line.strip()
        if line:
            ultima = line
            if "%" in line or "Downloading" in line or "Separating" in line:
                print(json.dumps({"evento": "progresso", "etapa": line[:120]}), flush=True)
    return proc.wait(), ultima


def cmd_separate(arquivo, out_dir, mode, ffmpeg_bin):
    os.makedirs(out_dir, exist_ok=True)
    ffmpeg_dir = str(Path(ffmpeg_bin).parent)
    if ffmpeg_dir and os.path.isdir(ffmpeg_dir):
        os.environ["PATH"] = ffmpeg_dir + os.pathsep + os.environ.get("PATH", "")

    cuda_ok, _ = testar_cuda_seguro()
    device = "cuda" if cuda_ok else "cpu"
    print(json.dumps({"evento": "progresso", "etapa": f"Preparando áudio para Demucs ({device.upper()})..."}), flush=True)

    wav_in = os.path.join(out_dir, "_input.wav")
    subprocess.run([ffmpeg_bin, "-y", "-v", "error", "-i", arquivo, "-ac", "2", "-ar", "44100", wav_in], check=True)

    model = "htdemucs_6s" if mode == "stems6" else "htdemucs"
    ret, ultima = rodar_demucs_em(device, model, mode, wav_in, out_dir)

    # Fallback automatico para CPU somente se o erro for de GPU/CUDA (nao de modulo ausente)
    if ret != 0 and device == "cuda" and "ModuleNotFoundError" not in ultima:
        print(json.dumps({"evento": "progresso", "etapa": f"CUDA falhou ({ultima[:70]}) — alternando para CPU..."}), flush=True)
        device = "cpu"
        ret, ultima = rodar_demucs_em("cpu", model, mode, wav_in, out_dir)

    if ret != 0:
        raise RuntimeError(f"Demucs falhou (codigo {ret}): {ultima}")

    stem_dir = Path(out_dir) / model / "_input"
    if not stem_dir.exists():
        raise RuntimeError("Pasta de stems do Demucs nao encontrada.")

    stems = {}
    for wav in sorted(stem_dir.glob("*.wav")):
        destino = Path(out_dir) / f"{wav.stem}.wav"
        shutil.move(str(wav), str(destino))
        stems[wav.stem] = str(destino)

    try:
        os.remove(wav_in)
        shutil.rmtree(Path(out_dir) / model, ignore_errors=True)
    except Exception:
        pass

    print(json.dumps({"evento": "concluido", "device": device, "model": model, "stems": stems}, ensure_ascii=False), flush=True)


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"erro": "Comando ausente"}))
        sys.exit(1)
    cmd = sys.argv[1]
    try:
        if cmd == "detect-gpu":
            print(json.dumps(detectar_gpu_hardware(), ensure_ascii=False))
        elif cmd == "status":
            cmd_status()
        elif cmd == "install-ia":
            cmd_install_ia()
        elif cmd == "analyze":
            cmd_analyze(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "ffmpeg")
        elif cmd == "separate":
            cmd_separate(sys.argv[2], sys.argv[3], sys.argv[4] if len(sys.argv) > 4 else "vocal", sys.argv[5] if len(sys.argv) > 5 else "ffmpeg")
        else:
            print(json.dumps({"erro": f"Comando desconhecido: {cmd}"}))
            sys.exit(1)
    except Exception as e:
        print(json.dumps({"erro": str(e)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
