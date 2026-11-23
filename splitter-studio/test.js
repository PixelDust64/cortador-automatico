const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASE_DIR = __dirname;
const PORT = 4359;
const BASE = `http://127.0.0.1:${PORT}`;
const FFMPEG = fs.existsSync(path.join(BASE_DIR, 'runtime', 'ffmpeg', 'ffmpeg.exe'))
  ? path.join(BASE_DIR, 'runtime', 'ffmpeg', 'ffmpeg.exe')
  : 'ffmpeg';

const dadosDir = path.join(BASE_DIR, 'dados');
fs.mkdirSync(dadosDir, { recursive: true });
const wavTeste = path.join(dadosDir, '_teste_sintetico.wav');

// Gera audio sintetico de teste (acorde Am: 440Hz + 523.25Hz + 659.25Hz, 6s stereo)
execFileSync(FFMPEG, [
  '-y', '-v', 'error',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6',
  '-f', 'lavfi', '-i', 'sine=frequency=523.25:duration=6',
  '-f', 'lavfi', '-i', 'sine=frequency=659.25:duration=6',
  '-filter_complex', '[0][1][2]amix=inputs=3:duration=first,aformat=channel_layouts=stereo',
  '-ar', '44100',
  wavTeste,
]);

const srv = spawn(process.execPath, [path.join(BASE_DIR, 'server.js')], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});

async function esperarServidor() {
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`${BASE}/api/status`);
      if (r.ok) return await r.json();
    } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('Servidor nao iniciou');
}

async function postJson(url, body) {
  const r = await fetch(`${BASE}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`${url} -> ${r.status}: ${j.erro}`);
  return j;
}

async function esperarJob(jobId) {
  for (let i = 0; i < 60; i++) {
    const r = await fetch(`${BASE}/api/job/${jobId}`);
    const j = await r.json();
    if (j.status === 'concluido') return j;
    if (j.status === 'erro') throw new Error(j.erro);
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error('Timeout job');
}

(async () => {
  try {
    const st = await esperarServidor();
    console.log('[OK] /api/status:', JSON.stringify(st));

    const buf = fs.readFileSync(wavTeste);
    const upRes = await fetch(`${BASE}/api/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'teste_am.wav' },
      body: buf,
    });
    const m1 = await upRes.json();
    if (!upRes.ok || !m1.id || m1.peaks.length < 50) throw new Error('Falha upload');
    console.log('[OK] /api/upload:', m1.id, m1.duracao + 's', 'peaks:', m1.peaks.length);

    const tb = await postJson('/api/tom-bpm', { mediaId: m1.id });
    console.log('[OK] /api/tom-bpm:', tb.tom, '| Camelot:', tb.camelot, '| BPM:', tb.bpm);

    const pt = await postJson('/api/mudar-tom', { mediaId: m1.id, semitons: 3, velocidade: 1.2 });
    console.log('[OK] /api/mudar-tom:', pt.id, pt.duracao + 's');

    const ct = await postJson('/api/cortar', { mediaId: m1.id, inicio: 1, fim: 4, fadeIn: 0.5, fadeOut: 0.5 });
    console.log('[OK] /api/cortar (manter):', ct.id, ct.duracao + 's');

    const ct2 = await postJson('/api/cortar', { mediaId: m1.id, inicio: 2, fim: 4, inverter: true });
    console.log('[OK] /api/cortar (remover meio):', ct2.id, ct2.duracao + 's');

    const jn = await postJson('/api/juntar', { mediaIds: [ct.id, ct2.id], crossfade: 0.5 });
    console.log('[OK] /api/juntar:', jn.id, jn.duracao + 's');

    const remStart = await postJson('/api/remover-voz', { mediaId: m1.id, motor: 'ffmpeg' });
    const remJob = await esperarJob(remStart.jobId);
    console.log('[OK] /api/remover-voz:', remJob.resultado.faixas.map(f => f.stemKey).join(', '));

    const spStart = await postJson('/api/splitter', { mediaId: m1.id, modo: 'stems4', motor: 'ffmpeg' });
    const spJob = await esperarJob(spStart.jobId);
    console.log('[OK] /api/splitter:', spJob.resultado.faixas.map(f => f.stemKey).join(', '));

    const mx = await postJson('/api/mixar', {
      nome: 'karaoke_teste',
      faixas: [
        { mediaId: remJob.resultado.faixas[0].id, volume: 0.85, eco: false },
        { mediaId: remJob.resultado.faixas[1].id, volume: 1.0, eco: true },
      ],
    });
    console.log('[OK] /api/mixar (Karaoke):', mx.id, mx.duracao + 's');

    const dl = await fetch(`${BASE}/api/download/${mx.id}?formato=mp3`);
    const mp3Buf = await dl.arrayBuffer();
    if (!dl.ok || mp3Buf.byteLength < 1000) throw new Error('Falha download MP3');
    console.log('[OK] /api/download (MP3):', mp3Buf.byteLength, 'bytes');

    const html = await fetch(`${BASE}/`);
    if (!html.ok) throw new Error('Falha index.html');
    console.log('[OK] GET / (index.html):', (await html.text()).length, 'chars');

    console.log('=== TODOS OS 11 TESTES PASSARAM! ===');
  } finally {
    srv.kill();
    try { fs.rmSync(dadosDir, { recursive: true, force: true }); } catch {}
  }
})().catch(e => {
  console.error('[FALHA]', e);
  srv.kill();
  process.exit(1);
});
