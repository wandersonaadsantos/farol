# Evidência: contrato das telas (brief B2, seção 5)

Branch `md/contrato-telas`. Implementa, antes do desenho, o que as telas vão ler e acionar
e que ainda não tinha caminho. Nenhuma funcionalidade nova: cada item expõe o que o engine
já decide.

## O que entrou

- **Projeções no snapshot** (`lib/engine/sync-telas.js`, via `statusForUi`): `admin`,
  `distribuicao`, `admissao`, `comandosEmitidos`. O observador dos sinais passou a guardar
  quem é o admin vigente.
- **Rotas** (6 novas, inventário de 60 para 66, cada uma com classe):
  `/api/sync/command-status` e `/api/sync/takeover-notice` (leitura sensível),
  `/api/sync/cleanup-state` (leitura de baixo risco), `/api/sync/policy` (demais),
  `/api/auth/sessions` (leitura sensível) e `/api/auth/revoke` (destrutiva).
- **Sessões individuais da A4**: identificador público de 16 hex (pedaço do hash, nunca o
  token), marca da sessão atual e revogação de uma só.
- **Correção no brief:** andamento e pendências remotas já chegavam à tela por eventos SSE
  próprios; não eram lacuna.

## Gate

`test/contrato-telas.test.js`: 10 casos, servidor HTTP real, banco e identidade falsos,
dados sintéticos (`acme-exemplo`, `conta-sintetica`). `test/facades.test.js` e
`test/local-auth-inventario.test.js` verdes (a contagem de rotas mudou de propósito e o
teste diz por quê). Contraprovas: 13 por script, todas reprovaram; duas nasceram inertes e
viraram caso novo (desligar a chave de limpeza depois de ligar, e o admin da projeção vindo
da observação real dos sinais).
