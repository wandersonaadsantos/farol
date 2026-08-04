# Perfil de assinatura Claude por chave de API

Data: 2026-08-04
Status: **DESENHADO**, aguardando plano de implementação.

## Problema

O Farol isola qual assinatura Claude cada conta GitHub usa via **perfis** (`config.claudeProfiles:
[{id, label, dir}]`, ver `docs/superpowers/specs/2026-07-31-perfis-claude-por-conta-design.md`).
Cada perfil aponta pra um diretório de config (`CLAUDE_CONFIG_DIR`) logado via `claude login`,
fora do Farol. Essa spec original **excluiu de propósito** a autenticação por API key
("Não estende o conceito de perfil pra fontes de auth por API key/token... só cobre o caminho
de config dir/OAuth já existente").

Hoje isso é a única forma de auth: quem não quer (ou não pode) usar uma assinatura OAuth por
login interativo — por exemplo, pra usar billing por API direto, ou apontar pra um endpoint
compatível com a API de Mensagens da Anthropic — não tem opção nenhuma na tela "Plano e
chaves". O `claude` CLI já suporta isso nativamente via `ANTHROPIC_API_KEY` (+
`ANTHROPIC_BASE_URL` opcional), mas o Farol nunca expôs esse caminho.

## Objetivo

Perfil de assinatura Claude passa a ter dois **tipos**: `dir` (o que já existe, login por
assinatura) e `apikey` (novo: chave de API + URL base opcional). Os dois tipos convivem no
mesmo gerenciador de perfis, escolhidos por conta GitHub exatamente como hoje (perfil da
conta > perfil padrão do Farol > legado). Cobre **as duas vias que hoje resolvem assinatura**:
sessões autônomas (headless: revisão, autoanálise, pushback, chat, ferramentas) e sessão de
terminal interativa (ícone de terminal num card da fila, e "Abrir sessão de login" por perfil).

## Modelo de dados

`config.claudeProfiles: [{ id, label, kind, dir, apiKey, baseUrl }]`

- **`kind`**: `'dir'` (default quando ausente, compatibilidade com todo perfil já salvo) ou
  `'apikey'`.
- **`dir`**: como hoje, só relevante pra `kind: 'dir'`.
- **`apiKey`**: string, obrigatória pra `kind: 'apikey'`. Sanitizada com a mesma regra do
  `dir` (`sanitizeClaudeDir`, generalizada): tira aspas de contorno, rejeita aspas/quebra de
  linha no meio (vai virar valor de variável de shell, mesmo motivo de segurança do `dir`).
- **`baseUrl`**: string, opcional pra `kind: 'apikey'`. Mesma sanitização. Vazio = usa o
  endpoint padrão da Anthropic (o `claude` CLI não recebe `ANTHROPIC_BASE_URL` nesse caso).

`normalizeClaudeProfiles(val)` passa a filtrar por `kind`: entrada `dir` sem `dir` válido é
descartada (como hoje); entrada `apikey` sem `apiKey` válida é descartada. `kind` desconhecido
(nem `'dir'` nem `'apikey'`) também descarta a entrada.

`config.claudeProfileId` (padrão do Farol) e `accounts[].claudeProfileId` (override por conta)
não mudam: continuam sendo só o `id` do perfil, o `kind` mora dentro do perfil apontado.

## Resolução

Novo método na `Engine`, **substitui o uso direto de `resolveClaudeConfigDir` em todo lugar
que hoje resolve assinatura pra uma sessão** (não substitui o método em si, ver abaixo):

```js
// cascata idêntica à de resolveClaudeConfigDir hoje: conta > padrão global > legado.
// Devolve o PERFIL INTEIRO resolvido, não só um dir, pra quem chama decidir o que fazer
// com cada kind.
resolveClaudeAuth(user) {
  const acc = (this.config.accounts || []).find(a => a && a.user === user);
  const profiles = this.config.claudeProfiles || [];
  if (profiles.length) {
    const id = acc?.claudeProfileId || this.config.claudeProfileId || '';
    const p = profiles.find(p => p.id === id);
    if (p?.kind === 'apikey' && p.apiKey) return { kind: 'apikey', apiKey: p.apiKey, baseUrl: p.baseUrl || '' };
    if (p && p.kind !== 'apikey' && p.dir) return { kind: 'dir', dir: p.dir };
  }
  return { kind: 'dir', dir: this.config.claudeConfigDir || '' };
}
```

`resolveClaudeConfigDir(user)` **continua existindo**, sem mudar sua assinatura, pra não
quebrar nenhum call site esquecido: passa a chamar `resolveClaudeAuth` por baixo e devolver
`dir` só quando o resultado for `kind: 'dir'` (senão `''`, mesmo comportamento de "sem config
dir próprio" que já existe hoje pro legado vazio). Todo call site de sessão (headless e
terminal) migra pra `resolveClaudeAuth`; call sites que só querem "o dir, se houver" (nenhum
esperado sobrar depois da migração, mas por garantia) continuam funcionando via
`resolveClaudeConfigDir`.

## Centralização da injeção de env (o "kind" só é decidido em 2 lugares)

Hoje 5 pontos resolvem assinatura pra uma sessão: `ghEnv` (headless + processo que abre o
terminal) e os 4 script builders de terminal/login (`buildSessionScript`/`Mac`,
`buildLoginScript`/`Mac`, Windows e macOS). Em vez de repetir `if (kind === 'apikey') ...` em
cada um, dois helpers concentram a tradução de `auth` resolvido pra env:

```js
// lib/parse.js (funções puras, sem estado de engine) -----------------------------------

// objeto env (JS): usado só por ghEnv (server.js). Muta o env recebido.
function applyClaudeAuthEnv(env, auth) {
  if (auth.kind === 'apikey' && auth.apiKey) {
    env.ANTHROPIC_API_KEY = auth.apiKey;
    if (auth.baseUrl) env.ANTHROPIC_BASE_URL = auth.baseUrl;
  } else if (auth.dir) {
    env.CLAUDE_CONFIG_DIR = auth.dir;
  }
}

// linhas de script (.cmd no Windows, .command no macOS): usado pelos 4 builders de
// sessão/login. Mesmo escaping de aspa simples que o dir já usa hoje no lado Mac (achado
// de auditoria adversarial documentado no CLAUDE.md: sem escapar, um valor com aspa simples
// escapava da atribuição shell e executava comando arbitrário).
function claudeAuthShellLines(auth, isWin) {
  const esc = s => s.replace(/'/g, "'\\''");
  if (auth.kind === 'apikey' && auth.apiKey) {
    const lines = isWin
      ? [`set "ANTHROPIC_API_KEY=${auth.apiKey}"`]
      : [`export ANTHROPIC_API_KEY='${esc(auth.apiKey)}'`];
    lines.push(auth.baseUrl
      ? (isWin ? `set "ANTHROPIC_BASE_URL=${auth.baseUrl}"` : `export ANTHROPIC_BASE_URL='${esc(auth.baseUrl)}'`)
      : (isWin ? 'rem sem base url propria' : '# sem base url propria'));
    return lines;
  }
  const dir = auth.dir || '';
  return [dir
    ? (isWin ? `set "CLAUDE_CONFIG_DIR=${dir}"` : `export CLAUDE_CONFIG_DIR='${esc(dir)}'`)
    : (isWin ? 'rem sem config dir proprio' : '# sem config dir proprio')];
}
```

Nota: `set "X=..."` no Windows não tem o mesmo problema de injeção que o lado posix (não há
split de comando por aspa simples em `cmd.exe` do mesmo jeito), mas o valor já passa pelo
mesmo sanitizador anti-aspas/quebra-de-linha na entrada (`normalizeClaudeProfiles`), então a
defesa em profundidade já existente pro `dir` no Windows cobre `apiKey`/`baseUrl` igual.

### Pontos de chamada migrados

- `Engine.ghEnv(user)`: troca `if (claudeDir) env.CLAUDE_CONFIG_DIR = claudeDir` por
  `applyClaudeAuthEnv(env, this.resolveClaudeAuth(user))`.
- `buildSessionScript(engine, slash, account)` (Windows, terminal da fila): troca a linha
  `cfgDir` única por `claudeAuthShellLines(engine.resolveClaudeAuth(account), true).join('\r\n')`.
- `buildSessionScriptMac(engine, slash, id, user)`: mesma troca, `join('\n')`, `isWin=false`.
- `buildLoginScript(engine, dir)` **e** `buildLoginScriptMac(engine, dir, id)`: hoje recebem
  um `dir` já resolvido por `resolveConfigDirForLogin(profileId)`. Passam a receber o
  `auth` resolvido inteiro (`resolveAuthForLogin(profileId)`, espelho de
  `resolveConfigDirForLogin` mas devolvendo `{kind,...}`), e usam `claudeAuthShellLines`
  igual aos outros dois.

### Login não existe pra perfil de chave

`openClaudeLoginSession(profileId)` resolve o perfil pelo id; se o `kind` for `apikey`,
**não abre sessão nenhuma** e devolve `{ ok: false, error: 'perfis de chave de API não usam
login: a chave já é a credencial' }`. A UI já esconde o botão "Abrir sessão de login" nesses
casos (ver seção UI), então este é o segundo lado da defesa, não um caminho que o usuário
encontra no uso normal.

## Doctor / badge de status

`allClaudeAuthInfo()` passa a ramificar por perfil:

- perfil `dir` (e o legado `''`): comportamento de hoje, `claudeAuthInfo(dir)` lê
  `.claude.json`/`.credentials.json` e devolve `{configDir, account, ready}`.
- perfil `apikey`: sem OAuth pra ler. Devolve `{ configDir: null, account: null,
  ready: !!p.apiKey, apiKeyMode: true }`.

```js
allClaudeAuthInfo() {
  const profiles = this.config.claudeProfiles || [];
  const legacy = { id: '', label: 'Padrão', ...this.claudeAuthInfo() };
  if (!profiles.length) return [legacy];
  return [legacy, ...profiles.map(p => ({
    id: p.id, label: p.label,
    ...(p.kind === 'apikey' ? { configDir: null, account: null, ready: !!p.apiKey, apiKeyMode: true } : this.claudeAuthInfo(p.dir))
  }))];
}
```

`claudeAuthBadge(id)` (ui/app.js) ganha um terceiro ramo antes dos existentes: se
`info.apiKeyMode`, mostra `🔑 chave configurada` (ready) ou `SEM CHAVE` (não), no lugar do
selo de email/"SEM LOGIN".

## UI (Sistema > Plano e chaves)

- **"Adicionar perfil"** ganha um seletor de tipo no topo do form (2 botões, estilo já usado
  em segmentados existentes na tela de Consumo): **Login por assinatura** / **Chave de API**.
  Troca os campos abaixo conforme a escolha:
  - Login por assinatura: nome + diretório (como hoje).
  - Chave de API: nome + campo de chave (`type=password`, com botão 👁 mostrar/ocultar ao
    lado, mesmo padrão `.btn icon sm ghost` já usado em outras ações) + campo opcional de URL
    base, com texto de apoio: *"Deixe em branco para usar a Anthropic direto. Um endpoint
    customizado precisa falar a API de Mensagens da Anthropic — não é garantia de que
    qualquer provedor (ex.: OpenRouter) funcione sem um proxy tradutor."*
- **Cada card de perfil salvo** edita os campos certos pro seu `kind` (mesma edição inline
  reativa que já existe pra label/dir, `change` no card dispara `saveClaudeProfiles`).
  Perfil de chave mostra o mesmo campo mascarado + botão mostrar/ocultar + campo de URL base.
- **Botão "Abrir sessão de login"** só renderiza em perfis `kind !== 'apikey'` (tanto no card
  de cada perfil quanto na linha "Perfil padrão do Farol", quando o padrão resolvido for um
  perfil de chave).
- Badge de status (seção anterior) aparece igual nos dois tipos, só o conteúdo muda.

## Segurança

- Mesma sanitização anti-injeção do `dir` (sem aspas, sem quebra de linha; tira aspas de
  contorno tipo "copiar como caminho" do Explorer) vale pra `apiKey` e `baseUrl`, client-side
  (mesma checagem que já existe pro dir em `ui/app.js`) e server-side
  (`normalizeClaudeProfiles`).
- A chave nunca é logada (`farol.log` não recebe, mesma regra que já protege `GH_TOKEN`) e
  nunca entra no zip de distribuição (config.json já é excluído da auditoria de
  `make-package.ps1`, invariante 7 do `CLAUDE.md`, sem mudança necessária aqui).
- Sem chamada de rede pra validar a chave: o status é só "preenchida ou não" (`!!apiKey`),
  igual a decisão consciente de fora-de-escopo abaixo.

## Testes

- `normalizeClaudeProfiles`: kind ausente vira `'dir'`; `dir` sem `dir` válido descarta;
  `apikey` sem `apiKey` válida descarta; `apiKey`/`baseUrl` com aspas ou quebra de linha no
  meio são rejeitados (mesmos casos hoje cobertos pro `dir`); `baseUrl` vazio é aceito
  (opcional).
- `resolveClaudeAuth`: cascata completa (conta > global > legado) testada pros dois kinds em
  cada nível; perfil apontado inexistente ou com campo obrigatório do seu kind vazio cai no
  legado (mesma regra de robustez que `resolveClaudeConfigDir` já tem hoje).
- `applyClaudeAuthEnv`: seta as vars certas por kind, nunca os dois ao mesmo tempo.
- `claudeAuthShellLines`: as 3 combinações (dir preenchido/vazio, apikey com/sem baseUrl) nos
  dois dialetos (Windows/posix), incluindo o teste de escaping de aspa simples (mesmo ataque
  documentado no `CLAUDE.md` pro `dir`, replicado pra `apiKey`/`baseUrl`).
- `openClaudeLoginSession` com perfil `apikey` devolve `{ok:false}` sem spawnar nada.
- Doctor: `allClaudeAuthInfo()` devolve `apiKeyMode: true`/`ready` correto pra perfil de
  chave, sem tentar ler arquivo nenhum.

## Fora de escopo (decisão consciente)

- **Só `ANTHROPIC_API_KEY` + `ANTHROPIC_BASE_URL`.** Sem `ANTHROPIC_AUTH_TOKEN` (formato
  Bearer, outro mecanismo de auth) nem os modos `CLAUDE_CODE_USE_BEDROCK`/`VERTEX` (cada um
  exige suas próprias variáveis de região/projeto, escopo maior que o pedido aqui).
- **Sem validação de rede.** Não testa a chave contra a API de verdade; o "chave configurada"
  é só presença, não confirmação de que funciona. Se a chave for inválida, o erro aparece só
  quando uma sessão de fato rodar (mesmo comportamento que perfil `dir` sem login já tem
  hoje: só falha na hora de usar).
- **Compatibilidade com OpenRouter não é garantida.** O `claude` CLI fala a API de Mensagens
  da Anthropic; o campo de URL base é um escape hatch genérico pra qualquer endpoint que fale
  esse protocolo (proxy próprio, gateway corporativo), não uma integração testada com o
  OpenRouter especificamente.
