# Farol nativo: índice dos planos de implementação

Desenho: `docs/superpowers/specs/2026-10-27-farol-nativo-swiftui-winui-design.md`
(aprovado em 28/10/2026). O desenho cobre cinco subsistemas que entregam
software testável separadamente, então são cinco planos. Este índice fixa a
ordem, as dependências e as interfaces entre eles, para cada plano ser
executado por quem nunca viu os outros.

| # | plano | arquivo | depende de | entrega |
|---|---|---|---|---|
| 1 | Contrato do sidecar no motor | `2026-10-28-farol-nativo-1-contrato-do-sidecar.md` | nada | motor que sobe como sidecar, autentica a casca, emite os eventos da casca, faz bootstrap de versão e update em `~/.farol/engine/`, e aceita bind fora do loopback (web) |
| 2 | Casca macOS | `2026-10-28-farol-nativo-2-casca-mac.md` | 1 | `Farol.app` em Swift com janela, bandeja, badge, notificação, autostart, instância única, visor e sidecar |
| 3 | Casca Windows | `2026-10-28-farol-nativo-3-casca-win.md` | 1 | `Farol.exe` em C#/WinUI 3 com a mesma paridade |
| 4 | Empacotamento, assinatura, update e release | `2026-10-28-farol-nativo-4-release.md` | 2 e 3 | `.dmg` notarizado com Sparkle, `.msix` assinado com App Installer, release unificada, release de ponte 2.x, retirada do Electron |
| 5 | Web hospedada (operação) | `2026-10-28-farol-nativo-5-web.md` | 1 | proxy com TLS, um processo por pessoa, documentação de operação |

Os planos 2 e 3 podem correr em paralelo depois do 1. O 4 fecha os dois. O 5
é só operação sobre o que o 1 entrega.

## Padrões adotados pelos planos onde a seção 8 do desenho deixou a decisão ao dono

Cada um é reversível na revisão do plano; trocar um deles muda só o plano citado.

| decisão (seção 8) | padrão adotado | plano |
|---|---|---|
| 1. versão mínima | macOS 14 (Sonoma); Windows 10 1809 (build 17763), x64 | 2, 3 |
| 2. instalador Windows | MSIX com App Installer (update nativo do SO) | 3, 4 |
| 3. bandeja no Windows | P/Invoke em `Shell_NotifyIcon`, zero dependência | 3 |
| 4. update da casca Mac | Sparkle 2 por SPM, versão exata, appcast assinado com EdDSA | 2, 4 |
| 5. repositórios | um só: `shell/mac/` e `shell/win/` dentro do repositório do motor | 2, 3, 4 |
| 6. contas de assinatura | Apple Developer Program e certificado OV Windows como secrets do repositório; em nome de quem fica em aberto | 4 |
| 7. ordem | Mac e Windows em paralelo depois do plano 1 | índice |
| proxy da web | Caddy 2 (TLS automático), motor em loopback atrás dele | 5 |

## Interfaces entre os planos (fixadas aqui, não renegociadas por plano)

### Variáveis de ambiente que a casca passa ao sidecar

| variável | valor | quem lê |
|---|---|---|
| `FAROL_SHELL` | `mac` ou `win` | `modoCasca()` em `lib/paths.js` |
| `FAROL_SHELL_VERSION` | versão semântica da casca, ex. `3.0.0` | bootstrap de versão (`engines.farolShell`) |
| `FAROL_HOME` | opcional, como hoje | `lib/paths.js` |

### Arquivo `~/.farol/state/casca.json` (0600; `CASCA_DIR` de `lib/paths.js`, fora do workspace)

Gravado pelo motor assim que o socket abre; apagado na saída limpa.

```json
{ "porta": 47170, "pid": 12345, "versao": "2.79.0", "codigoPareamento": "K7QMZP2XWD",
  "iniciadoEm": 1761600000000, "proximaVersao": null }
```

`codigoPareamento` tem 10 caracteres do alfabeto base32 do pareamento, sem hífen
(`LOCAL_AUTH.CODIGO_TAMANHO`), é de uso único (classe `casca`) e válido por
`TEMPOS.PAREAMENTO_VALIDADE_MS`; `proximaVersao` só é preenchido antes de uma
saída por update.

Nota de contrato (plano 1 entregue, 28/10/2026): a casca encerra o motor pelo `pid`
gravado aqui, que é o do processo que escuta, mesmo depois do reexec do bootstrap. No
Windows a casca mantém o motor num Job Object com `KILL_ON_JOB_CLOSE`. O motor
reexecutado vigia o pai (`TEMPOS.VIGIA_DO_PAI_MS`) e sai sozinho quando ele morre, em
até cerca de 2 s.

### Rotas que a casca usa

- `GET /api/auth/status` (pública): reconhece um Farol vivo na porta.
- `POST /api/auth/pair` `{ codigo, rotulo }` → `{ ok, token }` (pública).
- `GET /api/events` com `Authorization: Bearer <token>` e `x-farol: 1`: SSE.
- `POST /api/check` com o mesmo cabeçalho: "Checar agora" da bandeja.
- `GET /` no WebView, com o token injetado em `localStorage['farol-auth-token']`
  antes da página rodar.

Toda chamada leva `Host: 127.0.0.1:<porta>` (allowlist de `lib/http-guard.js`).

### Eventos SSE que a casca lê (e só esses)

| evento | corpo | quando |
|---|---|---|
| `aviso-nativo` | `{ titulo, corpo, url, pr, silencioso }` (`url` e `pr` podem ser `null`) | a cada notificação |
| `casca` | `{ badge: { contador, rotulo }, ocupado, autostart, cores: { bg, symbol } }` | na conexão e a cada mudança |
| `casca-saida` | `{ motivo: 'update' \| 'reinicio', proximaVersao }` | antes de o motor sair de propósito; o processo então sai com código 75 |

A casca NÃO lê `state` nem `state-patch`.

Nota de contrato (plano 1 entregue): `casca` pode repetir o mesmo corpo, e as cascas
comparam e ignoram o igual. `casca-saida { motivo, proximaVersao }` antecede a saída com
código 75.

### Códigos de saída do sidecar

- `0`: saída pedida pela casca (SIGTERM) ou Ctrl+C.
- `75`: saída de propósito (update ou reinício); a casca religa na hora, sem
  recuo e sem contar como falha.
- qualquer outro: falha; a casca religa com recuo 1 s, 2 s, 4 s, teto 30 s.

Nota de contrato (plano 1 entregue): o 75 é `CASCA.CODIGO_SAIDA_DE_PROPOSITO`, em
`lib/constants.js`.

### Layout do bundle (o que o plano 4 empacota e o que o 1 pressupõe)

```
<bundle>/engine/node/bin/node        (Mac: Contents/Resources/engine/node/bin/node; Win: engine\node\node.exe)
<bundle>/engine/app/server.js        (pacote leve do motor: server.js, lib/, ui/, workspace-template/, assets/, package.json)
~/.farol/engine/<versão>/server.js   (motor atualizado; o bootstrap do motor semeado executa o mais novo compatível)
```

A casca executa SEMPRE `<bundle>/engine/node <bundle>/engine/app/server.js`.

### `package.json` da casca e do motor

- Motor: `engines.farolShell` com a faixa de versão da casca aceita (formato
  `>=X.Y.Z <N`, o mesmo de `engines.node`).
- Cada casca informa a própria versão em `FAROL_SHELL_VERSION`.

### Arquivo de reabertura silenciosa

`~/.farol/workspace/state/reabrir-silencioso.json` (`{ at, to }`), escrito pelo
motor no update e consumido (lido e apagado) pela casca no boot, válido por
`TEMPOS.REABERTURA_SILENCIOSA_MS` (10 min). Já existe; a casca só passa a ser
quem consome.

### Fixtures de paridade (planos 2 e 3)

`test/fixtures/casca/eventos.json`: lista de `{ evento, corpo, esperado }`
gerada pelo plano 1 a partir dos testes de `avisos-nativos.js`. Os testes das
duas cascas leem esse arquivo e conferem título, corpo, url e badge.
