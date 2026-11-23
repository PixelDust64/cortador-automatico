'use strict';
/**
 * Testes unitarios e de integracao das funcionalidades BASE (compatibilidade com
 * o projeto original Cortador Automatico).
 *
 * Objetivo: garantir que nenhuma modificacao da branch quebrou as funcoes
 * essenciais da aplicacao original (desempenho, filtros FFmpeg, legenda,
 * pipeline, sessoes, scripts Python e rotas principais do servidor HTTP).
 *
 * Como rodar (Node 22+, sem dependencias externas):
 *     node --test docs/testes-base-original.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const RAIZ = path.resolve(__dirname, '..');
const MONTAGEM = path.join(RAIZ, 'instalador', 'montagem');
const EMBED_PY = path.join(MONTAGEM, 'runtime', 'python', 'python.exe');
const EMBED_FFMPEG = path.join(MONTAGEM, 'runtime', 'ffmpeg', 'ffmpeg.exe');
const EMBED_FFPROBE = path.join(MONTAGEM, 'runtime', 'ffmpeg', 'ffprobe.exe');

const desempenho = require(path.join(RAIZ, 'src', 'desempenho'));
const media = require(path.join(RAIZ, 'src', 'media'));
const pipeline = require(path.join(RAIZ, 'src', 'pipeline'));
const legenda = require(path.join(RAIZ, 'src', 'legenda'));
const sessoes = require(path.join(RAIZ, 'src', 'sessoes'));
const score = require(path.join(RAIZ, 'src', 'score'));
const copy = require(path.join(RAIZ, 'src', 'copy'));

function httpGet(porta, caminho) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port: porta, path: caminho }, (res) => {
      const pedacos = [];
      res.on('data', (d) => pedacos.push(d));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(pedacos).toString('utf8'),
      }));
    });
    req.on('error', reject);
  });
}

// ------------------------------------------------------------------ 1. Desempenho base

test('base/desempenho: pc(), recomendado() e nucleos() funcionam corretamente', () => {
  const info = desempenho.pc();
  assert.ok(info.nucleos >= 1, 'nucleos deve ser >= 1');
  assert.ok(info.ramGb > 0, 'ramGb deve ser > 0');
  assert.equal(typeof info.processador, 'string');

  const rec = desempenho.recomendado();
  assert.ok(rec === 'leve' || rec === 'total');

  const n = desempenho.nucleos();
  assert.ok(n >= 1 && n <= info.nucleos);
});

test('base/desempenho: adaptarFfmpeg() preserva argumentos essenciais de libx264', () => {
  const base = ['-i', 'in.mp4', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', 'out.mp4'];
  const res = desempenho.adaptarFfmpeg(base);
  assert.ok(Array.isArray(res.args));
  assert.equal(typeof res.placa, 'boolean');
  assert.ok(res.args.includes('-c:v'));
  assert.ok(res.args.includes('out.mp4'));
});

// ------------------------------------------------------------------ 2. Media & FFmpeg

test('base/media: filtroDeFormato cobre todos os formatos de corte (original, vertical, blur, foco, split)', () => {
  assert.equal(media.filtroDeFormato('original'), null);

  const vert = media.filtroDeFormato('vertical');
  assert.match(vert, /scale=1080:1920/);
  assert.match(vert, /crop=1080:1920/);

  const blur = media.filtroDeFormato('blur');
  assert.match(blur, /gblur=sigma=28/);
  assert.match(blur, /overlay=/);

  const foco = media.filtroDeFormato('foco', { baixo: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } });
  assert.match(foco, /crop=iw\*0\.80000:ih\*0\.80000/);
  assert.match(foco, /scale=1080:1920/);

  const split = media.filtroDeFormato('split', {
    topo: { x: 0, y: 0, w: 0.25, h: 0.3 },
    baixo: { x: 0, y: 0, w: 1, h: 1 },
    proporcaoTopo: 0.3,
    linha: { espessura: 6, cor: '#ff00aa' },
  });
  assert.match(split, /vstack=inputs=2/);
  assert.match(split, /drawbox=.*color=0xff00aa/);
});

test('base/ffmpeg: binario ffmpeg responde -version com codigo 0', (t) => {
  const ff = process.env.FFMPEG_PATH || (fs.existsSync(EMBED_FFMPEG) ? EMBED_FFMPEG : null);
  if (!ff) return t.skip('FFmpeg nao encontrado localmente');
  const r = spawnSync(ff, ['-version'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /ffmpeg version/i);
});

test('base/corte-e-sincronia: cortarClipe() gera corte vertical 9:16 sem deslocamento de audio (normal e com chamariz)', async (t) => {
  const ff = process.env.FFMPEG_PATH || (fs.existsSync(EMBED_FFMPEG) ? EMBED_FFMPEG : null);
  const fp = process.env.FFPROBE_PATH || (fs.existsSync(EMBED_FFPROBE) ? EMBED_FFPROBE : null);
  if (!ff || !fp) return t.skip('FFmpeg/ffprobe nao encontrado localmente');

  process.env.FFMPEG_PATH = ff;
  process.env.FFPROBE_PATH = fp;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teste-corte-sync-'));
  const origem = path.join(tmpDir, 'origem.mp4');
  const clipeNormal = path.join(tmpDir, 'clipe-normal.mp4');
  const clipeTeaser = path.join(tmpDir, 'clipe-teaser.mp4');

  function medirSincronia(arquivo) {
    const r = spawnSync(fp, [
      '-v', 'quiet', '-print_format', 'json',
      '-show_format', '-show_streams', arquivo,
    ], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    assert.equal(r.status, 0, 'ffprobe falhou em ' + arquivo);
    const info = JSON.parse(r.stdout);
    const v = (info.streams || []).find((s) => s.codec_type === 'video');
    const a = (info.streams || []).find((s) => s.codec_type === 'audio');
    assert.ok(v, 'stream de video ausente');
    assert.ok(a, 'stream de audio ausente');
    const startV = Number(v.start_time || 0);
    const startA = Number(a.start_time || 0);
    const durV = Number(v.duration || info.format.duration || 0);
    const durA = Number(a.duration || info.format.duration || 0);
    return {
      largura: v.width,
      altura: v.height,
      startV,
      startA,
      durV,
      durA,
      deslocamentoInicio: Math.abs(startV - startA),
      deslocamentoDuracao: Math.abs(durV - durA),
    };
  }

  try {
    // Gera video sintetico de 7s (1280x720 @ 30fps + audio 48kHz)
    const gen = spawnSync(ff, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=7',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=7',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k',
      origem,
    ], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
    assert.equal(gen.status, 0, gen.stderr);

    // 1. Corte normal (3s a partir de 2s)
    await media.cortarClipe({
      video: origem,
      inicio: 2,
      duracao: 3,
      destino: clipeNormal,
      formato: 'vertical',
      qualidade: 'rapida',
      temAudio: true,
      pastaTrabalho: tmpDir,
    });
    assert.ok(fs.existsSync(clipeNormal) && fs.statSync(clipeNormal).size > 10000);
    const s1 = medirSincronia(clipeNormal);
    assert.equal(s1.largura, 1080);
    assert.equal(s1.altura, 1920);
    assert.ok(Math.abs(s1.durV - 3) < 0.25, 'duracao video normal fora do esperado: ' + s1.durV);
    assert.ok(s1.deslocamentoInicio < 0.05, 'audio deslocado no inicio (normal): ' + s1.deslocamentoInicio + 's');
    assert.ok(s1.deslocamentoDuracao < 0.08, 'audio dessincronizado na duracao (normal): ' + s1.deslocamentoDuracao + 's');

    // 2. Corte com chamariz/teaser (3s + 1s de teaser = 4s)
    await media.cortarClipe({
      video: origem,
      inicio: 2,
      duracao: 3,
      destino: clipeTeaser,
      formato: 'vertical',
      qualidade: 'rapida',
      temAudio: true,
      teaser: { inicio: 3.5, duracao: 1 },
      pastaTrabalho: tmpDir,
    });
    assert.ok(fs.existsSync(clipeTeaser) && fs.statSync(clipeTeaser).size > 10000);
    const s2 = medirSincronia(clipeTeaser);
    assert.equal(s2.largura, 1080);
    assert.equal(s2.altura, 1920);
    assert.ok(Math.abs(s2.durV - 4) < 0.25, 'duracao video com chamariz fora do esperado: ' + s2.durV);
    assert.ok(s2.deslocamentoInicio < 0.05, 'audio deslocado no inicio (chamariz): ' + s2.deslocamentoInicio + 's');
    assert.ok(s2.deslocamentoDuracao < 0.08, 'audio dessincronizado na duracao (chamariz): ' + s2.deslocamentoDuracao + 's');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ 3. Legenda, Sessoes, Score e Copy

test('base/legenda: temTextoFixo() e gerarAss() funcionam corretamente', () => {
  assert.equal(legenda.temTextoFixo(null), false);
  assert.equal(legenda.temTextoFixo({ texto: '   ' }), false);
  assert.equal(legenda.temTextoFixo({ texto: 'AO VIVO' }), true);

  const tmpAss = path.join(os.tmpdir(), 'teste-base-legenda-' + Date.now() + '.ass');
  try {
    legenda.gerarAss([
      { inicio: 0.5, fim: 1.2, texto: 'Olha' },
      { inicio: 1.2, fim: 2.0, texto: 'isso' },
    ], 0, tmpAss, { textoFixo: { texto: 'TESTE', posicao: 'topo' } });
    assert.ok(fs.existsSync(tmpAss), 'arquivo .ass deve ser criado');
    const conteudo = fs.readFileSync(tmpAss, 'utf8');
    assert.match(conteudo, /\[Script Info\]/);
    assert.match(conteudo, /Dialogue:/);
  } finally {
    try { fs.unlinkSync(tmpAss); } catch (_) {}
  }
});

test('base/modulos: sessoes, score, copy e pipeline exportam API principal intacta', () => {
  assert.equal(typeof sessoes.paraJanela, 'function');
  const lista = sessoes.paraJanela();
  assert.ok(Array.isArray(lista) && lista.length > 0);
  assert.equal(typeof pipeline.acharPython, 'function');
  assert.equal(typeof pipeline.processar, 'function');
  assert.equal(typeof pipeline.refazerClipe, 'function');
  assert.equal(typeof score, 'object');
  assert.equal(typeof copy, 'object');
});

// ------------------------------------------------------------------ 4. Scripts Python base

test('base/python: transcrever.py e separar_voz.py compilam sem erro de sintaxe', (t) => {
  const py = process.env.PYTHON_BIN || (fs.existsSync(EMBED_PY) ? EMBED_PY : null);
  if (!py) return t.skip('Python embutido nao encontrado localmente');
  const r = spawnSync(py, [
    '-m', 'py_compile',
    path.join(RAIZ, 'py', 'transcrever.py'),
    path.join(RAIZ, 'py', 'separar_voz.py'),
  ], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  assert.equal(r.status, 0, r.stderr);
});

// ------------------------------------------------------------------ 5. Servidor HTTP (rotas originais)

test('base/servidor: rotas essenciais da aplicacao original respondem HTTP 200', async () => {
  const porta = 4380 + Math.floor(Math.random() * 40);
  const env = Object.assign({}, process.env, {
    NAO_ABRIR: '1',
    PORTA: String(porta),
    PYTHONNOUSERSITE: '1',
  });
  if (fs.existsSync(EMBED_PY)) env.PYTHON_BIN = EMBED_PY;
  if (fs.existsSync(EMBED_FFMPEG)) env.FFMPEG_PATH = EMBED_FFMPEG;
  if (fs.existsSync(EMBED_FFPROBE)) env.FFPROBE_PATH = EMBED_FFPROBE;

  const srv = spawn(process.execPath, [path.join(RAIZ, 'src', 'server.js')], {
    cwd: RAIZ,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout aguardando servidor subir')), 15000);
      srv.stdout.setEncoding('utf8');
      srv.stdout.on('data', (d) => {
        if (/rodando em http:\/\/127\.0\.0\.1:/.test(d)) { clearTimeout(timer); resolve(); }
      });
      srv.on('exit', (code) => { clearTimeout(timer); reject(new Error('servidor saiu cedo: ' + code)); });
    });

    const home = await httpGet(porta, '/');
    assert.equal(home.status, 200);
    assert.match(home.body, /id="placaVideo"/);
    assert.match(home.body, /id="btnProjetos"/);
    assert.match(home.body, /id="btnAjustes"/);

    for (const rota of ['/api/desempenho', '/api/sessoes', '/api/rede', '/api/armazenamento', '/api/projetos']) {
      const r = await httpGet(porta, rota);
      assert.equal(r.status, 200, 'rota ' + rota + ' deve responder 200');
      assert.doesNotThrow(() => JSON.parse(r.body), 'rota ' + rota + ' deve devolver JSON valido');
    }
  } finally {
    try { srv.kill(); } catch (_) {}
  }
});
