# API HTTP — Mega Cortes HD (Uso Headless & Agentes Automatizados)

O **Mega Cortes HD** expõe uma API HTTP/JSON + SSE completa em `http://127.0.0.1:4321` (ou na rede local com `REDE=1`), permitindo que **agentes de IA, scripts, pipelines CI/CD, n8n ou integrações headless** operem todas as funções do programa sem precisar abrir o navegador.

---

## 1. Execução Headless e Variáveis de Ambiente

Inicie apenas o servidor Node.js (sem abrir janela):

```powershell
node src/server.js
```

| Variável | Padrão | Descrição |
|---|---|---|
| `PORTA` ou `PORT` | `4321` | Porta HTTP do servidor |
| `REDE` | *(vazio)* | Defina `REDE=1` (ou `HOST=0.0.0.0`) para escutar na rede local |
| `DADOS` | `D:\CortadorAutomatico` | Pasta raiz onde ficam `baixados/`, `saida/`, `trabalho/` e `ao-vivo/` |
| `AUTH_SENHA` | *(vazio)* | Ativa autenticação obrigatória via cookie `sessao` em todas as rotas `/api/*` |
| `USAR_GPU` | automático | Controle de aceleração GPU/CUDA na transcrição |

---

## 2. Autenticação (quando `AUTH_SENHA` está definida)

### `POST /api/login`
- **Content-Type:** `application/x-www-form-urlencoded`
- **Corpo:** `senha=<SUA_SENHA>`
- **Resposta:** `302 Found` com cabeçalho `Set-Cookie: sessao=<token>; HttpOnly; Path=/; Max-Age=2592000` (ou `401`).
- Envie o cookie `Cookie: sessao=<token>` nas requisições seguintes (ex.: `curl -c cookies.txt` / `curl -b cookies.txt`).

---

## 3. Sistema, Hardware e Armazenamento

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/api/rede` | Retorna `{ naRede, temDialogoNativo, porta, enderecos }` |
| `GET` | `/api/desempenho` | Retorna info de CPU, RAM, modo (`leve`/`total`) e GPU detectada (`CUDA`, `NVENC`/`AMF`/`QSV`) |
| `POST` | `/api/desempenho` | Altera modo de desempenho: `{ "modo": "leve" \| "total" }` |
| `GET` | `/api/armazenamento` | Retorna pasta atual de dados, discos disponíveis e espaço livre |
| `POST` | `/api/armazenamento` | Muda a pasta de dados: `{ "pasta": "E:\\Cortes" }` (ou `null` para padrão) |
| `GET` | `/api/sessoes` | Lista os perfis/sessões de corte disponíveis |
| `GET` | `/api/saida` | Retorna o caminho da pasta de saída (`saida/`) |

---

## 4. Download, Upload e Inspeção de Vídeos

| Método | Rota | Corpo / Query | Descrição |
|---|---|---|---|
| `POST` | `/api/espiar` | `{ "url": "https://..." }` | Consulta metadados do link (título, duração, ao vivo) sem baixar |
| `POST` | `/api/baixar` | `{ "url": "https://...", "limiteAltura": 1080 }` | Inicia download via `yt-dlp` para `baixados/`. Retorna `{ id }` (acompanhe via SSE `/api/eventos?id=...`) |
| `POST` | `/api/upload?nome=video.mp4` | Binário + query `?nome=...` | Envia arquivo de vídeo local para processamento |
| `POST` | `/api/info` | `{ "video": "..." }` | Retorna metadados (`ffprobe`) do vídeo (duração, largura, altura, FPS) |
| `POST` | `/api/achar-webcam` | `{ "video": "...", "duracao": 120 }` | Detecta automaticamente região da webcam no vídeo |
| `POST` | `/api/frame` | `{ "video": "...", "segundo": 10, "sid": "local" }` | Extrai frame JPEG no instante especificado |
| `POST` | `/api/previa` | `{ "video": "...", "formato": "split", ... }` | Gera imagem de prévia do enquadramento 9:16 |

---

## 5. Fila de Processamento, Cortes e Eventos (SSE)

Todas as operações pesadas de vídeo entram na **fila sequencial** (`filaTrabalhos`), executando 1 trabalho por vez sem travar a máquina.

| Método | Rota | Corpo / Query | Descrição |
|---|---|---|---|
| `POST` | `/api/processar` | `{ "video": "<caminho>", "titulo": "...", "formato": "split", "quantidade": 8, ... }` | Enfileira transcrição + seleção de momentos + renderização de clipes. Retorna `{ id, naFila: true }` |
| `POST` | `/api/refazer` | `{ "arquivo": "<clipe.mp4>", "numero": 1, "inicio": 12.5, "duracao": 35, "gancho": "TEXTO", "legendar": true, "vinhetas": [...] }` | Refaz 1 clipe reaproveitando a transcrição (aceita até 2 vinhetas do Croma Studio). Retorna `{ id, naFila: true }` |
| `POST` | `/api/projeto/mais` | `{ "pasta": "<pasta_projeto>", ... }` | Extrai novos clipes de um projeto já transcrito sem baixar novamente |
| `GET` | `/api/eventos?id=<id>` | Query `id` | **Server-Sent Events (SSE):** stream em tempo real de `{ tipo: "progresso" \| "fim" \| "erro", pct, etapa, msg, pasta }` |
| `GET` | `/api/fila` | — | Estado atual da fila: `{ ativo, itens: [{ id, tipo, titulo, status, pct, etapa, msg, pasta }] }` |
| `POST` | `/api/fila/mover` | `{ "id": "...", "direcao": "subir" \| "descer" }` | Move trabalho `aguardando` para cima (`"subir"`) ou para baixo (`"descer"`) na fila |
| `POST` | `/api/fila/cancelar` | `{ "id": "..." }` | Cancela um trabalho na fila ou encerra o processo em execução |
| `POST` | `/api/fila/limpar` | — | Remove itens já concluídos/cancelados/com erro da lista da fila |
| `GET` | `/api/atual` | — | Retorna o ID do último trabalho ativo |

---

## 6. Projetos e Streaming de Arquivos

| Método | Rota | Query | Descrição |
|---|---|---|---|
| `GET` | `/api/projetos` | `?sessao=cortes` (opcional) | Lista todos os projetos já gerados em `saida/` |
| `GET` | `/api/projeto` | `?pasta=<caminho>` | Abre detalhes completos de um projeto (clipes, notas, caminhos, sessão) |
| `GET` | `/api/video` | `?pasta=...` ou `?caminho=...` ou `?clipe=...` | Stream de vídeo com suporte a `Range` (`206 Partial Content`) |
| `GET` | `/api/quadro` | `?pasta=...&t=12.5` | Frame JPEG sob demanda do vídeo de um projeto |
| `GET` | `/api/palavras` | `?pasta=...` | Retorna transcrição palavra por palavra com timestamps |
| `GET` | `/arquivo` | `?p=<arquivo_em_saida>` | Baixa/serve um clipe ou miniatura dentro de `saida/` |
| `DELETE` | `/api/projeto` | `?pasta=<caminho>` | Apaga uma pasta de projeto dentro de `saida/` |

---

## 7. Modo Ao Vivo (Live Clipping)

| Método | Rota | Corpo | Descrição |
|---|---|---|---|
| `POST` | `/api/aovivo/iniciar` | `{ "url": "https://...", ... }` | Inicia gravação contínua (buffer 20 min) e monitoramento de chat/áudio |
| `POST` | `/api/aovivo/parar` | — | Encerra a gravação da live |
| `POST` | `/api/aovivo/clipar` | `{ "segundos": 30 }` | Gera um clipe imediato dos últimos `N` segundos |
| `POST` | `/api/aovivo/ajustar` | `{ ... }` | Atualiza configurações de enquadramento/detecção em tempo real |
| `GET` | `/api/aovivo/estado` | — | Estado atual da live conectada e clipes gerados |
| `GET` | `/api/aovivo/quadro` | — | Frame atual da transmissão ao vivo |
| `POST` | `/api/aovivo/previa` | `{ ... }` | Prévia do enquadramento 9:16 sobre a live |
| `GET` | `/api/aovivo/eventos` | — | Stream **SSE** de eventos da live (picos, chat, clipes prontos) |

---

## 8. Croma Studio (Favoritos e Tela Final Padrão)

| Método | Rota | Corpo / Query | Descrição |
|---|---|---|---|
| `GET` | `/api/croma/favoritos` | — | Lista gradientes favoritos (até 10), thumbs favoritas (até 10) e `finalPadrao` |
| `POST` | `/api/croma/favoritos` | `{ "tipo": "thumb" \| "gradiente", "nome": "...", "pngBase64": "data:image/png;base64,...", "dados": {...} }` | Salva novo favorito |
| `DELETE` | `/api/croma/favoritos` | `?tipo=thumb&id=<id>` | Remove um favorito |
| `POST` | `/api/croma/final-padrao` | `{ "thumbId": "<id>" \| null, "duracao": 2.5, "audio": "<caminho>" \| null }` | Define (ou desativa com `thumbId: null`) a tela final padrão em todos os novos cortes |
| `GET` | `/api/croma/favoritos/img/:arquivo.png` | — | Retorna a imagem PNG de uma thumb favorita |

---

## 9. Splitter Studio (Áudio, Separação Vocal/Stems IA, BPM/Tom)

Todos os endpoints do **Splitter Studio** ficam sob `/api/splitter/*` e reaproveitam automaticamente a pasta `baixados/` do Mega Cortes HD.

| Método | Rota | Corpo / Query | Descrição |
|---|---|---|---|
| `GET` | `/api/splitter/status` | — | Status de FFmpeg, yt-dlp, Python, Demucs, CUDA e hardware GPU detectado (`perfil`: `pascal-cu126`, `rtx-cu126`, `blackwell-cu128`, `cpu`) |
| `POST` | `/api/splitter/instalar-ia` | — | Inicia job assíncrono que instala Demucs + PyTorch compatível com a série da GPU (ou CPU). Retorna `{ jobId }` |
| `GET` | `/api/splitter/biblioteca` | — | Lista todos os vídeos/áudios já existentes em `baixados/` |
| `POST` | `/api/splitter/carregar-existente` | `{ "arquivo": "Video [ID].mp4" }` | Carrega um vídeo de `baixados/` com cache WAV. Retorna objeto `midia` (`id`, `url`, `downloadUrl`, `duracao`, `peaks`) |
| `POST` | `/api/splitter/upload` | Binário + header `X-File-Name` | Faz upload de áudio/vídeo local e extrai WAV stereo 44.1 kHz |
| `POST` | `/api/splitter/baixar-link` | `{ "url": "https://..." }` | Reaproveita de `baixados/` se o vídeo já existir (`reaproveitado: true`); senão baixa para `baixados/` |
| `POST` | `/api/splitter/remover-voz` | `{ "mediaId": "...", "motor": "ia" \| "ffmpeg" }` | Inicia separação em 2 faixas (`no_vocals` + `vocals`). Retorna `{ jobId }` |
| `POST` | `/api/splitter/separar` | `{ "mediaId": "...", "modo": "stems4" \| "stems6", "motor": "ia" \| "ffmpeg" }` | Inicia separação em 4 ou 6 instrumentos. Retorna `{ jobId }` |
| `GET` | `/api/splitter/job/:jobId` | — | Consulta progresso de separação ou instalação de IA (`status`: `rodando` \| `concluido` \| `erro`, `progresso`, `etapa`, `resultado`) |
| `POST` | `/api/splitter/mudar-tom` | `{ "mediaId": "...", "semitons": 2, "velocidade": 1.1 }` | Altera tom (`-12..+12`) e velocidade (`0.5..2.0`) via FFmpeg Rubberband |
| `POST` | `/api/splitter/tom-bpm` | `{ "mediaId": "..." }` | Retorna `{ bpm, bpmConfianca, tom, nota, escala, camelot, tomConfianca, loudnessDb, duracao }` |
| `POST` | `/api/splitter/cortar` | `{ "mediaId": "...", "inicio": 10, "fim": 45, "fadeIn": 1, "fadeOut": 1, "inverter": false }` | Corta o trecho selecionado (ou remove o meio se `inverter: true`) |
| `POST` | `/api/splitter/juntar` | `{ "mediaIds": ["id1", "id2"], "crossfade": 1.5 }` | Concatena múltiplas faixas com crossfade opcional (`0..5s`) |
| `POST` | `/api/splitter/mixar` | `{ "nome": "mix", "faixas": [{ "mediaId": "...", "volume": 0.9, "atrasoMs": 0, "eco": false }] }` | Mixa múltiplas pistas (usado no Removedor, Splitter e Karaoke) |
| `GET` | `/api/splitter/audio/:id` | — | Stream de áudio com suporte a `Range` |
| `GET` | `/api/splitter/download/:id` | `?formato=mp3\|wav` | Download do áudio em MP3 (256 kbps) ou WAV (cabeçalho RFC 5987 UTF-8) |

---

## 10. Exemplos de Automação Headless

### Exemplo A — Separar voz e baixar o instrumental em MP3 (PowerShell / curl)

```powershell
$base = "http://127.0.0.1:4321/api/splitter"

# 1. Carrega link (reaproveita de baixados/ se ja existir)
$midia = Invoke-RestMethod -Method Post "$base/baixar-link" -ContentType "application/json" `
  -Body '{"url":"https://www.youtube.com/watch?v=SEU_VIDEO"}'

# 2. Dispara separacao vocal via IA Demucs (auto CUDA/CPU)
$job = Invoke-RestMethod -Method Post "$base/remover-voz" -ContentType "application/json" `
  -Body (@{ mediaId = $midia.id; motor = "ia" } | ConvertTo-Json)

# 3. Aguarda conclusao
do {
  Start-Sleep -Seconds 2
  $st = Invoke-RestMethod "$base/job/$($job.jobId)"
  Write-Host "$($st.progresso)% - $($st.etapa)"
} while ($st.status -eq "rodando")

# 4. Baixa a faixa instrumental em MP3
$inst = $st.resultado.faixas | Where-Object { $_.stemKey -eq "no_vocals" }
Invoke-WebRequest "http://127.0.0.1:4321$($inst.downloadUrl)?formato=mp3" -OutFile "instrumental.mp3"
```

### Exemplo B — Consultar fila e listar projetos via `curl`

```bash
# Ver fila em execucao
curl -s http://127.0.0.1:4321/api/fila

# Listar projetos ja cortados
curl -s http://127.0.0.1:4321/api/projetos

# Checar hardware GPU/CUDA detectado
curl -s http://127.0.0.1:4321/api/desempenho
```
