# Contrato de qualidade do Farol

Diretriz de qualidade de código do Farol, extraída do `lovelace-eng/lace-be-fastify` (referência de backend em camadas) e adaptada ao stack do Farol (Node puro, zero dependências, sem framework). Leia junto com o `CLAUDE.md` (que manda nos invariantes do app). Este arquivo manda em COMO o código é organizado e verificado.

## De onde vem

O `lace-be-fastify` é um backend TS + Fastify + Prisma + Zod com uma arquitetura em camadas madura. O valor dele pro Farol não é o stack (que é o oposto do nosso), é o conjunto de princípios que tornam o código previsível e seguro de mudar. Abaixo separo o que transfere do que não transfere, pra não copiar cegamente.

## Princípios universais (valem pro Farol)

1. **Responsabilidade única por unidade.** Cada função e cada módulo faz UMA coisa. No lace isso aparece como `route` (fiação) / `resolver` (adapter) / `policy` (regra) / `selector`+`recorder` (dados), cada arquivo com um papel. No Farol a tradução é: nada de função que busca no gh, decide, formata e posta tudo junto; cada passo é uma unidade nomeada.

2. **Separação de camadas.** O fluxo tem estágios distintos e a dependência aponta numa direção só: composição (quem liga as peças) → adapter (fala com o mundo: gh, http, claude) → domínio (a regra: gate de aprovação, política por conta) → dados (ler/gravar estado em disco). A camada de baixo não conhece a de cima.

3. **Estrutura consistente e previsível.** Coisas parecidas têm a mesma forma. Se `parseAccounts`, `parseProjectReviewers` e `parseDefaultReviewers` fazem o mesmo tipo de trabalho, elas moram juntas e seguem o mesmo formato de entrada/saída.

4. **Erros tipados e centralizados.** O lace usa `AppError(mensagem, code, statusCode)` e um handler central. No Farol: erros de operação com causa clara (rede, limite de sessão, binário do claude ausente) são classificados num ponto só, não com `catch` improvisado espalhado. O `farol.log` (invariante 3: só falhas) é o ponto central.

5. **Gate automático, não manual.** O lace roda `lint + format + test` em todo commit (husky + lint-staged). O Farol não tem husky (seria dependência, viola o invariante 1), mas tem o equivalente possível dentro do zero-deps: `npm run check` (`node --check` em todo `.js`) + `npm run lint` (catraca de qualidade + higiene) + `npm test` (runner nativo `node --test`, ZERO dependências). Rodar isso é obrigatório antes de qualquer entrega, e é a rede que protege a decomposição em ondas. Desde 17/08/2026 a mesma trinca roda no **CI** (`.github/workflows/ci.yml`) em todo push na `main` e em todo PR, numa matriz **Linux + Windows + macOS**. O macOS na matriz não é enfeite: o suporte a Mac foi construído sem um Mac de teste, então o CI é a única validação contínua de que o caminho POSIX não quebrou. O job agregador `ci` é o status check exigido pela proteção da `main`, o que permite mexer na matriz sem reconfigurar a regra.

6. **Testabilidade por construção.** O lace separa `app` (fábrica) de `server` (listener) pra testar sem subir HTTP. O Farol já expõe `Engine` e as funções puras via `module.exports`, e o `require` não tem efeito colateral (só `new Engine()` toca disco). Isso é o que torna o teste possível: preservar essa propriedade é regra (nunca fazer trabalho no top-level do módulo).

## O que NÃO transfere (não force no Farol)

Estes são específicos do stack do lace e violariam os invariantes do Farol (ver `CLAUDE.md`, invariante 1: zero dependências além do Electron):

- **Fastify, plugins, ciclo de request/response.** O Farol tem um `http.createServer` mínimo, de propósito.
- **Prisma / selectors+recorders sobre banco.** O estado do Farol é arquivo em `~/.farol`, não banco. A ideia de "acesso a dados isolado" transfere; o Prisma não.
- **Zod / schema-first / tipos derivados.** Não há TS nem build. Validação continua sendo função pura de normalização (`parse*`).
- **Vertical slices por feature (route/resolver/policy/schemas).** Estrutura boa pra HTTP REST; o Farol é um engine de polling + orquestração, a decomposição natural é por RESPONSABILIDADE (gh, review, decisão, chat, update), não por rota.
- **argon2 / jose / helmet / rate-limit.** O Farol não autentica ninguém nem expõe superfície pública; roda em `127.0.0.1`.

## Como o Farol aplica isso (plano em ondas)

O débito original era o `server.js`: uma classe `Engine` de 3122 linhas fazendo tudo (o oposto dos princípios 1 e 2). A correção é decompor em ondas, cada uma protegida pela rede de teste, sem mudar comportamento e sem quebrar os invariantes do `CLAUDE.md`.

- **Onda 0 (feita):** este contrato + a rede (`npm test`, `npm run check`), baseline verde.
- **Onda 1 (feita):** funções puras sem estado pra `lib/` (`format`, `io`, `parse`, `taxonomy`), com teste.
- **Onda 2 (feita):** camadas base `lib/paths.js` (versão/plataforma/caminhos), `lib/workspace.js` (leitura dos artefatos do workspace) e `lib/http-server.js` (adapter HTTP+SSE), e a `Engine` separada por responsabilidade em `lib/engine/` (colaboradores que recebem o `engine` como ctx; a `Engine` mantém fachadas finas que delegam): `update`, `chat`, `tools`, `pushback`, `decision`, `gh-queries`, `session`, `selfpr` (Meus PRs), `review` (pipeline headless + gate). O `server.js` caiu de 3122 pra ~905 linhas; o que ficou na `Engine` é o núcleo legítimo (composição, ciclo de vida, contas/política, polling, settings/snapshot).
- **Onda 3 (feita):** cobertura e gate. Sete módulos de produção estavam sem nenhum teste, incluindo o `selfpr.js` (que mergeia PR no GitHub) e o `pushback.js` (cujo teste era uma cópia manual do gate, ou seja, testava o teste). O `npm run check` validava três arquivos escolhidos a dedo e ignorava os 19 de `lib/`. Corrigido: `tools/check-syntax.js` descobre todo `.js` do projeto, e `test/facades.test.js` deriva do fonte a aridade esperada de cada fachada, no lugar de uma tabela curada de 6.
- **Onda 4 (feita, e depois migrada pra ESM):** o `ui/app.js` não tinha **nenhum** teste, porque é um script de navegador que toca `document` no top-level (o que também viola o princípio 6). As **26 funções puras** saíram para `ui/pure.js`. Na migração ESM (fase 13, ver abaixo), o truque de carga dupla (`<script src>` antes do `app.js` no navegador + rodapé CommonJS pro `node --test`) morreu: `ui/pure.js` usa `export function`/`export const` nativo, `ui/index.html` carrega um `<script type="module" src="app.js">` só (que importa `pure.js` por cima), e o `node --test` importa o mesmo arquivo (`import * as P from '../ui/pure.js'` ou `await import()` quando precisa vir depois de fixar `process.env` como `TZ`).

  Entrou junto o único ajuste de forma: `fmtRel` e `usageDayKeysBack` ganharam um parâmetro `agora = Date.now()`. Todos os chamadores passam um argumento só e nenhum é passado por referência a `.map` (conferido um a um), então nada mudou para eles, e o teste virou determinístico em vez de depender do relógio.

  **Regra do arquivo novo:** só entra o que for puro. Função que precise de `STATE`, `SCOPE` ou `document` fica no `app.js`; para trazer, primeiro passe o que ela lê como parâmetro.

- **Onda 5 (em andamento, o débito atual):** o que sobrou no `ui/app.js` são ~4000 linhas de render, estado, atalhos, paleta de comandos, busca e SSE, ainda sem teste que o execute.

  **Primeiro passo, feito em 17/08/2026:** as sete funções que o texto anterior mapeava saíram. `buildFixPrompt` e `pushbackControl` já tinham ido antes; as cinco restantes foram na mesma leva, e não como cinco casos soltos: `personOf` era a única leitura de global de todo o grupo de perfil, então com `people` no argumento os cinco (`personOf`, `papelOf`, `domLevelOf`, `papelPicker`, `domainMatrix`) viraram puros de uma vez, junto das três tabelas de opções. `reviewerLabel`/`chipHtml` foram juntas (uma chama a outra, ambas liam `reviewerCands`) e `chatBadge` levou `chats`. São 8 funções e ~36 linhas. Os pontos de chamada são **13 no `app.js`** mais 5 internos ao `pure.js` (`personOf` por `papelOf`/`domLevelOf`, `papelOf` por `papelPicker`, `domLevelOf` por `domainMatrix`, `reviewerLabel` por `chipHtml`): 18 no total. O número que circulou antes (19) contava a linha da própria definição como chamador.

  Duas coisas que a extração trouxe de brinde. A primeira: as tabelas de opções **duplicam** as chaves de `lib/taxonomy.js`, e a duplicação é estrutural (o servidor estático só entrega `UI_DIR`, então o navegador não importa `lib/`). Ninguém defendia isso, então chave nova no engine sumiria da UI em silêncio; `test/taxonomy-ui.test.js` passou a comparar os **conjuntos de chaves**, deixando os rótulos livres de propósito (a UI abrevia pra caber no `<select>`). A segunda: o `chipHtml` carregava dois ternários no mesmo statement, o que fez o `ternarioAninhado` do `ui/pure.js` subir ao receber a função; foi corrigido na mudança em vez de re-baselinado, então a dívida líquida **caiu** (`ui/app.js` foi de 57 pra 56 e o `ui/pure.js` não subiu).

  **Como se provou que foi movimentação e não reescrita:** as funções antigas foram reconstruídas do `git show main:ui/app.js`, com os globais injetados, e comparadas com as novas em 27 entradas (login vazio, caixa alta, pessoa inexistente, tentativa de XSS, time desconhecido, time enterprise, chat com contagem zero e sem chat). **Zero divergências** na saída.

  **Segundo passo, no mesmo dia:** o bloco da aba **Consumo** (`fmtMoney`,
  `fmtUsageMetric`, `usageColorsFor`, `usageTooltipHtml` e os quatro construtores
  `usageKpisHtml`/`usageMatrixHtml`/`usageBudgetHtml`/`usageSessionsHtml`, mais as duas
  tabelas de cor). São ~175 linhas, e o bloco **já era puro**: não lia global nenhuma, só
  montava string a partir do resumo que o engine manda. O que o prendia no `app.js` era a
  forma, não o conteúdo: cada função terminava atribuindo em `el.innerHTML`, então parecia
  render de DOM. Separado o build da atribuição, o `app.js` fica com
  `el.innerHTML = xHtml(...)`. O `usageMatrixHtml` devolve `{ html, caption }` porque a
  versão antiga escrevia em dois lugares. Fica de fora o `drawUsageTimeline`, que mede
  `clientWidth` e ata listener, ou seja, precisa do elemento de verdade.

  Três coisas que este passo ensinou, e que valem pros próximos:

  1. **Mover pode quebrar sem que nada acuse.** Deixei `USAGE_KIND_COLOR` e
     `USAGE_PALETTE` pra trás no `app.js`, e três funções passaram a referenciar constante
     inexistente. `node --check` passa (é erro de runtime) e `npm test` passava (nada
     executava o código recém-chegado). Quem denunciou foi a comparação com o original.
     A lição virou teste: o primeiro caso do bloco novo só **executa** cada construtor.
  2. **O ratchet reclama de mudança de casa.** Os 4 ternários aninhados que vieram junto
     fizeram o `pure.js` subir de 16 pra 20 enquanto o `app.js` caía de 56 pra 52, soma
     idêntica. Reescrevi os quatro em vez de re-baselinar, e aí a dívida caiu de verdade:
     72 → 68 nos dois arquivos somados.
  3. **Asserção de texto sobre o `app.js` fica cega quando o código sai dele.** O teste de
     acessibilidade contava `data-goto` só no `app.js` e no HTML, e reprovou por piso
     (6 → 5) sem que nenhuma menção tivesse perdido `role`. Hoje o `pure.js` tem **mais**
     emissores que o `app.js` (5 contra 3), então a varredura passou a incluí-lo: o teste
     ficou mais forte, não só verde.

  **Terceiro passo, ainda no mesmo dia:** o **editor de reviewers** (`defaultFor`,
  `overrideFor`, `reposOfOrg`, `suggestDefault`, `addControl` e o `renderOrgBlock`, que
  compõe todos). Diferente dos dois anteriores, aqui não bastava um parâmetro: as funções
  liam **sete globais** entre config, candidatos e três Sets de estado de tela. Todas só
  **leem** (quem muta os Sets são os handlers, que ficaram no `app.js`), então entra um
  `ctx` único, montado uma vez por renderização (`revCtx`) — mesmo motivo do `peopleOf`.

  A extração foi **de baixo pra cima**: primeiro as folhas, e só então o compositor.
  Tentar o `renderOrgBlock` antes arrastaria as folhas impuras junto. Ficaram de fora o
  `seedException` (muta os Sets e persiste via API) e o `renderReviewersEditor` (escreve
  no DOM).

  A comparação com o original cobriu 32 combinações de estado (exceção aberta, pendente,
  org expandida, candidatos carregados ou não) contra 4 orgs e 4 repos: **768 comparações,
  zero divergências**. Ela pegou dois erros meus antes do commit — `ctx` usado sem ser
  declarado no `seedException`, e três chamadas de `addControl` que ficaram sem receber o
  `ctx`. Os dois são `ReferenceError`/`TypeError` de runtime: `node --check` passa e a
  suíte passava, porque nada executava o caminho novo.

  Um achado de comportamento ficou registrado em teste em vez de corrigido: o
  `suggestDefault` usa limiar `ceil(n/2)`, então com **exatamente duas** exceções o limiar
  vira 1 e qualquer reviewer que apareça numa delas é sugerido. É surpreendente ao ler o
  nome da função, mas mudar seria decisão de produto, não refactor.

  **Quarto passo:** os dois maiores construtores de card do Radar (`queueCardHtml`,
  `panoramaRowHtml`) e o `reviewChip`, 93 linhas. O `acctMark` **ficou** no `app.js` e o
  ctx recebe o resultado dele: ele depende de `SCOPE`, `TWEAK` e da tabela de contas, uma
  cadeia que não tem a ver com desenhar o card, e puxá-la junto arrastaria meio painel de
  contas sem ganho de teste.

  Este foi o primeiro passo a **esbarrar de verdade** no obstáculo previsto: o teste
  "Panorama: o autor fica FORA da caixa que trunca o título" era regex sobre o texto do
  `app.js`, e reprovou quando o markup mudou de arquivo. A resposta não foi repontar o
  regex pro `pure.js`, e sim **migrar a asserção pra teste real** — agora ele renderiza um
  título de 300 caracteres e verifica a estrutura, que é o que o regex tentava aproximar.
  Provado por mutação: reintroduzir o defeito de 11/08 (menção do autor dentro da caixa
  que trunca) faz o teste novo reprovar. A metade de CSS ficou no `ui-widgets`, porque
  `app.css` não é executável. **É o caminho pros próximos passos**: cada extração que
  cruzar uma asserção de texto migra ela junto, e o teste sai mais forte do que entrou.

  O `panoramaRowHtml` trouxe **duas** globais declaradas dentro do `renderPanorama`
  (`runningKeys`, `waitingKeys`) que o regex de conversão não pegou — de novo achadas pela
  comparação, não pelos gates. E carregava as cadeias de ternário mais densas do arquivo
  (o rótulo do estado, o botão, o tooltip com quatro motivos): nomeadas uma a uma, o
  `app.js` caiu de 51 pra 46 e a dívida somada de 67 pra 62.

  **Quinto passo:** o painel **Sistema** (`claudeAuthBadge`, `claudeProfilesHtml`,
  `accountsManagerHtml`), 199 linhas. Dois pedaços ficaram no `app.js` de propósito,
  porque são DOM e não markup: o guarda de foco (não reconstruir enquanto a pessoa
  digita num campo do bloco) e o `hint.hidden` do fim dos perfis, que o listener do
  seletor desfaz.

  Este passo rendeu a lição mais útil sobre o **ratchet de ternário**, e ela custou
  caro: eu passei a maior parte do tempo caçando falso positivo. O gate conta `?` por
  statement **depois de remover comentários e strings** (`strip`, em `rules.js`), coisa
  que eu só fui verificar depois de reescrever comentários e trocar um `'?'` de texto
  da UI por outra palavra. Essa troca chegou a mudar texto visível, e a comparação não
  pegou porque os fixtures não cobriam aquele ramo. **Antes de perseguir o número, leia
  como ele é medido, e bisecte com o scanner de verdade** (`scanFile(source, relPath)`)
  em vez de reimplementar a fórmula.

  O que de fato reduziu a dívida foi tratar repetição, não espremer expressão: um
  helper `sel(cond)` eliminou onze `? ' selected' : ''` idênticos, e a barra de ações
  virou um nome em vez de um bloco inteiro no meio do markup. `app.js` foi de 46 pra 42
  e o `pure.js` voltou pra baseline; a soma caiu de 62 pra 58.

  **Sexto passo:** o banner do topo (`statusBannerHtml`) e o vazio da fila
  (`queueEmptyOkHtml`), mais a limpeza de **17 imports mortos** que os passos 2 a 5
  tinham deixado para trás.

  Este passo foi planejado por uma rodada de análise em paralelo (dez candidatos, cada
  plano passando por dois céticos independentes: um procurando furo no plano, outro só
  no eixo do gate). Valeu por três coisas que eu não teria achado sozinho:

  1. **Import morto não quebra nada e por isso apodrece.** Um cético apontou o risco
     antes de eu cometer o próximo; ao medir, havia **17** já acumulados, todos meus.
     Símbolo importado do `pure.js` que ninguém mais usa passa por `node --check`, pelo
     lint, pela suíte e pelo CI. Virou guarda em `test/app-carrega.test.js`.
  2. **Extrair para função NÃO reduz o ratchet; só nomear em `const` reduz.** O
     `rules.js` conta `?` por trecho separado por `;` no arquivo inteiro, então cada
     hoist precisa ser statement próprio. Foi por isso que o banner saiu com `if`
     planos em vez de ternário encadeado: medido, a escada subiria o `pure.js` de 16
     para 17, e o arquivo tem folga ZERO nesse eixo.
  3. **Um candidato foi descartado com razão.** O `cmdStatic` não tem parte pura com
     ganho real, e saber isso vale tanto quanto extrair.

  O banner saiu **sem `?.`** de propósito: snapshot sem `account` tem que explodir
  alto, como explode hoje, em vez de virar silenciosamente "Nenhuma conta detectada" e
  mentir para quem está olhando.

  **Sétimo passo:** o **diagnóstico** (`diagnosticsText`) e o **cartão da sessão ao
  vivo** (`sessionCardHtml`).

  O diagnóstico é o único texto do Farol que alguém lê **fora** do Farol: a pessoa
  clica em "gerar diagnóstico", cola no chat e espera socorro. Estava sem um único
  teste. Agora tem dez, e um deles é o que faltava — o relatório **promete** no rodapé
  que não contém tokens nem senhas, e nada garantia isso. O teste planta token, senha e
  cabeçalho de autorização no estado e exige que nenhum apareça na saída. Provado por
  mutação: um `JSON.stringify(config)` no relatório faz o teste falhar.

  A extração custou trabalho extra por causa do ratchet. `buildDiagnostics` era um
  `return [...]` gigante com uma dúzia de ternários dentro de template literals — um
  único statement, portanto uma única contagem no `app.js`, mas que estouraria o
  `pure.js` (folga zero). Cada ternário virou seu próprio `const`, o que baixou a soma
  em 2 em vez de subir.

  **As duas asserções fixadas migraram, e a migração é a parte que interessa.** O
  `ui-widgets.test.js` casava regex contra o corpo de `buildDiagnostics` (`indexOf('  Resumo:')
  < indexOf('Detalhe')`) e contra a marcação do cartão (`class="session-stage" data-started=`,
  metade do guarda de B13). Regex contra o fonte quebra quando o código se move mesmo
  sem mudar de comportamento — foi o que aconteceu. Cada uma virou teste de **saída** em
  `ui-pure.test.js`; do lado do `app.js` sobrou só a metade que de fato mora lá (de onde
  vem o dado, quem envelhece o rótulo), com comentário dizendo para onde foi a outra.

  **O que vem depois, e o obstáculo real:** a separação entre render e estado. O `app.js` tem **25 globais mutáveis** espalhados e nenhuma função de boot (tudo é efeito de topo, em ordem de arquivo), então o corte não é mecânico. E há um risco a respeitar: `test/ui-widgets.test.js` fixa **22 corpos de função inteiros** por regex sobre o texto do `app.js`, e mover qualquer um deles faz o `match` devolver `null`. Nenhum dos chamadores deste primeiro passo caía dentro dessas 22 (foi conferido antes de mexer); do próximo em diante, cada extração precisa vir junto com a migração da asserção de texto pra teste real em `pure.js`, que é a direção que o cabeçalho daquele arquivo já defende.

### Números de hoje (mantenha esta linha viva)

| Arquivo | Linhas | Testes |
|---|---|---|
| `ui/app.js` | ~3446 | nenhum que o execute (os 5 que o tocam leem o arquivo como texto) |
| `ui/pure.js` | ~2316 | `ui-pure.test.js`, 285 testes |
| `server.js` | ~1483 | via `boot`, `facades`, e os testes de comportamento |
| maior módulo de `lib/` (`decision.js`) | ~869 | `decision-envelope.test.js`, `decision-history.test.js` |
| suíte | | 1415 testes (1408 passando, 7 pulados fora do macOS) |

Os cinco que leem o `ui/app.js` do disco: `ui-widgets` (fixa 22 corpos de função por
regex), `ui-contract` (extrai as rotas `/api/*` e cruza com o `http-server.js`),
`ui-semantics` (varre texto proibido), `ui-pure` (compara `app.js` com `pure.js`) e
`release-consistency`, que é o único que não olha código: lê só o banner `RELEASE_NOTES`.

Medidos em 17/08/2026, na v2.48.0, depois do primeiro passo da onda 5. O `ui/app.js` só
agora começou a encolher; a onda 5 segue aberta e o grosso dela (render x estado) não foi
tocado.

Quem mexer aqui e deixar esses números defasados repete o problema que esta seção teve: o documento afirmava "~2600 linhas com ~120 métodos" muito depois de o `server.js` ter caído para mil.

Padrão do colaborador: funções `(engine, ...args)`, todo `this.` vira `engine.`, e a `Engine` ganha um método-fachada `x(a) { return mod.x(this, a); }`. Assim nenhum chamador muda e o comportamento é idêntico.

Regra de cada onda: extrai um pedaço → `grep this.` no módulo novo deve dar zero → `npm run check && npm test` verde → só então segue. Sem regressão; refactor é movimentação, não reescrita.

## O ui/app.js virou executável em teste (18/08/2026)

A onda 5 sempre carregou um custo declarado: **nenhum teste executa o `ui/app.js`**. Os
arquivos que o "testam" leem o fonte como texto e casam regex, e num único dia isso
deixou passar dois bugs, ambos com sintaxe válida e CI verde nos três sistemas:

1. bloco de Consumo movido pro `pure.js` deixando `USAGE_KIND_COLOR` pra trás;
2. um regex de conversão enfiando `ctxRev` **dentro** da string `'var(--accent)'`, o que
   quebrou a tela de Reviewers inteira, em produção, por duas releases.

`jsdom` resolveria e está fora (invariante 1). Então entrou `test/helpers/dom-stub.js`:
um DOM mínimo escrito à mão, deliberadamente burro, que existe pra **uma** pergunta —
"carregar a tela e desenhar com um estado plausível levanta exceção?".

O caminho exercitado é o mesmo do app real: o handler de `state` do SSE, que é o
orquestrador de render (chama ~15 funções numa tacada). `test/app-carrega.test.js`
dispara estados plausíveis nele: cheio, vazio, sem reviewers, com org órfã, com decisão
pendente, e com as abas Sistema e Consumo **ativas** (esses dois ramos só desenham
quando a aba está ativa, e foi assim que a primeira versão do teste deixou passar a
mutação do Consumo).

Provado por mutação: reintroduzir qualquer um dos dois bugs reprova o teste, e
`node --check` continua passando nas duas versões corrompidas, que é o ponto.

**O limite, pra ninguém confundir cobertura com garantia:** o stub não faz layout,
cascata nem evento de verdade. Verde aqui não diz que a tela está certa, diz que ela
não explode. Validar visual e clique continua sendo abrir o app.

Nota de operação: o script de test ganhou `--test-force-exit`, porque carregar o
`app.js` liga os timers dele e o runner esperava o event loop drenar.

## Achar trava sem guarda (auditoria de mutação)

O gate diz se a suíte passa. Ele **não** diz se a suíte testa alguma coisa. A
diferença apareceu em 17/08/2026, quando o repo passou a receber contribuição de mais
gente e a pergunta virou "o que dá pra quebrar sem ninguém perceber?".

O método é bruto e funciona: **apaga a trava, roda a suíte inteira, vê se alguém
reclama.** Zero falhas significa que aquela linha não tem dono.

Rodado sobre as 15 travas do caminho de decisão e postagem, achou **três** sem guarda,
todas com a mesma assinatura: um par onde uma metade tinha teste e a outra não.

| trava | approve | reject |
|---|---|---|
| clique nunca auto-posta | 2 testes | **nenhum** |
| cobertura incompleta | 8 testes | **nenhum** |
| token da conta dona (não é par, é única) | — | **nenhum** |

As duas primeiras eram assimetria pura: o mesmo invariante, guardado de um lado e
esquecido do outro, sendo que o comentário do código dizia que o lado desguardado era
o *mais* grave ("reprovar com leitura parcial é pior ainda"). A terceira era a única
coisa impedindo um review de sair assinado pela conta errada, o cenário A1.

**A heurística que sobra disso, e que vale pra revisar contribuição de fora: assimetria
é cheiro.** Quando um caminho novo faz diferente de um caminho velho equivalente, o
velho quase sempre tem uma razão. Foi assim que os dois furos do reenvio apareceram
também: `retryFailedPosts` e `decide()` fazem a mesma coisa (postar um payload decidido
antes) e só um deles lia o head ao vivo.

Vale repetir a varredura quando mexer em gate, e obrigatoriamente antes de afrouxar
qualquer trava: se apagar a linha não reprova nada, o teste que deveria protegê-la não
existe, e o próximo a mexer ali não vai ter aviso nenhum.

## O gate, em um comando

```bash
npm run check && npm run lint && npm test
```

`check` = `tools/check-syntax.js`, que **descobre** todo `.js` do projeto (98 arquivos, ESM nativo desde a migração da fase 13) e valida a sintaxe rodando `node --check` por processo filho em cada um (`execFileSync`, sem `vm.Script`: `node --check` já entende ESM direto, então não precisa de wrapper nenhum). Era uma lista fixa de três arquivos, e por isso os 19 módulos de `lib/` ficavam de fora. `test` = `node --test test/` (a rede). Verde nos dois é pré-requisito de qualquer entrega.

Os dois testes estruturais da rede trazem **piso anti-vacuidade** (`facades.test.js` exige um mínimo de fachadas casadas, `check-syntax.js` um mínimo de arquivos encontrados): verificação dirigida por varredura que deixa de casar vira laço vazio e fica verde sem verificar nada, que é a pior falha possível num gate.

### Princípio 4 ainda não está implementado

Não existe `AppError` nem classificação central de erro. Há dezenas de `catch` vazios espalhados, alguns com justificativa no comentário ("best-effort", "log nunca derruba o app") e a maioria sem. É a lacuna conhecida deste contrato, e o lugar certo de atacá-la é junto com a Onda 4, não antes.

## Gate de ratchet (v2.45.1)

O `lint` é o gate de ratchet do contrato engineering-standards em Node puro (`tools/quality/`): compara as violações com `baseline.json` e reprova qualquer contagem que SUBA. Corrigiu dívida? `npm run lint:update` trava o número mais baixo. A baseline nunca sobe à mão.

Regras medidas (chaves do `rules.js`):

1. `maxLines` — arquivo não pode exceder 400 linhas de código útil.
2. `emptyCatch` — blocos `catch` vazios sem comentário de intenção reprovam.
3. `varUse` — uso de `var` é reprovado; use `const`/`let`.
4. `jsonParseCru` — chamadas diretas a `JSON.parse` fora de `lib/io.js` reprovam.
5. `jsonStringifyCru` — chamadas diretas a `JSON.stringify` fora de `lib/io.js` reprovam.
6. `processEnvDireto` — acesso direto a `process.env` fora de `lib/paths.js` e `lib/env.js` reprovam.
7. `ternarioAninhado` — dois ou mais ternários no mesmo statement reprovam.
8. `tempoMagico` — números mágicos de tempo (milissegundos, segundos) em propriedades ou cálculos reprovam.
9. `portaLiteral` — porta 47170 escrita em código fora de `lib/constants.js` reprova.
10. `profundidadeExcedida` — profundidade de chaves dentro de função acima de 3 níveis reprova (contada a partir do corpo da função).

## Backlog da onda de qualidade (16/08/2026, deferido com veredito de review)

Itens julgados no review final da v2.45.1 como "não bloqueia, fica pra depois". Quem pegar qualidade em seguida, começa por aqui:

1. **Comentários de teste ensinando o invariante CommonJS morto**: `test/merge-gates.test.js` (~linha 9), `test/session-claude-profile.test.js` (~18), `test/boot.test.js` (~5) e `test/account-identity.test.js` (~15) ainda explicam o patch em termos de `require`/referência capturada no load. Pós-ESM o mecanismo real é outro (patch no objeto default + `await import()` depois). Reescrever os comentários pra ensinar o mecanismo atual.
2. **Sombreamento de nome em `lib/engine/session.js`** (~linha 522): o módulo importa `env` (lib/env.js) e o `runClaudeStream` declara um local `const env = engine.ghEnv(...)`. Funciona, mas confunde; renomear o local pra `childEnv`.
3. **Trava estrutural nos módulos de patch**: a garantia de que `run`/`runShell` (io.js) e `prMetrics` (fanout.js) só existem no default mutável é hoje uma omissão da lista de named exports. Uma checagem no `tools/quality/higiene.js` proibindo esses nomes em `export {}` desses dois arquivos transformaria a doutrina em gate.
4. **`realpath` no guard de execução direta** (`server.js`, comparação `import.meta.url` vs `process.argv[1]`): com symlink/junction no caminho, o modo `node server.js` não sobe e não avisa. Teórico na instalação atual (o installer copia arquivos); `fs.realpathSync` nos dois lados fecha.
5. **Ondas futuras do ratchet**: `maxLines` segue com 7 arquivos acima do teto (ui/app.js é a Onda 4 prevista) e `jsonStringifyCru` com 10 pontos. O gate impede crescer; a redução é trabalho de decomposição planejada, não de correção pontual.
