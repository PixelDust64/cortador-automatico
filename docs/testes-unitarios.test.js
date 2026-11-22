'use strict';
/**
 * Testes unitarios e de integracao das funcionalidades e ferramentas do Mega Cortes HD.
 *
 * Como rodar (Node 22+, sem precisar instalar nenhuma dependencia):
 *     node --test docs/testes-unitarios.test.js
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
const media = require(path.join(RAIZ, 'src', 'media'));
const pipeline = require(path.join(RAIZ, 'src', 'pipeline'));

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

// ------------------------------------------------------------------ 1. Desempenho & GPU

test('desempenho: informacoes do PC e modo recomendado', () => {
  const info = desempenho.pc();
  assert.ok(info.nucleos >= 1, 'nucleos deve ser >= 1');
  assert.ok(info.ramGb > 0, 'ramGb deve ser > 0');
  assert.equal(typeof info.processador, 'string');

  const rec = desempenho.recomendado();
  assert.ok(rec === 'leve' || rec === 'total');

  const n = desempenho.nucleos();
  assert.ok(n >= 1 && n <= info.nucleos);
});

test('desempenho: resumo() expoe estrutura completa de GPU (NVENC/AMF/QSV + CUDA)', () => {
  const r = desempenho.resumo();
  assert.ok(r.modo === 'leve' || r.modo === 'total');
  assert.ok(r.placa && typeof r.placa === 'object');
  assert.equal(typeof r.placa.ligada, 'boolean');
  assert.equal(typeof r.placa.quebrou, 'boolean');
  assert.ok('achada' in r.placa);
  assert.ok('sigla' in r.placa);
  assert.ok('gpu' in r.placa);
  assert.ok('cuda' in r.placa);
  assert.ok('computeType' in r.placa);
});

test('desempenho: adaptarFfmpeg() sempre retorna { args, placa } valido', () => {
  const base = ['-i', 'in.mp4', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', 'out.mp4'];
  const res = desempenho.adaptarFfmpeg(base);
  assert.ok(Array.isArray(res.args));
  assert.equal(typeof res.placa, 'boolean');
  assert.ok(res.args.includes('-c:v'));
});

test('desempenho: detectarPlaca(null) e detectarCuda(null) finalizam sem travar', async () => {
  const enc = await desempenho.detectarPlaca(null);
  const cuda = await desempenho.detectarCuda(null);
  assert.ok(enc === null || typeof enc === 'object');
  assert.ok(cuda === null || typeof cuda === 'object');
});

// ------------------------------------------------------------------ 2. Media / FFmpeg

test('media: filtroDeFormato gera filtros corretos para todos os formatos', () => {
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

test('ferramenta ffmpeg: binario responde -version com codigo 0', (t) => {
  const ff = process.env.FFMPEG_PATH || (fs.existsSync(EMBED_FFMPEG) ? EMBED_FFMPEG : null);
  if (!ff) return t.skip('FFmpeg nao encontrado localmente');
  const r = spawnSync(ff, ['-version'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /ffmpeg version/i);
});

// ------------------------------------------------------------------ 3. Pipeline & Python CUDA

test('pipeline: acharPython retorna caminho valido', () => {
  const py = pipeline.acharPython();
  assert.equal(typeof py, 'string');
  assert.ok(py.length > 0);
});

test('ferramentas Python: sintaxe de transcrever.py e separar_voz.py', (t) => {
  const py = process.env.PYTHON_BIN || (fs.existsSync(EMBED_PY) ? EMBED_PY : null);
  if (!py) return t.skip('Python embutido nao encontrado localmente');
  const r = spawnSync(py, [
    '-m', 'py_compile',
    path.join(RAIZ, 'py', 'transcrever.py'),
    path.join(RAIZ, 'py', 'separar_voz.py'),
  ], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  assert.equal(r.status, 0, r.stderr);
});

test('transcrever.py --testar-cuda devolve JSON valido com status CUDA', (t) => {
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
  assert.ok(linha, 'saida JSON esperada');
  const dados = JSON.parse(linha);
  assert.equal(typeof dados.cuda, 'boolean');
  if (dados.cuda) {
    assert.ok(dados.dispositivos >= 1);
    assert.ok(['float16', 'int8_float16', 'int8_float32', 'int8', 'float32'].includes(dados.compute_type));
  }
});

// ------------------------------------------------------------------ 4. Croma Studio & Servidor HTTP

test('Croma Studio: bundle estatico presente em src/ui/croma com caminhos relativos', () => {
  const idx = path.join(RAIZ, 'src', 'ui', 'croma', 'index.html');
  assert.ok(fs.existsSync(idx), 'src/ui/croma/index.html deve existir');
  const html = fs.readFileSync(idx, 'utf8');
  assert.match(html, /Croma Studio/i);
  assert.match(html, /src="\.\/assets\/[^"]+\.js"/);
});

test('servidor HTTP: rotas principais, /api/desempenho, /croma/ e protecao contra path traversal', async () => {
  const porta = 4390 + Math.floor(Math.random() * 50);
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
    // Aguarda o servidor anunciar que subiu
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
    assert.match(home.body, /id="btnCroma"/);

    const apiDsp = await httpGet(porta, '/api/desempenho');
    assert.equal(apiDsp.status, 200);
    const dsp = JSON.parse(apiDsp.body);
    assert.ok(dsp.placa && typeof dsp.placa === 'object');

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

    // Garante que path traversal nao vaza package.json
    const traversal = await httpGet(porta, '/croma/../../../package.json');
    assert.doesNotMatch(traversal.body, /"name"\s*:\s*"cortador-automatico"/);
  } finally {
    try { srv.kill(); } catch (_) {}
  }
});
