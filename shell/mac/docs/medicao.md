# Memória da casca nativa do macOS parada

Medição do critério do desenho (`docs/superpowers/specs/2026-10-27-farol-nativo-swiftui-winui-design.md`,
seção 1): app inteiro, motor incluso, abaixo de 150 MB parado no Mac, contra os 398 MB de RSS do
Electron (86 MB deles do motor).

## Condições

- **Data**: 29/10/2026, das 14:47 às 14:58 (horário de Brasília).
- **Máquina**: Apple M1 Max, macOS 27.0.1 (26A434), Xcode 26.6, Node 24.22.1.
- **Build**: Debug, sem assinatura (`shell/mac/scripts/build.sh`), com a Sparkle 2.10.1 embutida
  e sem iniciar (chave EdDSA vazia; ver "O que não foi medido").
- **Motor**: o `server.js` do checkout, versão 2.78.11, por `FAROL_NODE` e `FAROL_SERVER_JS`, num
  `FAROL_HOME` temporário (nunca o `~/.farol`).
- **Carga**: uma conta real do GitHub (a do `gh auth status`) com as 10 organizações de que ela é
  membro, no modo simples (`ghUser` + `owners`). O motor migrou a configuração para uma conta com
  `autoReview: false`, conferida no `config.json` antes da medição: as buscas foram só leitura e
  nenhuma revisão rodou.
- **Janela**: `ui/` autenticada (log `pareamento com o motor concluído` e `janela aberta (visor:
  false, com token: true)`), movida para a tela principal e pintada (captura no início com Radar >
  Pra mim e a primeira checagem em andamento). Ninguém clicou na janela durante os 10 minutos.
  A máquina estava em uso: outras janelas cobriram a do Farol durante a medição, e a captura do
  fim veio vazia (WebKit sem pintar janela encoberta).
- **Leitura**: `ps -o rss= -p <pid>` (KB) do processo `Farol` do `.app`, do `node` do `casca.json`
  e dos três processos WebKit nascidos com o app (`WebContent`, `GPU`, `Networking`; o
  `launchctl procinfo` pede root, então a identificação foi pelo horário de nascimento, o mesmo
  segundo da abertura da janela). MB aqui é KB / 1024.

## Resultado (RSS)

| processo | 0 min (14:48) | 5 min (14:53) | 10 min (14:58) |
|---|---:|---:|---:|
| Farol (app) | 99 888 KB | 85 632 KB | 77 392 KB |
| node (motor) | 87 200 KB | 70 240 KB | 65 280 KB |
| WebKit.WebContent | 44 672 KB | 17 760 KB | 16 864 KB |
| WebKit.GPU | 29 008 KB | 17 760 KB | 14 656 KB |
| WebKit.Networking | 14 672 KB | 8 960 KB | 9 600 KB |
| **soma** | **275 440 KB (269,0 MB)** | **200 352 KB (195,7 MB)** | **183 792 KB (179,5 MB)** |

A leitura de 0 min foi tirada cerca de 40 s depois da abertura, ainda na primeira checagem.

Logo depois da leitura de 10 min, o `footprint` (memória física própria de cada processo,
contando a comprimida e sem as páginas compartilhadas dos frameworks do sistema) deu: app 31 MB,
motor 44 MB, WebContent 48 MB, GPU 18 MB, Networking 9,5 MB, soma 150,5 MB. O RSS caiu entre as
leituras em parte porque o sistema comprimiu páginas ociosas (pouca memória livre na máquina em
uso), e o RSS não conta memória comprimida: a WebContent tinha 16,5 MB de RSS e 48 MB de
footprint.

## Veredito

- **Contra o Electron**: 179,5 MB contra 398 MB, menos da metade (55% a menos).
- **Contra o critério de 150 MB**: não passa pelo RSS de 10 min, que estoura em 29,5 MB; pelo
  footprint fica 0,5 MB acima (150,5 MB). No início, ainda na primeira checagem, a soma foi de 269 MB.
- **Onde está o peso**: o app (75,6 MB de RSS, só 31 MB próprios: o resto são páginas de AppKit,
  WebKit e da Sparkle compartilhadas com o sistema, mais o `Farol.debug.dylib` do build Debug) e o
  motor (63,8 MB de RSS, 44 MB próprios). O WebKit somado ficou em 40,2 MB de RSS (contra ~90 MB na
  leitura única da Task 8, com a janela pintando), e 75 MB de footprint.

## O que não foi medido

- Build Release (universal, otimizado e sem o dylib de depuração), que deve baixar a parte do app.
- Assinatura, notarização e o bundle com o motor e o Node dentro do `.app` (plano 4).
- Update real pela Sparkle: com a `SUPublicEDKey` vazia a Sparkle não inicia (log `atualização
  desligada: The EdDSA public key is not valid for Farol.`), então nenhuma verificação saiu.
- Janela visível e na frente durante os 10 minutos inteiros: a máquina estava em uso e outras
  janelas a cobriram; com a janela pintando o tempo todo, o WebKit tende a ficar mais perto dos
  ~90 MB da leitura da Task 8.
- Sessão de revisão rodando (o motor parado é o caso do critério).

## Saída

"Sair" pela bandeja: nenhum processo `Farol` nem `server.js` restante, `casca.json` apagado, porta
47190 livre e os três processos WebKit encerrados.

## Medição em Release (30/10/2026)

### Condições

- **Data**: 30/10/2026, das 09:15 às 09:29 (horário de Brasília).
- **Máquina**: a mesma (Apple M1 Max, macOS 27, Xcode 26.6).
- **Build**: o primeiro bundle de verdade, `tools/release/montar-mac.sh` sem argumentos: `xcodebuild
  archive` em Release universal (arm64 e x86_64), motor 2.78.11 e Node 24.22.1 universal DENTRO do
  `.app` (`Contents/Resources/engine/`), assinatura ad hoc, Sparkle 2.10.1 embutida e sem iniciar
  (chave EdDSA vazia). Nada de `FAROL_NODE` nem `FAROL_SERVER_JS`: o motor subiu do bundle.
- **Motor**: `FAROL_HOME` temporário (`/tmp/farol-bundle-home`, porta 47195), aberto com
  `FAROL_HOME=... open dist/mac/Farol.app`. A conta do `gh` foi detectada e nasceu com
  `autoReview: false`: as buscas foram só leitura (3 PRs em Pra mim, 6 em Meus PRs, 59 no
  Panorama) e nenhuma revisão rodou.
- **Janela**: autenticada (log `pareamento com o motor concluído` e `janela aberta (visor: false,
  com token: true)`), num monitor secundário, na tela (`kCGWindowIsOnscreen` verdadeiro nas três
  leituras) e pintando: a captura só da janela no fim mostrou a fila com a última checagem às
  09:26. Ninguém clicou nela. A máquina seguiu em uso no monitor principal, então não dá para
  afirmar que nenhuma outra janela a cobriu em parte nesse tempo.
- **Leitura**: o mesmo método da medição anterior, `ps -o rss= -p <pid>` (KB) do `Farol`, do
  `node` do bundle e dos três WebKit nascidos no mesmo segundo da abertura (09:15:10).

### Resultado (RSS)

| processo | 0 min (09:15:56) | 5 min (09:20:56) | 10 min (09:25:56) |
|---|---:|---:|---:|
| Farol (app) | 106 048 KB | 92 848 KB | 92 960 KB |
| node (motor) | 108 576 KB | 96 496 KB | 78 624 KB |
| WebKit.WebContent | 57 744 KB | 42 992 KB | 57 984 KB |
| WebKit.GPU | 34 720 KB | 20 896 KB | 31 040 KB |
| WebKit.Networking | 26 576 KB | 14 880 KB | 15 920 KB |
| **soma** | **333 664 KB (325,8 MB)** | **268 112 KB (261,8 MB)** | **276 528 KB (270,0 MB)** |

A leitura de 0 min saiu 46 s depois da abertura, ainda na primeira checagem.

O `footprint` dos cinco processos às 09:29 (14 min) deu: app 33 MB, motor 58 MB, WebContent
47 MB, GPU 28 MB, Networking 9,7 MB, soma 176 MB. No mesmo instante o RSS somava 241 376 KB
(235,7 MB).

### Veredito

- **Contra o critério de 150 MB**: não passa. Pelo RSS de 10 min estoura em 120 MB (270 MB); pelo
  footprint fica 26 MB acima (176 MB).
- **Contra o Electron**: 270 MB contra 398 MB, 32% a menos.
- **Contra a medição em Debug**: o Release não baixou o app (33 MB de footprint contra 31 MB; o
  RSS maior vem do binário universal e das páginas compartilhadas) e o total subiu porque, com a
  janela pintando o tempo todo, o WebKit ficou em 105 MB de RSS (contra 40 MB com a janela
  encoberta) e 85 MB de footprint. O motor também pesou mais (58 MB de footprint contra 44 MB)
  com a mesma conta. O peso que falta cortar para o critério está no WebKit pintando e no motor,
  não na casca.

### O que não foi medido

- Bundle assinado com Developer ID e notarizado (é o mesmo binário; a assinatura não muda a
  memória, mas fica registrado).
- Update real pela Sparkle (chave EdDSA vazia).
- Sessão de revisão rodando.

### Saída

`quit app "Farol"`: nenhum processo `Farol` nem `node` do bundle restante, `casca.json` apagado,
porta 47195 livre e os três processos WebKit encerrados.
