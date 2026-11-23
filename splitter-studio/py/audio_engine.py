#!/usr/bin/env python3
"""
Motor Python de Audio Studio (isolado em D:\\cortador-automatico\\teste).
Funcoes:
  - analyze <arquivo>          -> Detecta Tom (Key), Escala, Camelot e BPM
  - separate <arquivo> <saida> -> Separa voz/musica (2 stems) ou instrumentos (4/6 stems) via Demucs
  - status                     -> Verifica numpy, torch, cuda (sm_61 safe) e demucs
"""
import json
import math
import os
import shutil
import subprocess
import sys
import wave
from pathlib import Path


def testar_cuda_seguro():
    try:
        import torch
        if not torch.cuda.is_available():
            return False, "CUDA indisponivel"
        # Testa operacao real para evitar erro de sm_61 em builds novos do PyTorch
        x = torch.zeros((4, 4), device="cuda")
        y = (x + 1.0).sum().item()
        if y != 16.0:
            return False, "Falha no teste CUDA"
        nome = torch.cuda.get_device_name(0)
        return True, nome
    except Exception as e:
        return False, str(e)


def cmd_status():
    info = {
        "python": sys.version.split()[0],
        "numpy": False,
        "demucs": False,
        "torch": False,
        "cuda": False,
        "gpu": None,
    }
    try:
        import numpy  # noqa: F401
        info["numpy"] = True
    except Exception:
        pass
    try:
        import torch  # noqa: F401
        info["torch"] = True
        ok, msg = testar_cuda_seguro()
        info["cuda"] = ok
        info["gpu"] = msg if ok else None
    except Exception:
        pass
    try:
        import demucs  # noqa: F401
        info["demucs"] = True
    except Exception:
        pass
    print(json.dumps(info, ensure_ascii=False))


def carregar_mono_pcm(arquivo, ffmpeg_bin, sr=22050, max_segundos=180):
    """Decodifica o audio para mono float32 via ffmpeg."""
    import numpy as np

    cmd = [
        ffmpeg_bin,
        "-v", "error",
        "-i", str(arquivo),
        "-t", str(max_segundos),
        "-ac", "1",
        "-ar", str(sr),
        "-f", "f32le",
        "pipe:1",
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

    # Framing vetorizado
    n_frames = 1 + (len(y) - n_fft) // hop
    idx = np.arange(n_fft)[None, :] + hop * np.arange(n_frames)[:, None]
    frames = y[idx] * np.hanning(n_fft)[None, :]
    mag = np.abs(np.fft.rfft(frames, axis=1))

    # Spectral flux (onset envelope)
    diff = np.diff(mag, axis=0, prepend=mag[:1])
    flux = np.maximum(0.0, diff).sum(axis=1)
    flux = flux - np.mean(flux)
    if np.std(flux) < 1e-8:
        return 120.0, 0.0

    # Autocorrelacao via FFT
    n_ac = 1 << int(math.ceil(math.log2(len(flux) * 2)))
    f_fft = np.fft.rfft(flux, n=n_ac)
    ac = np.fft.irfft(f_fft * np.conj(f_fft), n=n_ac)[:len(flux)]
    if ac[0] > 0:
        ac = ac / ac[0]

    fps = sr / hop
    # Faixa de BPM 60..190
    min_lag = max(1, int(round(fps * 60.0 / 190.0)))
    max_lag = min(len(ac) - 1, int(round(fps * 60.0 / 60.0)))
    if max_lag <= min_lag:
        return 120.0, 0.0

    regiao = ac[min_lag:max_lag + 1].copy()
    # Prior leve favorecendo 85..155 BPM (evita dobrar/cortar pela metade com facilidade)
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
    # Limita a 1500 frames para ficar instantaneo
    if n_frames > 1500:
        step = max(1, n_frames // 1500)
        starts = np.arange(0, len(y) - n_fft, hop * step)
    else:
        starts = np.arange(0, len(y) - n_fft, hop)

    idx = np.arange(n_fft)[None, :] + starts[:, None]
    frames = y[idx] * np.hanning(n_fft)[None, :]
    spec = np.abs(np.fft.rfft(frames, axis=1)) ** 2
    freqs = np.fft.rfftfreq(n_fft, 1.0 / sr)

    # Mapeia frequencias musicais (65 Hz .. 2093 Hz) para 12 classes de altura (C..B)
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

    # Perfis Krumhansl-Schmuckler
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
    res = {
        "bpm": bpm,
        "bpmConfianca": bpm_conf,
        "tom": f"{nota} {escala}",
        "nota": nota,
        "escala": escala,
        "camelot": camelot,
        "tomConfianca": tom_conf,
        "loudnessDb": db,
    }
    print(json.dumps(res, ensure_ascii=False))


def cmd_separate(arquivo, out_dir, mode, ffmpeg_bin):
    """Separa faixas usando Demucs (htdemucs ou htdemucs_6s)."""
    os.makedirs(out_dir, exist_ok=True)
    # Adiciona diretorio do ffmpeg ao PATH para torchaudio/demucs
    ffmpeg_dir = str(Path(ffmpeg_bin).parent)
    os.environ["PATH"] = ffmpeg_dir + os.pathsep + os.environ.get("PATH", "")

    cuda_ok, gpu_info = testar_cuda_seguro()
    device = "cuda" if cuda_ok else "cpu"
    print(json.dumps({"evento": "progresso", "etapa": f"Inicializando Demucs ({device.upper()})..."}), flush=True)

    # Converte entrada para WAV 44.1kHz stereo para evitar problemas de codec no torchaudio
    wav_in = os.path.join(out_dir, "_input.wav")
    subprocess.run(
        [ffmpeg_bin, "-y", "-v", "error", "-i", arquivo, "-ac", "2", "-ar", "44100", wav_in],
        check=True,
    )

    model = "htdemucs_6s" if mode == "stems6" else "htdemucs"
    cmd = [
        sys.executable, "-m", "demucs.separate",
        "-n", model,
        "-d", device,
        "-o", out_dir,
    ]
    if mode == "vocal":
        cmd += ["--two-stems", "vocals"]
    cmd.append(wav_in)

    print(json.dumps({"evento": "progresso", "etapa": f"Separando faixas com IA ({model} / {device.upper()})..."}), flush=True)
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    ultima_linha = ""
    for line in proc.stdout:
        line = line.strip()
        if line:
            ultima_linha = line
            if "%" in line or "Downloading" in line or "Separating" in line:
                print(json.dumps({"evento": "progresso", "etapa": line[:120]}), flush=True)
    ret = proc.wait()
    if ret != 0:
        raise RuntimeError(f"Demucs falhou (codigo {ret}): {ultima_linha}")

    # Localiza pasta de saida do demucs: out_dir/<model>/_input/*.wav
    stem_dir = Path(out_dir) / model / "_input"
    if not stem_dir.exists():
        raise RuntimeError("Pasta de stems do Demucs nao encontrada.")

    stems = {}
    for wav in sorted(stem_dir.glob("*.wav")):
        destino = Path(out_dir) / f"{wav.stem}.wav"
        shutil.move(str(wav), str(destino))
        stems[wav.stem] = str(destino)

    # Limpa temporarios
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
        if cmd == "status":
            cmd_status()
        elif cmd == "analyze":
            arquivo = sys.argv[2]
            ffmpeg_bin = sys.argv[3] if len(sys.argv) > 3 else "ffmpeg"
            cmd_analyze(arquivo, ffmpeg_bin)
        elif cmd == "separate":
            arquivo = sys.argv[2]
            out_dir = sys.argv[3]
            mode = sys.argv[4] if len(sys.argv) > 4 else "vocal"
            ffmpeg_bin = sys.argv[5] if len(sys.argv) > 5 else "ffmpeg"
            cmd_separate(arquivo, out_dir, mode, ffmpeg_bin)
        else:
            print(json.dumps({"erro": f"Comando desconhecido: {cmd}"}))
            sys.exit(1)
    except Exception as e:
        print(json.dumps({"erro": str(e)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
