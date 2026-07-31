# Perfis de assinatura Claude por conta GitHub

Data: 2026-07-31
Status: aprovado, aguardando plano de implementação

## Problema

O Farol já isola a assinatura/plano do Claude Code usado nas sessões (headless e terminal)
via `config.claudeConfigDir`, que injeta `CLAUDE_CONFIG_DIR` nos processos filhos (ver
`CLAUDE.md` seção "Assinatura do Claude"). Hoje esse campo é único, texto livre, global:
todas as sessões do Farol, de qualquer conta GitHub monitorada, usam o mesmo config dir.

Isso não dá a granularidade que o multi-conta GitHub já tem (`accounts: [{user, owners,
label, autoReview, onClean, ...}]`). O caso concreto: revisar PRs da conta de trabalho
(`wandersonbiuder`/`biudtech`) deveria consumir o plano BIUD TECNOLOGIA; revisar PRs da
conta pessoal (`wandersonaadsantos`) deveria consumir o Max pessoal. Hoje isso exige trocar
manualmente o campo global toda vez que se alterna de contexto.

Além disso não há visibilidade rápida de qual conta/email Claude está logada em cada
perfil — só o doctor mostra isso, e só pro único config dir global.

## Objetivo

Tornar a escolha de assinatura Claude **opcional por conta GitHub**, com fallback total
para o comportamento atual (sem quebrar quem só usa o campo simples hoje — o Farol é usado
por terceiros, então o campo legado precisa continuar funcionando sozinho). Junto, dar
visibilidade de relance (badge) e detalhada (doctor) de qual conta está logada em cada
perfil.

## Modelo de dados

Novo, em `config.json` (mesma regra do `accounts`: só local, nunca no fonte/zip):

- **`claudeProfiles: [{ id, label, dir }]`** — lista de perfis nomeados. `id` gerado
  (uuid curto ou slug do label + timestamp), `label` livre (ex: "BIUD Trabalho"), `dir` é
  o caminho absoluto do config dir (equivalente ao que hoje vai em `claudeConfigDir`).
- **`claudeProfileId`** (novo campo global, no nível raiz do config, ao lado do antigo
  `claudeConfigDir`) — id do perfil usado como padrão do Farol quando uma conta não tiver
  override. Vazio = "padrão da máquina" (sem `CLAUDE_CONFIG_DIR`, herda o login local).
- **`accounts[].claudeProfileId`** (novo campo opcional, por entrada de conta) — se
  presente, essa conta usa esse perfil, ignorando `claudeProfileId` global.
- **`claudeConfigDir`** (campo existente) — mantido, inalterado. Vira fallback de
  compatibilidade: se `claudeProfiles` estiver vazio/ausente, o resolver ignora todo o
  sistema novo e devolve exatamente esse valor, como hoje.

Nenhuma migração automática de dados é necessária: quem já usa `claudeConfigDir` continua
funcionando sem tocar em nada. Adotar o sistema de perfis é opt-in (basta criar o primeiro
perfil na UI).

## Resolução

Novo método em `Engine`, usado em todo lugar que hoje lê `config.claudeConfigDir`
diretamente:

```js
resolveClaudeConfigDir(user) {
  const acc = (this.config.accounts || []).find(a => a.user === user);
  const profiles = this.config.claudeProfiles || [];
  if (profiles.length) {
    const id = (acc && acc.claudeProfileId) || this.config.claudeProfileId || '';
    const p = profiles.find(p => p.id === id);
    if (p) return p.dir;
  }
  return this.config.claudeConfigDir || '';
}
```

Sem `user` (chamadas sem conta associada, ex. sessão avulsa) cai direto no `claudeProfileId`
global ou no legado.

### Pontos de chamada a migrar

- `Engine.ghEnv(user)` (`server.js`): troca `this.config.claudeConfigDir` por
  `this.resolveClaudeConfigDir(user)`.
- `buildSessionScript(engine, slash)` (`lib/engine/session.js`, sessão terminal Windows):
  hoje não recebe conta. Ganha parâmetro `user`/`account` (o `spawnConsole` do Windows já
  recebe `account` e hoje não repassa pro script — passa a repassar), e usa
  `engine.resolveClaudeConfigDir(account)`.
- `buildSessionScriptMac(engine, slash, id, user)` (`lib/engine/session.js`): já recebe
  `user`; troca a leitura direta de `engine.config.claudeConfigDir` por
  `engine.resolveClaudeConfigDir(user)`.

## UI (Sistema)

- Campo texto único "Assinatura do Claude" dá lugar a um gerenciador de perfis simples:
  lista de perfis (label + caminho) com botão de adicionar e remover linha. Sem edição de
  `id` (gerado na criação, oculto).
- Dropdown "Perfil padrão do Farol": opções = perfis salvos + "Padrão da máquina" (valor
  vazio, mesmo efeito de hoje sem `claudeConfigDir`).
- Na tabela de contas GitHub já existente (Sistema > contas), cada linha ganha um dropdown
  opcional "Perfil Claude": mesmas opções do padrão, mais "Usar o padrão do Farol" (vazio =
  sem override, cai no global).
- O campo antigo `claudeConfigDir` texto livre some da UI (vira só um valor legado gravado
  no config; se o usuário nunca criar um perfil, ele continua sendo lido pelo resolver, só
  não é mais editável por um campo dedicado — pode ser recriado como o primeiro perfil, ver
  seção Migração da UI abaixo).

### Migração da UI (sem perder configuração existente)

Ao abrir a tela de Sistema, se `claudeConfigDir` estiver preenchido e `claudeProfiles`
estiver vazio, mostrar esse valor como valor pré-preenchido de um perfil sugerido
("Perfil atual") que o usuário pode salvar com um clique (vira o primeiro item de
`claudeProfiles` e some do campo legado). Enquanto ele não salvar, o valor legado continua
funcionando via fallback do resolver — nada quebra, é só um convite a migrar.

## Visibilidade

- **Badge por conta** (Sistema, ao lado de cada linha da tabela de contas GitHub): selo
  pequeno com o email logado no perfil resolvido pra aquela conta (`user@dominio` ou
  "SEM LOGIN" se o dir apontado não tiver `.credentials.json`).
- **Badge por perfil** (dentro do gerenciador de perfis): mesma informação, ao lado de cada
  perfil salvo, pra saber de relance qual email está logado em qual perfil antes mesmo de
  vincular a uma conta.
- **Doctor**: `claudeAuthInfo()` deixa de aceitar só o dir global; ganha parâmetro `dir`
  opcional. O doctor passa a iterar todos os perfis salvos (mais o legado, se existir) e
  reporta status de cada um, em vez de um único bloco.

## Testes

- `resolveClaudeConfigDir`: sem profiles (fallback legado); com profiles + sem override de
  conta (usa o global); com profiles + override de conta (usa o da conta); id apontando
  pra perfil inexistente (cai no legado); sem `user` informado.
- `claudeAuthInfo(dir)` parametrizado: dir com credencial válida, dir sem
  `.credentials.json`, dir vazio (default da máquina).
- UI: adicionar/remover perfil persiste em `config.json` via `updateSettings`; dropdown de
  conta grava `claudeProfileId` só naquela entrada de `accounts`.

## Fora de escopo

- Não migra nem apaga `claudeConfigDir` automaticamente.
- Não adiciona autenticação assistida (login continua sendo ação manual do usuário via
  `claude login`, nunca automatizado pelo Farol).
- Não estende o conceito de perfil pra fontes de auth por API key/token (`ANTHROPIC_API_KEY`
  etc.) — só cobre o caminho de config dir/OAuth já existente.
