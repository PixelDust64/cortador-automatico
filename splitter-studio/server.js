const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

const PORT = Number(process.env.PORT || 4350);
const BASE_DIR = __dirname;
const PUBLIC_DIR = path.join(BASE_DIR, 'public');
const DADOS_DIR = path.join(BASE_DIR, 'dados');
const PY_ENGINE = path.join(BASE_DIR, 'py', 'audio_engine.py');

fs.mkdirSync(DADOS_DIR, { recursive: true });
fs.mkdirSync(PUBLIC_DIR, { recursive: true });

// Localiza binarios exclusivamente dentro da propria pasta runtime/ ou no PATH do sistema
function acharBinario(candidatos, fallback) {
  for (const c of candidatos) {
    if (c && fs.existsSync(c)) return c;
  }
  return fallback;
}

const RUNTIME_LOCAL = path.join(BASE_DIR, 'runtime');
const FFMPEG = acharBinario([
  path.join(RUNTIME_LOCAL, 'ffmpeg', 'ffmpeg.exe'),
  path.join(RUNTIME_LOCAL, 'ffmpeg.exe'),
], 'ffmpeg');

const FFPROBE = acharBinario([
  path.join(RUNTIME_LOCAL, 'ffmpeg', 'ffprobe.exe'),
  path.join(RUNTIME_LOCAL, 'ffprobe.exe'),
], 'ffprobe');

const YTDLP = acharBinario([
  path.join(RUNTIME_LOCAL, 'yt-dlp.exe'),
], 'yt-dlp');

const PYTHON_VENV = path.join(BASE_DIR, '.venv', 'Scripts', 'python.exe');
function acharPython() {
  if (fs.existsSync(PYTHON_VENV)) return PYTHON_VENV;
  const uvPy = path.join(process.env.APPDATA || '', 'uv', 'python', 'cpython-3.12-windows-x86_64-none', 'python.exe');
  if (fs.existsSync(uvPy)) return uvPy;
  return 'python';
}

// Registro em memoria de midias e jobs
const midias = new Map();
const jobs = new Map();

function gerarId(prefixo = 'a') {
  return `${prefixo}_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
}

function limparNome(nome) {
  return String(nome || 'audio')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'audio';
}

function rodarComando(bin, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { windowsHide: true, ...opts });
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', d => { stdout += d.toString('utf8'); });
    proc.stderr?.on('data', d => { stderr += d.toString('utf8'); });
    proc.on('error', reject);
    proc.on('close', code => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || stdout.trim() || `${path.basename(bin)} saiu com codigo ${code}`));
    });
  });
}

async function obterInfoAudio(arquivo) {
  try {
    const { stdout } = await rodarComando(FFPROBE, [
      '-v', 'error',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      arquivo,
    ]);
    const info = JSON.parse(stdout || '{}');
    const audioStream = (info.streams || []).find(s => s.codec_type === 'audio') || {};
    const duracao = Number(info.format?.duration || audioStream.duration || 0);
    return {
      duracao: Number.isFinite(duracao) ? Math.round(duracao * 100) / 100 : 0,
      sampleRate: Number(audioStream.sample_rate || 44100),
      canais: Number(audioStream.channels || 2),
      codec: audioStream.codec_name || 'desconhecido',
      tamanho: fs.existsSync(arquivo) ? fs.statSync(arquivo).size : 0,
    };
  } catch {
    return {
      duracao: 0,
      sampleRate: 44100,
      canais: 2,
      codec: 'desconhecido',
      tamanho: fs.existsSync(arquivo) ? fs.statSync(arquivo).size : 0,
    };
  }
}

async function gerarPeaks(arquivo, numBarras = 180) {
  return new Promise((resolve) => {
    const proc = spawn(FFMPEG, [
      '-v', 'error',
      '-i', arquivo,
      '-ac', '1',
      '-ar', '8000',
      '-f', 's16le',
      'pipe:1',
    ], { windowsHide: true });

    const chunks = [];
    proc.stdout.on('data', c => chunks.push(c));
    proc.on('error', () => resolve(new Array(numBarras).fill(0.1)));
    proc.on('close', () => {
      const buf = Buffer.concat(chunks);
      const totalSamples = Math.floor(buf.length / 2);
      if (totalSamples < 10) return resolve(new Array(numBarras).fill(0.1));
      const step = Math.max(1, Math.floor(totalSamples / numBarras));
      const peaks = [];
      let maxVal = 0.001;
      for (let i = 0; i < numBarras; i++) {
        const start = i * step;
        const end = Math.min(totalSamples, start + step);
        let pico = 0;
        // Amostragem rapida dentro do bloco
        const stride = Math.max(1, Math.floor((end - start) / 64));
        for (let s = start; s < end; s += stride) {
          const v = Math.abs(buf.readInt16LE(s * 2)) / 32768;
          if (v > pico) pico = v;
        }
        if (pico > maxVal) maxVal = pico;
        peaks.push(pico);
      }
      resolve(peaks.map(p => Math.round((p / maxVal) * 1000) / 1000));
    });
  });
}

async function registrarMidia(arquivo, nomeOriginal, origem = 'arquivo', extras = {}) {
  const id = gerarId('m');
  const info = await obterInfoAudio(arquivo);
  const peaks = await gerarPeaks(arquivo, 180);
  const reg = {
    id,
    nome: limparNome(nomeOriginal),
    arquivo,
    origem,
    url: `/api/audio/${id}`,
    downloadUrl: `/api/download/${id}`,
    ...info,
    peaks,
    ...extras,
    criadoEm: Date.now(),
  };
  midias.set(id, reg);
  return reg;
}

function enviarJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function lerJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk.toString('utf8');
      if (raw.length > 10 * 1024 * 1024) reject(new Error('Payload muito grande'));
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch (e) { reject(new Error('JSON invalido')); }
    });
    req.on('error', reject);
  });
}

function lerRawBody(req, destinoPath) {
  return new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(destinoPath);
    let bytes = 0;
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 500 * 1024 * 1024) {
        ws.destroy();
        reject(new Error('Arquivo excede 500 MB'));
      }
    });
    req.pipe(ws);
    ws.on('finish', () => resolve(bytes));
    ws.on('error', reject);
    req.on('error', reject);
  });
}

// Normaliza qualquer arquivo (inclusive video MP4/WebM/MKV) para WAV stereo 44.1kHz para edicao limpa
async function extrairAudioWav(entrada, saidaWav) {
  await rodarComando(FFMPEG, [
    '-y', '-v', 'error',
    '-i', entrada,
    '-vn',
    '-ac', '2',
    '-ar', '44100',
    '-c:a', 'pcm_s16le',
    saidaWav,
  ]);
}

async function checarStatusPython() {
  const py = acharPython();
  try {
    const { stdout } = await rodarComando(py, [PY_ENGINE, 'status']);
    return { ok: true, bin: py, ...JSON.parse(stdout) };
  } catch (e) {
    return { ok: false, bin: py, erro: e.message, numpy: false, demucs: false, cuda: false };
  }
}

// Separacao rapida via FFmpeg (cancelamento de centro para instrumental + extracao de centro para voz)
async function separarRapidoFFmpeg(entrada, outDir, modo) {
  fs.mkdirSync(outDir, { recursive: true });
  const stems = {};
  if (modo === 'vocal') {
    const musica = path.join(outDir, 'no_vocals.wav');
    const voz = path.join(outDir, 'vocals.wav');
    // Remove sinal central (onde normalmente fica a voz)
    await rodarComando(FFMPEG, [
      '-y', '-v', 'error', '-i', entrada,
      '-af', 'stereotools=mlev=0.015625:slev=1.2',
      '-ac', '2', '-ar', '44100', musica,
    ]);
    // Isola faixa central + filtro passa-banda vocal (180Hz - 5500Hz)
    await rodarComando(FFMPEG, [
      '-y', '-v', 'error', '-i', entrada,
      '-af', 'stereotools=slev=0.015625:mlev=1.2,highpass=f=180,lowpass=f=5500',
      '-ac', '2', '-ar', '44100', voz,
    ]);
    stems.no_vocals = musica;
    stems.vocals = voz;
  } else {
    // 4 faixas por separacao espectral + stereo (rapido, sem GPU)
    const voz = path.join(outDir, 'vocals.wav');
    const baixo = path.join(outDir, 'bass.wav');
    const bateria = path.join(outDir, 'drums.wav');
    const outros = path.join(outDir, 'other.wav');

    await Promise.all([
      rodarComando(FFMPEG, ['-y', '-v', 'error', '-i', entrada, '-af', 'stereotools=slev=0.02:mlev=1.2,highpass=f=220,lowpass=f=4500', '-ac', '2', '-ar', '44100', voz]),
      rodarComando(FFMPEG, ['-y', '-v', 'error', '-i', entrada, '-af', 'lowpass=f=220', '-ac', '2', '-ar', '44100', baixo]),
      rodarComando(FFMPEG, ['-y', '-v', 'error', '-i', entrada, '-af', 'highpass=f=4500', '-ac', '2', '-ar', '44100', bateria]),
      rodarComando(FFMPEG, ['-y', '-v', 'error', '-i', entrada, '-af', 'stereotools=mlev=0.05:slev=1.2,highpass=f=220,lowpass=f=4500', '-ac', '2', '-ar', '44100', outros]),
    ]);
    stems.vocals = voz;
    stems.bass = baixo;
    stems.drums = bateria;
    stems.other = outros;
  }
  return stems;
}

// Separacao via Demucs (IA) em background com atualizacao de progresso no job
function iniciarJobSeparacao(midia, modo, motor) {
  const jobId = gerarId('job');
  const job = {
    id: jobId,
    status: 'rodando',
    etapa: 'Preparando separacao...',
    progresso: 5,
    resultado: null,
    erro: null,
  };
  jobs.set(jobId, job);

  (async () => {
    const outDir = path.join(DADOS_DIR, jobId);
    fs.mkdirSync(outDir, { recursive: true });

    try {
      let stemsMap = null;
      let motorUsado = motor;

      if (motor === 'ia') {
        const py = acharPython();
        const pyStatus = await checarStatusPython();
        if (!pyStatus.demucs) {
          throw new Error('Demucs (IA) nao esta instalado no ambiente Python ainda. Use o modo "Rapido (FFmpeg)" ou instale o Demucs.');
        }

        stemsMap = await new Promise((resolve, reject) => {
          const proc = spawn(py, [PY_ENGINE, 'separate', midia.arquivo, outDir, modo, FFMPEG], { windowsHide: true });
          let errBuf = '';
          let resultadoFinal = null;
          proc.stdout.on('data', chunk => {
            for (const linha of chunk.toString('utf8').split(/\r?\n/)) {
              if (!linha.trim()) continue;
              try {
                const msg = JSON.parse(linha);
                if (msg.evento === 'progresso') {
                  job.etapa = msg.etapa;
                  const m = /(\d+)%/.exec(msg.etapa || '');
                  if (m) job.progresso = Math.max(10, Math.min(95, Number(m[1])));
                } else if (msg.evento === 'concluido') {
                  resultadoFinal = msg;
                }
              } catch { /* ignora linhas nao-json */ }
            }
          });
          proc.stderr.on('data', d => { errBuf += d.toString('utf8'); });
          proc.on('error', reject);
          proc.on('close', code => {
            if (code === 0 && resultadoFinal) resolve(resultadoFinal.stems);
            else reject(new Error(errBuf.trim() || `Demucs falhou (codigo ${code})`));
          });
        });
      } else {
        job.etapa = 'Separando faixas com FFmpeg (modo rapido)...';
        job.progresso = 35;
        stemsMap = await separarRapidoFFmpeg(midia.arquivo, outDir, modo);
        motorUsado = 'ffmpeg';
      }

      job.etapa = 'Gerando formas de onda das faixas...';
      job.progresso = 96;

      const labels = {
        no_vocals: 'Música (Instrumental)',
        vocals: 'Voz',
        drums: 'Bateria',
        bass: 'Baixo',
        other: 'Outros',
        guitar: 'Guitarra',
        piano: 'Piano',
      };
      const cores = {
        no_vocals: '#22c55e',
        vocals: '#8b5cf6',
        drums: '#f59e0b',
        bass: '#06b6d4',
        other: '#ec4899',
        guitar: '#ef4444',
        piano: '#3b82f6',
      };

      const faixas = [];
      // Ordena para que Musica/Voz venham primeiro
      const ordem = ['no_vocals', 'vocals', 'drums', 'bass', 'guitar', 'piano', 'other'];
      const chaves = Object.keys(stemsMap).sort((a, b) => {
        const ia = ordem.indexOf(a);
        const ib = ordem.indexOf(b);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      });

      for (const chave of chaves) {
        const arq = stemsMap[chave];
        const rotulo = labels[chave] || chave;
        const m = await registrarMidia(arq, `${midia.nome} - ${rotulo}`, 'stem', {
          stemKey: chave,
          rotulo,
          cor: cores[chave] || '#8b5cf6',
        });
        faixas.push(m);
      }

      job.status = 'concluido';
      job.progresso = 100;
      job.etapa = 'Concluido!';
      job.resultado = { motor: motorUsado, modo, faixas };
    } catch (e) {
      job.status = 'erro';
      job.erro = e.message;
      job.etapa = 'Erro na separacao';
    }
  })();

  return job;
}

// Roteador HTTP
const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsed.pathname;

  try {
    // 1. Status do ambiente
    if (req.method === 'GET' && pathname === '/api/status') {
      const py = await checarStatusPython();
      return enviarJson(res, 200, {
        ok: true,
        porta: PORT,
        ffmpeg: fs.existsSync(FFMPEG) || FFMPEG === 'ffmpeg',
        ytdlp: fs.existsSync(YTDLP) || YTDLP === 'yt-dlp',
        python: py,
      });
    }

    // 2. Upload de arquivo local (audio ou video)
    if (req.method === 'POST' && pathname === '/api/upload') {
      const nomeHeader = decodeURIComponent(req.headers['x-file-name'] || 'audio.wav');
      const ext = path.extname(nomeHeader).toLowerCase() || '.bin';
      const idTemp = gerarId('up');
      const brutoPath = path.join(DADOS_DIR, `${idTemp}_raw${ext}`);
      const wavPath = path.join(DADOS_DIR, `${idTemp}.wav`);

      const bytes = await lerRawBody(req, brutoPath);
      if (bytes === 0) return enviarJson(res, 400, { erro: 'Arquivo vazio' });

      await extrairAudioWav(brutoPath, wavPath);
      try { fs.unlinkSync(brutoPath); } catch {}

      const midia = await registrarMidia(wavPath, path.basename(nomeHeader, ext), 'upload');
      return enviarJson(res, 200, midia);
    }

    // 3. Baixar audio de link (YouTube, Twitch, Kick, SoundCloud, TikTok, etc.)
    if (req.method === 'POST' && pathname === '/api/baixar-link') {
      const { url } = await lerJsonBody(req);
      if (!url || !/^https?:\/\//i.test(String(url).trim())) {
        return enviarJson(res, 400, { erro: 'Cole um link valido (http:// ou https://)' });
      }
      const cleanUrl = String(url).trim();
      const dlId = gerarId('dl');
      const outTemplate = path.join(DADOS_DIR, `${dlId}.%(ext)s`);

      // Primeiro tenta pegar o titulo rapidamente
      let titulo = 'Audio da Web';
      try {
        const { stdout } = await rodarComando(YTDLP, [
          '--no-playlist', '--print', '%(title)s', '--no-warnings', cleanUrl,
        ]);
        const t = stdout.trim().split(/\r?\n/)[0];
        if (t) titulo = t;
      } catch { /* segue com titulo padrao */ }

      const ffmpegDir = path.dirname(FFMPEG);
      await rodarComando(YTDLP, [
        '--no-playlist',
        '--no-warnings',
        '-f', 'bestaudio/best',
        '-x',
        '--audio-format', 'wav',
        '--ffmpeg-location', ffmpegDir,
        '-o', outTemplate,
        cleanUrl,
      ]);

      const wavPath = path.join(DADOS_DIR, `${dlId}.wav`);
      if (!fs.existsSync(wavPath)) {
        // Procura arquivo baixado caso yt-dlp tenha mantido outra extensao
        const encontrado = fs.readdirSync(DADOS_DIR).find(f => f.startsWith(dlId + '.'));
        if (!encontrado) throw new Error('Nao foi possivel baixar o audio deste link.');
        await extrairAudioWav(path.join(DADOS_DIR, encontrado), wavPath);
        try { fs.unlinkSync(path.join(DADOS_DIR, encontrado)); } catch {}
      }

      const midia = await registrarMidia(wavPath, titulo, 'link', { linkOriginal: cleanUrl });
      return enviarJson(res, 200, midia);
    }

    // 4. Streaming de audio com suporte a Range (seek no player)
    if (req.method === 'GET' && pathname.startsWith('/api/audio/')) {
      const id = pathname.replace('/api/audio/', '');
      const m = midias.get(id);
      if (!m || !fs.existsSync(m.arquivo)) return enviarJson(res, 404, { erro: 'Midia nao encontrada' });

      const stat = fs.statSync(m.arquivo);
      const ext = path.extname(m.arquivo).toLowerCase();
      const mime = ext === '.mp3' ? 'audio/mpeg' : ext === '.ogg' ? 'audio/ogg' : 'audio/wav';
      const range = req.headers.range;

      if (range) {
        const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
        const start = parseInt(startStr, 10);
        const end = endStr ? parseInt(endStr, 10) : stat.size - 1;
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': end - start + 1,
          'Content-Type': mime,
        });
        fs.createReadStream(m.arquivo, { start, end }).pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Length': stat.size,
          'Content-Type': mime,
          'Accept-Ranges': 'bytes',
        });
        fs.createReadStream(m.arquivo).pipe(res);
      }
      return;
    }

    // 5. Download em MP3 ou WAV
    if (req.method === 'GET' && pathname.startsWith('/api/download/')) {
      const id = pathname.replace('/api/download/', '');
      const formato = (parsed.searchParams.get('formato') || 'mp3').toLowerCase() === 'wav' ? 'wav' : 'mp3';
      const m = midias.get(id);
      if (!m || !fs.existsSync(m.arquivo)) return enviarJson(res, 404, { erro: 'Midia nao encontrada' });

      let arqSaida = m.arquivo;
      let apagarDepois = false;
      if (formato === 'mp3' && !m.arquivo.endsWith('.mp3')) {
        arqSaida = path.join(DADOS_DIR, `${id}_export.mp3`);
        await rodarComando(FFMPEG, ['-y', '-v', 'error', '-i', m.arquivo, '-c:a', 'libmp3lame', '-b:a', '256k', arqSaida]);
        apagarDepois = true;
      }

      const stat = fs.statSync(arqSaida);
      const nomeDownload = `${limparNome(m.nome)}.${formato}`;
      const nomeAscii = nomeDownload
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\x20-\x7E]/g, '_')
        .replace(/["\\]/g, '_');
      res.writeHead(200, {
        'Content-Type': formato === 'mp3' ? 'audio/mpeg' : 'audio/wav',
        'Content-Length': stat.size,
        'Content-Disposition': `attachment; filename="${nomeAscii}"; filename*=UTF-8''${encodeURIComponent(nomeDownload)}`,
      });
      const rs = fs.createReadStream(arqSaida);
      rs.pipe(res);
      rs.on('close', () => { if (apagarDepois) { try { fs.unlinkSync(arqSaida); } catch {} } });
      return;
    }

    // 6. Removedor Vocal / Splitter (inicia job assincrono)
    if (req.method === 'POST' && (pathname === '/api/remover-voz' || pathname === '/api/splitter')) {
      const body = await lerJsonBody(req);
      const midia = midias.get(body.mediaId);
      if (!midia) return enviarJson(res, 404, { erro: 'Audio nao encontrado' });
      const modo = pathname === '/api/remover-voz' ? 'vocal' : (body.modo === 'stems6' ? 'stems6' : 'stems4');
      const motor = body.motor === 'ffmpeg' ? 'ffmpeg' : 'ia';
      const job = iniciarJobSeparacao(midia, modo, motor);
      return enviarJson(res, 200, { jobId: job.id, status: job.status });
    }

    // 7. Consultar progresso de job
    if (req.method === 'GET' && pathname.startsWith('/api/job/')) {
      const id = pathname.replace('/api/job/', '');
      const job = jobs.get(id);
      if (!job) return enviarJson(res, 404, { erro: 'Job nao encontrado' });
      return enviarJson(res, 200, job);
    }

    // 8. Mudar de Tom e Velocidade (Pitch & Speed via FFmpeg rubberband)
    if (req.method === 'POST' && pathname === '/api/mudar-tom') {
      const { mediaId, semitons = 0, velocidade = 1.0 } = await lerJsonBody(req);
      const midia = midias.get(mediaId);
      if (!midia) return enviarJson(res, 404, { erro: 'Audio nao encontrado' });

      const st = Math.max(-12, Math.min(12, Number(semitons) || 0));
      const vel = Math.max(0.5, Math.min(2.0, Number(velocidade) || 1.0));
      const pitchScale = Math.pow(2, st / 12);
      const outPath = path.join(DADOS_DIR, `${gerarId('pitch')}.wav`);

      await rodarComando(FFMPEG, [
        '-y', '-v', 'error',
        '-i', midia.arquivo,
        '-af', `rubberband=pitch=${pitchScale.toFixed(6)}:tempo=${vel.toFixed(4)}`,
        '-ac', '2', '-ar', '44100',
        outPath,
      ]);

      const sinal = st >= 0 ? `+${st}` : `${st}`;
      const nova = await registrarMidia(outPath, `${midia.nome} (${sinal}st ${Math.round(vel * 100)}%)`, 'pitch');
      return enviarJson(res, 200, nova);
    }

    // 9. Determinar Tom e BPM (Python numpy)
    if (req.method === 'POST' && pathname === '/api/tom-bpm') {
      const { mediaId } = await lerJsonBody(req);
      const midia = midias.get(mediaId);
      if (!midia) return enviarJson(res, 404, { erro: 'Audio nao encontrado' });

      const py = acharPython();
      const { stdout } = await rodarComando(py, [PY_ENGINE, 'analyze', midia.arquivo, FFMPEG]);
      const analise = JSON.parse(stdout);
      return enviarJson(res, 200, { ...analise, duracao: midia.duracao, sampleRate: midia.sampleRate, canais: midia.canais });
    }

    // 10. Cortador de Audio (manter ou remover selecao + fade in / fade out)
    if (req.method === 'POST' && pathname === '/api/cortar') {
      const { mediaId, inicio = 0, fim = 0, fadeIn = 0, fadeOut = 0, inverter = false } = await lerJsonBody(req);
      const midia = midias.get(mediaId);
      if (!midia) return enviarJson(res, 404, { erro: 'Audio nao encontrado' });

      const t0 = Math.max(0, Number(inicio) || 0);
      const t1 = Math.min(midia.duracao || 99999, Math.max(t0 + 0.1, Number(fim) || midia.duracao));
      const fIn = Math.max(0, Number(fadeIn) || 0);
      const fOut = Math.max(0, Number(fadeOut) || 0);
      const outPath = path.join(DADOS_DIR, `${gerarId('cut')}.wav`);

      if (!inverter) {
        const dur = Math.max(0.1, t1 - t0);
        const filtros = [];
        if (fIn > 0) filtros.push(`afade=t=in:st=0:d=${Math.min(fIn, dur / 2).toFixed(2)}`);
        if (fOut > 0) filtros.push(`afade=t=out:st=${Math.max(0, dur - Math.min(fOut, dur / 2)).toFixed(2)}:d=${Math.min(fOut, dur / 2).toFixed(2)}`);
        const args = ['-y', '-v', 'error', '-ss', t0.toFixed(3), '-to', t1.toFixed(3), '-i', midia.arquivo];
        if (filtros.length) args.push('-af', filtros.join(','));
        args.push('-ac', '2', '-ar', '44100', outPath);
        await rodarComando(FFMPEG, args);
      } else {
        // Remove o trecho selecionado [t0, t1] e junta [0..t0] + [t1..fim]
        const filterComplex = `[0:a]atrim=0:${t0.toFixed(3)},asetpts=PTS-STARTPTS[a1];[0:a]atrim=${t1.toFixed(3)},asetpts=PTS-STARTPTS[a2];[a1][a2]concat=n=2:v=0:a=1[out]`;
        await rodarComando(FFMPEG, [
          '-y', '-v', 'error', '-i', midia.arquivo,
          '-filter_complex', filterComplex,
          '-map', '[out]', '-ac', '2', '-ar', '44100', outPath,
        ]);
      }

      const nova = await registrarMidia(outPath, `${midia.nome} (corte)`, 'corte');
      return enviarJson(res, 200, nova);
    }

    // 11. Juntar Audios (com crossfade opcional)
    if (req.method === 'POST' && pathname === '/api/juntar') {
      const { mediaIds = [], crossfade = 0 } = await lerJsonBody(req);
      const lista = mediaIds.map(id => midias.get(id)).filter(Boolean);
      if (lista.length < 2) return enviarJson(res, 400, { erro: 'Adicione pelo menos 2 audios para juntar' });

      const cf = Math.max(0, Math.min(5, Number(crossfade) || 0));
      const outPath = path.join(DADOS_DIR, `${gerarId('join')}.wav`);
      const args = ['-y', '-v', 'error'];
      for (const m of lista) args.push('-i', m.arquivo);

      const filtros = [];
      for (let i = 0; i < lista.length; i++) {
        filtros.push(`[${i}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[a${i}]`);
      }

      if (cf <= 0) {
        const inputs = lista.map((_, i) => `[a${i}]`).join('');
        filtros.push(`${inputs}concat=n=${lista.length}:v=0:a=1[out]`);
      } else {
        let prev = '[a0]';
        for (let i = 1; i < lista.length; i++) {
          const dest = i === lista.length - 1 ? '[out]' : `[m${i}]`;
          filtros.push(`${prev}[a${i}]acrossfade=d=${cf.toFixed(2)}:c1=tri:c2=tri${dest}`);
          prev = dest;
        }
      }

      args.push('-filter_complex', filtros.join(';'), '-map', '[out]', '-ac', '2', '-ar', '44100', outPath);
      await rodarComando(FFMPEG, args);

      const nova = await registrarMidia(outPath, `Mix_${lista.length}_faixas`, 'juntar');
      return enviarJson(res, 200, nova);
    }

    // 12. Mixar faixas (usado no Removedor, Splitter e Karaoke!)
    if (req.method === 'POST' && pathname === '/api/mixar') {
      const { faixas = [], ecoVoz = false, nome = 'Mix_Final' } = await lerJsonBody(req);
      const validas = faixas
        .map(f => ({ midia: midias.get(f.mediaId), volume: Number(f.volume ?? 1), atrasoMs: Number(f.atrasoMs ?? 0), eco: Boolean(f.eco) }))
        .filter(f => f.midia && f.volume > 0.001);

      if (!validas.length) return enviarJson(res, 400, { erro: 'Nenhuma faixa com volume > 0 para mixar' });

      const outPath = path.join(DADOS_DIR, `${gerarId('mix')}.wav`);
      const args = ['-y', '-v', 'error'];
      for (const f of validas) args.push('-i', f.midia.arquivo);

      const filtros = [];
      const labels = [];
      validas.forEach((f, i) => {
        const cadeia = [`volume=${f.volume.toFixed(3)}`];
        if (f.atrasoMs > 0) cadeia.push(`adelay=${Math.round(f.atrasoMs)}|${Math.round(f.atrasoMs)}`);
        if (f.eco || ecoVoz) cadeia.push('aecho=0.8:0.88:45:0.22');
        filtros.push(`[${i}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,${cadeia.join(',')}[f${i}]`);
        labels.push(`[f${i}]`);
      });

      if (labels.length === 1) {
        filtros.push(`${labels[0]}anull[out]`);
      } else {
        filtros.push(`${labels.join('')}amix=inputs=${labels.length}:duration=longest:normalize=0,alimiter=limit=0.95[out]`);
      }

      args.push('-filter_complex', filtros.join(';'), '-map', '[out]', '-ac', '2', '-ar', '44100', outPath);
      await rodarComando(FFMPEG, args);

      const nova = await registrarMidia(outPath, nome, 'mix');
      return enviarJson(res, 200, nova);
    }

    // Arquivos estaticos
    let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, ''));
    if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      return enviarJson(res, 404, { erro: 'Rota nao encontrada' });
    }
    const ext = path.extname(filePath).toLowerCase();
    const mimes = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
    };
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mimes[ext] || 'application/octet-stream', 'Content-Length': data.length });
    res.end(data);
  } catch (e) {
    console.error('[Erro API]', pathname, e.message);
    enviarJson(res, 500, { erro: e.message || 'Erro interno' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Audio Studio rodando em http://127.0.0.1:${PORT}`);
  console.log(`FFmpeg: ${FFMPEG}`);
  console.log(`yt-dlp: ${YTDLP}`);
  console.log(`Python: ${acharPython()}`);
});
