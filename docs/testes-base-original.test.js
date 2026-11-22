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
