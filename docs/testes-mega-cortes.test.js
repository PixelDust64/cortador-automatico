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
    assert.match(home.body, /id="filaDock"/);

    const fila = await httpGet(porta, '/api/fila');
    assert.equal(fila.status, 200);
    const filaDados = JSON.parse(fila.body);
    assert.equal(typeof filaDados.ativo, 'boolean');
    assert.ok(Array.isArray(filaDados.itens));

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
  assert.match(ui, /id="fonteLegenda"/);
  assert.match(ui, /id="fontePcSelect"/);
});

test('mega/fontes: seletor de fontes instaladas no PC disponivel via /api/fontes-sistema', () => {
  const srv = fs.readFileSync(path.join(RAIZ, 'src', 'server.js'), 'utf8');
  assert.match(srv, /\/api\/fontes-sistema/);
});

test('mega/vinhetas: inserirVinhetas() insere 2 vinhetas (apos 3s e no fim) mantendo sincronia A/V', async (t) => {
  const ff = process.env.FFMPEG_PATH || (fs.existsSync(EMBED_FFMPEG) ? EMBED_FFMPEG : null);
  const fp = process.env.FFPROBE_PATH || (fs.existsSync(EMBED_FFPROBE) ? EMBED_FFPROBE : null);
  if (!ff || !fp) return t.skip('FFmpeg/ffprobe nao encontrado localmente');

  process.env.FFMPEG_PATH = ff;
  process.env.FFPROBE_PATH = fp;
  const media = require(path.join(RAIZ, 'src', 'media'));
  const os = require('node:os');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teste-vinheta-'));
  const clipe = path.join(tmpDir, 'clipe.mp4');
  const thumb = path.join(tmpDir, 'thumb.png');

  try {
    // Clipe base de 5s (1080x1920 + audio 48kHz) + imagem PNG de vinheta
    let r = spawnSync(ff, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30:duration=5',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=5',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k', clipe,
    ], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
    assert.equal(r.status, 0, r.stderr);

    r = spawnSync(ff, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=purple:s=1080x1920:d=0.1',
      '-frames:v', '1', thumb,
    ], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    assert.equal(r.status, 0, r.stderr);

    await media.inserirVinhetas(clipe, [
      { imagem: thumb, onde: 3, duracao: 1.5, audio: null },
      { imagem: thumb, onde: 5, duracao: 1.0, audio: null },
    ], { pastaTrabalho: tmpDir, qualidade: 'rapida' });

    const p = spawnSync(fp, [
      '-v', 'quiet', '-print_format', 'json',
      '-show_format', '-show_streams', clipe,
    ], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    assert.equal(p.status, 0);
    const info = JSON.parse(p.stdout);
    const v = info.streams.find((s) => s.codec_type === 'video');
    const a = info.streams.find((s) => s.codec_type === 'audio');
    assert.ok(v && a);
    const durV = Number(v.duration || info.format.duration);
    const durA = Number(a.duration || info.format.duration);
    // 5s originais + 1.5s + 1.0s = 7.5s
    assert.ok(Math.abs(durV - 7.5) < 0.3, 'duracao esperada ~7.5s, obtido: ' + durV);
    assert.ok(Math.abs(durV - durA) < 0.08, 'dessincronia A/V apos vinhetas: ' + Math.abs(durV - durA));
    assert.ok(Math.abs(Number(v.start_time || 0) - Number(a.start_time || 0)) < 0.05);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('mega/beavernet: ordem de fallback (Qwen3.8 Flash >> Nemotron >> Gemma-4 4B >> Qwen 0.8B), chave opcional e sem auto-updater', async () => {
  const pro = require(path.join(RAIZ, 'src', 'pro'));
  assert.equal(pro.BEAVERNET_BASE_URL, 'https://net.beaverai.org/v1');
  assert.deepEqual(pro.BEAVERNET_MODELOS_PADRAO, [
    's567901/Qwen3.8-Flash-Next-Huihui-Refusal-Direction-r-v2',
    'serranoprime1/nvidia/nemotron-3.5-super-vl:free',
    'Meus Artis/Gemma-4-E4B-it-Ultra-Uncensored-Heretic',
    'pixel.dust/Qwen3.5-0.8B-Space-Programming',
  ]);
  assert.ok(pro.PROVEDORES.includes('beavernet'));
  assert.ok(pro.PROVEDORES.includes('gemini'));
  assert.ok(pro.PROVEDORES.includes('openai'));
  assert.ok(pro.PROVEDORES.includes('anthropic'));

  // Nao deve existir auto-updater do upstream no Mega Cortes HD
  assert.equal(fs.existsSync(path.join(RAIZ, 'src', 'atualizar.js')), false, 'auto-updater nao deve estar presente');

  // Estado padrao ou BeaverNet sem chave deve estar pronto sem exigir API key
  const st = await pro.obterEstado();
  assert.equal(typeof st.provedor, 'string');
  assert.ok(Array.isArray(st.beavernetModelos) && st.beavernetModelos.length === 4);

  // Parser JSON resiliente (texto extra com chaves apos JSON, <think>, virgula sobrando e JSON truncado)
  const r1 = pro.extrairJson('<think>analisando {foo}</think>\n{"cortes":[{"inicio":10,"fim":40,"titulo":"Teste",}]}\nNota final: {ok}');
  assert.equal(r1.cortes.length, 1);
  assert.equal(r1.cortes[0].inicio, 10);

  const r2 = pro.extrairJson('{"cortes":[{"inicio":5,"fim":35,"titulo":"Primeiro"},{"inicio":60,"fim":95,"titulo":"Segundo"},{"inicio":120,"fim":150,"titul');
  assert.equal(r2.cortes.length, 2);
  assert.equal(r2.cortes[1].titulo, 'Segundo');

  // Garante que pipeline.js passa USAR_GPU a partir de desempenho.usarCudaNaTranscricao()
  const pipeSrc = fs.readFileSync(path.join(RAIZ, 'src', 'pipeline.js'), 'utf8');
  assert.match(pipeSrc, /desempenho\.usarCudaNaTranscricao\(\)/);
  assert.match(pipeSrc, /USAR_GPU:\s*usarGpu/);
});

test('mega/splitter-e-ia: rotas /splitter/, /api/splitter/status, /api/ia/config e /api/fontes-sistema respondem HTTP 200', async () => {
  const porta = 4470 + Math.floor(Math.random() * 40);
  const env = Object.assign({}, process.env, { NAO_ABRIR: '1', PORTA: String(porta), PYTHONNOUSERSITE: '1' });
  if (fs.existsSync(EMBED_PY)) env.PYTHON_BIN = EMBED_PY;

  const srv = spawn(process.execPath, [path.join(RAIZ, 'src', 'server.js')], { env, stdio: 'pipe', windowsHide: true });
  try {
    for (let i = 0; i < 40; i++) {
      try { const r = await fetch(`http://127.0.0.1:${porta}/api/rede`); if (r.ok) break; } catch (_) {}
      await new Promise((r) => setTimeout(r, 150));
    }
    for (const rota of ['/splitter/', '/api/splitter/status', '/api/splitter/biblioteca', '/api/ia/config', '/api/fontes-sistema']) {
      const r = await fetch(`http://127.0.0.1:${porta}${rota}`);
      assert.equal(r.status, 200, `rota ${rota} deve responder 200`);
    }
    const ia = await fetch(`http://127.0.0.1:${porta}/api/ia/config`).then((r) => r.json());
    assert.ok(Array.isArray(ia.beavernetModelos) && ia.beavernetModelos.length === 4);
    const fontes = await fetch(`http://127.0.0.1:${porta}/api/fontes-sistema`).then((r) => r.json());
    assert.ok(Array.isArray(fontes.fontes) && fontes.fontes.length > 0);
  } finally {
    try { srv.kill(); } catch (_) {}
  }
});

test('mega/legenda: zero sobreposicao em palavras ultra-curtas e posicao fixa travada', () => {
  const os = require('node:os');
  const legenda = require(path.join(RAIZ, 'src', 'legenda'));
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teste-legenda-'));
  const assPath = path.join(tmpDir, 'teste.ass');
  try {
    // Palavras ultra-curtas ("em" com apenas 50ms) que antes causavam empilhamento duplo
    const palavras = [
      { inicio: 23.80, fim: 24.08, texto: 'tinha' },
      { inicio: 24.08, fim: 24.13, texto: 'em' },
      { inicio: 24.13, fim: 24.50, texto: 'mente' },
      { inicio: 24.51, fim: 24.55, texto: 'que' },
      { inicio: 24.55, fim: 24.90, texto: 'talvez' },
    ];
    legenda.gerarAss(palavras, 0, assPath, { margemBaixo: 300 });
    const conteudo = fs.readFileSync(assPath, 'utf8');
    const dialogos = conteudo.split(/\r?\n/).filter((l) => l.startsWith('Dialogue: 0,'));
    assert.ok(dialogos.length >= 4, 'deve gerar eventos de legenda');

    const paraCs = (t) => {
      const m = /^(\d+):(\d+):(\d+)\.(\d+)$/.exec(t);
      assert.ok(m, 'timestamp ASS valido: ' + t);
      return Number(m[1]) * 360000 + Number(m[2]) * 6000 + Number(m[3]) * 100 + Number(m[4]);
    };

    let fimAnterior = -1;
    for (const linha of dialogos) {
      const partes = linha.split(',');
      const ini = paraCs(partes[1]);
      const fim = paraCs(partes[2]);
      assert.ok(fim > ini, 'duracao positiva');
      assert.ok(ini >= fimAnterior, `sobreposicao detectada: anterior=${fimAnterior}cs, atual=${ini}cs`);
      assert.match(linha, /\{\\an5\\pos\(540,1620\)\}/, 'legenda deve estar travada em pos(540,1620)');
      assert.doesNotMatch(linha, /\\fscx108/, 'nao deve aplicar zoom que desloca palavras');
      fimAnterior = fim;
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('mega/v2.4.0: melhorias tecnicas (Whisper local-first, wav atomico, skip_frame nokey, fallback Motor Local, YouTube cookies e CI release)', () => {
  const pySrc = fs.readFileSync(path.join(RAIZ, 'py', 'transcrever.py'), 'utf8');
  assert.match(pySrc, /local_files_only=True/, 'transcrever.py deve carregar do disco primeiro antes do HuggingFace');
  assert.match(pySrc, /cublas64_12\.dll/, 'transcrever.py deve validar cublas64_12.dll antes de ativar CUDA');
  assert.match(pySrc, /CUDA falhou na transcricao/, 'transcrever.py deve ter fallback para CPU se encode() falhar em CUDA');

  const mediaSrc = fs.readFileSync(path.join(RAIZ, 'src', 'media.js'), 'utf8');
  assert.match(mediaSrc, /\.parcial/, 'extrairAudio deve gravar em arquivo provisorio antes de renomear');

  const pipeSrc = fs.readFileSync(path.join(RAIZ, 'src', 'pipeline.js'), 'utf8');
  assert.match(pipeSrc, /function wavUtilizavel\(/, 'pipeline deve validar cabecalho RIFF/WAVE antes de reusar .wav');
  assert.match(pipeSrc, /Fiz os cortes com o Motor Local/, 'pipeline deve fazer fallback para Motor Local se Diretor IA falhar');

  const momSrc = fs.readFileSync(path.join(RAIZ, 'src', 'momentos.js'), 'utf8');
  assert.match(momSrc, /'-skip_frame',\s*'nokey'/, 'momentos.js deve usar -skip_frame nokey em videos longos');
  assert.match(momSrc, /split\(\/\\r\\n\|\\r\|\\n\/\)/, 'momentos.js deve processar progresso FFmpeg separado por \\r');

  const liveSrc = fs.readFileSync(path.join(RAIZ, 'src', 'aovivo.js'), 'utf8');
  assert.match(liveSrc, /cookie\|browser\|firefox\|chrome\|edge/, 'aovivo.js deve pular navegador sem cookies legiveis');

  const wfSrc = fs.readFileSync(path.join(RAIZ, '.github', 'workflows', 'instalador.yml'), 'utf8');
  assert.match(wfSrc, /Instalar-Mega-Cortes-HD\.exe/, 'workflow de release deve publicar Instalar-Mega-Cortes-HD.exe');

  const proSrc = fs.readFileSync(path.join(RAIZ, 'src', 'pro.js'), 'utf8');
  assert.match(proSrc, /porId\.get\(id \+ ' \(alias\)'\)/, 'chamarIa deve resolver modelos com sufixo (alias) do BeaverNet');

  const srvSrc = fs.readFileSync(path.join(RAIZ, 'src', 'server.js'), 'utf8');
  assert.match(srvSrc, /podarTrabalhosAntigos/, 'server.js deve podar trabalhos concluidos para evitar crescimento de memoria');
  assert.match(srvSrc, /writeHead\(416/, 'server.js deve responder 416 para Range invalido');
});

test('mega/v2.4.0-fatiamento: live gravada de 5h fatia em blocos sequenciais de 30 min sem estourar contexto e deduplica fronteiras', () => {
  const pro = require(path.join(RAIZ, 'src', 'pro'));
  // Simula 5 horas de live gravada (18.000s) com 1 frase a cada 60s
  const segmentos = [];
  for (let t = 0; t < 18000; t += 60) {
    segmentos.push({
      inicio: t,
      fim: t + 10,
      texto: `Momento da live no minuto ${Math.floor(t / 60)} com fala completa.`,
      palavras: [
        { inicio: t, fim: t + 3, texto: 'Momento' },
        { inicio: t + 3, fim: t + 6, texto: 'minuto' },
        { inicio: t + 6, fim: t + 10, texto: String(Math.floor(t / 60)) + '.' },
      ],
    });
  }
  const { fatias } = pro.fatiarTranscricao({ segmentos }, null, 18000, 18000);
  // 5h em blocos de 30 min (passo 29 min) => 10 a 11 fatias sequenciais
  assert.ok(fatias.length >= 10 && fatias.length <= 12, 'esperado ~10-11 fatias para 5h, obtido: ' + fatias.length);
  for (const f of fatias) {
    assert.ok(f.linhas.length <= 18000, 'nenhuma fatia pode exceder limite de caracteres');
  }
  // Garante cobertura do inicio (0s) ate perto do fim (5h)
  assert.ok(fatias[0].inicio <= 60);
  assert.ok(fatias[fatias.length - 1].fim >= 17900);

  // Deduplicacao na emenda de 60s entre fatias mantem o corte de maior nota
  const dedup = pro.deduplicarCortesIa([
    { inicio: 1750, fim: 1790, duracao: 40, nota: 82, titulo: 'Menor' },
    { inicio: 1755, fim: 1795, duracao: 40, nota: 95, titulo: 'Maior' },
    { inicio: 7200, fim: 7245, duracao: 45, nota: 88, titulo: 'Outro bloco' },
  ], 5);
  assert.equal(dedup.length, 2);
  assert.equal(dedup[0].titulo, 'Maior');
  assert.equal(dedup[1].titulo, 'Outro bloco');
});
