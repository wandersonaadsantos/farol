# Farol nativo no Mac, no Windows e na web: estratégia

Data: 27/10/2026 (revisão 2, sem PWA). Base: v2.78.7 (commit 226b685e). Estudo, sem implementação.

## 1. A decisão e o motivo

O time quer o Farol mais leve e mais rápido. A causa é a stack de entrega: o
Electron embute um Chromium inteiro só para desenhar uma tela que já é HTML e
JavaScript puro, e esse custo é fixo, pago mesmo com o app na bandeja. A
decisão é ter o Farol como produto único, com aplicação INSTALADA DE FORMA
NATIVA no Mac e no Windows (bandeja, autostart, badge, notificação e instância
única do SO, tudo o que o `main.js` faz hoje) e como aplicação web, trocando o
que for preciso da stack. PWA foi descartada pelo time.

## 2. O que o código já é hoje (medido)

O Farol já é, por construção, um servidor web com uma tela de navegador na
frente. O Electron é uma casca fina.

| peça | tamanho | depende do Electron? |
|---|---|---|
| `server.js` + `lib/` (motor, HTTP, SSE, ~27 rotas) | 2254 linhas + lib | não; `electron` aparece em 5 arquivos de `lib/`, todos sobre update e versão do runtime |
| `ui/` (vanilla JS, módulos ES, sem framework, sem bundler) | 1,7 MB | não; sem preload, sem `ipcRenderer`; o shell faz `win.loadURL('http://127.0.0.1:<porta>')` com `nodeIntegration: false` |
| `main.js` (shell Electron) | 337 linhas | sim: janela, bandeja, badge no Dock, notificação nativa, autostart, instância única |
| modo servidor (`node server.js` sem Electron) | desde 15/10/2026 | roda no Termux e numa hospedagem, com update próprio e login do Claude pela tela |
| autenticação da API local (A4) | ligada no celular, opt-in no desktop | token de pareamento; é o que permite expor a tela fora do loopback |
| assinatura de código | só ad-hoc (`codesign --sign -`) no Mac; nada no Windows | a distribuição notarizada "é outro processo" (comentário em `installer/native-bundle-mac.sh`) |

### Custo medido nesta máquina (Apple Silicon, arm64 nativo, instância isolada sem contas)

| modo | processos | RSS somado | memória física (top) |
|---|---|---|---|
| `node server.js` (modo servidor) | 1 | 86 MB | ~86 MB |
| Electron (`electron .`) | 5 (shell, GPU, utility, renderer, node) | 398 MB | ~230 MB |

O Electron custa de 2,7x a 4,6x o motor sozinho, parado. Dos 398 MB, 86 são o
motor (não mudam com a troca de casca) e o resto é Chromium. A instalação
local deste Mac está na v2.47.0 contra v2.78.7 no repositório. Windows não
medido; a conta é a mesma (Chromium embutido mais motor).

## 3. As cascas nativas possíveis

Todas reutilizam a `ui/` e o motor como estão. A diferença é quem desenha a
janela e em que linguagem a casca é escrita.

| opção | casca (RSS típico) | motor | nativo do SO | custo |
|---|---|---|---|---|
| A. Electron (hoje) | Chromium embutido, ~230 a 310 MB | Node embutido no Electron | tudo | zero |
| B. **Tauri 2** (Rust) | WebView do SO: WKWebView no Mac, WebView2 no Windows, ~20 a 60 MB | Node como sidecar, 86 MB | tudo: bandeja, autostart, badge no Dock e overlay na barra de tarefas, notificação, instância única, updater assinado, deep link | médio: toolchain Rust no build, assinatura por SO, duas linguagens no repositório |
| C. Wails v3 (Go) | mesmo WebView do SO, ~20 a 60 MB | Node como sidecar | bandeja, notificação, autostart; badge e updater menos maduros | médio, ecossistema menor que o do Tauri |
| D. Nativo puro (SwiftUI + WinUI 3) | ~15 a 40 MB cada | Node como sidecar | tudo, com fidelidade máxima | alto: duas cascas, duas linguagens, dois pipelines; a tela continua sendo a `ui/` num WebView, então o ganho sobre B é só estético |
| E. Reescrever o motor fora do Node | ~30 MB | motor novo | tudo | altíssimo: 6415 testes, 150+ módulos, o motor orquestra `claude`, `gh` e três provedores por processo filho; nada disso melhora com a troca de linguagem |

Os RSS de B, C e D são ordens de grandeza conhecidas, não medidas aqui.

**Escolha: B, Tauri 2.** É a única que entrega tudo o que o `main.js` faz,
com updater assinado e empacotador por SO embutidos (`.dmg`, `.app`, `.msi`,
`.exe` NSIS), com a maior comunidade entre as cascas em WebView e com a tela
servida pelo motor, exatamente como hoje. Memória esperada do Farol inteiro
parado: de 398 MB para algo entre 110 e 150 MB, a confirmar no protótipo.
D fica como opção futura se um dia a tela for reescrita em componentes nativos.
C é alternativa se o time preferir Go a Rust; o desenho abaixo vale igual.

## 4. Arquitetura alvo

```
Farol.app / Farol.exe (Tauri, Rust, ~5 MB)
  ├─ janela: WebView do SO apontando para http://127.0.0.1:<porta>?token=…
  ├─ bandeja, badge, notificação, autostart, instância única, updater
  └─ sidecar: node + server.js (o motor de hoje, intocado)
        └─ HTTP + SSE em 127.0.0.1:<porta>, A4 exigido pela casca
```

- **A casca é dona do motor**, como hoje: sobe o sidecar no início, derruba
  no fim, religa se morrer. A tela nunca sabe que mudou de casca.
- **Ponte casca x tela**: o que hoje é `engine.on('new-prs')` dentro do
  processo do Electron vira a casca lendo o MESMO SSE (`/api/events`) que a
  tela lê. Sem IPC novo, sem API nova no motor; a casca é só mais um cliente
  autenticado.
- **Node sidecar**: o binário oficial do Node 24 (arm64 e x64 no Mac, x64 no
  Windows, ~120 MB em disco) viaja dentro do bundle, como o Electron já viaja
  hoje. Fica como alternativa a estudar o Node SEA (executável único), que
  exige bundle CommonJS e o projeto é ESM; não é pré-requisito.
- **A UI não ganha dependência**: o Tauri injeta `window.__TAURI__` sem
  bundler; a UI continua sem framework e os testes de `ui/pure/` não mudam.
- **WebKit vira alvo**: no Mac a tela roda no motor do Safari, não no
  Chromium. A `ui/` é vanilla e sem polyfill; o protótipo precisa de uma
  passada de compatibilidade (CSS, `EventSource`, `Notification`, `localStorage`
  por origem de porta).

## 5. Fases

### Fase 0: parar de sangrar (dias)

Todo o time na versão atual e na arquitetura certa (arm64 nos Macs Apple
Silicon). Expor o consumo de memória por processo em Sistema para medir antes
e depois.

### Fase 1: protótipo Tauri (1 semana, descartável)

Casca mínima: janela, bandeja, sidecar do motor, A4 ligado. Medir RSS lado a
lado com o Electron no Mac e no Windows, com as contas reais do time, e passar
a `ui/` no WKWebView. Critério de seguir: memória do app inteiro abaixo de
150 MB parado e nenhuma tela quebrada no WebKit.

### Fase 2: paridade com o `main.js` (2 a 3 semanas)

Badge (Dock e overlay na barra de tarefas), notificações com clique que abre o
PR, autostart, instância única, menu da bandeja, abrir Terminal para a sessão
interativa (já é o motor quem abre). O `main.js` vira a referência de
comportamento e some no fim.

### Fase 3: empacotamento, assinatura e update (2 semanas)

- Mac: Developer ID + notarização (hoje a assinatura é ad-hoc; sem isso o
  Gatekeeper barra em máquinas de terceiros). `.dmg` universal ou um por
  arquitetura.
- Windows: certificado de assinatura (ou EV para evitar o SmartScreen) e
  `.exe` NSIS, que é o formato que `tools/make-installer.ps1` já gera.
- Update: o updater do Tauri com manifesto assinado substitui o caminho
  "pacote completo" de `lib/update-installer.js`; o update leve do motor
  (`lib/engine/update-servidor.js`) continua valendo para o sidecar. Release
  publicada no mesmo repositório do GitHub.
- CI: build por SO (o Rust compila na máquina alvo; macOS cruza arm64/x64,
  Windows precisa de runner Windows).

### Fase 4: performance da tela (2 a 3 semanas, paralela às outras)

A troca de casca resolve memória, não a lentidão da tela. Pontos já levantados
em 26/10: o SSE empurra o snapshot inteiro a cada ciclo, a UI re-renderiza
tudo, os estáticos saem sem gzip e com `no-store`. Ganhos sem framework novo:
diff de snapshot por seção, render por seção, gzip e `ETag`, paginação do
histórico no snapshot.

### Fase 5: web (quando houver demanda de rodar fora da máquina)

O modo servidor já é a versão web. O que falta é operação e dois ajustes no
motor: `config.bind` (padrão `127.0.0.1`) com a allowlist de Host de
`lib/http-guard.js` aceitando o host configurado, e A4 exigido sempre que o
bind não for loopback. Na frente, proxy com TLS (Caddy ou Nginx), um processo
por pessoa (cada instância é uma identidade do `gh` e uma assinatura do
Claude, por desenho) e o VPS de 4 vCPU e 8 GB dimensionado em 26/10. A casca
Tauri pode apontar para esse servidor em vez do sidecar local, o que dá "app
nativo com motor remoto" sem código novo na tela.

## 6. O que muda nos invariantes e no repositório

- Invariante 1 ("Electron é a única dependência npm de runtime") é
  substituído por: o motor roda em Node puro sem dependência npm; a casca é
  Rust com as crates do Tauri; nenhum pacote npm novo (o CLI do Tauri instala
  por `cargo`). O Electron sai do `package.json` quando o `main.js` morrer.
- Invariantes 2 (`~/.farol`) e 4 (gates de postagem) não são tocados.
- Invariante 5 (`IS_WIN`/`IS_MAC`): a casca ganha os próprios ramos em Rust;
  os do motor continuam como estão.
- Novo diretório `src-tauri/` (Rust, `tauri.conf.json`, ícones). As quatro
  listas de distribuição travadas em `test/distribuicao-listas.test.js`
  precisam ser revistas na mesma tarefa.
- `lib/electron-runtime.js`, `lib/update-installer.js` e as partes de
  `lib/engine/update.js` que conhecem o Electron saem na fase 3.
- Ferramentas que importam `electron` (`tools/benchmark-ui-native.js`,
  smokes e 2 testes) são portadas ou retiradas.

## 7. Riscos

- **WebKit no Mac**: a tela nunca rodou fora do Chromium. É o risco técnico
  número um e o protótipo existe para medi-lo.
- **WebView2 no Windows**: vem com o Windows 10 e 11 atualizados; o
  instalador do Tauri sabe baixar o runtime quando falta. Em máquinas
  bloqueadas por política isso pode exigir aprovação de TI.
- **Assinatura**: conta Apple Developer paga e certificado Windows. Sem isso
  "compatibilidade com o SO" não existe de verdade, com qualquer casca.
- **Duas linguagens**: quem mantém a casca precisa de Rust básico. A casca é
  pequena (centenas de linhas) e muda pouco.
- **Sidecar morrendo**: o motor é um processo à parte; a casca precisa
  religar e a tela precisa reconectar (o `ui/transporte.js` já faz recuo
  exponencial de reconexão).
- **Medidas**: tudo acima foi medido com instância vazia; a fase 1 mede com
  as contas reais.

## 8. Próximo passo

Fase 1: protótipo Tauri descartável nesta máquina, medido lado a lado com o
Electron, com a `ui/` passada no WKWebView. Pré-requisito: toolchain Rust e o
CLI do Tauri instalados (por `cargo`, sem npm).

## 9. Referência: o Sentinela (reescrita nativa do Farol em Swift)

Analisado em 27/10/2026 a partir de `~/Downloads/sentinela-main` (v0.9.0, sem
`.git`; autor Thiago Prado, MIT, deriva do Farol com crédito em `NOTICE.md`).

**O que é.** Não é uma casca nativa sobre o Farol: é a opção E deste documento
(motor reescrito) somada à opção D (tela nativa), só para macOS. Um processo
só, sem servidor HTTP, SwiftUI com barra de menus e Liquid Glass, estado em
SQLite (GRDB) e segredos no Keychain. O `gh` e o `claude -p` em `stream-json`
continuam sendo processos filhos, como no Farol.

**Tamanho e ritmo.** 133 mil linhas de Swift em 720 arquivos (Farol: 67 mil de
produto em JS, 93 mil de teste), 2011 testes, feito entre 07/10 e 27/10/2026 em
cinco ondas com agentes em paralelo, partindo de 1104 casos de teste extraídos
das suítes do Farol (`fixtures/farol/`, 472 JSONs) para portar os gates
(invariante 4) sem perder comportamento.

| módulo | linhas | equivale no Farol a |
|---|---|---|
| SNEngine | 41.082 | `server.js` + `lib/engine/` |
| SNUI | 22.674 | `ui/` |
| SNCore | 5.689 | `decision.js`, `public-review.js`, `log-taxonomy.js` |
| SNStore | 4.667 | `state/*.json` (virou SQLite) |
| SNCodeGraph + parser | 5.832 | `lib/review-context/` (tree-sitter em vez de `@babel/parser`) |
| SNClaude, SNGitHub, SNJira, SNRepo, SNMCP | 10.379 | `session.js`, `gh-queries.js`, `lib/jira/`, `tools/jira-mcp.js` |

**O que ele deixou de fora, por decisão:** Windows e Linux, sincronização entre
aparelhos (toda a `lib/sync/`, Firebase, Aparelhos, grupos de consumo),
auto-update, co-assinatura, Destaques, Novidades, Entregas. Exige macOS 27 e
Apple Silicon. A assinatura é ad hoc ou certificado local: sem notarização, o
Gatekeeper barra a primeira abertura em outra máquina e o Keychain pede
permissão a cada versão.

**O que ele mudou de arquitetura (e que vale olhar independentemente da casca):**
espelho local do repositório por PR em vez de `gh api` arquivo a arquivo;
pipeline Leitor, Verificador e Redator com o app como maestro determinístico e
sessões separadas por papel; caminho rápido para PR pequeno; especialista
versionado por repositório.

**O que isso diz para a nossa decisão:**

1. A opção D "tela nativa" custa, na prática, uma reescrita inteira: o
   Sentinela não conseguiu manter a `ui/` nem o motor, porque a tela nativa
   lê estado tipado (`AppState`) e não o snapshot JSON do SSE. É o aviso da
   seção "Programação" confirmado com números: 133 mil linhas em 3 semanas
   intensas, para UMA plataforma e com um terço do escopo do Farol fora.
2. O Sentinela resolve o problema de memória do time no Mac hoje, se o time
   aceitar macOS 27, só Mac, sem sync entre aparelhos e sem update
   automático. Para Windows e web ele não ajuda em nada.
3. Para o Farol virar nativo nas três frentes com o escopo inteiro, o caminho
   continua sendo uma casca (Tauri, ou SwiftUI + WinUI com WebView) sobre o
   motor e a `ui/` de hoje. O Sentinela é a prova do custo do outro caminho.
4. Dá para aproveitar do Sentinela sem adotá-lo: as `fixtures/farol/` são um
   corpus pronto para provar paridade de gates em qualquer porte; o espelho
   local e o pipeline por papéis são melhorias de revisão que cabem no motor
   Node, com casca nenhuma.

Hipótese a validar com o autor: quanto o Sentinela consome de memória parado e
em revisão, para comparar com os 86 MB do motor Node e os 398 MB do Electron.
