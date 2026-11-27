'use strict';
/**
 * Motor Diretor IA do Mega Cortes HD — 100% direto do PC do usuario (sem intermediarios, sem paywall).
 *
 * Provedores suportados:
 *  - beavernet : BeaverNet (https://net.beaverai.org/v1) — pool comunitario gratuito compativel com OpenAI;
 *                chave de API OPCIONAL, selecao manual de modelo + fallback automatico na ordem:
 *                1) s567901/Qwen3.8-Flash-Next-Huihui-Refusal-Direction-r-v2
 *                2) serranoprime1/nvidia/nemotron-3.5-super-vl:free
 *                3) Meus Artis/Gemma-4-E4B-it-Ultra-Uncensored-Heretic
 *                4) pixel.dust/Qwen3.5-0.8B-Space-Programming
 *  - gemini    : Google Gemini API (chave propria do usuario)
 *  - openai    : ChatGPT / OpenAI API (chave propria do usuario)
 *  - anthropic : Claude / Anthropic API (chave propria do usuario)
 */

const pastas = require('./pastas');
const { achatarPalavras, montarFrases, mmss, rotulo } = require('./score');

const PROVEDORES = ['beavernet', 'gemini', 'openai', 'anthropic'];

const BEAVERNET_BASE_URL = 'https://net.beaverai.org/v1';

// Ordem de preferencia padrao: Qwen3.8 Flash Next >> Nemotron >> Gemma-4 4B >> Qwen 0.8B
const BEAVERNET_MODELOS_PADRAO = [
  's567901/Qwen3.8-Flash-Next-Huihui-Refusal-Direction-r-v2',
  'serranoprime1/nvidia/nemotron-3.5-super-vl:free',
  'Meus Artis/Gemma-4-E4B-it-Ultra-Uncensored-Heretic',
  'pixel.dust/Qwen3.5-0.8B-Space-Programming',
];

const MODELOS_PADRAO_PROVEDOR = {
  beavernet: BEAVERNET_MODELOS_PADRAO[0],
  gemini: 'gemini-2.5-flash',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-latest',
};

function provedorSalvo() {
  const cfg = pastas.lerConfig();
  const provedor = PROVEDORES.includes(cfg.iaProvedor) ? cfg.iaProvedor : 'beavernet';
  let chave = String(cfg.iaChavePropria || '').trim();
  if (!chave && provedor === 'beavernet' && process.env.BEAVERNET_API_KEY) {
    chave = String(process.env.BEAVERNET_API_KEY).trim();
  }
  const modelo = String(cfg.iaModeloProprio || '').trim();
  const baseUrl = String(cfg.iaBaseUrl || '').trim();
  return { provedor, chave, modelo, baseUrl };
}

function resumoProvedor() {
  const p = provedorSalvo();
  return {
    provedor: p.provedor,
    temChavePropria: !!p.chave,
    modeloProprio: p.modelo,
    baseUrl: p.baseUrl || (p.provedor === 'beavernet' ? BEAVERNET_BASE_URL : ''),
    beavernetModelos: BEAVERNET_MODELOS_PADRAO,
  };
}

function salvarProvedor(provedor, chave, modelo, baseUrl) {
  const prov = PROVEDORES.includes(provedor) ? provedor : 'beavernet';
  const cfg = pastas.lerConfig();
  const chaveLimpa = String(chave || '').trim();
  const atual = cfg.iaProvedor === prov ? String(cfg.iaChavePropria || '') : '';
  const chaveFinal = chave === '' ? '' : (chaveLimpa || atual);

  if (prov !== 'beavernet') {
    if (!chaveFinal) {
      const nomes = { gemini: 'Google Gemini', openai: 'OpenAI (ChatGPT)', anthropic: 'Anthropic (Claude)' };
      throw new Error('Cole a sua chave de API para usar ' + (nomes[prov] || prov) + '.');
    }
    if (chaveFinal.length < 16 || /\s/.test(chaveFinal)) {
      throw new Error('Essa chave de API parece incompleta. Copie novamente, inteira.');
    }
    if (prov === 'anthropic' && !/^sk-ant-/i.test(chaveFinal)) {
      throw new Error('A chave do Claude começa com "sk-ant-".');
    }
    if (prov === 'openai' && !/^sk-/i.test(chaveFinal)) {
      throw new Error('A chave da OpenAI começa com "sk-".');
    }
  }

  cfg.iaProvedor = prov;
  if (chaveFinal) cfg.iaChavePropria = chaveFinal;
  else delete cfg.iaChavePropria;

  const modLimpo = String(modelo || '').trim().slice(0, 120);
  if (modLimpo) cfg.iaModeloProprio = modLimpo;
  else delete cfg.iaModeloProprio;

  const urlLimpa = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (prov === 'beavernet' && urlLimpa && /^https?:\/\//i.test(urlLimpa)) cfg.iaBaseUrl = urlLimpa;
  else delete cfg.iaBaseUrl;

  pastas.gravarConfig(cfg);
  return resumoProvedor();
}

async function obterEstado() {
  const p = provedorSalvo();
  const pronto = p.provedor === 'beavernet' || !!p.chave;
  return {
    ativo: pronto,
    pronto,
    gratuito: true,
    ...resumoProvedor(),
  };
}

// ---------------------------------------------------------------- chamadas LLM diretas

async function chamarOpenAiCompativel({ baseUrl, apiKey, model, systemPrompt, userPrompt, maxTokens = 2000, timeoutMs = 45000 }) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (apiKey) headers.Authorization = 'Bearer ' + apiKey;

  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.4,
    max_tokens: maxTokens,
  };

  const r = await fetch(baseUrl.replace(/\/+$/, '') + '/chat/completions', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const texto = await r.text();
  let dados = null;
  try { dados = JSON.parse(texto); } catch (_) {}

  if (!r.ok) {
    const msg = (dados && dados.error && (dados.error.message || dados.error)) || texto.slice(0, 200) || ('HTTP ' + r.status);
    throw new Error('[' + model + '] ' + msg);
  }

  const content = dados && dados.choices && dados.choices[0] && dados.choices[0].message && dados.choices[0].message.content;
  if (!content) throw new Error('[' + model + '] Resposta vazia da API.');
  return String(content);
}

async function chamarGemini({ apiKey, model, systemPrompt, userPrompt, timeoutMs = 45000 }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: { temperature: 0.4, responseMimeType: 'application/json' },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const dados = await r.json().catch(() => null);
  if (!r.ok) {
    throw new Error((dados && dados.error && dados.error.message) || ('Gemini HTTP ' + r.status));
  }
  const text = dados && dados.candidates && dados.candidates[0] && dados.candidates[0].content && dados.candidates[0].content.parts
    ? dados.candidates[0].content.parts.map((p) => p.text || '').join('')
    : '';
  if (!text) throw new Error('Resposta vazia do Gemini.');
  return text;
}

async function chamarAnthropic({ apiKey, model, systemPrompt, userPrompt, maxTokens = 2000, timeoutMs = 45000 }) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const dados = await r.json().catch(() => null);
  if (!r.ok) {
    throw new Error((dados && dados.error && dados.error.message) || ('Anthropic HTTP ' + r.status));
  }
  const text = dados && Array.isArray(dados.content)
    ? dados.content.map((b) => b.text || '').join('')
    : '';
  if (!text) throw new Error('Resposta vazia do Claude.');
  return text;
}

// Cache em memoria de GET /v1/models do BeaverNet (2 minutos)
let cacheModelosBeaver = { ts: 0, lista: null };

function normalizarModeloBeaver(m) {
  const id = String(m && (m.id || m.name) || '').trim();
  if (!id) return null;
  const limits = (m && m.limits) || {};
  const anon = (m && m.anonymous) || {};
  const allowAnon = m && typeof m.allow_anonymous === 'boolean' ? m.allow_anonymous : true;
  const unstable = !!(m && m.unstable);
  const ctx = Number(limits.contextLength || limits.context_length || m.context_length || 32768) || 32768;
  const maxOutChave = Number(limits.maxTokens || limits.max_tokens || 2000) || 2000;
  const maxOutAnon = Number(anon.maxTokens || anon.max_tokens || anon.maxOutputTokens || 512) || 512;
  const maxPromptAnon = Number(anon.maxPromptTokens || anon.max_prompt_tokens || 8192) || 8192;
  const ctxK = ctx >= 1000 ? Math.round(ctx / 1000) + 'k ctx' : ctx + ' ctx';
  return {
    id,
    allowAnonymous: allowAnon,
    unstable,
    contextLength: ctx,
    maxOutChave,
    maxOutAnon,
    maxPromptAnon,
    label: `${id} · ${allowAnon ? 'sem chave' : 'requer chave grátis'} · ${ctxK}`,
  };
}

async function obterCatalogoBeaverNet(forcar = false) {
  const agora = Date.now();
  if (!forcar && cacheModelosBeaver.lista && (agora - cacheModelosBeaver.ts) < 120000) {
    return cacheModelosBeaver.lista;
  }
  try {
    const r = await fetch(BEAVERNET_BASE_URL + '/models', { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    const brutos = Array.isArray(d && d.data) ? d.data : [];
    const mapa = new Map();
    for (const item of brutos) {
      const norm = normalizarModeloBeaver(item);
      if (norm && !norm.unstable) mapa.set(norm.id, norm);
    }
    const lista = Array.from(mapa.values());
    if (lista.length) {
      cacheModelosBeaver = { ts: agora, lista };
      return lista;
    }
  } catch (_) {}
  // Fallback estatico caso /v1/models esteja indisponivel
  return BEAVERNET_MODELOS_PADRAO.map((id) => normalizarModeloBeaver({ id, allow_anonymous: true }));
}

async function validarChaveBeaverNet(chave) {
  const c = String(chave || '').trim();
  if (!c) return { ok: true, anonimo: true };
  try {
    const r = await fetch(BEAVERNET_BASE_URL + '/users/me', {
      headers: { Authorization: 'Bearer ' + c, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return { ok: false, erro: 'Chave BeaverNet inválida ou expirada (HTTP ' + r.status + ').' };
    const u = await r.json().catch(() => ({}));
    return { ok: true, anonimo: false, usuario: u.username || u.name || u.handle || 'autenticado' };
  } catch (_) {
    // Se a rede oscilar durante a validacao, nao bloqueia o salvamento
    return { ok: true, anonimo: false, aviso: 'Chave salva (não foi possível confirmar /v1/users/me agora).' };
  }
}

/**
 * Executa o prompt no provedor configurado.
 * No BeaverNet, consulta os limites reais de /v1/models (sem capar modelos que aceitam mais tokens)
 * e faz fallback inteligente: modelo escolhido -> favoritos -> modelos online (>=16k ctx) -> beaverlite.
 */
async function chamarIa(systemPrompt, userPrompt, opcoes = {}) {
  const cfg = provedorSalvo();
  const maxTokens = opcoes.maxTokens || 2000;
  const timeoutMs = opcoes.timeoutMs || 50000;

  if (cfg.provedor === 'beavernet') {
    const baseUrl = cfg.baseUrl || BEAVERNET_BASE_URL;
    const temChave = !!cfg.chave;
    const catalogo = await obterCatalogoBeaverNet(false);
    const porId = new Map(catalogo.map((m) => [m.id, m]));

    // Monta fila inteligente respeitando perfil com chave vs sem chave
    const fila = [];
    const add = (id) => { if (id && id !== 'auto' && !fila.includes(id)) fila.push(id); };

    const buscarInfo = (id) => porId.get(id) || porId.get(id + ' (alias)');

    if (cfg.modelo && cfg.modelo !== 'auto') add(cfg.modelo);
    for (const fav of BEAVERNET_MODELOS_PADRAO) {
      const info = buscarInfo(fav);
      if (!info || temChave || info.allowAnonymous) add(fav);
    }
    // Completa com outros modelos online estaveis de contexto grande (>= 16k)
    const extras = catalogo
      .filter((m) => !m.unstable && (temChave || m.allowAnonymous) && m.contextLength >= 16384)
      .sort((a, b) => (b.contextLength - a.contextLength) || ((temChave ? b.maxOutChave : b.maxOutAnon) - (temChave ? a.maxOutChave : a.maxOutAnon)))
      .slice(0, 4);
    for (const ex of extras) add(ex.id);
    // Ultimo fallback do proprio pool BeaverNet
    add('beaverlite');

    const erros = [];
    for (const modelo of fila) {
      const info = buscarInfo(modelo);
      const tetoReal = info
        ? (temChave ? info.maxOutChave : info.maxOutAnon)
        : (temChave ? maxTokens : 512);
      const maxTok = Math.max(128, Math.min(maxTokens, tetoReal));
      try {
        const texto = await chamarOpenAiCompativel({
          baseUrl,
          apiKey: cfg.chave || '',
          model: modelo,
          systemPrompt,
          userPrompt,
          maxTokens: maxTok,
          timeoutMs,
        });
        if (opcoes.validarJson) extrairJson(texto);
        return { texto, provedor: 'beavernet', modeloUsado: modelo };
      } catch (e) {
        erros.push(e.message);
      }
    }
    throw new Error('BeaverNet indisponível nos modelos configurados: ' + erros.join(' | '));
  }

  if (cfg.provedor === 'gemini') {
    if (!cfg.chave) throw new Error('Configure sua chave da API do Google Gemini antes de usar o Diretor IA.');
    const modelo = cfg.modelo || MODELOS_PADRAO_PROVEDOR.gemini;
    const texto = await chamarGemini({ apiKey: cfg.chave, model: modelo, systemPrompt, userPrompt, timeoutMs });
    return { texto, provedor: 'gemini', modeloUsado: modelo };
  }

  if (cfg.provedor === 'openai') {
    if (!cfg.chave) throw new Error('Configure sua chave da API da OpenAI antes de usar o Diretor IA.');
    const modelo = cfg.modelo || MODELOS_PADRAO_PROVEDOR.openai;
    const texto = await chamarOpenAiCompativel({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: cfg.chave,
      model: modelo,
      systemPrompt,
      userPrompt,
      maxTokens,
      timeoutMs,
    });
    return { texto, provedor: 'openai', modeloUsado: modelo };
  }

  if (cfg.provedor === 'anthropic') {
    if (!cfg.chave) throw new Error('Configure sua chave da API do Claude (Anthropic) antes de usar o Diretor IA.');
    const modelo = cfg.modelo || MODELOS_PADRAO_PROVEDOR.anthropic;
    const texto = await chamarAnthropic({ apiKey: cfg.chave, model: modelo, systemPrompt, userPrompt, maxTokens, timeoutMs });
    return { texto, provedor: 'anthropic', modeloUsado: modelo };
  }

  throw new Error('Provedor de IA desconhecido: ' + cfg.provedor);
}

async function listarModelosBeaverNet() {
  const cfg = provedorSalvo();
  const temChave = !!cfg.chave;
  const catalogo = await obterCatalogoBeaverNet(true);
  const filtrados = catalogo
    .filter((m) => !m.unstable && (temChave || m.allowAnonymous))
    .sort((a, b) => {
      const ia = BEAVERNET_MODELOS_PADRAO.indexOf(a.id);
      const ib = BEAVERNET_MODELOS_PADRAO.indexOf(b.id);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      return (b.contextLength - a.contextLength);
    });

  // Garante os 4 favoritos no topo na ordem exata de preferencia (Qwen3.8 Flash >> Nemotron >> Gemma-4 4B >> Qwen 0.8B)
  const porId = new Map(filtrados.map((m) => [m.id, m]));
  const ordenados = [];
  for (const fav of BEAVERNET_MODELOS_PADRAO) {
    const direto = porId.get(fav);
    const alias = porId.get(fav + ' (alias)');
    const escolhido = direto || (alias ? Object.assign({}, alias, { id: fav }) : normalizarModeloBeaver({ id: fav, allow_anonymous: true }));
    ordenados.push(escolhido);
    porId.delete(fav);
    porId.delete(fav + ' (alias)');
  }
  for (const resto of porId.values()) ordenados.push(resto);
  return {
    modelos: ordenados.map((m) => m.id),
    detalhes: ordenados,
  };
}

async function testarConexao() {
  const res = await chamarIa(
    'Responda apenas com um JSON: {"ok":true}',
    'Teste de conexão. Responda {"ok":true}.',
    { maxTokens: 40, timeoutMs: 25000 }
  );
  return { ok: true, provedor: res.provedor, modeloUsado: res.modeloUsado };
}

// ---------------------------------------------------------------- preparacao de transcricao e parsing JSON

function compactarTranscricao(transcricao, trecho, maxChars) {
  const palavras = achatarPalavras(transcricao);
  const frases = montarFrases(palavras);
  const filtradas = trecho
    ? frases.filter((f) => f.fim >= trecho.inicio && f.inicio <= trecho.fim)
    : frases;

  const linhas = [];
  let total = 0;
  for (const f of filtradas) {
    const l = `[${f.inicio.toFixed(1)}-${f.fim.toFixed(1)}] ${f.texto}`;
    if (total + l.length + 1 > maxChars) break;
    linhas.push(l);
    total += l.length + 1;
  }
  return { linhas: linhas.join('\n'), palavras };
}

function extrairJson(texto) {
  let s = String(texto || '').trim();
  // Remove blocos de raciocinio (<think>...</think>) de modelos reasoning
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  // Se vier em bloco markdown ```json ... ```, prioriza o conteudo interno
  const bloco = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (bloco) s = bloco[1].trim();

  const limparVirgulas = (str) => str.replace(/,\s*([}\]])/g, '$1');

  // 1. Extrai todos os objetos JSON balanceados { ... } respeitando strings e escapes
  const candidatos = [];
  let depth = 0;
  let inStr = false;
  let esc = false;
  let start = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) { esc = false; }
      else if (ch === '\\') { esc = true; }
      else if (ch === '"') { inStr = false; }
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start >= 0) {
          candidatos.push(s.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }

  for (const cand of candidatos) {
    try {
      const obj = JSON.parse(limparVirgulas(cand));
      if (obj && (Array.isArray(obj.cortes) || typeof obj.inicio === 'number' || obj.ok === true)) {
        return obj;
      }
    } catch (_) {}
  }
  for (const cand of candidatos) {
    try { return JSON.parse(limparVirgulas(cand)); } catch (_) {}
  }

  // 2. Recuperacao de JSON truncado (ex: limite de 512 tokens no BeaverNet sem chave):
  // extrai todos os objetos de corte completos ja gerados dentro de "cortes":[ ...
  const idxCortes = s.search(/"cortes"\s*:\s*\[/i);
  if (idxCortes >= 0) {
    const sub = s.slice(idxCortes);
    const arrStart = sub.indexOf('[');
    if (arrStart >= 0) {
      const itens = [];
      let d = 0, str = false, e = false, st = -1;
      for (let i = arrStart + 1; i < sub.length; i++) {
        const ch = sub[i];
        if (str) {
          if (e) e = false;
          else if (ch === '\\') e = true;
          else if (ch === '"') str = false;
          continue;
        }
        if (ch === '"') { str = true; continue; }
        if (ch === '{') { if (d === 0) st = i; d++; }
        else if (ch === '}') {
          if (d > 0) {
            d--;
            if (d === 0 && st >= 0) {
              try {
                const it = JSON.parse(limparVirgulas(sub.slice(st, i + 1)));
                if (it && typeof it.inicio !== 'undefined') itens.push(it);
              } catch (_) {}
              st = -1;
            }
          }
        }
      }
      if (itens.length > 0) return { cortes: itens };
    }
  }

  throw new Error('A IA não retornou um JSON válido de cortes.');
}

/**
 * Analisa a transcricao inteira com IA na nuvem e devolve cortes com titulo, gancho e hashtags.
 */
async function analisarComIa(transcricao, picos, duracao, opcoes = {}) {
  const cfg = provedorSalvo();
  const quantidade = Math.max(1, Math.min(20, Number(opcoes.quantidade || 8)));
  const minDur = Number(opcoes.minDur || 28);
  const maxDur = Number(opcoes.maxDur || 62);
  // Usa limite real de prompt do modelo quando disponivel (evita capar modelos grandes sem chave)
  let limiteChars = 60000;
  if (cfg.provedor === 'beavernet' && !cfg.chave) {
    const cat = await obterCatalogoBeaverNet(false);
    const idAlvo = cfg.modelo || BEAVERNET_MODELOS_PADRAO[0];
    const alvo = cat.find((m) => m.id === idAlvo || m.id === idAlvo + ' (alias)');
    const promptTok = alvo ? alvo.maxPromptAnon : 8192;
    limiteChars = Math.max(18000, Math.min(60000, Math.round(promptTok * 2.6)));
  }
  const { linhas, palavras } = compactarTranscricao(transcricao, opcoes.trecho, limiteChars);
  if (!linhas) return { cortes: [], usouTrial: false };

  const systemPrompt = [
    'Você é um diretor de cortes virais para TikTok, YouTube Shorts e Instagram Reels em português do Brasil.',
    'Receberá trechos de transcrição com timestamps em segundos no formato [inicio-fim] texto.',
    'Escolha os melhores momentos com história completa (começo, desenvolvimento e clímax/punchline).',
    'Evite agradecimentos de Pix, sub, raid, propaganda e silêncios.',
    'Responda ESTRITAMENTE em JSON válido no formato:',
    '{"cortes":[{"inicio":12.5,"fim":52.0,"nota":92,"titulo":"Título curto e chamativo","gancho":"FRASE CURTA DE 4S","hashtags":["tag1","tag2","tag3"],"motivo":"Por que este trecho viraliza"}]}',
  ].join('\n');

  const userPrompt = [
    `Contexto: ${opcoes.contexto || 'Vídeo'} ${opcoes.canal ? '(' + opcoes.canal + ')' : ''}`,
    `Duração total: ${Math.round(duracao || 0)}s | Quantidade desejada: ${quantidade} cortes | Duração de cada corte: entre ${minDur}s e ${maxDur}s.`,
    opcoes.descricao ? `Pedido específico do usuário: ${opcoes.descricao}` : '',
    'Transcrição:',
    linhas,
  ].filter(Boolean).join('\n');

  const maxTokensPedido = Math.min(8192, Math.max(2500, quantidade * 280));
  const res = await chamarIa(systemPrompt, userPrompt, { maxTokens: maxTokensPedido, timeoutMs: 90000, validarJson: true });
  const parsed = extrairJson(res.texto);
  const brutos = Array.isArray(parsed && parsed.cortes) ? parsed.cortes : [];

  const cortes = brutos
    .map((c) => {
      const inicio = Math.max(0, Number(c.inicio) || 0);
      let fim = Math.min(duracao || 99999, Number(c.fim) || (inicio + minDur));
      if (fim - inicio < 8) fim = Math.min(duracao || 99999, inicio + minDur);
      const dur = Math.round((fim - inicio) * 10) / 10;
      const pags = palavras.filter((p) => p.inicio >= inicio - 0.3 && p.fim <= fim + 0.3);
      const notaVal = Math.max(50, Math.min(99, Math.round(Number(c.nota) || 85)));
      const motivoTxt = String(c.motivo || 'Selecionado pelo Diretor IA (' + res.modeloUsado + ')').trim();
      return {
        inicio,
        fim,
        duracao: dur,
        inicioMmss: mmss(inicio),
        fimMmss: mmss(fim),
        nota: notaVal,
        rotulo: rotulo(notaVal),
        titulo: String(c.titulo || '').trim().slice(0, 90),
        gancho: String(c.gancho || '').trim().slice(0, 60),
        hashtags: Array.isArray(c.hashtags) ? c.hashtags.map((h) => String(h).replace(/^#/, '').trim()).filter(Boolean).slice(0, 5) : [],
        motivo: motivoTxt,
        motivos: [{ fator: motivoTxt, pontos: notaVal }],
        palavras: pags,
        texto: pags.map((p) => p.texto || p.palavra || '').join(' ').trim(),
        feitoComIa: true,
        modeloIa: res.modeloUsado,
      };
    })
    .filter((c) => c.duracao >= 5)
    .slice(0, quantidade);

  return {
    cortes,
    provedor: res.provedor,
    modeloUsado: res.modeloUsado,
    usouTrial: false,
    trialsRestantes: 999,
  };
}

/**
 * Refina um clipe capturado ao vivo (ajusta inicio/fim e gera titulo + gancho).
 */
async function refinarClipeAoVivo(transcricao, offset, duracaoAlvo, duracaoTotal, opcoes = {}) {
  const { linhas } = compactarTranscricao(transcricao, null, 12000);
  if (!linhas) return { corte: null, usouTrial: false, liveAtivo: true };

  const systemPrompt =
    'Você é um editor de clipes ao vivo. Ajuste o melhor início e fim desse momento e crie um título chamativo + gancho curto (até 5 palavras). ' +
    'Responda APENAS JSON: {"inicio":0,"fim":30,"titulo":"...","gancho":"...","hashtags":["tag1","tag2"]}';

  const userPrompt = `Live: ${opcoes.contexto || 'Ao vivo'} (${opcoes.canal || ''})\nDuração alvo: ~${Math.round(duracaoAlvo || 30)}s\nTranscrição:\n${linhas}`;

  const res = await chamarIa(systemPrompt, userPrompt, { maxTokens: 350, timeoutMs: 30000, validarJson: true });
  const parsed = extrairJson(res.texto);
  if (!parsed) return { corte: null, usouTrial: false, liveAtivo: true };

  const inicio = Math.max(0, Number(parsed.inicio ?? offset) || 0);
  const fim = Math.min(duracaoTotal || 99999, Math.max(inicio + 8, Number(parsed.fim ?? (inicio + (duracaoAlvo || 30))) || 30));

  return {
    corte: {
      inicio,
      fim,
      duracao: Math.round((fim - inicio) * 10) / 10,
      titulo: String(parsed.titulo || '').trim().slice(0, 90),
      gancho: String(parsed.gancho || '').trim().slice(0, 60),
      hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.map((h) => String(h).replace(/^#/, '').trim()).filter(Boolean).slice(0, 5) : [],
    },
    usouTrial: false,
    liveAtivo: true,
    provedor: res.provedor,
    modeloUsado: res.modeloUsado,
  };
}

module.exports = {
  PROVEDORES,
  BEAVERNET_BASE_URL,
  BEAVERNET_MODELOS_PADRAO,
  obterEstado,
  analisarComIa,
  refinarClipeAoVivo,
  salvarProvedor,
  resumoProvedor,
  listarModelosBeaverNet,
  validarChaveBeaverNet,
  testarConexao,
  extrairJson,
};
