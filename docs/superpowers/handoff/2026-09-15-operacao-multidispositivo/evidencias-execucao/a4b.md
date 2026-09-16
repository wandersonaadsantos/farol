# Evidência: A4b Autenticação exigida exercitada e guarda do celular para a C3

Branch `md/a4b`, da ponta de `md/integracao` (`17ac164`). Adendo de 16/09/2026, item 5.

## 1. Guarda nova: a C3 não liga no celular sem autenticação exigida

**Antes:** nada impedia ligar o compartilhamento cifrado no modo celular com a exigência
automática desligada; a API ficaria sem porteiro com o conteúdo compartilhado.

**Agora:** `compartilhamentoPermitido` (puro, `lib/local-auth/modo.js`) e
`syncComGuardaDoCelular` (`server.js`), aplicados no boot E em toda gravação de
configuração. No celular sem exigência, `shared` e `distribution` ficam desligados, e o
motivo `autenticacao-local` sai em `sync.bloqueioCompartilhamento` para a tela não mostrar
como ligado o que o engine desligou. Com `localAuth: 'exigir'` no `config.json`, liga.

Testes: `test/local-auth-modo.test.js` (predicado) e
`test/local-auth-compartilhamento.test.js` (engine real, modo celular simulado pelo sinal
`TERMUX_VERSION`, pasta isolada). Contraprovas: 5 por script, todas reprovaram.

## 2. Exercício com a autenticação exigida, servidor real isolado

`node server.js` com `FAROL_HOME` temporário, porta 47191, `autoReview: false`,
`localAuth: 'exigir'`, sem conta configurada. Pedidos com `curl`:

| Verificação | Resultado |
|---|---|
| `GET /api/auth/status` sem token | `{"exigida":true,"autenticado":false}` |
| `GET /` (interface) | 200 (HTML, CSS e JS são públicos e sem segredo) |
| `GET /api/state` sem token | 401 `nao_autenticado` |
| `GET /api/events` sem token | 401 |
| `POST /api/review` sem token | 401 |
| `POST /api/sync/command` sem token | 401 |
| código de `node tools/farol-parear.js` | 10 caracteres, só no terminal |
| `POST /api/auth/pair` | `ok: true`, token de 43 caracteres, **nenhum cookie** |
| segundo uso do mesmo código | `codigo_invalido` |
| `GET /api/state` com o token | 200 |
| `GET /api/auth/status` com o token | `{"exigida":true,"autenticado":true}` |
| token ou código no log do servidor | nenhuma ocorrência |

## 3. O que falta, e por quê

A **interface** não trata o 401: com a exigência ligada, a página carrega e não oferece o
pareamento. Não há acesso anônimo ao conteúdo (o servidor recusa), mas também não há o
fluxo de autenticação. Essa tela é a 2.1 do brief B2 e depende do Claude Design. Por isso
a exigência automática no celular continua desligada (`ATIVACAO_AUTOMATICA_A4`), e agora a
C3 fica presa a ela no celular.
