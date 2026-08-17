# Contrato de qualidade do Farol

Diretriz de qualidade de código do Farol, extraída do `lovelace-eng/lace-be-fastify` (referência de backend em camadas) e adaptada ao stack do Farol (Node puro, zero dependências, sem framework). Leia junto com o `CLAUDE.md` (que manda nos invariantes do app). Este arquivo manda em COMO o código é organizado e verificado.

## De onde vem

O `lace-be-fastify` é um backend TS + Fastify + Prisma + Zod com uma arquitetura em camadas madura. O valor dele pro Farol não é o stack (que é o oposto do nosso), é o conjunto de princípios que tornam o código previsível e seguro de mudar. Abaixo separo o que transfere do que não transfere, pra não copiar cegamente.

## Princípios universais (valem pro Farol)

1. **Responsabilidade única por unidade.** Cada função e cada módulo faz UMA coisa. No lace isso aparece como `route` (fiação) / `resolver` (adapter) / `policy` (regra) / `selector`+`recorder` (dados), cada arquivo com um papel. No Farol a tradução é: nada de função que busca no gh, decide, formata e posta tudo junto; cada passo é uma unidade nomeada.

2. **Separação de camadas.** O fluxo tem estágios distintos e a dependência aponta numa direção só: composição (quem liga as peças) → adapter (fala com o mundo: gh, http, claude) → domínio (a regra: gate de aprovação, política por conta) → dados (ler/gravar estado em disco). A camada de baixo não conhece a de cima.

3. **Estrutura consistente e previsível.** Coisas parecidas têm a mesma forma. Se `parseAccounts`, `parseProjectReviewers` e `parseDefaultReviewers` fazem o mesmo tipo de trabalho, elas moram juntas e seguem o mesmo formato de entrada/saída.

4. **Erros tipados e centralizados.** O lace usa `AppError(mensagem, code, statusCode)` e um handler central. No Farol: erros de operação com causa clara (rede, limite de sessão, binário do claude ausente) são classificados num ponto só, não com `catch` improvisado espalhado. O `farol.log` (invariante 3: só falhas) é o ponto central.

5. **Gate automático, não manual.** O lace roda `lint + format + test` em todo commit (husky + lint-staged). O Farol não tem CI nem husky, mas tem o equivalente possível dentro do zero-deps: `npm test` (runner nativo `node --test`, ZERO dependências) + `npm run check` (`node --check`). Rodar isso é obrigatório antes de qualquer entrega, e é a rede que protege a decomposição em ondas.

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

- **Onda 5 (não feita, o débito atual):** o que sobrou no `ui/app.js` são ~2690 linhas de render, estado, atalhos, paleta de comandos, busca e SSE, ainda sem teste. O próximo passo barato já está mapeado: sete funções (`chatBadge`, `papelPicker`, `domainMatrix`, `reviewerLabel`, `chipHtml`, `buildFixPrompt`, `pushbackControl`) são puras em forma e só leem global, e viram puras com **um parâmetro a mais**; juntas têm menos de 20 chamadores. Depois disso é que faz sentido encarar a separação entre render e estado.

### Números de hoje (mantenha esta linha viva)

| Arquivo | Linhas | Testes |
|---|---|---|
| `ui/app.js` | ~2690 | nenhum (o que sobrou não é puro) |
| `ui/pure.js` | ~235 | `ui-pure.test.js`, 45 testes |
| `server.js` | ~1080 | via `boot`, `facades`, e os testes de comportamento |
| maior módulo de `lib/` (`selfpr.js`) | ~490 | `merge-gates.test.js` |
| suíte | | 1138 testes |

Quem mexer aqui e deixar esses números defasados repete o problema que esta seção teve: o documento afirmava "~2600 linhas com ~120 métodos" muito depois de o `server.js` ter caído para mil.

Padrão do colaborador: funções `(engine, ...args)`, todo `this.` vira `engine.`, e a `Engine` ganha um método-fachada `x(a) { return mod.x(this, a); }`. Assim nenhum chamador muda e o comportamento é idêntico.

Regra de cada onda: extrai um pedaço → `grep this.` no módulo novo deve dar zero → `npm run check && npm test` verde → só então segue. Sem regressão; refactor é movimentação, não reescrita.

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
