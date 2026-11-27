'use strict';
/**
 * Backend do Splitter Studio integrado ao Mega Cortes HD.
 * - Reutiliza a pasta pastas.baixados() e o baixador (yt-dlp) do Mega Cortes HD,
 *   evitando baixar o mesmo link duas vezes.
 * - Permite abrir qualquer video ja baixado nos projetos do Mega Cortes.
 * - Usa py/splitter_audio.py com deteccao adaptativa de GPU (requirements variaveis)
 *   e fallback automatico para CPU.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const pastas = require('./pastas');
const media = require('./media');
const baixador = require('./baixar');
const { acharPython } = require('./pipeline');

const RAIZ = path.join(__dirname, '..');
const PY_ENGINE = path.join(RAIZ, 'py', 'splitter_audio.py');

const midias = new Map();
const jobs = new Map();

function pastaSplitterTrabalho() {
  const p = path.join(pastas.trabalho(), 'splitter');
  fs.mkdirSync(p, { recursive: true });
  return p;
}

function arquivoCacheLinks() {
  return path.join(pastaSplitterTrabalho(), 'links-cache.json');
}

function lerCacheLinks() {
  try { return JSON.parse(fs.readFileSync(arquivoCacheLinks(), 'utf8')) || {}; }
  catch (_) { return {}; }
}

function gravarCacheLinks(mapa) {
  try { fs.writeFileSync(arquivoCacheLinks(), JSON.stringify(mapa, null, 2), 'utf8'); }
  catch (_) {}
}

function acharPythonSplitter() {
  // Prioriza .venv dedicado do Splitter Studio (onde o usuario pode ter instalado PyTorch CUDA/CPU),
  // depois o Python padrao do Mega Cortes HD.
  const candidatos = [
    path.join(RAIZ, 'splitter-studio', '.venv', 'Scripts', 'python.exe'),
    path.join(pastas.dados(), 'splitter-venv', 'Scripts', 'python.exe'),
    path.join(RAIZ, 'teste', '.venv', 'Scripts', 'python.exe'),
  ];
  for (const c of candidatos) {
    if (fs.existsSync(c)) return c;
  }
  const py = acharPython();
  return py || 'python';
}

function acharFfmpeg() {
  return media.FFMPEG || 'ffmpeg';
}

function acharFfprobe() {
  const ff = acharFfmpeg();
  if (ff && ff.toLowerCase().endsWith('ffmpeg.exe')) {
    const fp = ff.slice(0, -'ffmpeg.exe'.length) + 'ffprobe.exe';
    if (fs.existsSync(fp)) return fp;
  }
  return media.FFPROBE || 'ffprobe';
}

function gerarId(prefixo = 's') {
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
    const { stdout } = await rodarComando(acharFfprobe(), [
      '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', arquivo,
    ]);
    const info = JSON.parse(stdout || '{}');
    const s = (info.streams || []).find(st => st.codec_type === 'audio') || {};
    const dur = Number(info.format?.duration || s.duration || 0);
    return {
      duracao: Number.isFinite(dur) ? Math.round(dur * 100) / 100 : 0,
      sampleRate: Number(s.sample_rate || 44100),
      canais: Number(s.channels || 2),
      tamanho: fs.existsSync(arquivo) ? fs.statSync(arquivo).size : 0,
    };
  } catch (_) {
    return { duracao: 0, sampleRate: 44100, canais: 2, tamanho: 0 };
  }
}

async function gerarPeaks(arquivo, numBarras = 180) {
  return new Promise((resolve) => {
    const proc = spawn(acharFfmpeg(), [
      '-v', 'error', '-i', arquivo, '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1',
    ], { windowsHide: true });
    const chunks = [];
    proc.stdout.on('data', c => chunks.push(c));
    proc.on('error', () => resolve(new Array(numBarras).fill(0.1)));
    proc.on('close', () => {
      const buf = Buffer.concat(chunks);
      const total = Math.floor(buf.length / 2);
      if (total < 10) return resolve(new Array(numBarras).fill(0.1));
      const step = Math.max(1, Math.floor(total / numBarras));
      const peaks = [];
      let maxVal = 0.001;
      for (let i = 0; i < numBarras; i++) {
        const start = i * step;
        const end = Math.min(total, start + step);
        let pico = 0;
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

async function extrairAudioWav(entrada, saidaWav) {
  await rodarComando(acharFfmpeg(), [
    '-y', '-v', 'error', '-i', entrada, '-vn', '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le', saidaWav,
  ]);
}

async function registrarMidia(arquivo, nomeOriginal, origem = 'arquivo', extras = {}) {
  const id = gerarId('sp');
  const info = await obterInfoAudio(arquivo);
  const peaks = await gerarPeaks(arquivo, 180);
  const reg = {
    id,
    nome: limparNome(nomeOriginal),
    arquivo,
    origem,
    url: `/api/splitter/audio/${id}`,
    downloadUrl: `/api/splitter/download/${id}`,
    ...info,
    peaks,
    ...extras,
    criadoEm: Date.now(),
  };
  midias.set(id, reg);
  return reg;
}

/** Extrai ID do YouTube se for link do YouTube, para achar direto em pastas.baixados(). */
function extrairIdYoutube(url) {
  const m = /(?:youtu\.be\/|youtube\.com\/(?:watch\?.*v=|shorts\/|live\/|embed\/))([\w-]{11})/i.exec(String(url || ''));
  return m ? m[1] : null;
}

/** Procura um arquivo ja baixado em pastas.baixados() pelo ID ou pelo cache de links. */
function procurarEmBaixados(url, videoId) {
  const dir = pastas.baixados();
  if (!fs.existsSync(dir)) return null;

  // 1. Procura pelo cache exato de URL
  const cache = lerCacheLinks();
  const normUrl = String(url || '').trim();
  if (cache[normUrl] && fs.existsSync(cache[normUrl])) {
    return cache[normUrl];
  }

  // 2. Procura arquivo contendo [VIDEO_ID] (padrao do Mega Cortes: "Titulo [ID].ext")
  if (videoId) {
    const tag = `[${videoId}]`;
    const arquivos = fs.readdirSync(dir).filter(f => f.includes(tag) && /\.(mp4|mkv|webm|mov|m4a|mp3|wav|opus)$/i.test(f));
    if (arquivos.length) {
      const encontrado = path.join(dir, arquivos[0]);
      cache[normUrl] = encontrado;
      gravarCacheLinks(cache);
      return encontrado;
    }
  }
  return null;
}

/** Lista todos os videos/audios ja baixados na pasta pastas.baixados() do Mega Cortes. */
function listarBibliotecaBaixados() {
  const dir = pastas.baixados();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => /\.(mp4|mkv|webm|mov|m4a|mp3|wav|ogg|flac|opus)$/i.test(f))
    .map(f => {
      const full = path.join(dir, f);
      const st = fs.statSync(full);
      const nomeLimpo = path.basename(f, path.extname(f))
        .replace(/^\d{13}-/, '')
        .replace(/\s*\[[\w-]{6,}\]\s*$/, '')
        .replace(/_+/g, ' ')
        .trim();
      return {
        arquivo: f,
        nome: nomeLimpo || f,
        tamanhoMb: Math.round((st.size / 1048576) * 10) / 10,
        modificadoEm: st.mtimeMs,
      };
    })
    .sort((a, b) => b.modificadoEm - a.modificadoEm)
    .slice(0, 60);
}

/** Converte/extrai audio de um video de baixados com cache em trabalho/splitter/<hash>.wav */
async function carregarArquivoComCacheWav(caminhoVideo, nomeExibicao, origem, extras = {}) {
  const st = fs.statSync(caminhoVideo);
  const hash = crypto.createHash('md5').update(`${caminhoVideo}|${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 12);
  const wavCache = path.join(pastaSplitterTrabalho(), `cache_${hash}.wav`);
  if (!fs.existsSync(wavCache)) {
    await extrairAudioWav(caminhoVideo, wavCache);
  }
  return registrarMidia(wavCache, nomeExibicao, origem, extras);
}

async function checarStatusPython() {
  const py = acharPythonSplitter();
  try {
    const { stdout } = await rodarComando(py, [PY_ENGINE, 'status']);
    return { ok: true, bin: py, ...JSON.parse(stdout) };
  } catch (e) {
    return { ok: false, bin: py, erro: e.message, numpy: false, demucs: false, cuda: false };
  }
}

async function separarRapidoFFmpeg(entrada, outDir, modo) {
  fs.mkdirSync(outDir, { recursive: true });
  const ff = acharFfmpeg();
  const stems = {};
  if (modo === 'vocal') {
    const musica = path.join(outDir, 'no_vocals.wav');
    const voz = path.join(outDir, 'vocals.wav');
    await rodarComando(ff, ['-y', '-v', 'error', '-i', entrada, '-af', 'stereotools=mlev=0.015625:slev=1.2', '-ac', '2', '-ar', '44100', musica]);
    await rodarComando(ff, ['-y', '-v', 'error', '-i', entrada, '-af', 'stereotools=slev=0.015625:mlev=1.2,highpass=f=180,lowpass=f=5500', '-ac', '2', '-ar', '44100', voz]);
    stems.no_vocals = musica;
    stems.vocals = voz;
  } else {
    const voz = path.join(outDir, 'vocals.wav');
    const baixo = path.join(outDir, 'bass.wav');
    const bateria = path.join(outDir, 'drums.wav');
    const outros = path.join(outDir, 'other.wav');
    await Promise.all([
      rodarComando(ff, ['-y', '-v', 'error', '-i', entrada, '-af', 'stereotools=slev=0.02:mlev=1.2,highpass=f=220,lowpass=f=4500', '-ac', '2', '-ar', '44100', voz]),
      rodarComando(ff, ['-y', '-v', 'error', '-i', entrada, '-af', 'lowpass=f=220', '-ac', '2', '-ar', '44100', baixo]),
      rodarComando(ff, ['-y', '-v', 'error', '-i', entrada, '-af', 'highpass=f=4500', '-ac', '2', '-ar', '44100', bateria]),
      rodarComando(ff, ['-y', '-v', 'error', '-i', entrada, '-af', 'stereotools=mlev=0.05:slev=1.2,highpass=f=220,lowpass=f=4500', '-ac', '2', '-ar', '44100', outros]),
    ]);
    stems.vocals = voz;
    stems.bass = baixo;
    stems.drums = bateria;
    stems.other = outros;
  }
  return stems;
}

function iniciarJobSeparacao(midia, modo, motor) {
  const jobId = gerarId('spjob');
  const job = { id: jobId, status: 'rodando', etapa: 'Preparando separação...', progresso: 5, resultado: null, erro: null };
  jobs.set(jobId, job);

  (async () => {
    const outDir = path.join(pastaSplitterTrabalho(), jobId);
    fs.mkdirSync(outDir, { recursive: true });
    try {
      let stemsMap = null;
      let motorUsado = motor;
      let deviceUsado = 'cpu';

      if (motor === 'ia') {
        const py = acharPythonSplitter();
        const pySt = await checarStatusPython();
        if (!pySt.demucs) {
          throw new Error('Demucs (IA) ainda não está instalado. Clique em "Instalar IA (Auto GPU/CPU)" no topo ou use o modo Rápido (FFmpeg).');
        }
        const resIa = await new Promise((resolve, reject) => {
          const proc = spawn(py, [PY_ENGINE, 'separate', midia.arquivo, outDir, modo, acharFfmpeg()], { windowsHide: true });
          let errBuf = '';
          let resFinal = null;
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
                  resFinal = msg;
                }
              } catch (_) {}
            }
          });
          proc.stderr.on('data', d => { errBuf += d.toString('utf8'); });
          proc.on('error', reject);
          proc.on('close', code => {
            if (code === 0 && resFinal) resolve(resFinal);
            else reject(new Error(errBuf.trim() || `Demucs falhou (codigo ${code})`));
          });
        });
        stemsMap = resIa.stems;
        deviceUsado = resIa.device || 'cpu';
      } else {
        job.etapa = 'Separando faixas com FFmpeg (modo rápido)...';
        job.progresso = 40;
        stemsMap = await separarRapidoFFmpeg(midia.arquivo, outDir, modo);
        motorUsado = 'ffmpeg';
      }

      job.etapa = 'Gerando formas de onda...';
      job.progresso = 96;

      const labels = {
        no_vocals: 'Música (Instrumental)', vocals: 'Voz', drums: 'Bateria',
        bass: 'Baixo', other: 'Outros', guitar: 'Guitarra', piano: 'Piano',
      };
      const cores = {
        no_vocals: '#22c55e', vocals: '#8b5cf6', drums: '#f59e0b',
        bass: '#06b6d4', other: '#ec4899', guitar: '#ef4444', piano: '#3b82f6',
      };
      const ordem = ['no_vocals', 'vocals', 'drums', 'bass', 'guitar', 'piano', 'other'];
      const chaves = Object.keys(stemsMap).sort((a, b) => {
        const ia = ordem.indexOf(a); const ib = ordem.indexOf(b);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      });

      const faixas = [];
      for (const chave of chaves) {
        const rotulo = labels[chave] || chave;
        faixas.push(await registrarMidia(stemsMap[chave], `${midia.nome} - ${rotulo}`, 'stem', {
          stemKey: chave, rotulo, cor: cores[chave] || '#8b5cf6',
        }));
      }

      job.status = 'concluido';
      job.progresso = 100;
      job.etapa = 'Concluído!';
      job.resultado = { motor: motorUsado, device: deviceUsado, modo, faixas };
    } catch (e) {
      job.status = 'erro';
      job.erro = e.message;
      job.etapa = 'Erro na separação';
    }
  })();

  return job;
}

function iniciarJobInstalarIa() {
  const jobId = gerarId('ia');
  const job = { id: jobId, status: 'rodando', etapa: 'Detectando série da GPU e requirements ideais...', progresso: 5, resultado: null, erro: null };
  jobs.set(jobId, job);

  (async () => {
    try {
      const py = acharPythonSplitter();
      const resIa = await new Promise((resolve, reject) => {
        const proc = spawn(py, [PY_ENGINE, 'install-ia'], { windowsHide: true });
        let errBuf = '';
        let resFinal = null;
        proc.stdout.on('data', chunk => {
          for (const linha of chunk.toString('utf8').split(/\r?\n/)) {
            if (!linha.trim()) continue;
            try {
              const msg = JSON.parse(linha);
              if (msg.evento === 'progresso') {
                job.etapa = msg.etapa;
                if (typeof msg.progresso === 'number') job.progresso = msg.progresso;
              } else if (msg.evento === 'concluido') {
                resFinal = msg;
              }
            } catch (_) {}
          }
        });
        proc.stderr.on('data', d => { errBuf += d.toString('utf8'); });
        proc.on('error', reject);
        proc.on('close', code => {
          if (code === 0 && resFinal) resolve(resFinal);
          else reject(new Error(errBuf.trim() || `Instalador IA falhou (codigo ${code})`));
        });
      });
      job.status = 'concluido';
      job.progresso = 100;
      job.etapa = resIa.cuda ? `IA instalada com CUDA (${resIa.gpu})!` : 'IA instalada em modo CPU (fallback seguro)!';
      job.resultado = resIa;
    } catch (e) {
      job.status = 'erro';
      job.erro = e.message;
      job.etapa = 'Erro ao instalar IA';
    }
  })();

  return job;
}

function lerJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', c => {
      raw += c.toString('utf8');
      if (raw.length > 10 * 1024 * 1024) reject(new Error('Payload muito grande'));
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch (_) { reject(new Error('JSON invalido')); }
    });
    req.on('error', reject);
  });
}

function lerRawBody(req, destinoPath) {
  return new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(destinoPath);
    let bytes = 0;
    req.on('data', c => {
      bytes += c.length;
      if (bytes > 500 * 1024 * 1024) { ws.destroy(); reject(new Error('Arquivo excede 500 MB')); }
    });
    req.pipe(ws);
    ws.on('finish', () => resolve(bytes));
    ws.on('error', reject);
    req.on('error', reject);
  });
}

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

/**
 * Manipula todas as rotas /api/splitter/* dentro do servidor principal do Mega Cortes HD.
 * Retorna true se tratou a requisicao, false caso contrario.
 */
async function tratarRota(req, res, rota, urlObj) {
  if (!rota.startsWith('/api/splitter/')) return false;
  const sub = rota.slice('/api/splitter'.length);

  try {
    if (req.method === 'GET' && sub === '/status') {
      const py = await checarStatusPython();
      return json(res, 200, {
        ok: true,
        pastaBaixados: pastas.baixados(),
        ffmpeg: true,
        ytdlp: true,
        python: py,
      }), true;
    }

    if (req.method === 'POST' && sub === '/instalar-ia') {
      const job = iniciarJobInstalarIa();
      return json(res, 200, { jobId: job.id, status: job.status }), true;
    }

    if (req.method === 'GET' && sub === '/biblioteca') {
      return json(res, 200, {
        pasta: pastas.baixados(),
        itens: listarBibliotecaBaixados(),
      }), true;
    }

    if (req.method === 'POST' && sub === '/carregar-existente') {
      const { arquivo } = await lerJsonBody(req);
      const base = path.basename(String(arquivo || ''));
      const full = path.join(pastas.baixados(), base);
      if (!base || !fs.existsSync(full)) return json(res, 404, { erro: 'Arquivo não encontrado na pasta baixados.' }), true;
      const nomeLimpo = path.basename(base, path.extname(base)).replace(/\s*\[[\w-]{6,}\]\s*$/, '').replace(/_+/g, ' ').trim();
      const m = await carregarArquivoComCacheWav(full, nomeLimpo || base, 'baixados', { reaproveitado: true });
      return json(res, 200, m), true;
    }

    if (req.method === 'POST' && sub === '/upload') {
      const nomeHeader = decodeURIComponent(req.headers['x-file-name'] || 'audio.wav');
      const ext = path.extname(nomeHeader).toLowerCase() || '.bin';
      const idTemp = gerarId('up');
      const bruto = path.join(pastaSplitterTrabalho(), `${idTemp}_raw${ext}`);
      const wav = path.join(pastaSplitterTrabalho(), `${idTemp}.wav`);
      const bytes = await lerRawBody(req, bruto);
      if (bytes === 0) return json(res, 400, { erro: 'Arquivo vazio' }), true;
      await extrairAudioWav(bruto, wav);
      try { fs.unlinkSync(bruto); } catch (_) {}
      const m = await registrarMidia(wav, path.basename(nomeHeader, ext), 'upload');
      return json(res, 200, m), true;
    }

    if (req.method === 'POST' && sub === '/baixar-link') {
      const { url } = await lerJsonBody(req);
      const cleanUrl = String(url || '').trim();
      if (!baixador.pareceLink(cleanUrl)) return json(res, 400, { erro: 'Cole um link válido (http:// ou https://)' }), true;

      // 1. Verifica se ja existe na pasta pastas.baixados() do Mega Cortes (NAO baixa de novo!)
      let vidId = extrairIdYoutube(cleanUrl);
      let existente = procurarEmBaixados(cleanUrl, vidId);

      const ytdlpBin = await baixador.garantirYtDlp();
      if (!existente && !vidId) {
        try {
          const { stdout } = await rodarComando(ytdlpBin, ['--no-playlist', '--print', '%(id)s', '--no-warnings', cleanUrl]);
          vidId = stdout.trim().split(/\r?\n/)[0] || null;
          if (vidId) existente = procurarEmBaixados(cleanUrl, vidId);
        } catch (_) {}
      }

      if (existente) {
        const nomeLimpo = path.basename(existente, path.extname(existente)).replace(/\s*\[[\w-]{6,}\]\s*$/, '').replace(/_+/g, ' ').trim();
        const m = await carregarArquivoComCacheWav(existente, nomeLimpo, 'baixados', { linkOriginal: cleanUrl, reaproveitado: true });
        return json(res, 200, m), true;
      }

      // 2. Nao existe ainda: baixa direto para pastas.baixados() no mesmo padrao do Mega Cortes
      fs.mkdirSync(pastas.baixados(), { recursive: true });
      const modelo = path.join(pastas.baixados(), '%(title).60B [%(id)s].%(ext)s');
      const ffDir = path.dirname(acharFfmpeg());
      const args = [
        '--no-playlist', '--no-warnings',
        '-f', 'bestaudio/best',
        '-x', '--audio-format', 'm4a',
        '-o', modelo,
        '--print', 'after_move:filepath',
      ];
      if (ffDir && fs.existsSync(ffDir)) args.push('--ffmpeg-location', ffDir);
      args.push(cleanUrl);

      const { stdout } = await rodarComando(ytdlpBin, args);
      let arqBaixado = stdout.trim().split(/\r?\n/).pop();
      if (!arqBaixado || !fs.existsSync(arqBaixado)) {
        arqBaixado = procurarEmBaixados(cleanUrl, vidId);
      }
      if (!arqBaixado || !fs.existsSync(arqBaixado)) {
        throw new Error('Não foi possível localizar o arquivo baixado.');
      }

      const cache = lerCacheLinks();
      cache[cleanUrl] = arqBaixado;
      gravarCacheLinks(cache);

      const nomeLimpo = path.basename(arqBaixado, path.extname(arqBaixado)).replace(/\s*\[[\w-]{6,}\]\s*$/, '').replace(/_+/g, ' ').trim();
      const m = await carregarArquivoComCacheWav(arqBaixado, nomeLimpo, 'link', { linkOriginal: cleanUrl, reaproveitado: false });
      return json(res, 200, m), true;
    }

    if (req.method === 'GET' && sub.startsWith('/audio/')) {
      const id = sub.slice('/audio/'.length);
      const m = midias.get(id);
      if (!m || !fs.existsSync(m.arquivo)) return json(res, 404, { erro: 'Mídia não encontrada' }), true;
      const stat = fs.statSync(m.arquivo);
      const ext = path.extname(m.arquivo).toLowerCase();
      const mime = ext === '.mp3' ? 'audio/mpeg' : ext === '.ogg' ? 'audio/ogg' : 'audio/wav';
      const range = req.headers.range;
      if (range) {
        const [s, e] = range.replace(/bytes=/, '').split('-');
        const start = s ? parseInt(s, 10) : 0;
        const end = e ? Math.min(parseInt(e, 10), stat.size - 1) : stat.size - 1;
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= stat.size || end < start) {
          res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
          res.end();
          return true;
        }
        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Content-Type': mime });
        fs.createReadStream(m.arquivo, { start, end }).pipe(res);
      } else {
        res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': mime, 'Accept-Ranges': 'bytes' });
        fs.createReadStream(m.arquivo).pipe(res);
      }
      return true;
    }

    if (req.method === 'GET' && sub.startsWith('/download/')) {
      const id = sub.slice('/download/'.length);
      const formato = (urlObj.searchParams.get('formato') || 'mp3').toLowerCase() === 'wav' ? 'wav' : 'mp3';
      const m = midias.get(id);
      if (!m || !fs.existsSync(m.arquivo)) return json(res, 404, { erro: 'Mídia não encontrada' }), true;

      let arqSaida = m.arquivo;
      let apagar = false;
      if (formato === 'mp3' && !m.arquivo.endsWith('.mp3')) {
        arqSaida = path.join(pastaSplitterTrabalho(), `${id}_export.mp3`);
        await rodarComando(acharFfmpeg(), ['-y', '-v', 'error', '-i', m.arquivo, '-c:a', 'libmp3lame', '-b:a', '256k', arqSaida]);
        apagar = true;
      }
      const stat = fs.statSync(arqSaida);
      const nomeDownload = `${limparNome(m.nome)}.${formato}`;
      const nomeAscii = nomeDownload.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
      res.writeHead(200, {
        'Content-Type': formato === 'mp3' ? 'audio/mpeg' : 'audio/wav',
        'Content-Length': stat.size,
        'Content-Disposition': `attachment; filename="${nomeAscii}"; filename*=UTF-8''${encodeURIComponent(nomeDownload)}`,
      });
      const rs = fs.createReadStream(arqSaida);
      rs.pipe(res);
      rs.on('close', () => { if (apagar) { try { fs.unlinkSync(arqSaida); } catch (_) {} } });
      return true;
    }

    if (req.method === 'POST' && (sub === '/remover-voz' || sub === '/separar')) {
      const body = await lerJsonBody(req);
      const midia = midias.get(body.mediaId);
      if (!midia) return json(res, 404, { erro: 'Áudio não encontrado' }), true;
      const modo = sub === '/remover-voz' ? 'vocal' : (body.modo === 'stems6' ? 'stems6' : 'stems4');
      const motor = body.motor === 'ffmpeg' ? 'ffmpeg' : 'ia';
      const job = iniciarJobSeparacao(midia, modo, motor);
      return json(res, 200, { jobId: job.id, status: job.status }), true;
    }

    if (req.method === 'GET' && sub.startsWith('/job/')) {
      const job = jobs.get(sub.slice('/job/'.length));
      if (!job) return json(res, 404, { erro: 'Job não encontrado' }), true;
      return json(res, 200, job), true;
    }

    if (req.method === 'POST' && sub === '/mudar-tom') {
      const { mediaId, semitons = 0, velocidade = 1.0 } = await lerJsonBody(req);
      const midia = midias.get(mediaId);
      if (!midia) return json(res, 404, { erro: 'Áudio não encontrado' }), true;
      const st = Math.max(-12, Math.min(12, Number(semitons) || 0));
      const vel = Math.max(0.5, Math.min(2.0, Number(velocidade) || 1.0));
      const outPath = path.join(pastaSplitterTrabalho(), `${gerarId('pitch')}.wav`);
      await rodarComando(acharFfmpeg(), [
        '-y', '-v', 'error', '-i', midia.arquivo,
        '-af', `rubberband=pitch=${Math.pow(2, st / 12).toFixed(6)}:tempo=${vel.toFixed(4)}`,
        '-ac', '2', '-ar', '44100', outPath,
      ]);
      const sinal = st >= 0 ? `+${st}` : `${st}`;
      return json(res, 200, await registrarMidia(outPath, `${midia.nome} (${sinal}st ${Math.round(vel * 100)}%)`, 'pitch')), true;
    }

    if (req.method === 'POST' && sub === '/tom-bpm') {
      const { mediaId } = await lerJsonBody(req);
      const midia = midias.get(mediaId);
      if (!midia) return json(res, 404, { erro: 'Áudio não encontrado' }), true;
      const { stdout } = await rodarComando(acharPythonSplitter(), [PY_ENGINE, 'analyze', midia.arquivo, acharFfmpeg()]);
      return json(res, 200, { ...JSON.parse(stdout), duracao: midia.duracao, sampleRate: midia.sampleRate, canais: midia.canais }), true;
    }

    if (req.method === 'POST' && sub === '/cortar') {
      const { mediaId, inicio = 0, fim = 0, fadeIn = 0, fadeOut = 0, inverter = false } = await lerJsonBody(req);
      const midia = midias.get(mediaId);
      if (!midia) return json(res, 404, { erro: 'Áudio não encontrado' }), true;
      const t0 = Math.max(0, Number(inicio) || 0);
      const t1 = Math.min(midia.duracao || 99999, Math.max(t0 + 0.1, Number(fim) || midia.duracao));
      const fIn = Math.max(0, Number(fadeIn) || 0);
      const fOut = Math.max(0, Number(fadeOut) || 0);
      const outPath = path.join(pastaSplitterTrabalho(), `${gerarId('cut')}.wav`);
      if (!inverter) {
        const dur = Math.max(0.1, t1 - t0);
        const filtros = [];
        if (fIn > 0) filtros.push(`afade=t=in:st=0:d=${Math.min(fIn, dur / 2).toFixed(2)}`);
        if (fOut > 0) filtros.push(`afade=t=out:st=${Math.max(0, dur - Math.min(fOut, dur / 2)).toFixed(2)}:d=${Math.min(fOut, dur / 2).toFixed(2)}`);
        const args = ['-y', '-v', 'error', '-ss', t0.toFixed(3), '-to', t1.toFixed(3), '-i', midia.arquivo];
        if (filtros.length) args.push('-af', filtros.join(','));
        args.push('-ac', '2', '-ar', '44100', outPath);
        await rodarComando(acharFfmpeg(), args);
      } else {
        const fc = `[0:a]atrim=0:${t0.toFixed(3)},asetpts=PTS-STARTPTS[a1];[0:a]atrim=${t1.toFixed(3)},asetpts=PTS-STARTPTS[a2];[a1][a2]concat=n=2:v=0:a=1[out]`;
        await rodarComando(acharFfmpeg(), ['-y', '-v', 'error', '-i', midia.arquivo, '-filter_complex', fc, '-map', '[out]', '-ac', '2', '-ar', '44100', outPath]);
      }
      return json(res, 200, await registrarMidia(outPath, `${midia.nome} (corte)`, 'corte')), true;
    }

    if (req.method === 'POST' && sub === '/juntar') {
      const { mediaIds = [], crossfade = 0 } = await lerJsonBody(req);
      const lista = mediaIds.map(id => midias.get(id)).filter(Boolean);
      if (lista.length < 2) return json(res, 400, { erro: 'Adicione pelo menos 2 áudios para juntar.' }), true;
      const cf = Math.max(0, Math.min(5, Number(crossfade) || 0));
      const outPath = path.join(pastaSplitterTrabalho(), `${gerarId('join')}.wav`);
      const args = ['-y', '-v', 'error'];
      for (const m of lista) args.push('-i', m.arquivo);
      const filtros = lista.map((_, i) => `[${i}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[a${i}]`);
      if (cf <= 0) {
        filtros.push(`${lista.map((_, i) => `[a${i}]`).join('')}concat=n=${lista.length}:v=0:a=1[out]`);
      } else {
        let prev = '[a0]';
        for (let i = 1; i < lista.length; i++) {
          const dest = i === lista.length - 1 ? '[out]' : `[m${i}]`;
          filtros.push(`${prev}[a${i}]acrossfade=d=${cf.toFixed(2)}:c1=tri:c2=tri${dest}`);
          prev = dest;
        }
      }
      args.push('-filter_complex', filtros.join(';'), '-map', '[out]', '-ac', '2', '-ar', '44100', outPath);
      await rodarComando(acharFfmpeg(), args);
      return json(res, 200, await registrarMidia(outPath, `Mix_${lista.length}_faixas`, 'juntar')), true;
    }

    if (req.method === 'POST' && sub === '/mixar') {
      const { faixas = [], ecoVoz = false, nome = 'Mix_Final' } = await lerJsonBody(req);
      const validas = faixas
        .map(f => ({ midia: midias.get(f.mediaId), volume: Number(f.volume ?? 1), atrasoMs: Number(f.atrasoMs ?? 0), eco: Boolean(f.eco) }))
        .filter(f => f.midia && f.volume > 0.001);
      if (!validas.length) return json(res, 400, { erro: 'Nenhuma faixa com volume > 0.' }), true;
      const outPath = path.join(pastaSplitterTrabalho(), `${gerarId('mix')}.wav`);
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
      filtros.push(labels.length === 1 ? `${labels[0]}anull[out]` : `${labels.join('')}amix=inputs=${labels.length}:duration=longest:normalize=0,alimiter=limit=0.95[out]`);
      args.push('-filter_complex', filtros.join(';'), '-map', '[out]', '-ac', '2', '-ar', '44100', outPath);
      await rodarComando(acharFfmpeg(), args);
      return json(res, 200, await registrarMidia(outPath, nome, 'mix')), true;
    }

    return json(res, 404, { erro: 'Rota do Splitter Studio não encontrada.' }), true;
  } catch (e) {
    console.error('[Splitter Studio]', sub, e.message);
    return json(res, 500, { erro: e.message || 'Erro interno no Splitter Studio' }), true;
  }
}

module.exports = { tratarRota, listarBibliotecaBaixados, checarStatusPython, acharPythonSplitter };
