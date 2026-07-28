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

O maior débito do Farol frente a esta diretriz é o `server.js`: uma classe `Engine` de ~2600 linhas com ~120 métodos fazendo tudo (o oposto do princípio 1 e 2). A correção é decompor em ondas, cada uma protegida pela rede de teste, sem mudar comportamento e sem quebrar os invariantes do `CLAUDE.md`.

- **Onda 0 (feita):** este contrato + a rede (`npm test`, `npm run check`), baseline verde.
- **Onda 1 (feita):** funções puras sem estado pra `lib/` (`format`, `io`, `parse`, `taxonomy`), com teste.
- **Onda 2 (feita):** camadas base `lib/paths.js` (versão/plataforma/caminhos), `lib/workspace.js` (leitura dos artefatos do workspace) e `lib/http-server.js` (adapter HTTP+SSE), e a `Engine` separada por responsabilidade em `lib/engine/` (colaboradores que recebem o `engine` como ctx; a `Engine` mantém fachadas finas que delegam): `update`, `chat`, `tools`, `pushback`, `decision`, `gh-queries`, `session`, `selfpr` (Meus PRs), `review` (pipeline headless + gate). O `server.js` caiu de 3122 pra ~905 linhas; o que ficou na `Engine` é o núcleo legítimo (composição, ciclo de vida, contas/política, polling, settings/snapshot).

Padrão do colaborador: funções `(engine, ...args)`, todo `this.` vira `engine.`, e a `Engine` ganha um método-fachada `x(a) { return mod.x(this, a); }`. Assim nenhum chamador muda e o comportamento é idêntico.

Regra de cada onda: extrai um pedaço → `grep this.` no módulo novo deve dar zero → `npm run check && npm test` verde → só então segue. Sem regressão; refactor é movimentação, não reescrita.

## O gate, em um comando

```bash
npm run check && npm test
```

`check` = `node --check` em `server.js`, `main.js`, `ui/app.js` (sintaxe). `test` = `node --test test/` (a rede: funções puras + smoke de boot). Verde nos dois é pré-requisito de qualquer entrega.
