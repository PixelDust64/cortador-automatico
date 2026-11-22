'use strict';
/**
 * Testes unitarios e de integracao EXCLUSIVOS da branch Mega Cortes HD.
 *
 * Objetivo: validar os diferenciais desta versao independente:
 *   1. GPU adaptativa (CUDA + NVENC/AMF/QSV em paralelo, FFmpeg 8.0.1, status em 1 linha)
 *   2. Croma Studio integrado (/croma/, lazy-load iframe, protecao contra path traversal)
 *   3. Identidade propria Mega Cortes HD e creditos MIT ao projeto original (MARCA.md)
 *
 * Como rodar (Node 22+, sem dependencias externas):
 *     node --test docs/testes-mega-cortes.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const RAIZ = path.resolve(__dirname, '..');
const MONTAGEM = path.join(RAIZ, 'instalador', 'montagem');
const EMBED_PY = path.join(MONTAGEM, 'runtime', 'python', 'python.exe');
const EMBED_FFMPEG = path.join(MONTAGEM, 'runtime', 'ffmpeg', 'ffmpeg.exe');
const EMBED_FFPROBE = path.join(MONTAGEM, 'runtime', 'ffmpeg', 'ffprobe.exe');

const desempenho = require(path.join(RAIZ, 'src', 'desempenho'));

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

// ------------------------------------------------------------------ 1. GPU adaptativa (CUDA + NVENC/AMF/QSV)

test('mega/gpu: resumo().placa expoe campos estendidos de CUDA, sigla e nome da GPU', () => {
  const { placa } = desempenho.resumo();
  assert.ok('sigla' in placa, 'deve expor sigla do encoder (NVENC/AMF/QSV)');
  assert.ok('gpu' in placa, 'deve expor nome da GPU detectada');
  assert.ok('cuda' in placa, 'deve expor status CUDA');
  assert.ok('computeType' in placa, 'deve expor computeType escolhido');
});

test('mega/gpu: detectarPlaca(null) e detectarCuda(null) finalizam sem travar em testando', async () => {
  const enc = await desempenho.detectarPlaca(null);
  const cuda = await desempenho.detectarCuda(null);
  assert.ok(enc === null || typeof enc === 'object');
  assert.ok(cuda === null || typeof cuda === 'object');
  const { placa } = desempenho.resumo();
  assert.notEqual(placa.achada, 'testando');
  assert.notEqual(placa.cuda, 'testando');
});

test('mega/gpu: transcrever.py --testar-cuda devolve JSON valido com compute_type compativel', (t) => {
  const py = process.env.PYTHON_BIN || (fs.existsSync(EMBED_PY) ? EMBED_PY : null);
  if (!py) return t.skip('Python embutido nao encontrado localmente');
  const r = spawnSync(py, [path.join(RAIZ, 'py', 'transcrever.py'), '--testar-cuda'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 20000,
    env: Object.assign({}, process.env, { PYTHONNOUSERSITE: '1' }),
  });
  assert.equal(r.status, 0, r.stderr);
  const linha = r.stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith('{')).pop();
  assert.ok(linha, 'deve imprimir linha JSON');
  const dados = JSON.parse(linha);
  assert.equal(typeof dados.cuda, 'boolean');
  if (dados.cuda) {
    assert.ok(dados.dispositivos >= 1);
    assert.ok(['float16', 'int8_float16', 'int8_float32', 'int8', 'float32'].includes(dados.compute_type));
  }
});

test('mega/gpu: instalador/montar.js fixa FFmpeg 8.0.1 (compatibilidade NVENC drivers < 610)', () => {
  const montar = fs.readFileSync(path.join(RAIZ, 'instalador', 'montar.js'), 'utf8');
  assert.match(montar, /FFMPEG_VERSAO\s*=\s*'8\.0\.1'/);
});

// ------------------------------------------------------------------ 2. Croma Studio integrado

test('mega/croma: bundle estatico presente em src/ui/croma com caminhos relativos', () => {
  const idx = path.join(RAIZ, 'src', 'ui', 'croma', 'index.html');
  assert.ok(fs.existsSync(idx), 'src/ui/croma/index.html deve existir');
  const html = fs.readFileSync(idx, 'utf8');
  assert.match(html, /Croma Studio/i);
  assert.match(html, /src="\.\/assets\/[^"]+\.js"/);
});

test('mega/croma: rotas /croma, /croma/, bundle JS e protecao contra path traversal', async () => {
  const porta = 4430 + Math.floor(Math.random() * 40);
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
    assert.match(home.body, /id="btnCroma"/);
    assert.match(home.body, /id="telaCroma"/);

    const redir = await httpGet(porta, '/croma');
    assert.equal(redir.status, 302);
    assert.equal(redir.headers.location, '/croma/');

    const croma = await httpGet(porta, '/croma/');
    assert.equal(croma.status, 200);
    assert.match(croma.body, /Croma Studio/i);

    const m = /src="\.\/(assets\/[^"]+\.js)"/.exec(croma.body);
    assert.ok(m, 'deve referenciar bundle JS do Croma Studio');
    const asset = await httpGet(porta, '/croma/' + m[1]);
    assert.equal(asset.status, 200);
    assert.ok(asset.body.length > 10000);

    const traversal = await httpGet(porta, '/croma/../../../package.json');
    assert.doesNotMatch(traversal.body, /"name"\s*:\s*"cortador-automatico"/);
  } finally {
    try { srv.kill(); } catch (_) {}
  }
});

// ------------------------------------------------------------------ 3. Identidade Mega Cortes HD & MARCA.md

test('mega/identidade: nome proprio Mega Cortes HD, nova banner e creditos ao criador original', () => {
  const readme = fs.readFileSync(path.join(RAIZ, 'README.md'), 'utf8');
  assert.match(readme, /# Mega Cortes HD/);
  assert.match(readme, /Gabriel Workspace/);
  assert.match(readme, /Croma Studio/);
  assert.ok(fs.existsSync(path.join(RAIZ, 'docs', 'mega-cortes-hd-banner.jpg')), 'banner propria deve existir');

  const iss = fs.readFileSync(path.join(RAIZ, 'instalador', 'cortador.iss'), 'utf8');
  assert.match(iss, /#define Nome "Mega Cortes HD"/);
  assert.match(iss, /OutputBaseFilename=Instalar-Mega-Cortes-HD/);

  const ui = fs.readFileSync(path.join(RAIZ, 'src', 'ui', 'index.html'), 'utf8');
  assert.match(ui, /<title>Mega Cortes HD<\/title>/);
});
