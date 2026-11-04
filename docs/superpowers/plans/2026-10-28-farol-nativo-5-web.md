# Web hospedada: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** rodar o Farol num servidor Linux (VPS) com uma instância por pessoa, acessada pelo navegador por HTTPS, usando o que o plano 1 entregou (`config.bind`, Host configurável, A4 exigida fora do loopback) e o modo servidor que já existe.

**Architecture:** um processo `node server.js` por pessoa, cada um com o próprio `FAROL_HOME` (identidade do `gh` e assinatura do Claude são por instância, por desenho), supervisionado por uma unidade `systemd` por usuário Linux; um proxy reverso com TLS (Caddy, decisão do plano, reversível para Nginx) encaminha `https://farol.<dominio>/<pessoa>/` ou `https://<pessoa>.farol.<dominio>/` para `127.0.0.1:<porta da pessoa>`, reescrevendo `Host` para o que a allowlist aceita. Nenhuma mudança de produto: este plano é operação, scripts e documentação, com um teste de fumaça automatizado.

**Tech Stack:** Linux (Ubuntu 24.04 LTS), `systemd` (unidades de usuário com `linger`), Caddy 2, Node 24 por `nvm` ou binário oficial, `gh`, `claude`.

**Spec:** desenho 4.6 e seção 5 do estudo (`2026-10-27-farol-nativo-mac-win-web-estrategia.md`): VPS de 4 vCPU e 8 GB.

## Global Constraints

- O motor nunca fica exposto sem TLS e sem A4: `bind` só sai de `127.0.0.1` quando a instância está atrás do proxy (padrão deste plano: o motor continua em loopback e o PROXY é quem expõe; `bind` fora do loopback fica documentado para o caso sem proxy e exige A4 pelo plano 1).
- Uma instância por pessoa: um usuário Linux, um `FAROL_HOME`, uma porta, um `gh auth login`, um `claude auth login` (pela tela, `lib/engine/login-web.js`).
- Update do motor: `lib/engine/update-servidor.js` como hoje (o `systemd` religa). `FAROL_UPDATE_MANAGER=external` quando a operação preferir atualizar por fora.
- Dados em `~/.farol` de cada usuário Linux (invariante 2). Log só de falhas (invariante 3).
- Commits em português, sem trailer. Branch `feat/web-hospedada`.

## Review Focus

1. **Proxy que bufferiza o SSE**: a conexão cai em 90 s (`OCIOSO_MS` de `ui/transporte.js`); o Caddyfile precisa de `flush_interval -1` para `/api/events`; teste na Task 2 (smoke lê `event: ping` em menos de 30 s pelo proxy).
2. **`Host` errado chegando ao motor** (`farol.dominio` em vez de `127.0.0.1:<porta>`): 403 `{ error: 'forbidden', motivo: 'host' }`; o Caddyfile reescreve `Host`; teste na Task 2.
3. **Dois usuários com a mesma porta**: o segundo motor falha ao subir e o `systemd` entra em laço; o script de provisionamento aloca a porta a partir de um registro `/etc/farol/portas` e recusa repetição; teste na Task 1.
4. **Token A4 em URL**: nunca; o pareamento é pelo painel da tela (`POST /api/auth/pair`), e o `ui/transporte.js` já manda o token por cabeçalho; o smoke da Task 2 confere que nenhum `token=` aparece no log do Caddy.
5. **Reinício do VPS**: `loginctl enable-linger <usuário>` é o que faz a unidade de usuário subir sem login; o script de provisionamento aplica e o smoke da Task 3 reinicia o serviço.

---

### Task 1: provisionamento de uma instância por pessoa

**Files:**
- Create: `tools/web/provisionar-pessoa.sh <login-linux> [porta]`: cria o usuário, instala o pacote leve em `~/.farol/app` (ou um clone, com `FAROL_UPDATE_MANAGER=external`), aloca a porta em `/etc/farol/portas` (próxima livre a partir de 47170; recusa repetida), grava `~/.farol/config.json` com `{ "port": <porta>, "localAuth": "exigir" }`, instala a unidade `~/.config/systemd/user/farol.service` (`ExecStart=node ~/.farol/app/server.js`, `Restart=always`, `RestartSec=10`, `Environment=FAROL_HOME=%h/.farol`), `loginctl enable-linger`, `systemctl --user enable --now farol`
- Create: `tools/web/farol.service.template`
- Test: `test/web-provisionar.test.js` (a alocação de porta como função pura em `tools/web/portas.js`: próxima livre, recusa repetida, formato do arquivo)

- [ ] **Step 1:** teste falha. **Step 2:** implementar. **Step 3:** passa; rodar o script numa VM Ubuntu para dois usuários e conferir duas portas e dois serviços vivos.
- [ ] **Step 4: Commit** `feat(web): provisionamento de uma instância do Farol por pessoa com systemd`

---

### Task 2: proxy com TLS

**Files:**
- Create: `tools/web/Caddyfile.template`: por pessoa, um bloco `<pessoa>.farol.<dominio> { reverse_proxy 127.0.0.1:<porta> { header_up Host 127.0.0.1:<porta>; flush_interval -1 } }`; TLS automático pelo Caddy; `log` sem query string
- Create: `tools/web/gerar-caddyfile.sh` (lê `/etc/farol/portas` e gera o Caddyfile), `tools/web/smoke.sh <pessoa>` (curl pelo proxy: `/` dá 200 com o `index.html`; `/api/state` sem token dá 401; `/api/events` com token de teste recebe `event: ping` em menos de 30 s; o log do Caddy não contém `token=`)
- Test: `test/web-caddyfile.test.js` (geração como função pura em `tools/web/caddyfile.js`: um bloco por pessoa, `header_up Host` com a porta certa, `flush_interval -1` presente)

- [ ] **Step 1:** teste falha. **Step 2:** implementar. **Step 3:** passa; `smoke.sh` verde na VM (Review Focus 1, 2 e 4).
- [ ] **Step 4: Commit** `feat(web): Caddyfile por pessoa com Host reescrito e SSE sem buffer`

---

### Task 3: primeiro acesso, pareamento e logins

**Files:**
- Create: `docs/WEB.md`: passo a passo do operador (provisionar, Caddy, DNS), e da pessoa (abrir a URL, parear com o código de `node tools/farol-parear.js` rodado pelo operador como aquele usuário, `gh auth login` no servidor como aquele usuário, login do Claude pela tela), update, backup de `~/.farol`, o que fazer quando a assinatura bate o limite; dimensionamento (4 vCPU / 8 GB para até 4 revisões paralelas, do estudo de 26/10)
- Modify: `CLAUDE.md` (mapa: `tools/web/`), `docs/CONFIGURATION.md` (link para `docs/WEB.md`)
- Test: `test/guias-navegaveis.test.js` (já existe: links vivos)

- [ ] **Step 1:** escrever. **Step 2:** `npm test -- test/guias-navegaveis.test.js` passa. **Step 3:** reiniciar a VM e conferir que os serviços voltam sem login (Review Focus 5).
- [ ] **Step 4: Commit** `docs(web): operação do Farol hospedado`
