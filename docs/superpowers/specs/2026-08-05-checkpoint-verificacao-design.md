# Checkpoint de verificação: proteger o trabalho já feito contra reprocessamento do zero

Data: 2026-08-05
Status: **DESENHO** (aguardando plano de implementação granular via writing-plans)

## Problema

Achado real (05/08/2026, PR `biudtech/internal-auth#43`, docs: "spec e plano da
autenticacao unificada do backoffice"): a revisão headless verifica afirmações
factuais do documento contra o código real (regra "cobertura da leitura é gate",
CLAUDE.md). No meio da verificação, a sessão despachou um subagente de
verificação (`pr-reviewer`) três vezes seguidas (10:29, 10:33, 10:37), e as três
vezes ele caiu em `529 Overloaded` (sobrecarga temporária da API da Anthropic,
externo ao Farol). Às 10:38-10:39 a sessão principal já tinha checado
manualmente `gateway-watch.ts`, `authz.ts`, `admin.ts`, `forward-auth-test.mjs`
e `removeGuest`. Às 10:47, depois de mais um `529` e o subagente travar de novo,
a sessão decidiu retomar a verificação na mão e **refez exatamente a mesma
lista de checagens, do zero**, sem nenhum reaproveitamento do que já tinha sido
apurado minutos antes na mesma execução.

Consequência dupla:
1. **Desperdício de tokens/tempo real**, cobrado normalmente pela Anthropic
   (as chamadas que tiveram sucesso geraram saída e foram faturadas; só as
   tentativas que morreram no 529 sem gerar saída não custaram nada).
2. **Risco de qualidade**: nada garante que a segunda passada chegue ao MESMO
   veredito da primeira pra cada afirmação. Se divergirem, hoje isso é
   invisível, a última passada simplesmente vence, sem nenhum sinal de alerta.

A causa não é um bug de controle de fluxo do `server.js`/`lib/engine/review.js`
(o Farol só sobe UM processo `claude -p` e deixa o modelo decidir o que fazer
dentro dele; o retry entre ciclos do Farol, `retryAfterNet`, é outro mecanismo,
só entra se a sessão INTEIRA morrer). O redespacho de subagente e a decisão de
redigitar a verificação na mão são escolhas do próprio modelo reagindo ao
`529`, sem nenhuma memória estruturada pra consultar.

## Objetivo

Dar ao processo de verificação uma memória persistida, incremental e
auditável, de forma que:

1. Uma sessão que precisa recomeçar (por causa de um subagente que travou, ou
   de um relançamento inteiro depois de timeout) **não repita o que ela mesma,
   ou uma execução anterior, já confirmou**.
2. Divergência de veredito entre passadas **nunca seja resolvida em silêncio**:
   vira ponto de atenção visível pra você, do mesmo jeito que hoje um PR
   aprovado com ressalva aparece em Revisões recentes.
3. O mecanismo seja **testável e determinístico** (funções puras com testes,
   no padrão do resto de `lib/`), evitando a armadilha de depender só do
   modelo interpretar texto livre pra saber "o que já foi verificado".
4. O desenho sirva só a revisão headless por enquanto, mas com um formato de
   dados genérico o bastante pra outros tipos de sessão (chat, autoanálise,
   pushback) adotarem depois sem reescrever nada, quando fizer sentido.

## Arquitetura em 3 ondas

Cada onda é entregável e testável isoladamente (`npm run check && npm test`
verde antes de passar pra próxima), na mesma disciplina que
`docs/superpowers/plans/gaps-2026-08/00-plano-mestre.md` já estabeleceu pro
projeto. A Onda 3 só começa depois que 1+2 estiverem validadas em uso real
(regra do projeto: nada de trabalho novo empilhado sobre base não confirmada).

### Onda 1: captura incremental via interceptação de tool_use (o app escreve, o modelo só sinaliza)

**Achado crítico da 3ª conferência, que muda o mecanismo desta onda por
completo:** `workspace-template/prompts/pr-review-auto.md`, regra 2, é
explícita: **"NÃO escreva em `state/` (nem memória de autor, nem
highlights). O app grava a partir do campo `memory`."** O desenho anterior
desta onda (sessão gravando o checkpoint via Write/Edit) violava essa regra
de propósito, que existe pra manter TODA escrita em `state/` centralizada no
código do app (mesma razão de `writeJsonAtomic` existir: escrita atômica,
nunca um processo externo mexendo direto no arquivo de estado).

A solução: reaproveitar a interceptação de `tool_use` que **já existe**,
em tempo real, no streaming do `claude -p`. Confirmado no fonte
(`lib/engine/session.js:404-412`, dentro de `handleEvent`):

```js
} else if (block.type === 'tool_use') {
  const sum = engine.toolSummary(block.name, block.input);
  onEvent({ kind: 'tool', text: sum ? `${block.name} · ${sum}` : block.name });
}
```

Cada chamada de ferramenta da sessão já passa por aqui, com `block.input`
completo disponível, ANTES/durante a execução. `toolSummary` (`session.js:294`)
já lê `input.description` pra Bash. A ideia: quando a sessão confirma uma
afirmação, ela roda de qualquer forma um comando Bash pra inspecionar o
código (`sed`, `grep`, etc.); a instrução do prompt pede que o campo
`description` DESSA MESMA chamada (não o `command`, que passa por shell e
sofreria com escaping de aspas dentro do JSON) carregue o veredito, prefixado
por um marcador fixo:

```
description (valor real da string, sem aspas escapadas; a notação com \" abaixo é só
porque isto é markdown mostrando JSON dentro de JSON, o campo em si é texto simples):
FAROL_CHECKPOINT: {"claim":"...","file":"...","line":53,"verdict":"confirmado","evidence":"..."}
```

Isso nunca passa por parser de shell (é um campo de string dentro do JSON do
protocolo `stream-json`, não o comando em si), então não sofre com aspas ou
caracteres especiais na evidência. Quando a afirmação não exige nenhum
comando Bash de verdade (ex.: já foi lida via `Read`), a instrução pede pra
rodar um Bash trivial e seguro só pra carregar o sinal: `command: "true"`
(no-op universal, POSIX e Windows via `cmd`), `description` com o marcador.

**Código novo desta onda (correção: deixa de ser "zero código no engine",
achado da 3ª conferência; o mecanismo de captura passiva EXIGE um pedaço
mínimo de engine pra existir):**

1. `lib/engine/verification-checkpoint.js` (arquivo novo) ganha, já nesta
   onda, só o essencial pra escrever: `checkpointPath(prKey)` (descrito
   acima) e `appendCheckpointEntry(path, entry)`, que lê o arquivo se
   existir (ou parte de `{prKey, prUrl, entries: []}` se não existir),
   empurra a entrada nova e grava com `writeJsonAtomic` (`lib/io.js`, já
   usado no projeto pra escrita atômica de estado). `readCheckpoint`,
   `summarizeCheckpoint` e o gate ficam pra Onda 2 (são o lado da LEITURA,
   que só faz sentido quando já existe dado sendo escrito).
2. Em `session.js`, no MESMO branch `tool_use` já existente (`handleEvent`,
   linha 408-412): um segundo `if` (aditivo, não substitui o `onEvent` que
   já roda) que testa `block.name === 'Bash' &&
   /^FAROL_CHECKPOINT:\s*(.+)$/.test(block.input.description || '')`, extrai
   o JSON depois do marcador, valida contra o schema mínimo (campos
   obrigatórios presentes) e, se válido, resolve `pr.key` via
   `engine.activeReviews.get(id)?.pr?.key` (já gravado por `runHeadlessReview`
   antes de chamar `runClaudeStream`, `review.js:263-267`) e chama
   `appendCheckpointEntry`. JSON inválido depois do marcador é **ignorado
   silenciosamente aqui** (não derruba a sessão por um marcador mal formado;
   o `checkpointGap`/gate da Onda 2 é quem trata malformação que IMPORTA, que
   é a do arquivo final, não de uma linha de captura perdida no meio).

`workspace-template/prompts/pr-review-auto.md` ganha uma seção nova
instruindo a sessão a:

- Antes de checar qualquer afirmação que cite arquivo/linha específico,
  ler o arquivo de checkpoint (caminho exato via `{{CHECKPOINT_PATH}}`,
  substituído no prompt do MESMO jeito que `{{URL}}` já é hoje, dentro do
  corpo de `headlessPromptFor`, sem mudar a assinatura dela). Ler é permitido
  (só ESCREVER em `state/` é vedado pela regra 2); a leitura usa a ferramenta
  `Read` normalmente.
- Se existir entrada com veredito `confirmado` ou `refutado` pra aquela
  afirmação, reaproveitar (citar a evidência já registrada) em vez de reler o
  código.
- Ao estabelecer um veredito novo, rodar o Bash de verificação (ou um `true`
  trivial) com `description` no formato `FAROL_CHECKPOINT: {...}` descrito
  acima, **na hora**, não só no fim da revisão. É o app, ao ver esse evento
  passar pelo stream, que grava o arquivo; a sessão nunca toca `state/`.

Esta onda já corta a maior parte do desperdício visto no PR #43: mesmo com o
mecanismo de captura sendo passivo (a sessão só "avisa" via o campo
`description`, nunca escreve arquivo), o efeito é o mesmo, o app grava
enquanto a sessão avança, e uma interrupção no meio ainda deixa o que já foi
confirmado registrado.

**Risco conhecido desta onda isolada:** depende do modelo seguir a instrução
de emitir o marcador. É por isso que a Onda 2 trava o gate de decisão em cima
do que foi (ou não foi) registrado, e a Onda 3 reforça a instrução de LER
quando já existe checkpoint não-vazio, em vez de deixar só a instrução
genérica.

### Onda 2: leitura, validação, relatório na UI e gate de decisão

Continua em `lib/engine/verification-checkpoint.js` (o mesmo arquivo da Onda
1, mesmo padrão de responsabilidade única de `lib/engine/fanout.js`), agora
com o lado da LEITURA:

- `checkpointPath(prKey)` (já existe desde a Onda 1): deriva o caminho do
  arquivo a partir da key do PR (`org/repo#N`) usando
  `encodeURIComponent(prKey)` (ex.: `biudtech%2Finternal-auth%2343.json`),
  sempre dentro de `state/verification/` no workspace. **Descartada a ideia
  inicial de substituir `/`/`#` por `__`:** owner ou repo podem conter `_`,
  então `org="a__b"` `repo="c"` e `org="a"` `repo="b__c"` colidiriam no mesmo
  arquivo (bug real, achado na 3ª conferência). `encodeURIComponent` é
  injetivo (nunca perde informação, `%` em si também seria escapado se
  aparecesse), então duas keys diferentes NUNCA mapeiam pro mesmo arquivo.
  `%`, `2`, `F` etc. são caracteres válidos em nome de arquivo tanto no
  Windows quanto no macOS.
- `readCheckpoint(path)` (função nova desta onda): lê e valida o JSON. Arquivo ausente devolve
  `{ok: true, entries: []}` (não é erro, é "ainda não existe checkpoint").
  Arquivo presente mas malformado (JSON inválido, campo obrigatório faltando)
  devolve `{ok: false, reason}` (isso SIM é tratado como problema, ver gate
  abaixo). Zero rede, zero side-effect além da leitura.
- `summarizeCheckpoint(entries)`: função pura que agrupa entradas pela
  identidade da afirmação (arquivo+linha+texto da claim) e devolve
  `{total, confirmedCount, conflicts: [...]}`. Um "conflito" é um grupo com
  mais de um veredito diferente pra mesma afirmação, o sinal exato de que uma
  passada discordou da outra.

**Gate de decisão, seguindo o padrão exato de `coverageGap` (confirmado no
fonte, `lib/engine/decision.js:165-219` e `lib/engine/review.js:293-323`):**
`coverageGap(result)` é uma função PURA que só olha `result.coverage` (o
envelope que a própria sessão já devolveu), nunca lê disco. Ela é usada duas
vezes: dentro do gate `shouldAutoApprove(engine, pr, result)` (a implementação
pura em `decision.js`, chamada pela fachada `engine.shouldAutoApprove(pr,
result)` que o `runHeadlessReview` invoca) e, separadamente, em
`runHeadlessReview` (`review.js:310-315`) pra compor o texto humano de
`reasons`. O checkpoint segue a MESMA forma, não uma arquitetura nova:

1. Em `runHeadlessReview`, logo depois de `parseHeadlessResult` (que já lê
   `res.text` e monta `result`) e ANTES de chamar `engine.shouldAutoApprove`,
   uma única leitura: `result.verificationCheckpoint =
   summarizeCheckpoint(readCheckpoint(checkpointPath(pr.key)).entries)`. É
   AQUI que o disco é lido, no arquivo que já faz IO da sessão, não dentro de
   `decision.js` (que continua 100% puro, coerente com o resto dos gates).
2. Nova função pura `checkpointGap(result)` em `decision.js`, ao lado de
   `coverageGap`: olha só `result.verificationCheckpoint` (nunca disco),
   devolve lista de problemas (`['malformado']` ou um item por conflito, ou
   `[]` se limpo/ausente).
3. `shouldAutoApprove` ganha uma linha nova, no mesmo lugar de
   `coverageGap` (`decision.js:177`): `if (checkpointGap(result).length)
   return { ok: false, motivo: 'checkpoint' };`.
4. `runHeadlessReview` ganha um bloco novo, no mesmo formato do bloco de
   `coverageGap` (`review.js:310-315`), prependendo a `result.reasons` quando
   `checkpointGap` não é vazio.

Checkpoint ausente ou limpo não bloqueia nada (mesma filosofia do coverage:
"sem checkpoint" não é sinal de problema, é só ausência de dado, igual PR
pequeno que nunca teve fan-out).

**UI** (`ui/app.js`, seção de relatório em Revisões recentes, mesmo padrão
visual de `coverage`): nova linha "Verificação de afirmações: N confirmadas
nesta passada, M reaproveitadas de checkpoint anterior" e, se houver conflito,
um selo vermelho "⚠ divergência entre passadas" com o detalhe de cada claim
conflitante, sempre visível, nunca escondido atrás de um clique a mais.

### Onda 3: retomada proativa pelo engine, não pelo bom senso do modelo

**Achado que simplifica esta onda:** confirmado no fonte que NÃO existe um
"caminho de relançamento" separado do "caminho de primeira vez".
`retryTargets` (`review.js:414-423`) só filtra e devolve a lista de PRs a
reenfileirar; o relançamento em si passa pelo MESMO `runOneHeadless` →
`runHeadlessReview` → `headlessPromptFor` de sempre (`review.js:104-127`).
Ou seja, a Onda 1 (placeholder `{{CHECKPOINT_PATH}}` sempre presente) JÁ
cobre tecnicamente o caso de retry, porque toda sessão, primeira vez ou
relançada, passa pelo mesmo `headlessPromptFor`.

O que a Onda 1 sozinha NÃO garante é que a instrução genérica ("antes de
checar, veja se já tem entrada") seja tratada com a urgência devida quando
HÁ MESMO algo pra reaproveitar. A Onda 3 fecha essa lacuna com um bloco
CONDICIONAL adicional, construído em `runHeadlessReview` (não em
`headlessPromptFor`, pra não mexer na aridade dela) logo antes da chamada a
`runClaudeStream` (`review.js:287`):

```js
// runHeadlessReview, imediatamente antes de montar o prompt final
let prompt = engine.headlessPromptFor(pr.url, pr.author, lotes, metrics);
const cp = readCheckpoint(checkpointPath(pr.key));
if (cp.ok && cp.entries.length) {
  prompt += resumeBlock(cp.entries.length, checkpointPath(pr.key));
}
const res = await engine.runClaudeStream(prompt, { ... });
```

`resumeBlock(count, path)` é uma função pura nova (mesmo arquivo
`lib/engine/verification-checkpoint.js`) que devolve o texto: "ATENÇÃO: existe
checkpoint parcial de verificação anterior em `<path>`, com N afirmações já
registradas. Leia esse arquivo ANTES de verificar qualquer afirmação; não
repita o que já está lá salvo se quiser reconfirmar por segurança."

Determinístico e testável (existe arquivo não-vazio? sim/não → concatena
bloco ou não), sem tocar na assinatura de nenhuma fachada existente.

## Formato de dados (Onda 2, consumido pela 1 e pela 3)

```json
{
  "prKey": "biudtech/internal-auth#43",
  "prUrl": "https://github.com/biudtech/internal-auth/pull/43",
  "entries": [
    {
      "claim": "gateway-watch.ts:53 verifica resources.active === true",
      "file": "gateway-watch.ts",
      "line": 53,
      "verdict": "confirmado",
      "evidence": "linha 53 confirma: if (resources.active === true)",
      "sessionId": "<id da sessão que gravou>",
      "at": "2026-08-05T10:38:41-03:00"
    }
  ]
}
```

Regras fixas do formato:
- **Append-only.** Nunca sobrescreve nem remove entrada. Um veredito revisado
  pra mesma afirmação vira uma entrada NOVA, com timestamp mais recente; a
  antiga fica, e a divergência é o que o `summarizeCheckpoint` detecta como
  conflito.
- **`verdict`** é um de `confirmado`, `refutado`, `parcial` (afirmação
  parcialmente correta, com ressalva).
- **`at`** sempre em horário de Brasília (regra transversal do projeto,
  `timestamps-horario-brasilia`), nunca UTC cru. Carimbado pelo ENGINE no
  momento em que intercepta o marcador (não pelo modelo, que não tem por que
  saber a hora certa), usando o mesmo helper de horário que o resto do Farol
  já usa pra `state/authors/*.md`.
- **`sessionId`** é o `id` interno da sessão (`activeReviews`), não algo que a
  sessão precisa informar, o engine já sabe.
- Localização do arquivo: `~/.farol/workspace/state/verification/<key
  codificada com encodeURIComponent>.json`, criado sob demanda pelo ENGINE
  (via `writeJsonAtomic`) na primeira captura de marcador; a sessão nunca cria
  nem escreve o arquivo diretamente (ver Onda 1).

## Testes (a confirmar em detalhe na Onda de implementação, escopo aqui)

- `readCheckpoint`: arquivo ausente devolve `{ok:true, entries:[]}`; JSON
  malformado devolve `{ok:false, reason}`; JSON válido mas faltando campo
  obrigatório devolve `{ok:false, reason}`; JSON válido e completo devolve
  `{ok:true, entries}` com os dados intactos.
- `checkpointPath`: `encodeURIComponent` aplicado à key; duas keys diferentes
  (incluindo o caso `a__b/c` vs `a/b__c` que colidia no esquema descartado)
  nunca produzem o mesmo caminho.
- **Interceptação do marcador (`session.js`, Onda 1):** `tool_use` do tipo
  `Bash` com `description` no formato `FAROL_CHECKPOINT: {...}` válido grava
  uma entrada nova no checkpoint da sessão corrente (via `activeReviews`);
  `description` sem o marcador não grava nada (comportamento de hoje,
  intocado); `description` COM o marcador mas JSON inválido depois dele é
  ignorado silenciosamente, sem lançar nem derrubar a sessão; `tool_use` de
  outro tipo de ferramenta (`Read`, `Grep`) nunca aciona a captura, mesmo que
  o texto contenha o marcador por acidente (só `Bash.description` é olhado).
- `summarizeCheckpoint`: sem entradas devolve `{total:0, confirmedCount:0,
  conflicts:[]}`; entradas todas concordantes não geram conflito; duas
  entradas pra mesma afirmação com veredito diferente geram exatamente um
  conflito, citando as duas.
- `checkpointGap` (função pura nova, Onda 2, mesmo arquivo de `coverageGap`):
  `result.verificationCheckpoint` ausente ou limpo devolve `[]`; malformado
  devolve item de erro; com conflito devolve um item por conflito.
- `shouldAutoApprove` (gate, Onda 2): com `checkpointGap` retornando não-vazio,
  o gate devolve `{ok:false, motivo:'checkpoint'}`; com `[]`, segue avaliando
  os outros gates normalmente (não interfere quando não há problema).
- **Nota sobre a aridade das fachadas:** `test/facades.test.js` hoje deriva a
  aridade esperada de cada fachada direto do fonte (lendo `server.js` e
  descobrindo se ela repassa `this`), não depende mais de tabela curada como
  o texto antigo do CLAUDE.md descrevia (achado real de v2.27→v2.28, já
  corrigido). Como esta spec NÃO muda a assinatura de `headlessPromptFor` (o
  placeholder novo entra no corpo, e o bloco de retomada é concatenado em
  `runHeadlessReview`, fora da função), nenhuma fachada existente muda de
  aridade; este ponto simplesmente não é um risco aqui, mas vale confirmar
  rodando `npm test` completo depois de cada onda mesmo assim.
- Prompt (Onda 1): teste no padrão de `test/review-prompt.test.js` garantindo
  que `{{CHECKPOINT_PATH}}` É substituído no prompt final (nunca sobra o
  placeholder cru) e que o valor bate com `checkpointPath(prFromUrl(...).key)`.
- Onda 3, injeção condicional: com checkpoint não-vazio presente no disco
  (arquivo de teste escrito antes), o prompt final contém o `resumeBlock`;
  com checkpoint ausente ou com `entries: []`, o prompt NÃO contém esse bloco
  (teste explícito dos dois casos, não só do caso positivo).
- `runOneHeadless`/`retryTargets`: teste confirmando que uma sessão relançada
  via `retryAfterNet` passa pelo MESMO `headlessPromptFor` (nenhum caminho de
  código separado pro retry), validando a premissa que fecha o desenho da
  Onda 3.

## Segurança

Nada sensível: os arquivos de checkpoint guardam só claims sobre código
público do próprio repo revisado (arquivo, linha, veredito, evidência textual),
sem token, sem segredo, sem dado de conta. Mesma pasta `state/` que já guarda
outros artefatos não sensíveis do workspace.

## Fora de escopo (decisão consciente)

- **Chat, autoanálise e classificação de pushback não ganham checkpoint agora.**
  O formato de dados foi desenhado genérico o bastante (não amarrado à
  revisão headless especificamente) pra esses fluxos adotarem depois sem
  reescrever o schema, mas a implementação desta spec cobre só a revisão
  headless.
- **Reconciliação automática de conflito nunca acontece.** Divergência entre
  passadas é sempre reportada pra decisão humana (mesma filosofia do resto do
  gate: automação decide o caminho fácil, humano decide o caso ambíguo).
  Nenhuma versão futura deveria "resolver sozinho" qual veredito vale.
- **Clique manual de "Revisar" nunca é bloqueado** por checkpoint malformado
  ou com conflito, só a postagem AUTOMÁTICA (mesma regra que já vale pro gate
  de cobertura hoje).
- **Sem detecção de sobrecarga (`529`) em si.** O Farol não tenta prever nem
  evitar que a API da Anthropic fique sobrecarregada; o checkpoint só reduz o
  CUSTO de uma sessão ter que se recuperar disso, não a frequência do evento.
- **Sem retomada de subagentes especificamente (fan-out de PR grande).** O
  fan-out de PR grande (`lib/engine/fanout.js`, lotes por subagente) já tem
  seu próprio mecanismo de consolidação; esta spec cobre o caminho de
  verificação de afirmações (coverage gate de docs/specs), que foi onde o
  incidente do PR #43 aconteceu. Se o fan-out mostrar o mesmo padrão de
  desperdício no futuro, o mesmo formato de checkpoint pode ser estendido pra
  lá, mas não está no escopo desta entrega.
- **Limitação real do mecanismo de captura (Onda 1):** a interceptação em
  `session.js` só enxerga `tool_use` da sessão de NÍVEL PRINCIPAL (o
  orquestrador). Chamadas de ferramenta que rodam DENTRO de um subagente
  (dispatch via `Task`, ex.: o `pr-reviewer` do fan-out) não aparecem nesse
  stream, só o próprio dispatch aparece (`Agent · ...`). No incidente real do
  PR #43, a verificação duplicada foi feita pelo orquestrador diretamente
  (visível no feed como `Bash · Check gateway-watch.ts:53...`), então esse
  caso concreto é coberto. Se no futuro a verificação de afirmações passar a
  rodar dentro de subagente, o mecanismo de captura precisaria ser estendido
  (fora do escopo desta entrega, mas documentado aqui pra não parecer
  esquecimento).
