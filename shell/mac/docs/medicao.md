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
  footprint fica no limite (150,5 MB). No início, ainda na primeira checagem, a soma foi de 269 MB.
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
