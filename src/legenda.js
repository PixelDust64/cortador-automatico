'use strict';
/**
 * Monta a legenda .ass no padrao de cortes virais modernos:
 * - Legenda dinamica 100% travada na mesma posicao ({\an5\pos(540,Y)}), sem pular
 *   nem empurrar palavras pros lados; sempre 1 linha limpa com destaque amarelo.
 * - Gancho de 4s em card arredondado moderno (desenho vetorial \p1 com borda sutil,
 *   sombra suave e destaque bicolor branco + dourado).
 * - Cartao de nome do streamer em pilula horizontal arredondada (nunca quadrado chapado).
 */

const fs = require('fs');

const PALAVRAS_POR_BLOCO = 3;
const MAX_CHARS_BLOCO = 19;

// Cores no formato ASS: &HAABBGGRR (BGR invertido)
const BRANCO = '&H00FFFFFF';
const AMARELO = '&H0000E5FF';
const DOURADO = '&H000AD6FF'; // #FFD60A
const PRETO = '&H00000000';
const FUNDO_CARD = '&H00160F0B'; // #0B0F16 (obsidian escuro)
const BORDA_SUTIL = '&H00FFE2C8';

// Catalogo de fontes abertas (SIL OFL) que acompanham o programa em src/fontes/
const FONTES_LEGENDA = {
  tiktok:     { id: 'tiktok',     nome: 'TikTok Sans',      ass: 'TikTok Sans Jamble',    arquivo: 'TikTokSans-ExtraBold.ttf', bold: 0 },
  montserrat: { id: 'montserrat', nome: 'Montserrat Black', ass: 'Montserrat Thin Black', arquivo: 'Montserrat-ExtraBold.ttf', bold: 0 },
  anton:      { id: 'anton',      nome: 'Anton Impact',     ass: 'Anton',                 arquivo: 'Anton-Regular.ttf',        bold: 0 },
  poppins:    { id: 'poppins',    nome: 'Poppins Bold',     ass: 'Poppins ExtraBold',     arquivo: 'Poppins-ExtraBold.ttf',    bold: 0 },
  bangers:    { id: 'bangers',    nome: 'Bangers Gamer',    ass: 'Bangers',               arquivo: 'Bangers-Regular.ttf',      bold: 0 },
  bebas:      { id: 'bebas',      nome: 'Bebas Neue',       ass: 'Bebas Neue',            arquivo: 'BebasNeue-Regular.ttf',    bold: 0 },
  arial:      { id: 'arial',      nome: 'Clássica (Arial)', ass: 'Arial Black',           arquivo: null,                       bold: -1 },
};

function resolverFonte(idOuNome) {
  const chave = String(idOuNome || 'tiktok').trim().toLowerCase();
  if (FONTES_LEGENDA[chave]) return FONTES_LEGENDA[chave];
  for (const f of Object.values(FONTES_LEGENDA)) {
    if (f.ass.toLowerCase() === chave || f.nome.toLowerCase() === chave) return f;
  }
  return FONTES_LEGENDA.tiktok;
}

function tempoAssCs(csInt) {
  const cs = Math.max(0, Math.round(Number(csInt) || 0));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const seg = (cs % 6000) / 100;
  return h + ':' + String(m).padStart(2, '0') + ':' + seg.toFixed(2).padStart(5, '0');
}

function tempoAss(s) {
  return tempoAssCs(Math.round(Math.max(0, Number(s) || 0) * 100));
}

const PAUSA_QUEBRA = 0.65;
const SEGURA_DEPOIS = 0.32;

/**
 * Agrupa em blocos curtos de 1 linha (ate 3 palavras e ate ~19 caracteres),
 * evitando quebra automatica em 2 linhas que fazia a legenda subir e descer.
 */
function montarBlocos(palavras, maximo, maxChars) {
  const limPalavras = maximo || PALAVRAS_POR_BLOCO;
  const limChars = maxChars || 999;
  const lista = (palavras || [])
    .filter((p) => p && isFinite(p.inicio) && isFinite(p.fim) && String(p.texto || '').trim())
    .slice().sort((a, b) => a.inicio - b.inicio);
  const blocos = [];
  let atual = [];
  let charsAtual = 0;
  for (const p of lista) {
    const txt = String(p.texto || '').trim();
    const ultima = atual[atual.length - 1];
    const novoTam = charsAtual ? (charsAtual + 1 + txt.length) : txt.length;
    if (atual.length && (atual.length >= limPalavras || novoTam > limChars || p.inicio - ultima.fim > PAUSA_QUEBRA)) {
      blocos.push(atual);
      atual = [];
      charsAtual = 0;
    }
    atual.push(p);
    charsAtual = charsAtual ? (charsAtual + 1 + txt.length) : txt.length;
  }
  if (atual.length) blocos.push(atual);
  return blocos;
}

function escapar(t) {
  return String(t)
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .replace(/\r?\n/g, ' ')
    .trim();
}

/** Desenha um retangulo com cantos arredondados perfeitos em vetor ASS (\p1). */
function retanguloArredondadoAss(w, h, r) {
  w = Math.round(w);
  h = Math.round(h);
  r = Math.min(Math.round(r), Math.floor(w / 2), Math.floor(h / 2));
  const k = Math.round(r * 0.552);
  return [
    'm ' + r + ' 0',
    'l ' + (w - r) + ' 0',
    'b ' + (w - r + k) + ' 0 ' + w + ' ' + (r - k) + ' ' + w + ' ' + r,
    'l ' + w + ' ' + (h - r),
    'b ' + w + ' ' + (h - r + k) + ' ' + (w - r + k) + ' ' + h + ' ' + (w - r) + ' ' + h,
    'l ' + r + ' ' + h,
    'b ' + (r - k) + ' ' + h + ' 0 ' + (h - r + k) + ' 0 ' + (h - r),
    'l 0 ' + r,
    'b 0 ' + (r - k) + ' ' + (r - k) + ' 0 ' + r + ' 0',
  ].join(' ');
}

function cabecalho(opcoes) {
  const fObj = resolverFonte(opcoes.fonte);
  const fonte = fObj.ass;
  const bold = fObj.bold;
  // Gancho e pilula de nome usam sempre TikTok Sans (limpa, moderna e legivel)
  const fonteUi = FONTES_LEGENDA.tiktok.ass;
  const tamanho = opcoes.tamanho || 74;
  const margemBaixo = opcoes.margemBaixo || 300;
  const tamGancho = opcoes.tamanhoGancho || 48;
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 1080',
    'PlayResY: 1920',
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // Legenda dinamica: contorno preto firme + sombra curta, sem reescalar palavras
    'Style: Corte,' + fonte + ',' + tamanho + ',' + BRANCO + ',' + AMARELO + ',' + PRETO + ',&H78000000,' +
      bold + ',0,0,0,100,100,1,0,1,6.5,3,5,40,40,' + margemBaixo + ',1',
    // Texto do Gancho de 4s (dentro do card arredondado vetorial)
    'Style: GanchoTxt,' + fonteUi + ',' + tamGancho + ',' + BRANCO + ',' + BRANCO + ',' + PRETO + ',&H00000000,' +
      '0,0,0,0,100,100,0.5,0,1,2.5,0,5,60,60,0,1',
    // Texto da pilula do nome do streamer
    'Style: NomeTxt,' + fonteUi + ',33,' + BRANCO + ',' + BRANCO + ',' + PRETO + ',&H00000000,' +
      '0,0,0,0,100,100,2.5,0,1,0,0,5,20,20,0,1',
    // Estilo base para formas vetoriais (\p1) de cards e pilulas
    'Style: Vetor,Arial,20,' + FUNDO_CARD + ',' + FUNDO_CARD + ',' + BORDA_SUTIL + ',&H00000000,' +
      '0,0,0,0,100,100,0,0,1,2,0,7,0,0,0,1',
    estiloFixo(opcoes.textoFixo, fonte, bold),
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n');
}

// ---------------------------------------------------------------- texto fixo

const MARGEM_FIXO = { topo: 210, meio: 0, baixo: 430 };
const ALINHA_FIXO = { topo: 8, meio: 5, baixo: 2 };

function posicaoFixo(t) {
  return MARGEM_FIXO[t && t.posicao] != null ? t.posicao : 'meio';
}

function estiloFixo(t, fonte, bold) {
  const pos = posicaoFixo(t);
  const tamanho = Math.max(40, Math.min(130, Number(t && t.tamanho) || 76));
  const cor = t && t.cor === 'amarelo' ? AMARELO : BRANCO;
  const b = bold != null ? bold : -1;
  return 'Style: Fixo,' + fonte + ',' + tamanho + ',' + cor + ',' + cor + ',' + PRETO + ',&H96000000,' +
    b + ',0,0,0,100,100,0,0,1,8,3,' + ALINHA_FIXO[pos] + ',60,60,' + MARGEM_FIXO[pos] + ',1';
}

function linhaFixo(t) {
  const bruto = semEmojis(t && t.texto);
  if (!bruto) return null;
  const tamanho = Math.max(40, Math.min(130, Number(t.tamanho) || 76));
  const porLinha = Math.max(10, Math.round((26 * 62) / tamanho));
  const texto = bruto.includes('/')
    ? bruto.split('/').map((p) => escapar(p.trim()).toUpperCase()).filter(Boolean).slice(0, 4).join('\\N')
    : quebrarLinhasEquilibradas(escapar(bruto).toUpperCase(), porLinha).join('\\N');
  const ate = Number(t.duracao) > 0 ? Number(t.duracao) : 36000;
  return 'Dialogue: 2,' + tempoAss(0) + ',' + tempoAss(ate) + ',Fixo,,0,0,0,,' + texto;
}

function semEmojis(texto) {
  return String(texto || '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu, '')
    .replace(/\s+/g, ' ').trim();
}

/** Quebra em no maximo 2 linhas equilibradas (nunca deixa 1 palavra sozinha embaixo). */
function quebrarLinhasEquilibradas(texto, porLinha) {
  const limpo = String(texto || '').trim();
  if (limpo.length <= porLinha) return [limpo];
  const palavras = limpo.split(/\s+/);
  if (palavras.length <= 2) return [limpo];

  // Divide perto do meio em 2 linhas de largura parecida
  let melhorIdx = Math.ceil(palavras.length / 2);
  let menorDif = Infinity;
  for (let i = 1; i < palavras.length; i++) {
    const l1 = palavras.slice(0, i).join(' ');
    const l2 = palavras.slice(i).join(' ');
    const dif = Math.abs(l1.length - l2.length);
    if (dif < menorDif) { menorDif = dif; melhorIdx = i; }
  }
  const a = palavras.slice(0, melhorIdx).join(' ');
  const b = palavras.slice(melhorIdx).join(' ');
  if (Math.max(a.length, b.length) <= porLinha + 6) return [a, b];

  // Se for muito longo, ate 3 linhas
  const linhas = [];
  let atual = '';
  for (const p of palavras) {
    if (atual && (atual + ' ' + p).length > porLinha) { linhas.push(atual); atual = p; }
    else atual = atual ? atual + ' ' + p : p;
  }
  if (atual) linhas.push(atual);
  return linhas.slice(0, 3);
}

/** Colore as ultimas 1-2 palavras de impacto do gancho em dourado (#FFD60A). */
function formatarTextoGanchoBicolor(linhasArr) {
  if (!linhasArr.length) return '';
  const todas = linhasArr.join(' \\N ').split(' ');
  const palavrasReais = todas.filter((t) => t !== '\\N');
  const qtdDestaque = palavrasReais.length >= 4 ? 2 : 1;
  let restam = qtdDestaque;
  for (let i = todas.length - 1; i >= 0 && restam > 0; i--) {
    if (todas[i] === '\\N') continue;
    todas[i] = '{\\1c' + DOURADO + '}' + todas[i] + '{\\1c' + BRANCO + '}';
    restam--;
  }
  return todas.join(' ').replace(/ ?\\N ?/g, '\\N');
}

function eventosGanchoCard(textoBruto, duracao, cy, tamFonte) {
  const limpo = escapar(textoBruto).toUpperCase();
  const porLinha = Math.max(16, Math.round((23 * 48) / tamFonte));
  const linhasTxt = quebrarLinhasEquilibradas(limpo, porLinha);
  const maiorLinha = Math.max(...linhasTxt.map((l) => l.length));

  // Largura e altura do card arredondado calculadas sobre a tipografia
  const largTexto = Math.round(maiorLinha * tamFonte * 0.56);
  const cardW = Math.max(340, Math.min(940, largTexto + 64));
  const altLinha = Math.round(tamFonte * 1.24);
  const cardH = Math.round(linhasTxt.length * altLinha + 36);
  const raio = 24;
  const x0 = Math.round(540 - cardW / 2);
  const y0 = Math.round(cy - cardH / 2);
  const forma = retanguloArredondadoAss(cardW, cardH, raio);
  const tIni = tempoAss(0);
  const tFim = tempoAss(duracao);
  const fade = '{\\fad(150,260)';

  const formatado = formatarTextoGanchoBicolor(linhasTxt);
  return [
    // Sombra difusa embaixo do card
    'Dialogue: 6,' + tIni + ',' + tFim + ',Vetor,,0,0,0,,' + fade + '\\an7\\pos(' + x0 + ',' + (y0 + 8) + ')\\1c&H000000&\\1a&H68&\\bord0\\shad0\\blur14\\p1}' + forma,
    // Card escuro arredondado com borda fina translucida
    'Dialogue: 7,' + tIni + ',' + tFim + ',Vetor,,0,0,0,,' + fade + '\\an7\\pos(' + x0 + ',' + y0 + ')\\1c' + FUNDO_CARD + '\\1a&H16&\\3c&HFFFFFF&\\3a&HC4&\\bord2\\shad0\\p1}' + forma,
    // Texto bicolor centralizado no card
    'Dialogue: 8,' + tIni + ',' + tFim + ',GanchoTxt,,0,0,0,,' + fade + '\\an5\\pos(540,' + Math.round(cy + 1) + ')}' + formatado,
  ];
}

function eventosPilulaStreamer(nomeLimpo, yDivisao) {
  const txt = escapar(nomeLimpo).toUpperCase();
  // Pilula sempre horizontal e elegante (mesmo com 3 letras tipo "DEV")
  const pillW = Math.max(154, Math.min(540, Math.round(txt.length * 23 + 68)));
  const pillH = 50;
  const raio = 25;
  const x0 = Math.round(540 - pillW / 2);
  const y0 = Math.round(yDivisao - pillH / 2);
  const forma = retanguloArredondadoAss(pillW, pillH, raio);
  const tIni = tempoAss(0);
  const tFim = tempoAss(36000);

  return [
    // Sombra suave da pilula
    'Dialogue: 3,' + tIni + ',' + tFim + ',Vetor,,0,0,0,,{\\an7\\pos(' + x0 + ',' + (y0 + 5) + ')\\1c&H000000&\\1a&H65&\\bord0\\shad0\\blur10\\p1}' + forma,
    // Corpo da pilula (obsidian escuro + borda neutra translucida que combina com qualquer cor de linha)
    'Dialogue: 4,' + tIni + ',' + tFim + ',Vetor,,0,0,0,,{\\an7\\pos(' + x0 + ',' + y0 + ')\\1c&H140E0A&\\1a&H0E&\\3c&HFFFFFF&\\3a&HAA&\\bord2.2\\shad0\\p1}' + forma,
    // Nome centralizado na pilula
    'Dialogue: 5,' + tIni + ',' + tFim + ',NomeTxt,,0,0,0,,{\\an5\\pos(540,' + Math.round(yDivisao + 1) + ')}' + txt,
  ];
}

/**
 * @param {Array} palavras  [{inicio, fim, texto}] em tempo ABSOLUTO do video
 * @param {number} offset   segundo em que o clipe comeca (pra zerar o tempo)
 * @param {string} destino  caminho do .ass
 */
function gerarAss(palavras, offset, destino, opcoes) {
  opcoes = opcoes || {};
  const tamLegenda = opcoes.tamanho || 74;
  const margemBaixo = opcoes.margemBaixo || 300;
  const linhas = [cabecalho(opcoes)];

  const nome = semEmojis(opcoes.textoFixo && opcoes.textoFixo.nome).slice(0, 30);
  const temNome = !!(nome && opcoes.alturaDivisao);

  // 1. Cartao em pilula horizontal com o nome do streamer na divisao
  if (temNome) {
    linhas.push.apply(linhas, eventosPilulaStreamer(nome, Math.round(opcoes.alturaDivisao)));
  }

  // 2. Gancho nos primeiros 4 segundos em card arredondado moderno
  const semEmoji = semEmojis(opcoes.gancho);
  if (semEmoji.length >= 3) {
    const duracao = Math.max(2, Math.min(8, opcoes.duracaoGancho || 4));
    const tamGancho = opcoes.tamanhoGancho || 48;
    let cyGancho = 245;
    if (opcoes.posicaoGancho === 'meio') {
      cyGancho = 960;
    } else if (opcoes.alturaDivisao) {
      // No modo split, posiciona o centro do card abaixo da linha divisoria e da pilula com respiro limpo
      cyGancho = Math.min(1280, Math.round(opcoes.alturaDivisao + (temNome ? 134 : 98)));
    } else if (opcoes.margemGancho) {
      cyGancho = Math.max(190, Math.round(opcoes.margemGancho + 65));
    }
    linhas.push.apply(linhas, eventosGanchoCard(semEmoji, duracao, cyGancho, tamGancho));
  }

  // 3. Texto fixo opcional
  const fixo = linhaFixo(opcoes.textoFixo);
  if (fixo) linhas.push(fixo);

  // 4. Legenda palavra por palavra 100% travada na mesma coordenada (zero pulo!)
  const yLegenda = Math.max(240, Math.min(1760, 1920 - margemBaixo));
  const doClipe = (palavras || []).filter((p) => p && Number(p.fim) - offset > 0.05);
  const maxCharsLinha = Math.max(14, Math.round((MAX_CHARS_BLOCO * 74) / tamLegenda));
  const blocos = opcoes.incluirPalavras !== false ? montarBlocos(doClipe, PALAVRAS_POR_BLOCO, maxCharsLinha) : [];

  // Monta eventos estritamente sem sobreposicao de centesimos pra nunca empilhar duas legendas
  const eventosBrutos = [];
  for (let b = 0; b < blocos.length; b++) {
    const bloco = blocos[b];
    const proxBlocoIniCs = blocos[b + 1] ? Math.max(0, Math.round((blocos[b + 1][0].inicio - offset) * 100)) : Infinity;
    for (let i = 0; i < bloco.length; i++) {
      const atual = bloco[i];
      const iniCs = Math.max(0, Math.round((atual.inicio - offset) * 100));
      const proxima = bloco[i + 1];
      const desejadoCs = proxima
        ? Math.max(iniCs + 4, Math.round((proxima.inicio - offset) * 100))
        : Math.round((atual.fim - offset + SEGURA_DEPOIS) * 100);
      const tetoCs = proxima ? Math.round((proxima.inicio - offset) * 100) : proxBlocoIniCs;
      const fimCs = Math.min(desejadoCs, isFinite(tetoCs) ? Math.max(iniCs + 2, tetoCs) : desejadoCs);
      if (fimCs <= iniCs) continue;

      const texto = bloco.map((p, j) => {
        const limpo = escapar(p.texto).toUpperCase();
        if (j === i) {
          return '{\\1c' + AMARELO + '}' + limpo + '{\\1c' + BRANCO + '}';
        }
        return limpo;
      }).join(' ');

      eventosBrutos.push({ iniCs, fimCs, texto });
    }
  }

  // Garantia absoluta de nao-sobreposicao entre eventos consecutivos
  for (let idx = 0; idx < eventosBrutos.length; idx++) {
    const ev = eventosBrutos[idx];
    const seg = eventosBrutos[idx + 1];
    const fimSeguro = seg ? Math.min(ev.fimCs, seg.iniCs) : ev.fimCs;
    if (fimSeguro <= ev.iniCs) continue;
    linhas.push(
      'Dialogue: 1,' + tempoAssCs(ev.iniCs) + ',' + tempoAssCs(fimSeguro) + ',Corte,,0,0,0,,{\\an5\\pos(540,' + yLegenda + ')}' + ev.texto
    );
  }

  fs.writeFileSync(destino, linhas.join('\n'), 'utf8');
  return destino;
}

/** Legenda .srt simples, pra quem quiser editar depois no CapCut/Premiere. */
function gerarSrt(palavras, offset, destino) {
  const blocos = montarBlocos((palavras || []).filter((p) => p && Number(p.fim) - offset > 0.05), 8, 999);

  const partes = blocos.map((g, idx) => {
    const ini = Math.max(0, g[0].inicio - offset);
    const seguinte = blocos[idx + 1] ? blocos[idx + 1][0].inicio - offset : Infinity;
    const fim = Math.max(ini + 0.3, Math.min(g[g.length - 1].fim - offset, seguinte));
    return [
      String(idx + 1),
      tempoSrt(ini) + ' --> ' + tempoSrt(fim),
      g.map((p) => p.texto).join(' ').replace(/\s+/g, ' ').trim(),
      '',
    ].join('\n');
  });

  fs.writeFileSync(destino, partes.join('\n'), 'utf8');
  return destino;
}

function tempoSrt(s) {
  const total = Math.round(Math.max(0, Number(s) || 0) * 1000);
  const h = Math.floor(total / 3600000);
  const m = Math.floor((total % 3600000) / 60000);
  const seg = Math.floor((total % 60000) / 1000);
  const ms = total % 1000;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' +
         String(seg).padStart(2, '0') + ',' + String(ms).padStart(3, '0');
}

/** Onde fica a linha entre a webcam e o jogo (formato rosto + jogo), em pixels do 1080x1920. */
function alturaDaDivisao(formato, recorte) {
  if (formato !== 'split') return null;
  const fracao = Math.max(0.15, Math.min(0.6, (recorte && recorte.proporcaoTopo) || 0.3));
  return Math.round(1920 * fracao / 2) * 2;
}

function margemGanchoIdeal(formato, recorte, textoFixo) {
  if (formato === 'split') {
    const div = alturaDaDivisao(formato, recorte) || 576;
    const temNome = !!(semEmojis(textoFixo && textoFixo.nome));
    return Math.min(1260, div + (temNome ? 118 : 92));
  }
  return 155;
}

module.exports = {
  gerarAss, gerarSrt, alturaDaDivisao, margemGanchoIdeal, FONTES_LEGENDA, resolverFonte, semEmojis,
  temTextoFixo: (t) => !!(semEmojis(t && t.texto) || semEmojis(t && t.nome)),
};
