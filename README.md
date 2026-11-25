<p align="center">
  <img src="docs/mega-cortes-hd-banner.jpg" alt="Mega Cortes HD — Cortes 9:16 com IA · GPU CUDA · Croma Studio" width="100%" />
</p>

<p align="center">
  <a href="https://github.com/gabrielworkspace/cortador-automatico"><img src="https://img.shields.io/badge/compat%C3%ADvel%20com-cortador--automatico%20v2.0.8-22c55e?style=flat-square" alt="Compatível com cortador-automatico v2.0.8" /></a>
  <a href="docs/testes-base-original.test.js"><img src="https://img.shields.io/badge/base%20original-100%25%20compat%C3%ADvel-3b82f6?style=flat-square" alt="Base original 100% compatível" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/licen%C3%A7a-MIT-a855f7?style=flat-square" alt="Licença MIT" /></a>
</p>

# Mega Cortes HD

**Fork independente mantido por [PixelDust64](https://github.com/PixelDust64)** · [Baixar Releases](https://github.com/PixelDust64/cortador-automatico/releases)

> **Política de compatibilidade e créditos:** o **Mega Cortes HD** é uma **versão independente da comunidade**, derivada do código aberto (licença [MIT](LICENSE)) do projeto original criado por **Gabriel Workspace** ([gabrielworkspace/cortador-automatico](https://github.com/gabrielworkspace/cortador-automatico) · [@gabriel.workspace](https://www.instagram.com/gabriel.workspace/)).
> - **Compromisso de compatibilidade:** esta branch tem a obrigação de se manter **100% compatível** com a versão original do `cortador-automatico` (projetos, pastas, formatos e funcionalidades base, validados por [docs/testes-base-original.test.js](docs/testes-base-original.test.js)), podendo incluir novas funcionalidades exclusivas sem quebrar a aplicação original.
> - **Independência:** este fork **não é oficial** e **não é afiliado, mantido ou endossado por Gabriel Workspace**. Para a versão oficial assinada digitalmente, acesse: [gabrielworkspace.github.io/cortador-automatico](https://gabrielworkspace.github.io/cortador-automatico/).

---

Corta vídeo e live da **Kick, Twitch e YouTube** em clipes verticais (**9:16**) prontos para TikTok, Reels e Shorts — tanto **live gravada (VOD)** quanto **ao vivo agora** — e inclui o **Croma Studio** (thumbnails, banners e vinhetas) e o **Splitter Studio** (estúdio completo de áudio e separação vocal/instrumentos com IA) integrados no mesmo lugar.

Tudo roda localmente no seu PC: nenhuma conta, chave de API ou mensalidade. A internet só é usada para baixar o vídeo (`yt-dlp`), ler o chat público da live (opcional) ou instalar o motor de IA do Splitter Studio sob demanda.

Guia de uso detalhado: [LEIA-ME.txt](LEIA-ME.txt) · Documentação da API HTTP (uso headless / agentes): [docs/API.md](docs/API.md).

## Diferenciais desta versão (Mega Cortes HD)

- **Uso adaptativo de GPU (CUDA + NVENC / AMF / QSV):** detecta em paralelo e de forma independente todos os recursos de hardware disponíveis no seu PC.
  - Acelera a **transcrição (`faster-whisper` / `ctranslate2`)** e a **separação de voz/instrumentos (`demucs`)** via **CUDA**, escolhendo automaticamente o `compute_type` e o build PyTorch compatível com a série da placa (`cu126` para Pascal `sm_61` e RTX 20/30/40, `cu128` para Blackwell RTX 50, ou fallback leve para **CPU**).
  - **FFmpeg fixado na versão `8.0.1`** (NVENC API `13.0`), mantendo compatibilidade com drivers NVIDIA `570+` / `582.xx` (inclusive série GTX 10xx / Pascal).
  - Nos **Ajustes**, exibe em uma linha direta a GPU detectada e as siglas ativas de transcrição e corte (`CUDA`/`CPU` e `NVENC`/`AMF`/`QSV`/`CPU`).
- **Croma Studio integrado (aba própria na barra superior):** crie thumbnails, banners, marcas d'água, QR Codes e salve até 10 gradientes e 10 thumbs favoritas (incluindo **`★ Final padrão`** e até 2 vinhetas com silêncio ou jingle nos cortes).
- **Splitter Studio integrado (aba própria na barra superior):** estúdio completo de manipulação de áudio com **8 ferramentas**, reaproveitamento automático da pasta `baixados/` (sem baixar o mesmo link duas vezes) e instalação adaptativa de IA (GPU CUDA ou CPU).
- **Fila lateral ao vivo:** acompanhe o progresso de múltiplos vídeos, reordene trabalhos pendentes ou cancele cortes em andamento sem sair da tela principal.
- **Diretor IA opcional (BeaverNet gratuito + Gemini / OpenAI / Claude):** além do **Motor Local** 100% offline e ilimitado, você pode ativar o Diretor IA nos Ajustes para analisar a transcrição inteira e gerar títulos e ganchos ainda mais precisos.

## Diretor IA Gratuito com BeaverNet (BeaverAI)

O **Mega Cortes HD** traz integração nativa com o **[BeaverNet](https://net.beaverai.org)** (`https://net.beaverai.org/v1`) — um **pool comunitário de computação LLM** onde colaboradores com GPUs disponíveis compartilham modelos de IA abertos através de uma única API compatível com OpenAI ([documentação oficial](https://net.beaverai.org/docs/platform/overview) · [modelos online](https://net.beaverai.org/models)).

- **100% gratuito e sem cadastro tradicional (sem e-mail, sem senha e sem cartão):** o BeaverNet já funciona sem chave de API (usando modelos abertos com limites comunitários). Para liberar limites maiores de texto e todos os modelos online, qualquer pessoa pode gerar uma chave gratuita (`bn-...`) em segundos em [net.beaverai.org/account](https://net.beaverai.org/account) — o site pede apenas um apelido e uma verificação anti-robô, sem e-mail, sem senha e sem dados de pagamento.
- **Filtro inteligente de modelos + fallback automático:** consulta `/v1/models` para ler os limites reais de contexto/saída de cada modelo (filtrando modelos anônimos quando sem chave e liberando todos os modelos online estáveis quando com chave `bn-...`). Nos **Ajustes**, você pode escolher manualmente qualquer modelo ou deixar no modo automático: `MeroMero 26B` → `Nemotron 3.5` → `Gemma-4 4B` → `Qwen3.5 0.8B` → melhores modelos online (`>= 16k` contexto) → `beaverlite`.
- **Outras APIs opcionais:** também aceita sua própria chave de API do **Google Gemini**, **OpenAI (ChatGPT)** ou **Anthropic (Claude)** — tudo chamado direto do seu computador, sem intermediários.

## Splitter Studio — Estúdio de Áudio e IA Integrado

O **Splitter Studio** funciona tanto integrado ao topo do **Mega Cortes HD** quanto de forma independente na pasta [splitter-studio/](splitter-studio/), reunindo **8 ferramentas de áudio** que aceitam **arquivo local**, **link da web (YouTube, Twitch, Kick, SoundCloud)** ou **vídeos já baixados na biblioteca do Mega Cortes (`baixados/`)**:

1. **Removedor Vocal e Isolamento:** separa **Música (Instrumental)** e **Voz** com IA neural (**Demucs**) ou modo rápido (**FFmpeg**), com player sincronizado, waveforms coloridas, volume independente por faixa e exportação em MP3/WAV.
2. **Splitter de Instrumentos (Stems):** separa a música em **4 faixas** (*Voz, Bateria, Baixo, Outros*) ou **6 faixas** (*+ Guitarra e Piano*), permitindo ajustar o volume de cada instrumento e baixar o mix personalizado.
3. **Mudar Tom e Velocidade:** altera semitons (`-12` a `+12`) e andamento (`0.5x` a `2.0x`) de forma independente via **FFmpeg Rubberband**.
4. **Detector de BPM e Tom:** identifica batidas por minuto (**BPM**), tonalidade musical (ex.: `A menor`), código **Camelot** para DJs (ex.: `8A`) e volume médio (`dB`).
5. **Cortador de Áudio:** seleção interativa na waveform com **Fade In / Fade Out** e modo **Manter seleção** ou **Remover o meio**.
6. **Juntar Faixas:** concatena múltiplos áudios ou vídeos baixados com reordenação e **crossfade** opcional (`0` a `5s`).
7. **Gravador de Microfone:** gravação direta no navegador com visualizador em tempo real e exportação em MP3/WAV.
8. **Modo Karaoke:** toca a base instrumental (vinda do Removedor ou da biblioteca) enquanto grava sua voz em sincronia e mixa tudo com efeito reverb/eco leve opcional.

> **IA adaptativa por GPU (`py/splitter_audio.py`):** detecta automaticamente a Compute Capability da GPU NVIDIA e seleciona o índice do PyTorch compatível (Pascal 6.x / Turing / Ampere / Ada → `cu126`; Blackwell 10.x/12.x → `cu128` ou superior) ou instala o PyTorch sem CUDA para CPU, com fallback automático para CPU em caso de falha na detecção ou execução CUDA — mantendo o instalador leve (`~765 MB`).

## Croma Studio — Thumbnails, banners, favoritos e vinhetas

Além de gerar os cortes verticais, o **Mega Cortes HD** traz o **Croma Studio** embutido no topo do programa para agilizar a identidade visual do seu canal sem precisar abrir editores pesados:

- **Thumbnails e presets prontos** para YouTube (`2048×1152`), Shorts/Reels (`1080×1920`), TikTok (`1080×1440`), Instagram (`4:5` e `1:1`), **Banners (`2560×1440`)** e **Marcas d'água (`150×150`)**.
- **Favoritos e `★ Final padrão`:** salve até 10 gradientes e 10 thumbs favoritas (ou importe uma imagem pronta) para aplicar como tela final padrão em todos os cortes ou como até **2 vinhetas** por clipe no Editor de Cortes (com silêncio ou áudio/jingle MP3/MP4).
- **QR Code, fotos de fundo e fractais:** gere QR Codes arrastáveis/redimensionáveis direto sobre a arte, importe fotos de fundo e use fundos em gradiente ou fractais 100% offline.

## Dois modos de corte

**Vídeo gravado** — baixa o VOD (ou usa um arquivo local), transcreve com Whisper local (GPU CUDA ou CPU), identifica os melhores trechos, corta em 9:16 com gancho e legenda e dá nota a cada clipe. Projetos ficam editáveis para ajustar começo/fim, reescrever o gancho ou extrair mais cortes.

**Ao vivo agora** — feito para postar primeiro:

1. **Gravação contínua**: o `yt-dlp` localiza a transmissão e o `ffmpeg` grava em pedaços de 4 s sem recodificar (descartando anúncios na Twitch), mantendo buffer dos últimos 20 minutos.
2. **Detecção leve**: taxa de mensagens do chat (Twitch IRC anônimo / Kick) e pico de volume comparados com a mediana recente.
3. **Conectar → configurar → Começar a clipar**: com prévia do enquadramento em tempo real; **CLIPAR AGORA** (tecla `C`) corta os últimos N segundos.
4. **Render rápido** (`x264 veryfast` ou GPU) direto dos pedaços, seguido de transcrição do clipe para sugerir título e hashtags.

## Texto fixo na tela

Nos dois modos dá para adicionar um texto fixo em todo clipe (topo, meio ou baixo; clipe inteiro ou só os 5 primeiros segundos; branco ou amarelo), usando `/` para quebrar linha e com visualização na prévia.

## Rodar a partir do código

```bash
iniciar.bat            # Windows: abre a janela do programa
node src/server.js     # ou direto (porta 4321)
```

Requer Node 22+, `ffmpeg`, `yt-dlp` e Python com `faster-whisper` (`instalar.bat` configura tudo). Sem `DADOS` definido, os arquivos vão para `D:\CortadorAutomatico` quando o disco `D:` existe.

## Código

| Arquivo | O que faz |
|---|---|
| `src/server.js` | servidor local, fila lateral, rotas `/api/*`, `/croma/` e `/splitter/` |
| `src/splitter.js` | backend do Splitter Studio e cache compartilhado com `baixados/` |
| `src/desempenho.js` | modos leve/total e detecção paralela de GPU (NVENC/AMF/QSV e CUDA) |
| `src/aovivo.js` | gravação da live, chat, detecção, corte e título dos clipes ao vivo |
| `src/pipeline.js` | vídeo gravado: transcrição → escolha → clipes |
| `src/score.js` / `src/copy.js` | pontuação dos trechos, títulos e hashtags |
| `src/media.js` | integração com o `ffmpeg` (cortes, sincronia e vinhetas) |
| `src/baixar.js` | download por link (`yt-dlp`) |
| `src/sessoes.js` | perfil de corte |
| `src/ui/index.html` | interface principal (com abas do Croma Studio e Splitter Studio) |
| `croma-studio/` / `src/ui/croma/` | Croma Studio: thumbnails, banners, favoritos, QR Code e materiais para canais |
| `splitter-studio/` / `src/ui/splitter/` | Splitter Studio: 8 ferramentas de áudio (versão standalone e integrada) |
| `py/transcrever.py` | transcrição com `faster-whisper` (CUDA automático + fallback CPU) |
| `py/splitter_audio.py` | motor Python do Splitter Studio (detecção de GPU, Demucs e Tom/BPM) |

## Instalador e builds

Os instaladores desta versão independente são publicados em [Releases deste repositório](https://github.com/PixelDust64/cortador-automatico/releases) e trazem Node, Python com `faster-whisper`, `ffmpeg 8.0.1`, `yt-dlp` e os modelos de fala embutidos. Para montar localmente no Windows: `node instalador/montar.js`.

> **Nota sobre assinatura de código:** as builds publicadas neste fork são **compilações independentes da comunidade** e **não** são assinadas por Gabriel Workspace nem pela SignPath Foundation.

## Privacidade e Segurança

O programa não envia dados para terceiros, exceto quando você solicita baixar um vídeo/live pelo link, ler o chat público da live (opcional), atualizar o `yt-dlp` ou instalar o motor de IA do Splitter Studio sob demanda. Todos os vídeos, transcrições, artes e cortes ficam apenas no seu computador.

> **Aviso de segurança (uso local / monousuário):** esta aplicação foi projetada para uso **monousuário** e **não possui medidas avançadas de segurança** (como controle de acesso multiusuário, isolamento de permissões ou proteção contra exposição pública), devido ao seu foco exclusivo em execução com recursos locais. Aconselha-se utilizar o programa **apenas na própria máquina ou em uma rede local privada confiável**, evitando expor a porta diretamente para a internet pública.

## Créditos, Agradecimentos e Licença

- **Projeto original e autor base:** **Gabriel Workspace** ([github.com/gabrielworkspace/cortador-automatico](https://github.com/gabrielworkspace/cortador-automatico) · Instagram [@gabriel.workspace](https://www.instagram.com/gabriel.workspace/)).
- **Agradecimentos à comunidade BeaverNet / BeaverAI:** agradecemos ao **[BeaverNet](https://net.beaverai.org)** e a todos os provedores comunitários (como *Linkpharm*, *serranoprime1*, *Meus Artis* e demais colaboradores) que disponibilizam modelos abertos gratuitamente para a comunidade através da API aberta ([docs](https://net.beaverai.org/docs/platform/overview)).
- **Licença do código:** [MIT](LICENSE) — mantendo integralmente o aviso de copyright original. O instalador inclui ferramentas de terceiros sob suas respectivas licenças (`Node.js`, `Python`, `faster-whisper`, `ffmpeg` e `yt-dlp`).
- **Marca:** em conformidade com [MARCA.md](MARCA.md), o nome *"Cortador Automático"*, o nome *"Gabriel Workspace"* e o logo original não pertencem a este fork; esta versão independente utiliza nome próprio (**Mega Cortes HD**) e identidade visual própria.
