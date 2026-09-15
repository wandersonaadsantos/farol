# A1 Consumo fiel, falha durável e tentativa interrompida: plano de implementação

> **Ajustes de execução (15/09/2026, valem sobre o texto abaixo):** worktree `C:\Users\wanderson\Documents\farol-md-exec`; branch `md/a1` cortada da ponta de `md/integracao` (base `origin/main` `8c043bc`, com `ui/pure/` modularizado, mais C1a, C0 e A5 integradas); sem `git fetch`/`merge origin/main`. Onde o texto manda criar ou acrescentar seção no `EXECUCAO.md`, a evidência vai para `docs/superpowers/handoff/2026-09-15-operacao-multidispositivo/evidencias-execucao/a1.md` e o `EXECUCAO.md` recebe só a linha de estado, os commits e o caminho da evidência. Dependência de entrega mergeada na main significa integrada em `md/integracao`. Números esperados de testes são referência: o que vale é a medição na hora.


> **Para quem executa:** use superpowers:executing-plans, tarefa por tarefa, marcando os checkboxes.

**Objetivo:** fechar os buracos de consumo e de retenção de falha medidos na seção 4.1 da spec: Codex que falha passa a registrar, resultado recusado vira `erro`, custo sem base deixa de valer zero no gate local, o id de sessão fica estável entre boots, a falha de cada sessão fica guardada fora do `farol.log`, a correção de desfecho chega ao banco mesmo depois do cursor, o pushback que falha tem teto por PR, e a sessão cortada por encerramento abrupto do processo vira linha `interrompida` no boot seguinte. O item 1 (medir a contagem dobrada no stream real) sai como script executável e uma tarefa **bloqueada** de captura e correção.

**Arquitetura:** três módulos novos e folhas (`lib/engine/sessao-id.js`, `lib/engine/falhas.js`, `lib/engine/usage-tentativas.js`), costurados nos pontos que já existem: `runProvedor` e o fechamento do Codex (abertura, parcial e fechamento da tentativa), `recordUsage` (marcas `farol_*` novas, sem mudar a assinatura), `profileBudgetStatus` (reserva do custo típico por sessão de custo desconhecido), a outbox (segundo cursor, de correções) e o construtor da `Engine` (reconciliação no boot). Nada aqui toca gate de postagem, decisão de revisão ou escrita no GitHub (CT-COMPAT (b)).

**Stack:** Node puro (>= 22.12), ESM, `node --test` nativo, zero dependências novas.

**Spec:** `docs/superpowers/specs/2026-09-15-operacao-multidispositivo-design.md`, seções 4.1, CT-COMPAT (b), CT-GRUPO ("Cobertura incompleta", regra do valor desconhecido), 7.A1, 13 e 15. Plano mestre: `docs/superpowers/plans/2026-09-15-operacao-multidispositivo-mestre.md` (A1 depende de A5).

## Restrições globais (valem em toda tarefa)

- **Zero dependências** além do Electron. Só `node:crypto`, `node:fs`, `node:path`, `node:child_process`.
- **Texto e comentários em português, sem travessão.** Vírgula, parênteses ou dois pontos.
- **Ratchet do lint não pode subir** (`tools/quality/rules.js`): nada de `JSON.parse`/`JSON.stringify` cru fora de `lib/io.js` (use `readJson`, `parseJson`, `writeJsonAtomic`); nada de `process.env` fora de `lib/paths.js`/`lib/env.js`; número de tempo só em `lib/constants.js`; `catch` vazio só com comentário; nenhum ternário aninhado (dois `?` no mesmo statement contam); profundidade de chaves <= 3 dentro de função (bloco novo dentro de região já estourada conta como estouro novo: prefira statement sem chaves ou função auxiliar); arquivo novo com menos de 400 linhas úteis. A pasta `test/` não é medida pelo gate.
- **Testes:** `node --test`, `FAROL_HOME` temporário fixado ANTES de qualquer import do repo, e import do repo por `await import()` (trava de `test/test-isolation.test.js`). Nunca `~/.farol` real, nunca GitHub, nunca Firebase real, nunca sessão real de Claude ou Codex: só `FAROL_HEADLESS_CMD` apontando para stub local e os dublês de `test/helpers/`.
- **Fachada fina:** toda fachada nova em `server.js` cabe numa linha e repassa todos os argumentos (`test/facades.test.js` deriva a aridade do fonte). Implementação sem parâmetro com default quando houver fachada.
- **Sem atribuição de IA** em commit (nada de `Co-Authored-By` nem "Generated with").
- **Gate por tarefa:** o teste da tarefa verde; ao fim de cada bloco de três tarefas, `npm run check && npm run lint && npm test`.
- **Consome da A5 (não implementar aqui):** o resultado ou o erro da sessão pode carregar `resumeOutcome: 'retomada' | 'recusada' | 'nova' | 'nenhuma'`. Este plano lê `err.resumeOutcome` e grava no registro de falha quando o valor é um desses quatro.
- **Produz (contrato exato):**
  - `lib/engine/usage-tentativas.js`: `abrirTentativa(engine, meta)`, `registrarParcial(engine, attemptId, parcial)`, `fecharTentativa(engine, attemptId)`, `reconciliarInterrompidas(engine)`.
  - `lib/engine/falhas.js`: `registrarFalha(engine, { sessionId, attemptId, kind, account, ref, motivo, classe, etapas, resumeOutcome })`, `falhasRecentes(engine, { limite })`, `falhaDaSessao(engine, sessionId)`.
  - `lib/engine/usage.js`: valor novo `'interrompida'` em `DESFECHOS` e valor novo `'desconhecido'` em `costSource`.

## Decisões técnicas deste plano (registrar no EXECUCAO.md se mudarem)

| Ponto | Escolha | Por quê |
|---|---|---|
| Id opaco de sessão | `id = <prefixo>-<randomUUID()>`, rótulo `<prefixo><n>` guardado em `activeReviews[].rotulo` | `kindFromId` continua funcionando pelo prefixo; único entre boots e aparelhos |
| Sessão de terminal (`t`) | continua com `t<n>` | não registra consumo nem desfecho; trocar mexeria nos scripts `.cmd`/`.command` sem ganho para a A1 |
| `sessionId` do registro de falha | é o id OPACO do Farol; o id da sessão do CLI vai no campo extra `cliSessionId` | o Consumo e o card estacionado ligam pelo id do Farol; a falha pode acontecer antes de existir sessão do CLI |
| Ligação falha x linha do Consumo | `sessionId` e `attemptId` (a linha ganha `attemptId`) | a mesma sessão pode ter duas tentativas (retomada recusada) |
| Fila de correção | a própria linha ganha `corrigidoEm` (durável em `usage-sessions.json`) e a outbox ganha `correcoesAt`, segundo cursor | não cria arquivo de sincronização novo com a sincronização desligada (CT-COMPAT (a) 1) e sobrevive à falta de `deviceId` |
| Reserva do custo desconhecido | `custoTipicoDeReview` por sessão de custo desconhecido do perfil (hoje e desde o corte); status ganha `parcialmenteEstimado: true` | regra de valor desconhecido de CT-GRUPO aplicada ao orçamento local |
| Contagem de desconhecidas | derivada de `usage-sessions.json` (conta também as linhas antigas `sem-base`) | o agregado `byProfileDay` não guarda a origem do custo |
| Linha `interrompida` | registrada no boot, com `at` do boot e `iniciadaEm` da tentativa | `recordUsage` corta o dia pelo relógio; o campo guarda a hora real |
| Tela | só dados no snapshot (`parked[key].sessionId`, `usage.falhasPorSessao`, `budgets[].parcialmenteEstimado`) e dois rótulos que já existem no padrão (`interrompida`, `desconhecido` lido como `não medido`) | desenho de tela vem do Claude Design (D9); a apresentação da falha copiável é da A3 |

## Mapa de arquivos

| Arquivo | Ação | Tarefa |
|---|---|---|
| `tools/medicao/contagem-dobrada.js` | criar | 1 |
| `test/medicao-contagem-dobrada.test.js` | criar | 1 |
| `lib/engine/session.js` (`acumularParcial`) | alterar só depois de desbloqueada | 2 |
| `lib/engine/sessao-id.js` | criar | 3 |
| `lib/engine/review.js:1113`, `lib/engine/selfpr.js:1031`, `lib/engine/pushback.js:237`, `lib/engine/tools.js:96`, `lib/engine/chat.js:76` | alterar | 3 |
| `test/sessao-id.test.js` | criar | 3 |
| `lib/engine/falhas.js` | criar | 4 |
| `server.js` (imports e fachadas de falha) | alterar | 4 |
| `test/falhas-sessao.test.js` | criar | 4 |
| `lib/engine/session.js:1015-1016`, `:1026`; `lib/codex/stream.js:169`, `:172` e exports | alterar | 5 |
| `test/erro-de-sessao-detalhe.test.js` | criar | 5 |
| `lib/engine/usage.js` (`estimarCusto`, `DESFECHOS`, `auditoriaDeConsumo`, `recordUsage`) | alterar | 6 |
| `lib/sync/consolidated.js:14`, `ui/pure.js:249-251`, `:270` | alterar | 6 |
| `test/usage-desconhecido.test.js` | criar | 6 |
| `test/usage-auditoria.test.js:128`, `test/sync-consolidated.test.js`, `test/ui-pure.test.js` | alterar/acrescentar | 6 |
| `lib/engine/usage.js` (`profileBudgetStatus`, `budgetStatusFor`, `linhaDeOrcamento`, `budgetsFrom`) | alterar | 7 |
| `test/usage-desconhecido-gate.test.js` | criar | 7 |
| `lib/codex/stream.js` (`eventoCodex`, `fecharCodex`) | alterar | 8 |
| `test/codex-falha-consumo.test.js` | criar | 8 |
| `lib/engine/review.js` (`lerResultadoDaRevisao`), `lib/engine/selfpr.js:1101`, `lib/engine/pushback.js` (`classifyPushback`), `lib/engine/tools.js:118` | alterar | 9 |
| `test/resultado-recusado-desfecho.test.js` | criar | 9 |
| `lib/engine/review.js` (`runOneHeadless`, `falhaDaAutoanalise`, `runHeadlessReview`, `estacionar`, `parkedParaUi`), `lib/engine/selfpr.js` (`runSelfAnalysis`), `lib/engine/tools.js` (catch), `lib/engine/usage.js` (`usageSummary`) | alterar | 10 |
| `test/falha-duravel-fiacao.test.js` | criar | 10 |
| `lib/engine/pushback.js` (`scanPushbacks`, `classifyPushback`) | alterar | 11 |
| `test/pushback-teto.test.js` | criar | 11 |
| `lib/sync/outbox.js`, `lib/engine/sync-usage.js` (`outboxReconciliada`), `lib/engine/usage.js` (`marcarDesfecho`) | alterar | 12 |
| `test/sync-outbox.test.js` | acrescentar | 12 |
| `lib/constants.js` (`TEMPOS.TENTATIVA_PARCIAL_MS`) | alterar | 13 |
| `lib/engine/usage-tentativas.js` | criar | 13 |
| `test/usage-tentativas.test.js` | criar | 13 |
| `lib/engine/session.js` (`runProvedor`, `registrarConsumo`), `lib/codex/stream.js` (`registrarUsoCodex`, `ligarCodexChild`, `runCodexStream`), `server.js:355` | alterar | 14 |
| `test/usage-tentativas-fiacao.test.js` | criar | 14 |
| `test/usage-interrompida-processo.test.js` | criar | 15 |
| `CLAUDE.md` (Mapa de arquivos), `docs/superpowers/handoff/2026-09-15-operacao-multidispositivo/EXECUCAO.md` | alterar | 16 |

**Antes de começar:** conferir na ponta de `md/integracao` (depois da A5) que as âncoras acima ainda valem: `grep -n "sessionSeq" lib server.js`, `grep -n "function registrarConsumo\|function acumularParcial\|slice(0, 300)" lib/engine/session.js lib/codex/stream.js`, `grep -n "function lerResultadoDaRevisao\|function estacionar\|function parkedParaUi" lib/engine/review.js`. Linha que andou por causa da A5 é ajuste técnico: corrigir aqui e registrar.

---

### Tarefa 1: script de medição da contagem dobrada (executável)

**Arquivos:**
- Criar: `tools/medicao/contagem-dobrada.js`
- Criar: `test/medicao-contagem-dobrada.test.js`
- Ler (não modificar): `lib/engine/session.js` (`acumularParcial`, ~1079)

**Interfaces:**
- Consome: `acumularParcial(acc, usage)` de `lib/engine/session.js`, `parseJson`/`safeStringify` de `lib/io.js`, `executadoDireto` de `lib/paths.js`.
- Produz: `medirContagem(texto)`, `desfechoDaMedicao(m)`, `formatarRelatorio(m)`, `extrairFixture(texto)`; CLI `node tools/medicao/contagem-dobrada.js <stream.jsonl> [--fixture <saida.jsonl>]`.

O script não é distribuído (`tools/make-package.ps1:47` copia uma lista fixa de `tools/`). Ele existe para a Tarefa 2 decidir com número, não com suspeita.

- [ ] **Passo 1: escrever o teste que falha**

Crie `test/medicao-contagem-dobrada.test.js`:

```js
// A suspeita de contagem dobrada (spec 7.A1, item 1) só se decide com o stream REAL.
// Este teste trava a aritmética do instrumento sobre fixtures sintéticas: se o script
// medir errado, a correção do acumulador sairia de um número errado.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-medicao-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const med = await import('../tools/medicao/contagem-dobrada.js');
const SCRIPT = path.join(import.meta.dirname, '..', 'tools', 'medicao', 'contagem-dobrada.js');

after(() => { try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const linha = (o) => JSON.stringify(o);
const assistant = (id, usage) => linha({ type: 'assistant', message: { id, content: [{ type: 'text', text: 'x' }], usage } });
const resultado = (usage) => linha({ type: 'result', is_error: false, result: 'ok', usage, total_cost_usd: 1 });

const DOBRADA = [
  linha({ type: 'system', subtype: 'init', model: 'claude-opus-5' }),
  assistant('msg_1', { input_tokens: 10, output_tokens: 100 }),
  assistant('msg_1', { input_tokens: 10, output_tokens: 100 }),
  assistant('msg_2', { input_tokens: 5, output_tokens: 50 }),
  'linha que não é JSON',
  resultado({ input_tokens: 15, output_tokens: 150 }),
].join('\n');

test('mesmo message.id repetido com o mesmo uso: acumulador soma duas vezes e o desfecho é dobrada', () => {
  const m = med.medirContagem(DOBRADA);
  assert.equal(m.eventosAssistant, 3);
  assert.equal(m.mensagensUnicas, 2);
  assert.equal(m.repetidos, 1);
  assert.equal(m.repetidosDiferentes, 0);
  assert.equal(m.acumulador.output_tokens, 250);
  assert.equal(m.dedup.output_tokens, 150);
  assert.equal(m.final.output_tokens, 150);
  assert.equal(m.desfecho, 'dobrada');
});

test('sem id repetido o desfecho é sem-repeticao', () => {
  const texto = [assistant('a', { output_tokens: 7 }), assistant('b', { output_tokens: 3 }), resultado({ output_tokens: 10 })].join('\n');
  assert.equal(med.medirContagem(texto).desfecho, 'sem-repeticao');
});

test('id repetido com uso incremental: a soma é a certa e o desfecho é soma-correta', () => {
  const texto = [assistant('m', { output_tokens: 40 }), assistant('m', { output_tokens: 60 }), resultado({ output_tokens: 100 })].join('\n');
  const m = med.medirContagem(texto);
  assert.equal(m.repetidosDiferentes, 1);
  assert.equal(m.dedup.output_tokens, 60, 'dedup guarda o último uso de cada id');
  assert.equal(m.desfecho, 'soma-correta');
});

test('id repetido sem evento final não conclui nada', () => {
  const texto = [assistant('m', { output_tokens: 40 }), assistant('m', { output_tokens: 40 })].join('\n');
  assert.equal(med.medirContagem(texto).desfecho, 'inconclusiva-sem-final');
});

test('nenhuma soma perto do final: divergente', () => {
  const texto = [assistant('m', { output_tokens: 40 }), assistant('m', { output_tokens: 40 }), resultado({ output_tokens: 500 })].join('\n');
  assert.equal(med.medirContagem(texto).desfecho, 'divergente');
});

test('extrairFixture guarda só tipo, id e uso: nada de conteúdo da sessão', () => {
  const fixture = med.extrairFixture(DOBRADA);
  assert.doesNotMatch(fixture, /"text"/);
  assert.doesNotMatch(fixture, /claude-opus-5/);
  assert.equal(med.medirContagem(fixture).desfecho, 'dobrada', 'a fixture reproduz a medição');
});

test('CLI imprime o relatório e grava a fixture; sem argumento sai com 2', () => {
  const env = { ...process.env, FAROL_HOME };
  const arquivo = path.join(FAROL_HOME, 'stream.jsonl');
  fs.writeFileSync(arquivo, DOBRADA);
  const ok = spawnSync(process.execPath, [SCRIPT, arquivo], { encoding: 'utf8', env });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /desfecho: dobrada/);
  const saida = path.join(FAROL_HOME, 'fixture.jsonl');
  const comFixture = spawnSync(process.execPath, [SCRIPT, arquivo, '--fixture', saida], { encoding: 'utf8', env });
  assert.equal(comFixture.status, 0, comFixture.stderr);
  assert.equal(med.medirContagem(fs.readFileSync(saida, 'utf8')).desfecho, 'dobrada');
  assert.equal(spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', env }).status, 2);
});
```

- [ ] **Passo 2: rodar e ver falhar**

`node --test test/medicao-contagem-dobrada.test.js`
Esperado: falha no import com `ERR_MODULE_NOT_FOUND` para `tools/medicao/contagem-dobrada.js`.

- [ ] **Passo 3: implementar**

Crie `tools/medicao/contagem-dobrada.js`:

```js
// Medição da suspeita de contagem dobrada do consumo parcial (spec 7.A1, item 1).
//
// O acumulador da sessão (acumularParcial, lib/engine/session.js) soma o `usage` de
// CADA evento `assistant` do stream-json. No transcrito o mesmo `message.id` aparece
// em mais de um evento (um por bloco de conteúdo), e ninguém mediu se esses eventos
// repetem o MESMO uso (a soma conta duas vezes) ou carregam incrementos (a soma está
// certa). Este script lê um stream capturado de sessão REAL e compara três números: a
// soma do acumulador de verdade, a soma deduplicada por message.id (último uso de cada
// id) e o uso do evento final. Não corrige nada: a correção é a Tarefa 2 do plano da
// A1, e ela depende do desfecho impresso aqui.
//
// O critério usa o token de SAÍDA porque é o denominador do custo estimado
// (tokensDeCusto em lib/engine/usage.js); os outros campos saem no relatório.
import fs from 'node:fs';
import { parseJson, safeStringify } from '../../lib/io.js';
import { executadoDireto } from '../../lib/paths.js';
import { acumularParcial } from '../../lib/engine/session.js';

const CAMPOS = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'];
// 5% de tolerância: o evento final pode incluir o fechamento da sessão
const TOLERANCIA = 0.05;

function zerado() { return Object.fromEntries(CAMPOS.map((c) => [c, 0])); }

function somar(acc, usage) {
  for (const c of CAMPOS) acc[c] += Number(usage && usage[c]) || 0;
}

function mesmoUso(a, b) {
  return CAMPOS.every((c) => (Number(a && a[c]) || 0) === (Number(b && b[c]) || 0));
}

function eventos(texto) {
  return String(texto || '').split(/\r?\n/).map((l) => parseJson(l.trim(), null)).filter((ev) => ev && typeof ev === 'object');
}

function medirContagem(texto) {
  const m = { eventosAssistant: 0, mensagensUnicas: 0, repetidos: 0, repetidosDiferentes: 0, acumulador: zerado(), dedup: zerado(), final: null };
  const porId = new Map();
  for (const ev of eventos(texto)) {
    if (ev.type === 'result') { m.final = zerado(); somar(m.final, ev.usage); continue; }
    if (ev.type !== 'assistant' || !ev.message) continue;
    m.eventosAssistant++;
    const usage = ev.message.usage;
    acumularParcial(m.acumulador, usage);
    const id = typeof ev.message.id === 'string' ? ev.message.id : '';
    if (!id) { somar(m.dedup, usage); continue; }
    if (porId.has(id)) { m.repetidos++; if (!mesmoUso(porId.get(id), usage)) m.repetidosDiferentes++; }
    porId.set(id, usage);
  }
  for (const u of porId.values()) somar(m.dedup, u);
  m.mensagensUnicas = porId.size;
  m.desfecho = desfechoDaMedicao(m);
  return m;
}

function distancia(valor, final) {
  return Math.abs(valor - final) / Math.max(1, final);
}

// Ordem fixa, a primeira que vale decide. Cada desfecho tem a ação correspondente
// escrita na Tarefa 2 do plano da A1.
function desfechoDaMedicao(m) {
  if (!m.repetidos) return 'sem-repeticao';
  if (!m.final) return 'inconclusiva-sem-final';
  const alvo = m.final.output_tokens;
  const dAcum = distancia(m.acumulador.output_tokens, alvo);
  const dDedup = distancia(m.dedup.output_tokens, alvo);
  if (dDedup <= TOLERANCIA && dDedup < dAcum) return 'dobrada';
  if (dAcum <= TOLERANCIA) return 'soma-correta';
  return 'divergente';
}

function valorFinal(m, nome) {
  return m.final ? m.final[nome] : 'ausente';
}

function formatarRelatorio(m) {
  return [
    `eventos assistant: ${m.eventosAssistant}`,
    `mensagens únicas: ${m.mensagensUnicas}`,
    `ids repetidos: ${m.repetidos} (com uso diferente: ${m.repetidosDiferentes})`,
    ...CAMPOS.map((c) => `${c}: acumulador ${m.acumulador[c]} | dedup ${m.dedup[c]} | final ${valorFinal(m, c)}`),
    `desfecho: ${m.desfecho}`,
  ].join('\n');
}

// Fixture versionável: só o que a medição usa. Conteúdo, modelo, ferramenta e caminho
// ficam de fora, porque o stream de sessão real carrega código e texto de PR.
function extrairFixture(texto) {
  const saida = [];
  for (const ev of eventos(texto)) {
    if (ev.type === 'result') saida.push(safeStringify({ type: 'result', usage: ev.usage || {} }));
    else if (ev.type === 'assistant' && ev.message) saida.push(safeStringify({ type: 'assistant', message: { id: ev.message.id, usage: ev.message.usage || {} } }));
  }
  return saida.join('\n') + '\n';
}

function principal(args) {
  const arquivo = args[0];
  if (!arquivo) {
    console.error('uso: node tools/medicao/contagem-dobrada.js <stream.jsonl> [--fixture <saida.jsonl>]');
    return 2;
  }
  const texto = fs.readFileSync(arquivo, 'utf8');
  console.log(formatarRelatorio(medirContagem(texto)));
  const i = args.indexOf('--fixture');
  if (i >= 0 && args[i + 1]) fs.writeFileSync(args[i + 1], extrairFixture(texto));
  return 0;
}

if (executadoDireto(import.meta.url)) process.exitCode = principal(process.argv.slice(2));

export default { medirContagem, desfechoDaMedicao, formatarRelatorio, extrairFixture };
export { medirContagem, desfechoDaMedicao, formatarRelatorio, extrairFixture };
```

- [ ] **Passo 4: rodar e ver passar**

`node --test test/medicao-contagem-dobrada.test.js` → 7 testes, 0 falhas. `npm run check && npm run lint` → verde, sem regressão.

- [ ] **Passo 5: contraprova**

Em `medirContagem`, troque `porId.set(id, usage);` por `porId.set(id + ':' + m.eventosAssistant, usage);` (a deduplicação deixa de existir). Rode o teste: `mesmo message.id repetido...` falha em `m.dedup.output_tokens` (250 em vez de 150). Restaure a linha, rode de novo (verde) e confira com `git diff --stat` que só os dois arquivos novos aparecem.

- [ ] **Passo 6: commit**

```
git add tools/medicao/contagem-dobrada.js test/medicao-contagem-dobrada.test.js
git commit -m "feat(medicao): script que compara acumulador, soma deduplicada e uso final do stream"
```

---

### Tarefa 2: captura do stream real e correção do acumulador

**BLOQUEADA: depende de autorização para sessões reais do CLI**

**Condição de desbloqueio:** autorização explícita do dono, em chat, para até 3 sessões headless triviais do Claude CLI, sem PR, com `FAROL_HOME` isolado (plano mestre, seção 2, e spec seção 13). Até lá a tarefa fica registrada como bloqueada no `EXECUCAO.md` e nenhum passo abaixo é executado. Nenhuma outra tarefa deste plano depende dela.

**Arquivos (quando desbloqueada):**
- Usar: `tools/medicao/contagem-dobrada.js` (Tarefa 1)
- Criar: `test/fixtures/medicao/stream-real-1.jsonl`, `-2.jsonl`, `-3.jsonl` (só a saída de `--fixture`)
- Alterar conforme o desfecho: `lib/engine/session.js` (`acumularParcial`, ~1079, e a chamada em `handleEvent`, ~961), `test/usage-parcial-stream.test.js`

- [ ] **Passo 1 (bloqueado): capturar**

Três sessões, uma por formato de conteúdo (raciocínio, ferramenta, ferramenta mais texto), gravadas fora do repositório. PowerShell:

```
$d = Join-Path $env:TEMP 'farol-medicao'; New-Item -ItemType Directory -Force $d | Out-Null
$env:FAROL_HOME = $d
claude -p --output-format stream-json --verbose "Pense passo a passo antes de responder: quanto é 17 vezes 23?" > "$d\stream-1.jsonl"
claude -p --output-format stream-json --verbose "Use a ferramenta Read no arquivo package.json desta pasta e diga só o valor do campo name." > "$d\stream-2.jsonl"
claude -p --output-format stream-json --verbose "Liste com a ferramenta Glob os arquivos .md desta pasta e depois escreva um parágrafo curto sobre eles." > "$d\stream-3.jsonl"
```

- [ ] **Passo 2 (bloqueado): medir e registrar**

Para cada N: `node tools/medicao/contagem-dobrada.js "$d\stream-N.jsonl" --fixture test/fixtures/medicao/stream-real-N.jsonl`. Copie os três relatórios para o `EXECUCAO.md` ("Ajustes técnicos relevantes", título "A1 item 1: medição"). Antes de `git add`, abra cada fixture e confirme que só existem `type`, `message.id` e `usage`.

- [ ] **Passo 3 (bloqueado): corrigir conforme o desfecho**

Vale o desfecho comum às três capturas; se discordarem, vale a linha `divergente`.

| Desfecho | O que muda em `acumularParcial` |
|---|---|
| `sem-repeticao` | **nada.** Acrescentar em `test/usage-parcial-stream.test.js` um teste que lê as três fixtures e exige `medirContagem(fixture).desfecho === 'sem-repeticao'` (trava a premissa) |
| `soma-correta` | **nada.** Mesmo teste de fixture exigindo `soma-correta`, e um comentário acima de `acumularParcial` registrando que id repetido carrega incremento, medido em 3 sessões reais |
| `dobrada` | deduplicar por `message.id`, último uso vence (código abaixo); a chamada em `handleEvent` passa a ser `acumularParcial(parcial, ev.message.usage, ev.message.id)` |
| `divergente` ou `inconclusiva-sem-final` | **nada no acumulador.** Registrar os números, marcar o item 1 como "medido, sem conclusão" e levar ao dono como decisão pendente; a linha parcial continua `costSource: 'estimado'` |

Código para `dobrada` (substitui a função inteira em `lib/engine/session.js`):

```js
const CAMPOS_USO = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'];

// Soma o usage de UMA mensagem no acumulador da sessão. MEDIDO em sessão real (A1,
// item 1): o mesmo message.id se repete com o MESMO uso, então cada id conta uma vez,
// com o último uso visto. Mensagem sem id continua somando (sem id não há dedup). O
// mapa por id é não enumerável para nunca viajar no diário de tentativas.
function acumularParcial(acc, usage, messageId) {
  if (!acc || !usage || typeof usage !== 'object') return false;
  const valores = {};
  let algum = false;
  for (const campo of CAMPOS_USO) {
    valores[campo] = Math.max(0, Number(usage[campo]) || 0);
    if (valores[campo] > 0) algum = true;
  }
  if (!algum) return false;
  if (typeof messageId === 'string' && messageId) {
    if (!acc.porMensagem) Object.defineProperty(acc, 'porMensagem', { value: new Map(), enumerable: false });
    const anterior = acc.porMensagem.get(messageId);
    if (anterior) for (const campo of CAMPOS_USO) acc[campo] -= anterior[campo];
    acc.porMensagem.set(messageId, valores);
  }
  for (const campo of CAMPOS_USO) acc[campo] += valores[campo];
  return true;
}
```

Teste novo em `test/usage-parcial-stream.test.js`: dois `acumularParcial(acc, { output_tokens: 100 }, 'msg_1')` e um `acumularParcial(acc, { output_tokens: 50 }, 'msg_2')` deixam `acc.output_tokens === 150`; e para cada fixture real, `medirContagem(fixture).dedup.output_tokens` é igual ao acumulador corrigido alimentado com os mesmos eventos. Contraprova: remover a linha `if (anterior) ...`; o teste de 150 falha com 250; restaurar. Commit: `git add lib/engine/session.js test/usage-parcial-stream.test.js test/fixtures/medicao` e `git commit -m "fix(consumo): parcial deduplicado por message.id, medido no stream real"`.

---

### Tarefa 3: id de sessão opaco e estável entre boots

**Arquivos:**
- Criar: `lib/engine/sessao-id.js`, `test/sessao-id.test.js`
- Alterar: `lib/engine/review.js:1113`, `lib/engine/selfpr.js:1031`, `lib/engine/pushback.js:237`, `lib/engine/tools.js:96`, `lib/engine/chat.js:76`

**Interfaces:**
- Consome: `engine.sessionSeq` (`server.js:254`), `kindFromId` (`lib/engine/usage.js`).
- Produz: `novoIdDeSessao(engine, prefixo)` devolvendo `{ id, rotulo }`; `activeReviews[id].rotulo`.

- [ ] **Passo 1: escrever o teste que falha**

Crie `test/sessao-id.test.js`:

```js
// O id de sessão (a1, s1...) zerava a cada boot (server.js, sessionSeq), e o
// marcarDesfecho pega a entrada MAIS RECENTE com aquele id: depois de um reinício o
// desfecho de uma análise antiga caía na sessão nova de mesmo rótulo (spec 4.1, extras).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-sessao-id-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { Engine } = await import('../server.js');
const { novoIdDeSessao } = await import('../lib/engine/sessao-id.js');
const { kindFromId } = await import('../lib/engine/usage.js');

after(() => { try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const RAIZ = path.join(import.meta.dirname, '..');
const RESULTADO = { usage: { input_tokens: 5, output_tokens: 7 }, total_cost_usd: 0.5 };

test('dois boots não reutilizam id, e o rótulo curto recomeça só para exibição', () => {
  const a = novoIdDeSessao(new Engine(), 'a');
  const b = novoIdDeSessao(new Engine(), 'a');
  assert.notEqual(a.id, b.id);
  assert.equal(a.rotulo, 'a1');
  assert.equal(b.rotulo, 'a1');
  assert.match(a.id, /^a-[0-9a-f-]{36}$/);
});

test('marcarDesfecho corrige a sessão certa depois de um reinício', () => {
  const primeiro = new Engine();
  const velho = novoIdDeSessao(primeiro, 's').id;
  primeiro.recordUsage(velho, 'eu', RESULTADO, 'claude-opus-5', '', 'o/r#1');
  const segundo = new Engine();
  const novo = novoIdDeSessao(segundo, 's').id;
  segundo.recordUsage(novo, 'eu', RESULTADO, 'claude-opus-5', '', 'o/r#2');
  assert.equal(segundo.marcarDesfecho(velho, 'descartada'), true);
  const linhas = segundo.usageSessions.sessions;
  assert.equal(linhas.find((s) => s.id === velho).status, 'descartada');
  assert.equal(linhas.find((s) => s.id === novo).status, 'ok', 'a sessão nova não herda o desfecho da antiga');
});

test('kindFromId continua lendo o tipo pelo prefixo do id opaco', () => {
  const e = new Engine();
  assert.equal(kindFromId(novoIdDeSessao(e, 'a').id), 'review');
  assert.equal(kindFromId(novoIdDeSessao(e, 's').id), 'self');
  assert.equal(kindFromId(novoIdDeSessao(e, 'pb').id), 'pushback');
  assert.equal(kindFromId(novoIdDeSessao(e, 'f').id), 'tool');
  assert.equal(kindFromId(novoIdDeSessao(e, 'c').id), 'chat');
});

test('prefixo desconhecido é recusado', () => {
  assert.throws(() => novoIdDeSessao(new Engine(), 'x'), /prefixo de sessão desconhecido/);
});

test('as cinco sessões de IA usam o id opaco, nenhuma monta id com o contador', () => {
  const sitios = [['lib/engine/review.js', 'a'], ['lib/engine/selfpr.js', 's'], ['lib/engine/pushback.js', 'pb'], ['lib/engine/tools.js', 'f'], ['lib/engine/chat.js', 'c']];
  for (const [arquivo, prefixo] of sitios) {
    const fonte = fs.readFileSync(path.join(RAIZ, arquivo), 'utf8');
    assert.match(fonte, new RegExp(`novoIdDeSessao\\(engine, '${prefixo}'\\)`), arquivo);
    assert.doesNotMatch(fonte, /\+\+engine\.sessionSeq/, `${arquivo} ainda monta id pelo contador`);
  }
});
```

- [ ] **Passo 2: rodar e ver falhar**

`node --test test/sessao-id.test.js` → falha no import de `lib/engine/sessao-id.js` (`ERR_MODULE_NOT_FOUND`).

- [ ] **Passo 3: implementar o módulo**

Crie `lib/engine/sessao-id.js`:

```js
// Id de sessão de IA do Farol (spec 7.A1, item 5). O id é OPACO e único entre boots
// e aparelhos (prefixo do tipo + UUID): é por ele que o desfecho se corrige
// (marcarDesfecho), que a falha durável se liga à linha do Consumo e que a outbox
// monta o eventId. O rótulo curto (a1, s2...) continua existindo, só para exibição.
// O prefixo fica na frente de propósito: kindFromId (lib/engine/usage.js) lê o tipo
// por ele, e as linhas antigas (a1, pb3) continuam sendo lidas do mesmo jeito.
// Sessão de terminal (t<n>) fica fora: não registra consumo nem desfecho.
import { randomUUID } from 'node:crypto';

const PREFIXOS = new Set(['a', 's', 'pb', 'f', 'c']);

function novoIdDeSessao(engine, prefixo) {
  if (!PREFIXOS.has(prefixo)) throw new Error(`prefixo de sessão desconhecido: ${prefixo}`);
  const seq = (Number(engine && engine.sessionSeq) || 0) + 1;
  if (engine) engine.sessionSeq = seq;
  return { id: `${prefixo}-${randomUUID()}`, rotulo: `${prefixo}${seq}` };
}

export default { novoIdDeSessao };
export { novoIdDeSessao };
```

- [ ] **Passo 4: trocar os cinco sítios**

1. `lib/engine/review.js`: acrescente `import { novoIdDeSessao } from './sessao-id.js';` junto dos imports locais (depois de `import { repoDoPr } from './review-signal.js';`). Em `runHeadlessReview` (linha 1113), troque
   `  const id = \`a${++engine.sessionSeq}\`;` por `  const { id, rotulo } = novoIdDeSessao(engine, 'a');`
   e no objeto logo abaixo troque `    id, keys: [pr.key], label: \`Revisão automática de ${pr.key}\`, mode: 'auto', checkpoint: 'review',` por `    id, rotulo, keys: [pr.key], label: \`Revisão automática de ${pr.key}\`, mode: 'auto', checkpoint: 'review',`.
2. `lib/engine/selfpr.js`: import `import { novoIdDeSessao } from './sessao-id.js';` depois do import de `verification-checkpoint.js`. Linha 1031: `  const { id, rotulo } = novoIdDeSessao(engine, 's');`; no `activeReviews.set` troque `    id, keys: [pr.key], label: \`Autoanálise de ${pr.key}\`, mode: 'self',` por `    id, rotulo, keys: [pr.key], label: \`Autoanálise de ${pr.key}\`, mode: 'self',`.
3. `lib/engine/pushback.js`: import `import { novoIdDeSessao } from './sessao-id.js';` depois do import de `../taxonomy.js`. Linha 237: `  const { id } = novoIdDeSessao(engine, 'pb');`.
4. `lib/engine/tools.js`: import `import { novoIdDeSessao } from './sessao-id.js';` depois do import de `../workspace.js`. Linha 96: `  const { id, rotulo } = novoIdDeSessao(engine, 'f');` e na linha 97 `engine.activeReviews.set(id, { id, rotulo, keys: [], label, mode: 'auto', startedAt: Date.now(), cancellable: true });`.
5. `lib/engine/chat.js`: depois de `import { writeJsonAtomic } from '../io.js';` (linha 6) acrescente `import { novoIdDeSessao } from './sessao-id.js';`. Linha 76: `  const { id } = novoIdDeSessao(engine, 'c');`.

- [ ] **Passo 5: rodar e ver passar**

`node --test test/sessao-id.test.js` → 5 testes verdes. Depois `npm test`: qualquer teste que dependa do formato `a<n>` do id gerado pelo engine (não do id passado à mão em `recordUsage`) é ajustado para `assert.match(id, /^a-/)`, e o ajuste vai para o `EXECUCAO.md`. Na base medida nenhum teste depende disso (`grep -rn "sessionSeq" test` vazio).

- [ ] **Passo 6: contraprova**

Em `novoIdDeSessao`, troque `id: \`${prefixo}-${randomUUID()}\`` por `id: \`${prefixo}${seq}\``. Rode `node --test test/sessao-id.test.js`: `dois boots não reutilizam id` falha (`a1` igual) e `marcarDesfecho corrige a sessão certa` falha (a sessão nova vira `descartada`). Restaure e rode de novo: verde.

- [ ] **Passo 7: commit**

```
git add lib/engine/sessao-id.js test/sessao-id.test.js lib/engine/review.js lib/engine/selfpr.js lib/engine/pushback.js lib/engine/tools.js lib/engine/chat.js
git commit -m "fix(consumo): id de sessão opaco e estável entre boots, rótulo curto só para exibição"
```

---

### Tarefa 4: registro local e durável de falha por sessão

**Arquivos:**
- Criar: `lib/engine/falhas.js`, `test/falhas-sessao.test.js`
- Alterar: `server.js` (import junto de `import usageMod from './lib/engine/usage.js';`, linha 66; fachadas junto de `marcarDesfecho`, ~1898)

**Interfaces:**
- Consome: `classify` (`lib/log-taxonomy.js`), `readJson`/`writeJsonAtomic`/`ensureDir` (`lib/io.js`), `STATE_DIR` (`lib/paths.js`); campo opcional `resumeOutcome` da A5.
- Produz (contrato): `registrarFalha(engine, { sessionId, attemptId, kind, account, ref, motivo, classe, etapas, resumeOutcome })` (aceita também `cliSessionId`), `falhasRecentes(engine, { limite })`, `falhaDaSessao(engine, sessionId)`. Auxiliares exportados: `mascararSegredos`, `erroDeSessao`, `detalheDaFalha`, `anotarFalhaDaSessao`, `marcarErroNoConsumo`, `falhasPorSessao`, `arquivoDeFalhas`. Fachadas `Engine.registrarFalha(dados)`, `Engine.falhasRecentes(opcoes)`, `Engine.falhaDaSessao(sessionId)`.

- [ ] **Passo 1: escrever o teste que falha**

Crie `test/falhas-sessao.test.js`:

```js
// A falha de uma sessão de IA tinha uma cópia só: a linha do farol.log, cortada em 300
// caracteres na origem e apagada inteira pelo "Limpar log" (spec 4.1). O registro
// durável mora fora do log, com o motivo inteiro, teto próprio e segredo mascarado.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-falhas-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const falhas = await import('../lib/engine/falhas.js');
const { Engine } = await import('../server.js');

after(() => { try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

test('motivo longo fica inteiro (sem o corte de 300) e sobrevive a um engine novo', () => {
  const e = new Engine();
  const motivo = 'sessão retornou erro: ' + 'x'.repeat(1200) + 'FIM-DO-STDERR';
  const r = e.registrarFalha({ sessionId: 'a-longo', attemptId: 't-1', kind: 'review', account: 'Conta', ref: 'o/r#1', motivo, etapas: null });
  assert.equal(r.motivo, motivo);
  assert.equal(r.account, 'conta');
  assert.ok(r.classe, 'a classe vem da taxonomia quando não é informada');
  const outro = new Engine();
  assert.equal(outro.falhaDaSessao('a-longo').motivo, motivo);
});

test('Limpar log não apaga o registro de falha', () => {
  const e = new Engine();
  e.registrarFalha({ sessionId: 'a-limpar', kind: 'review', motivo: 'quebrou qwerty' });
  e.log('ERROR', 'linha de teste');
  assert.equal(e.clearLog().ok, true);
  assert.ok(fs.existsSync(falhas.arquivoDeFalhas()));
  assert.equal(new Engine().falhaDaSessao('a-limpar').motivo, 'quebrou qwerty');
});

test('segredo no motivo é mascarado antes de gravar', () => {
  const e = new Engine();
  const motivo = [
    'ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnop',
    'token ghp_abcdefghijklmnopqrstuvwxyz0123',
    'Authorization: Bearer eyJhbGciOi.abc.def',
    'https://db.exemplo/x.json?auth=segredo123&y=1',
    'sk-or-v1-abcdefghijklmnop',
  ].join(' | ');
  const r = e.registrarFalha({ sessionId: 'a-segredo', kind: 'review', motivo });
  for (const vazado of ['sk-ant-api03', 'ghp_abcdef', 'eyJhbGciOi', 'segredo123', 'sk-or-v1']) {
    assert.doesNotMatch(r.motivo, new RegExp(vazado), `vazou ${vazado}`);
  }
  assert.match(r.motivo, /ANTHROPIC_API_KEY=\[segredo mascarado\]/);
  assert.match(fs.readFileSync(falhas.arquivoDeFalhas(), 'utf8'), /\[segredo mascarado\]/);
});

test('motivo acima do teto é cortado no teto próprio e marcado', () => {
  const r = falhas.registrarFalha(new Engine(), { sessionId: 'a-teto', kind: 'review', motivo: 'y'.repeat(20000) });
  assert.equal(r.motivo.length, 8000);
  assert.equal(r.motivoTruncado, true);
});

test('o arquivo guarda no máximo 500 registros, os mais antigos saem', () => {
  const e = new Engine();
  e.falhasSessao = [];
  for (let i = 0; i < 505; i++) falhas.registrarFalha(e, { sessionId: `a-n${i}`, kind: 'review', motivo: 'm' });
  assert.equal(new Engine().falhasRecentes({ limite: 1000 }).length, 500);
  assert.equal(e.falhaDaSessao('a-n0'), null);
  assert.equal(e.falhasRecentes({ limite: 2 })[0].sessionId, 'a-n504', 'mais recente primeiro');
});

test('resumeOutcome da A5 é gravado só quando é um dos quatro valores', () => {
  const e = new Engine();
  assert.equal(e.registrarFalha({ sessionId: 'a-r1', motivo: 'm', resumeOutcome: 'recusada' }).resumeOutcome, 'recusada');
  assert.equal('resumeOutcome' in e.registrarFalha({ sessionId: 'a-r2', motivo: 'm', resumeOutcome: 'inventado' }), false);
});

test('etapas saneadas e id do CLI guardado à parte', () => {
  const r = new Engine().registrarFalha({ sessionId: 'a-et', cliSessionId: 'cli-1', motivo: 'm', etapas: { totalMs: 30, stages: [{ id: 'leitura', label: 'leitura', ms: 30, extra: 'x' }] } });
  assert.deepEqual(r.etapas, { totalMs: 30, stages: [{ id: 'leitura', label: 'leitura', ms: 30 }] });
  assert.equal(r.cliSessionId, 'cli-1');
});

test('erroDeSessao mantém a mensagem com o corte de sempre e o texto inteiro à parte', () => {
  const err = falhas.erroDeSessao('claude saiu com código 1: ', 'z'.repeat(1000) + 'FIM');
  assert.equal(err.message, 'claude saiu com código 1: ' + 'z'.repeat(300));
  assert.ok(err.detalheCompleto.endsWith('FIM'));
  assert.equal(falhas.detalheDaFalha(err), err.detalheCompleto);
  assert.equal(falhas.detalheDaFalha(new Error('só mensagem')), 'só mensagem');
});

test('anotarFalhaDaSessao não sobrescreve o que já veio anotado', () => {
  const err = falhas.anotarFalhaDaSessao(new Error('e'), 'a-1', { totalMs: 1, stages: [] });
  falhas.anotarFalhaDaSessao(err, 'a-2', null);
  assert.equal(err.sessaoFarol, 'a-1');
  assert.deepEqual(err.etapas, { totalMs: 1, stages: [] });
});

test('marcarErroNoConsumo tolera engine sem marcarDesfecho e sem id', () => {
  assert.equal(falhas.marcarErroNoConsumo({}, 'a-1'), false);
  assert.equal(falhas.marcarErroNoConsumo({ marcarDesfecho: () => true }, ''), false);
  const chamadas = [];
  falhas.marcarErroNoConsumo({ marcarDesfecho: (id, st) => { chamadas.push([id, st]); return true; } }, 'a-9');
  assert.deepEqual(chamadas, [['a-9', 'erro']]);
});

test('falhasPorSessao resume só as sessões pedidas', () => {
  const e = new Engine();
  e.registrarFalha({ sessionId: 'a-resumo', motivo: 'w'.repeat(500) });
  const r = falhas.falhasPorSessao(e, ['a-resumo', 'a-inexistente']);
  assert.deepEqual(Object.keys(r), ['a-resumo']);
  assert.equal(r['a-resumo'].motivo.length, 200);
});
```

- [ ] **Passo 2: rodar e ver falhar**

`node --test test/falhas-sessao.test.js` → `ERR_MODULE_NOT_FOUND` para `lib/engine/falhas.js`.

- [ ] **Passo 3: implementar o módulo**

Crie `lib/engine/falhas.js`:

```js
// Registro local e durável de falha por sessão de IA (spec 7.A1, item 6). Mora em
// state/falhas-sessao.json, FORA do farol.log: o log é a fonte do Diagnóstico e o
// "Limpar log" o apaga inteiro, e até aqui ele era a única cópia do motivo de uma
// revisão que estacionou. Aqui o motivo fica inteiro (sem o corte de 300 caracteres
// da mensagem de erro), com teto próprio e máscara de segredo, ligado à linha do
// Consumo (sessionId e attemptId) e ao card estacionado (sessionId).
//
// `sessionId` é o id OPACO do Farol (lib/engine/sessao-id.js); o id da sessão do CLI,
// quando existe, vai em `cliSessionId`. Nunca lança: registrar falha não pode virar falha.
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { STATE_DIR } from '../paths.js';
import { readJson, writeJsonAtomic, ensureDir } from '../io.js';
import { classify } from '../log-taxonomy.js';

const ARQUIVO = path.join(STATE_DIR, 'falhas-sessao.json');
// stderr de CLI e pilha cabem folgados; um dump de megabytes não
const MOTIVO_MAX = 8000;
const FALHAS_MAX = 500;
const LIMITE_PADRAO = 50;
const RESUMO_MOTIVO_MAX = 200;
// o corte que a MENSAGEM de erro sempre teve: taxonomia, toast e retry leem ela
const CORTE_MENSAGEM = 300;
// desfechos de retomada que a A5 produz
const RESUME_OUTCOMES = ['retomada', 'recusada', 'nova', 'nenhuma'];
const MARCA = '[segredo mascarado]';
const VARIAVEL_DE_SEGREDO = /\b(ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|CLAUDE_CODE_OAUTH_TOKEN|OPENAI_API_KEY|CODEX_API_KEY|GH_TOKEN|GITHUB_TOKEN)\s*[=:]\s*\S+/gi;
const PARAMETRO_DE_URL = /([?&](?:auth|access_token|token)=)[^&\s]+/gi;
const FORMATOS_DE_SEGREDO = [
  /\bsk-(?:ant|or)-[A-Za-z0-9_-]{8,}/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
];

function arquivoDeFalhas() { return ARQUIVO; }
function objeto(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function texto(v) { return typeof v === 'string' ? v : ''; }

function avisar(engine, msg) {
  if (engine && typeof engine.log === 'function') engine.log('WARN', msg);
}

function mascararSegredos(valor) {
  let s = String(valor === undefined || valor === null ? '' : valor);
  s = s.replace(VARIAVEL_DE_SEGREDO, (_, nome) => `${nome}=${MARCA}`);
  s = s.replace(PARAMETRO_DE_URL, (_, prefixo) => `${prefixo}${MARCA}`);
  for (const re of FORMATOS_DE_SEGREDO) s = s.replace(re, MARCA);
  return s;
}

// Cópia em memória presa ao engine: o snapshot lê a cada push, e reler o disco a cada
// push seria IO sem motivo. Engine de teste sem o campo lê do disco uma vez.
function lista(engine) {
  if (engine && Array.isArray(engine.falhasSessao)) return engine.falhasSessao;
  const bruto = readJson(ARQUIVO, null, (m) => avisar(engine, m));
  const falhas = objeto(bruto) && Array.isArray(bruto.falhas) ? bruto.falhas.filter(objeto) : [];
  if (engine && typeof engine === 'object') engine.falhasSessao = falhas;
  return falhas;
}

function gravar(engine, falhas) {
  try {
    ensureDir(STATE_DIR);
    writeJsonAtomic(ARQUIVO, { falhas });
    return true;
  } catch (err) {
    avisar(engine, `gravar falhas-sessao.json: ${err.message}`);
    return false;
  }
}

function etapasValidas(etapas) {
  if (!objeto(etapas) || !Array.isArray(etapas.stages)) return null;
  const stages = etapas.stages.filter(objeto).map((s) => ({ id: texto(s.id), label: texto(s.label), ms: Number(s.ms) || 0 }));
  return { totalMs: Number(etapas.totalMs) || 0, stages };
}

// Erro de sessão com a mensagem de sempre (cortada) e o texto inteiro em
// `detalheCompleto`, que só o registro durável lê.
function erroDeSessao(prefixo, detalhe) {
  const bruto = String(detalhe === undefined || detalhe === null ? '' : detalhe);
  const err = new Error(`${prefixo}${bruto.slice(0, CORTE_MENSAGEM)}`);
  err.detalheCompleto = `${prefixo}${bruto}`;
  return err;
}

function detalheDaFalha(err) {
  if (!err) return '';
  return String(err.detalheCompleto || err.message || '');
}

// Quem conhece a sessão (runHeadlessReview, runSelfAnalysis) anota antes do finally
// apagar o feed; quem registra (runOneHeadless) está fora dela.
function anotarFalhaDaSessao(err, sessionId, etapas) {
  if (!err || typeof err !== 'object') return err;
  if (!err.sessaoFarol && sessionId) err.sessaoFarol = sessionId;
  if (!err.etapas && etapas) err.etapas = etapas;
  return err;
}

function marcarErroNoConsumo(engine, id) {
  if (!id || !engine || typeof engine.marcarDesfecho !== 'function') return false;
  return engine.marcarDesfecho(id, 'erro');
}

function registrarFalha(engine, dados) {
  try {
    const d = objeto(dados) ? dados : {};
    const bruto = String(d.motivo || '');
    const mascarado = mascararSegredos(bruto);
    const registro = {
      id: randomUUID(), at: Date.now(),
      sessionId: texto(d.sessionId), attemptId: texto(d.attemptId), cliSessionId: texto(d.cliSessionId),
      kind: texto(d.kind) || 'outro', account: texto(d.account).toLowerCase(), ref: texto(d.ref),
      motivo: mascarado.slice(0, MOTIVO_MAX),
      motivoTruncado: mascarado.length > MOTIVO_MAX,
      classe: texto(d.classe) || classify(bruto).id,
      etapas: etapasValidas(d.etapas),
    };
    if (RESUME_OUTCOMES.includes(d.resumeOutcome)) registro.resumeOutcome = d.resumeOutcome;
    const falhas = lista(engine);
    falhas.push(registro);
    if (falhas.length > FALHAS_MAX) falhas.splice(0, falhas.length - FALHAS_MAX);
    gravar(engine, falhas);
    return registro;
  } catch (err) {
    avisar(engine, `registrar falha de sessão: ${err && err.message}`);
    return null;
  }
}

function falhasRecentes(engine, opcoes) {
  const pedido = Number(opcoes && opcoes.limite);
  const limite = pedido > 0 ? Math.min(pedido, FALHAS_MAX) : LIMITE_PADRAO;
  return lista(engine).slice(-limite).reverse();
}

function falhaDaSessao(engine, sessionId) {
  const id = texto(sessionId);
  if (!id) return null;
  return [...lista(engine)].reverse().find((f) => f.sessionId === id) || null;
}

// Resumo curto para o snapshot da aba Consumo: só das sessões que a tela mostra.
function falhasPorSessao(engine, ids) {
  const alvo = new Set((Array.isArray(ids) ? ids : []).filter(Boolean));
  const out = {};
  if (!alvo.size) return out;
  for (const f of lista(engine)) {
    if (alvo.has(f.sessionId)) out[f.sessionId] = { at: f.at, classe: f.classe, motivo: String(f.motivo || '').slice(0, RESUMO_MOTIVO_MAX) };
  }
  return out;
}

const falhasMod = {
  arquivoDeFalhas, mascararSegredos, erroDeSessao, detalheDaFalha, anotarFalhaDaSessao,
  marcarErroNoConsumo, registrarFalha, falhasRecentes, falhaDaSessao, falhasPorSessao,
};
export default falhasMod;
export {
  arquivoDeFalhas, mascararSegredos, erroDeSessao, detalheDaFalha, anotarFalhaDaSessao,
  marcarErroNoConsumo, registrarFalha, falhasRecentes, falhaDaSessao, falhasPorSessao,
};
```

- [ ] **Passo 4: fachadas no `server.js`**

Depois de `import usageMod from './lib/engine/usage.js';` (linha 66) acrescente `import falhasMod from './lib/engine/falhas.js';`. Logo depois da fachada `marcarDesfecho(id, status) { ... }` (~1898) acrescente:

```js
  // registro durável de falha por sessão, fora do farol.log (lib/engine/falhas.js)
  registrarFalha(dados) { return falhasMod.registrarFalha(this, dados); }
  falhasRecentes(opcoes) { return falhasMod.falhasRecentes(this, opcoes); }
  falhaDaSessao(sessionId) { return falhasMod.falhaDaSessao(this, sessionId); }
```

- [ ] **Passo 5: rodar e ver passar**

`node --test test/falhas-sessao.test.js test/facades.test.js` → verdes (as três fachadas novas entram sozinhas na checagem de aridade). `npm run lint` → sem regressão.

- [ ] **Passo 6: contraprova**

(a) Em `lib/engine/tools.js`, dentro de `clearLog`, logo depois de `fs.writeFileSync(LOG_FILE, '');`, acrescente temporariamente `fs.rmSync(path.join(STATE_DIR, 'falhas-sessao.json'), { force: true });`. Rode o teste: `Limpar log não apaga o registro de falha` falha. Remova a linha. (b) Em `mascararSegredos`, troque o corpo por `return String(valor);`: `segredo no motivo é mascarado` falha. Restaure. Rode de novo: verde, e `git diff lib/engine/tools.js` vazio.

- [ ] **Passo 7: commit**

```
git add lib/engine/falhas.js test/falhas-sessao.test.js server.js
git commit -m "feat(consumo): registro durável de falha por sessão, fora do farol.log e com segredo mascarado"
```

---

### Tarefa 5: o texto inteiro da falha sai da sessão

**Arquivos:**
- Alterar: `lib/engine/session.js` (import; linhas 1015-1016 e 1026), `lib/codex/stream.js` (import; linhas 169 e 172; exports)
- Criar: `test/erro-de-sessao-detalhe.test.js`

**Interfaces:**
- Consome: `erroDeSessao` (Tarefa 4).
- Produz: todo erro de fim de sessão do Claude e do Codex carrega `err.detalheCompleto`; `fecharCodex` exportado.

- [ ] **Passo 1: escrever o teste que falha**

Crie `test/erro-de-sessao-detalhe.test.js`:

```js
// A mensagem de erro da sessão é cortada em 300 caracteres na origem, e é essa
// mensagem que a taxonomia, o toast e o retry leem. O corte continua; o texto inteiro
// passa a viajar em detalheCompleto, que é o que o registro durável de falha grava.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-detalhe-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import childProcess from 'node:child_process';

const realSpawn = childProcess.spawn;
let spawnImpl = null;
childProcess.spawn = function spawnFalso(...args) { return spawnImpl ? spawnImpl(...args) : realSpawn(...args); };

const { runClaudeStream, parseEnvelope } = await import('../lib/engine/session.js');
const { fecharCodex } = await import('../lib/codex/stream.js');

after(() => {
  childProcess.spawn = realSpawn;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

function filho() {
  const c = new EventEmitter();
  c.stdout = new PassThrough();
  c.stderr = new EventEmitter();
  c.stdin = Object.assign(new EventEmitter(), { write() { }, end() { } });
  c.pid = 4343;
  return c;
}

function engineFalso() {
  return {
    config: {}, running: new Map(), killTree() { }, recordUsage() { },
    ghEnv: () => ({ PATH: '' }), resolveClaudeAuth: () => ({ kind: 'dir', id: '' }),
    pushActivity() { }, setSessionModel() { }, toolSummary: () => '',
    parseEnvelope(raw) { return parseEnvelope(this, raw); },
  };
}

test('claude que sai com código != 0: mensagem cortada, detalhe inteiro', async () => {
  const c = filho();
  spawnImpl = () => c;
  const p = runClaudeStream(engineFalso(), 'prompt', { id: 'a-det' });
  spawnImpl = null;
  c.stderr.emit('data', 'e'.repeat(2000) + 'CAUDA');
  c.stdout.once('end', () => c.emit('close', 1));
  c.stdout.end();
  await assert.rejects(p, (err) => {
    assert.ok(err.message.length <= 'claude saiu com código 1: '.length + 300);
    assert.ok(err.detalheCompleto.endsWith('CAUDA'));
    return true;
  });
});

test('evento result com is_error: mensagem cortada, detalhe inteiro', async () => {
  const c = filho();
  spawnImpl = () => c;
  const p = runClaudeStream(engineFalso(), 'prompt', { id: 'a-det2' });
  spawnImpl = null;
  c.stdout.write(JSON.stringify({ type: 'result', is_error: true, result: 'r'.repeat(900) + 'CAUDA' }) + '\n');
  c.stdout.once('end', () => c.emit('close', 0));
  c.stdout.end();
  await assert.rejects(p, (err) => {
    assert.match(err.message, /^sessão retornou erro: r{300}$/);
    assert.ok(err.detalheCompleto.endsWith('CAUDA'));
    return true;
  });
});

test('codex com turn.failed e com código != 0: detalhe inteiro', () => {
  const engine = { recordUsage() { }, parseEnvelope: (raw) => raw };
  const run = { cancelled: false, model: '' };
  const falhou = { text: '', sessionId: null, resultEvent: { type: 'result', is_error: true, result: 'q'.repeat(700) + 'CAUDA', usage: {} } };
  assert.throws(() => fecharCodex(engine, {}, run, falhou, '', '', 1), (err) => err.detalheCompleto.endsWith('CAUDA') && err.message.length <= 'sessão retornou erro: '.length + 300);
  const semEvento = { text: '', sessionId: null, resultEvent: null };
  assert.throws(() => fecharCodex(engine, {}, run, semEvento, '', 'w'.repeat(500) + 'CAUDA', 2), (err) => err.detalheCompleto.endsWith('CAUDA') && /^codex saiu com código 2: /.test(err.message));
});
```

- [ ] **Passo 2: rodar e ver falhar**

`node --test test/erro-de-sessao-detalhe.test.js` → `fecharCodex` não é exportado (import vira `undefined` e o terceiro teste falha com `TypeError`); os dois primeiros falham em `err.detalheCompleto` indefinido.

- [ ] **Passo 3: implementar**

`lib/engine/session.js`: depois de `import { runCodexStream } from '../codex/stream.js';` acrescente `import { erroDeSessao } from './falhas.js';`. Troque

```js
          return finish(new Error(`sessão retornou erro: ${detail.slice(0, 300)}`));
```

por

```js
          // mensagem com o corte de sempre (taxonomia, toast e retry leem ela); o texto
          // inteiro viaja em detalheCompleto para o registro durável de falha
          return finish(erroDeSessao('sessão retornou erro: ', detail));
```

e troque

```js
        return finish(new Error(`claude saiu com código ${code}: ${detail.slice(0, 300)}`));
```

por

```js
        return finish(erroDeSessao(`claude saiu com código ${code}: `, detail));
```

`lib/codex/stream.js`: depois de `import { usaPlanoChatGPT } from './auth.js';` acrescente `import { erroDeSessao } from '../engine/falhas.js';`. Troque

```js
  if (resultEvent?.is_error) throw new Error(`sessão retornou erro: ${String(resultEvent.result || errBuf).slice(0, 300)}`);
```

por `  if (resultEvent?.is_error) throw erroDeSessao('sessão retornou erro: ', String(resultEvent.result || errBuf));` e

```js
  if (code !== 0) throw new Error(`codex saiu com código ${code}: ${(errBuf.trim() || 'sem saida').slice(0, 300)}`);
```

por `  if (code !== 0) throw erroDeSessao(\`codex saiu com código ${code}: \`, errBuf.trim() || 'sem saida');`. Nas duas linhas de export do fim do arquivo, acrescente `fecharCodex` depois de `eventoCodex`.

- [ ] **Passo 4: rodar e ver passar**

`node --test test/erro-de-sessao-detalhe.test.js test/session-stream.test.js test/usage-parcial-stream.test.js` → verdes (as mensagens dos testes antigos não mudaram).

- [ ] **Passo 5: contraprova**

Em `erroDeSessao` (`lib/engine/falhas.js`), troque `err.detalheCompleto = \`${prefixo}${bruto}\`;` por `err.detalheCompleto = err.message;`. Rode `node --test test/erro-de-sessao-detalhe.test.js`: os três falham em `endsWith('CAUDA')`. Restaure: verde.

- [ ] **Passo 6: commit**

```
git add lib/engine/session.js lib/codex/stream.js test/erro-de-sessao-detalhe.test.js
git commit -m "fix(consumo): erro de sessão carrega o detalhe inteiro sem mudar a mensagem cortada"
```

---

### Tarefa 6: `desconhecido` e `interrompida` no registro de consumo

**Arquivos:**
- Alterar: `lib/engine/usage.js` (`estimarCusto` 98-102, `DESFECHOS` 112-113, `auditoriaDeConsumo` 118-130, `recordUsage` 273-329, exports), `lib/sync/consolidated.js:14`, `ui/pure.js:249-251` e `:270`
- Criar: `test/usage-desconhecido.test.js`
- Alterar teste: `test/usage-auditoria.test.js:128`; acrescentar em `test/sync-consolidated.test.js` e `test/ui-pure.test.js`

**Interfaces:**
- Produz: `DESFECHOS` com `'interrompida'`; `costSource` com `'desconhecido'`; `ORIGENS_DESCONHECIDAS` (Set com `'desconhecido'` e o legado `'sem-base'`); `auditoriaDeConsumo(...).desconhecido`; marcas lidas por `recordUsage` no evento: `farol_custo_desconhecido`, `farol_interrompida`, `farol_attempt`, `farol_iniciada_em`, `farol_provedor_destacado`; campos novos na linha: `attemptId`, `iniciadaEm`, `provedorPodeTerContinuado`.
- A assinatura de `recordUsage` NÃO muda.

- [ ] **Passo 1: escrever o teste que falha**

Crie `test/usage-desconhecido.test.js`:

```js
// Custo que não se sabe não pode aparecer como zero, nem se esconder no balde medido
// (spec 4.1, buracos 1 e 4, e o extra da auditoria). E a sessão cortada pelo fim
// abrupto do processo precisa de um desfecho próprio.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-desconhecido-'));

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const usage = (await import('../lib/engine/usage.js')).default;

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const engineDeTeste = () => ({ usage: usage.defaultUsage(), usageSessions: { sessions: [] }, config: {}, pushState() { }, log() { } });

test('estimativa sem base devolve origem desconhecido, nunca um número inventado', () => {
  assert.deepEqual(usage.estimarCusto([], 'review', 'Opus 5', 250), { costUsd: 0, source: 'desconhecido' });
});

test('falha com custo desconhecido e sem token vira linha, e não some', () => {
  const eng = engineDeTeste();
  usage.recordUsage(eng, 'a-cx', 'eu', { usage: {}, is_error: true, total_cost_usd: 0, farol_custo_desconhecido: true }, 'Codex (padrão)', 'p1', 'o/r#1');
  const s = eng.usageSessions.sessions.at(-1);
  assert.equal(eng.usageSessions.sessions.length, 1);
  assert.equal(s.costSource, 'desconhecido');
  assert.equal(s.status, 'erro');
  assert.equal(s.costUsd, 0);
});

test('stub zerado sem marca continua ignorado', () => {
  const eng = engineDeTeste();
  usage.recordUsage(eng, 'a-z', 'eu', { usage: {}, total_cost_usd: 0 }, 'claude-opus-5', '', 'x');
  assert.equal(eng.usageSessions.sessions.length, 0);
});

test('interrompida sem token: desfecho interrompida e custo desconhecido', () => {
  const eng = engineDeTeste();
  usage.recordUsage(eng, 'a-int', 'eu', { usage: {}, farol_interrompida: true, farol_custo_desconhecido: true, farol_attempt: 'tent-1', farol_iniciada_em: 1234, farol_provedor_destacado: true }, 'claude-opus-5', 'p1', 'o/r#2');
  const s = eng.usageSessions.sessions.at(-1);
  assert.equal(s.status, 'interrompida');
  assert.equal(s.costSource, 'desconhecido');
  assert.equal(s.attemptId, 'tent-1');
  assert.equal(s.iniciadaEm, 1234);
  assert.equal(s.provedorPodeTerContinuado, true);
});

test('interrompida com token parcial: estimado quando há base, e interrompida vence parcial', () => {
  const medida = { status: 'ok', kind: 'review', model: 'Opus 5', outputTokens: 1000, costUsd: 1 };
  const eng = engineDeTeste();
  eng.usageSessions.sessions.push(medida, { ...medida }, { ...medida });
  usage.recordUsage(eng, 'a-int2', 'eu', { usage: { output_tokens: 500 }, farol_parcial: true, farol_interrompida: true, farol_attempt: 'tent-2' }, 'claude-opus-5', 'p1', 'o/r#3');
  const s = eng.usageSessions.sessions.at(-1);
  assert.equal(s.status, 'interrompida');
  assert.equal(s.costSource, 'estimado');
  assert.equal(s.costUsd, 0.5);
  assert.equal('provedorPodeTerContinuado' in s, false);
});

test('linha normal não ganha campos de tentativa além do attemptId informado', () => {
  const eng = engineDeTeste();
  usage.recordUsage(eng, 'a-ok', 'eu', { usage: { output_tokens: 3 }, total_cost_usd: 0.1, farol_attempt: 'tent-3', farol_resume_outcome: 'retomada' }, 'claude-opus-5', '', 'x');
  const s = eng.usageSessions.sessions.at(-1);
  assert.equal(s.status, 'ok');
  assert.equal(s.costSource, 'medido');
  assert.equal(s.attemptId, 'tent-3');
  assert.equal(s.resumeOutcome, 'retomada', 'o desfecho da retomada da A5 persiste na linha');
  assert.equal('iniciadaEm' in s, false);
  usage.recordUsage(eng, 'a-ok2', 'eu', { usage: { output_tokens: 3 }, total_cost_usd: 0.1, farol_resume_outcome: 'inventado' }, 'claude-opus-5', '', 'x');
  assert.equal('resumeOutcome' in eng.usageSessions.sessions.at(-1), false);
});

test('auditoria separa desconhecido (inclusive o legado sem-base) do medido', () => {
  const r = usage.auditoriaDeConsumo([
    { costUsd: 2, costSource: 'medido', status: 'ok' },
    { costUsd: 0, costSource: 'sem-base', status: 'parcial' },
    { costUsd: 0, costSource: 'desconhecido', status: 'interrompida' },
  ]);
  assert.deepEqual(r.medido, { sessions: 1, costUsd: 2 });
  assert.deepEqual(r.desconhecido, { sessions: 2, costUsd: 0 });
  assert.equal(r.perdido.sessions, 2, 'parcial e interrompida são gasto que não virou resultado');
});

test('marcarDesfecho aceita interrompida', () => {
  const eng = engineDeTeste();
  usage.recordUsage(eng, 'a-m', 'eu', { usage: { output_tokens: 1 }, total_cost_usd: 0.1 }, 'claude-opus-5', '', 'x');
  assert.equal(usage.marcarDesfecho(eng, 'a-m', 'interrompida'), true);
  assert.ok(usage.DESFECHOS.includes('interrompida'));
});
```

Em `test/usage-auditoria.test.js:128`, troque `assert.equal(s.costSource, 'sem-base');` por `assert.equal(s.costSource, 'desconhecido');` (mudança intencional do item 4).

No fim de `test/sync-consolidated.test.js`:

```js
test('custo desconhecido entra no balde sem base do consolidado, nunca no medido', () => {
  const eventos = { d1: { a: ev(AGORA, { costUsd: 0, costSource: 'desconhecido' }) } };
  const r = consolidatedSummary(eventos, {}, { days: 7, agoraMs: AGORA, euDeviceId: 'd1' });
  assert.deepEqual(r.totals.semBase, { sessions: 1, costUsd: 0 });
  assert.deepEqual(r.totals.medido, { sessions: 0, costUsd: 0 });
});
```

No fim de `test/ui-pure.test.js`:

```js
test('custo desconhecido aparece como não medido, e interrompida tem rótulo próprio', () => {
  assert.equal(P.usageSessionRow({ costUsd: 0, costSource: 'desconhecido' }).costLabel, 'não medido');
  const r = P.usageSessionRow({ costUsd: 0, status: 'interrompida' });
  assert.equal(r.stLabel, 'interrompida');
  assert.equal(r.stClass, 'interrompida');
});
```

- [ ] **Passo 2: rodar e ver falhar**

`node --test test/usage-desconhecido.test.js test/usage-auditoria.test.js test/sync-consolidated.test.js test/ui-pure.test.js` → falham: origem `sem-base` em vez de `desconhecido`, linha ausente no caso Codex, `interrompida` rejeitada, balde `desconhecido` indefinido, `totals.medido` com 1 sessão, rótulo `ok` para interrompida.

- [ ] **Passo 3: implementar em `lib/engine/usage.js`**

3a. Acima de `estimarCusto`, troque as três linhas de comentário que começam em `// Custo estimado de um gasto que não teve evento final. Sem base, devolve ZERO dizendo` e terminam em `// desconhecido, em vez de virar um número que ninguém pode auditar. PURA.` por:

```js
// Custo estimado de um gasto que não teve evento final. Sem base, devolve ZERO dizendo
// `desconhecido` (até a v2.59.3 era `sem-base`, que continua sendo lido igual): o token
// continua registrado (ele é medido) e o custo fica declarado como desconhecido, em vez
// de virar um número que ninguém pode auditar. PURA.
```

e troque `  if (taxa === null || !(Number(outputTokens) > 0)) return { costUsd: 0, source: 'sem-base' };` por `  if (taxa === null || !(Number(outputTokens) > 0)) return { costUsd: 0, source: 'desconhecido' };`.

3b. Troque

```js
const DESFECHOS = ['ok', 'erro', 'cancelada', 'parcial', 'descartada'];
const DESFECHOS_PERDIDOS = new Set(['erro', 'cancelada', 'parcial', 'descartada']);
```

por

```js
// `interrompida` (A1, item 9): o processo do Farol morreu com a sessão aberta e o boot
// seguinte registrou o que o diário de tentativas tinha visto.
const DESFECHOS = ['ok', 'erro', 'cancelada', 'parcial', 'descartada', 'interrompida'];
const DESFECHOS_PERDIDOS = new Set(['erro', 'cancelada', 'parcial', 'descartada', 'interrompida']);
// custo cujo valor não se sabe: nunca é zero para o gate nem medido para a auditoria
const ORIGENS_DESCONHECIDAS = new Set(['desconhecido', 'sem-base']);

function origemDoCusto(r, s) {
  if (ORIGENS_DESCONHECIDAS.has(s.costSource)) return r.desconhecido;
  return s.costSource === 'estimado' ? r.estimado : r.medido;
}
```

3c. Em `auditoriaDeConsumo`, troque `  const r = { total: zero(), util: zero(), perdido: zero(), medido: zero(), estimado: zero() };` por `  const r = { total: zero(), util: zero(), perdido: zero(), medido: zero(), estimado: zero(), desconhecido: zero() };` e `    soma(s.costSource === 'estimado' ? r.estimado : r.medido);` por `    soma(origemDoCusto(r, s));`.

3d. Em `recordUsage`, troque

```js
  if (!u.inputTokens && !u.outputTokens && !u.cacheReadTokens && !u.cacheCreationTokens && !u.costUsd) return;
```

por

```js
  const ev = resultEvent || {};
  // custo desconhecido DECLARADO (Codex que falhou, tentativa interrompida sem token) é
  // gasto que existe sem valor conhecido: registrar é o que impede de sumir da tela e do
  // gate. Sem a marca, tudo zerado continua sendo stub de teste ou CLI antigo.
  const desconhecido = ev.farol_custo_desconhecido === true || ev.farol_interrompida === true;
  if (!desconhecido && !u.inputTokens && !u.outputTokens && !u.cacheReadTokens && !u.cacheCreationTokens && !u.costUsd) return;
```

troque `  let costSource = 'medido';` por `  let costSource = desconhecido && !parcial ? 'desconhecido' : 'medido';`, e troque

```js
  const ev = resultEvent || {};
  // tabela NA ORDEM DE PRECEDÊNCIA; a primeira marca ligada nomeia o desfecho
  const marcas = [[parcial, 'parcial'], [ev.farol_cancelled, 'cancelada'], [ev.is_error, 'erro']];
```

por

```js
  // tabela NA ORDEM DE PRECEDÊNCIA; a primeira marca ligada nomeia o desfecho.
  // `interrompida` vem antes de `parcial`: a tentativa interrompida quase sempre também é
  // parcial, e "o Farol morreu no meio" é o que explica a linha.
  const marcas = [[ev.farol_interrompida, 'interrompida'], [parcial, 'parcial'], [ev.farol_cancelled, 'cancelada'], [ev.is_error, 'erro']];
```

e troque

```js
    status,
  });
  saveSessions(engine);
```

por

```js
    status,
    ...camposDaTentativa(ev),
  });
  saveSessions(engine);
```

Acrescente, logo antes de `function recordUsage`:

```js
// Campos da tentativa (lib/engine/usage-tentativas.js) que viajam no evento como marcas
// farol_*, para a assinatura de recordUsage (e da fachada) continuar a mesma. `attemptId`
// é o que o boot usa para não duplicar uma tentativa já registrada.
function camposDaTentativa(ev) {
  const extra = {};
  if (typeof ev.farol_attempt === 'string' && ev.farol_attempt) extra.attemptId = ev.farol_attempt;
  if (Number(ev.farol_iniciada_em) > 0) extra.iniciadaEm = Number(ev.farol_iniciada_em);
  if (ev.farol_provedor_destacado === true) extra.provedorPodeTerContinuado = true;
  // desfecho da retomada que a A5 produz: só os quatro valores do contrato
  if (['retomada', 'recusada', 'nova', 'nenhuma'].includes(ev.farol_resume_outcome)) extra.resumeOutcome = ev.farol_resume_outcome;
  return extra;
}
```

3e. Nos dois blocos de export do fim de `usage.js`, acrescente `ORIGENS_DESCONHECIDAS` depois de `DESFECHOS`.

- [ ] **Passo 4: leitores**

`lib/sync/consolidated.js:14`: troque `const ORIGENS = { estimado: 'estimado', 'sem-base': 'semBase' };` por `const ORIGENS = { estimado: 'estimado', 'sem-base': 'semBase', desconhecido: 'semBase' };`.

`ui/pure.js:249-251`: troque `  ok: 'ok', erro: 'erro', cancelada: 'cancelada', parcial: 'parcial', descartada: 'descartada',` por `  ok: 'ok', erro: 'erro', cancelada: 'cancelada', parcial: 'parcial', descartada: 'descartada', interrompida: 'interrompida',`. Em `custoDaSessao` (`ui/pure.js:270`), troque `  if (s.costSource === 'sem-base') {` por `  if (s.costSource === 'sem-base' || s.costSource === 'desconhecido') {`. O texto da tela não muda (decisão D9: copy nova sai do Claude Design).

- [ ] **Passo 5: rodar e ver passar**

`node --test test/usage-desconhecido.test.js test/usage-auditoria.test.js test/usage.test.js test/sync-consolidated.test.js test/ui-pure.test.js test/sync-outbox.test.js` → verdes. `npm run lint` sem regressão.

- [ ] **Passo 6: contraprova**

Em `recordUsage`, troque `  const desconhecido = ev.farol_custo_desconhecido === true || ev.farol_interrompida === true;` por `  const desconhecido = false;`. Rode `node --test test/usage-desconhecido.test.js`: `falha com custo desconhecido e sem token vira linha` e `interrompida sem token` falham. Restaure: verde.

- [ ] **Passo 7: commit**

```
git add lib/engine/usage.js lib/sync/consolidated.js ui/pure.js test/usage-desconhecido.test.js test/usage-auditoria.test.js test/sync-consolidated.test.js test/ui-pure.test.js
git commit -m "fix(consumo): custo desconhecido nunca vira zero nem medido, e desfecho interrompida"
```

---

### Tarefa 7: custo desconhecido no gate de orçamento local

**Arquivos:**
- Alterar: `lib/engine/usage.js` (`profileBudgetStatus` 469-490, `budgetStatusFor` 498-500, `linhaDeOrcamento`, `budgetsFrom`, exports)
- Criar: `test/usage-desconhecido-gate.test.js`

**Interfaces:**
- Consome: `ORIGENS_DESCONHECIDAS` (Tarefa 6), `custoTipicoDeReview`, `localDay`.
- Produz: `contarDesconhecidas(sessions, profileId, since, hoje)` devolvendo `{ hoje, desde }`; `profileBudgetStatus(profile, store, tipico, desconhecidas)` com a flag `parcialmenteEstimado: true` quando houver desconhecida; `budgets[].parcialmenteEstimado`. A fachada `Engine.profileBudgetStatus(profile)` não muda.

Regra (CT-GRUPO, "Valor desconhecido", aplicada ao orçamento local por perfil): cada sessão de custo desconhecido do perfil entra no gasto com a reserva do custo típico de revisão, e o status diz que está parcialmente estimado. Com custo típico zero (sem histórico de revisão medida nos últimos 30 dias) a reserva é zero e a flag continua ligada: a projeção do gate já é desligada nesse caso desde a v2.49.0 (falta de dado nunca vira ação), e mudar isso é decisão do dono, registrada como pendência na seção final.

- [ ] **Passo 1: escrever o teste que falha**

Crie `test/usage-desconhecido-gate.test.js`:

```js
// "Sem-base" entrava como zero no teto de orçamento (spec 4.1, buraco 4): uma leva de
// sessões interrompidas sem token passava pelo gate como se não tivesse gasto nada.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-gate-desconhecido-'));

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const usage = (await import('../lib/engine/usage.js')).default;

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const HOJE = usage.localDay();
const PERFIL = { id: 'p1', kind: 'apikey', label: 'P1', budgetDaily: 10 };

function cenario(desconhecidas, origem = 'desconhecido', perfil = 'p1') {
  const store = usage.defaultUsage();
  store.byProfileDay = { [`p1|${HOJE}`]: { sessions: 1, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 5 } };
  const agora = Date.now();
  const sessions = [1, 2, 3].map(() => ({ kind: 'review', at: agora, day: HOJE, costUsd: 2, costSource: 'medido', profileId: 'outro' }));
  for (let i = 0; i < desconhecidas; i++) sessions.push({ kind: 'review', at: agora, day: HOJE, costUsd: 0, costSource: origem, profileId: perfil, status: 'interrompida' });
  return { usage: store, usageSessions: { sessions } };
}

test('sessão de custo desconhecido reserva o custo típico e o status diz parcialmente estimado', () => {
  const st = usage.budgetStatusFor(cenario(3), PERFIL);
  assert.equal(st.blocked, true, '5 medidos + 3 x 2 de reserva estoura o teto de 10');
  assert.equal(st.reason, 'diario');
  assert.equal(st.parcialmenteEstimado, true);
});

test('o mesmo gasto sem desconhecidas continua liberado e com o formato de sempre', () => {
  const st = usage.budgetStatusFor(cenario(0), PERFIL);
  assert.deepEqual(st, { blocked: false, today: 5, sinceCutoff: 5 });
});

test('linha antiga sem-base conta como desconhecida', () => {
  assert.equal(usage.budgetStatusFor(cenario(3, 'sem-base'), PERFIL).blocked, true);
});

test('desconhecida de outro perfil não pesa neste', () => {
  const st = usage.budgetStatusFor(cenario(3, 'desconhecido', 'p2'), PERFIL);
  assert.equal(st.blocked, false);
  assert.equal('parcialmenteEstimado' in st, false);
});

test('contarDesconhecidas separa hoje e desde o corte', () => {
  const sessions = [
    { profileId: 'p1', costSource: 'desconhecido', day: HOJE },
    { profileId: 'p1', costSource: 'desconhecido', day: '2026-01-01' },
    { profileId: 'p1', costSource: 'medido', day: HOJE },
  ];
  assert.deepEqual(usage.contarDesconhecidas(sessions, 'p1', '2026-01-01', HOJE), { hoje: 1, desde: 2 });
  assert.deepEqual(usage.contarDesconhecidas(sessions, 'p1', '2026-06-01', HOJE), { hoje: 1, desde: 1 });
  assert.deepEqual(usage.contarDesconhecidas(sessions, '', '', HOJE), { hoje: 0, desde: 0 });
});

test('a linha de orçamento da tela usa a mesma conta e leva a flag', () => {
  const eng = cenario(3);
  const tipico = usage.custoTipicoDeReview(eng.usageSessions.sessions);
  const [linha] = usage.budgetsFrom(eng.usage, [PERFIL], tipico, eng.usageSessions.sessions);
  assert.equal(linha.blocked, true);
  assert.equal(linha.parcialmenteEstimado, true);
});
```

- [ ] **Passo 2: rodar e ver falhar**

`node --test test/usage-desconhecido-gate.test.js` → o primeiro teste falha (`blocked` false), `contarDesconhecidas` não é função, a linha não tem a flag.

- [ ] **Passo 3: implementar**

Acrescente antes de `function profileBudgetStatus`:

```js
// Quantas sessões DESTE perfil têm custo desconhecido, hoje e desde o corte. Lê o log de
// sessões porque o agregado não guarda a origem do custo. PURA.
function contarDesconhecidas(sessions, profileId, since, hoje) {
  const r = { hoje: 0, desde: 0 };
  if (!profileId) return r;
  for (const s of Array.isArray(sessions) ? sessions : []) {
    if (!s || s.profileId !== profileId || !ORIGENS_DESCONHECIDAS.has(s.costSource)) continue;
    if (s.day === hoje) r.hoje += 1;
    if (!since || s.day >= since) r.desde += 1;
  }
  return r;
}
```

Substitua a função `profileBudgetStatus` inteira por:

```js
function profileBudgetStatus(profile, store, tipico = 0, desconhecidas = null) {
  if (!profile) return { blocked: false };
  const spend = profileSpend(store, profile.id, profile.budgetSince);
  // O plano ChatGPT nao informa custo por sessao nem saldo de cota ao CLI. Aplicar
  // um teto em US$ ao Codex seria falsa precisao e, pior, a projecao aprendida nas
  // sessoes Claude poderia pausar um perfil Codex que gastou US$ 0.
  if (profile.kind === 'codex') return { blocked: false, today: spend.today, sinceCutoff: spend.sinceCutoff };
  const projecao = Number(tipico) > 0 ? Number(tipico) : 0;
  // Valor desconhecido (CT-GRUPO, aplicado ao teto local): cada sessão sem custo
  // conhecido pesa a reserva do custo típico, e o status diz que parte é estimativa.
  const nd = desconhecidas || { hoje: 0, desde: 0 };
  const marca = (Number(nd.hoje) || 0) + (Number(nd.desde) || 0) > 0 ? { parcialmenteEstimado: true } : {};
  const veredito = (reason, gasto, n, teto) => {
    if (teto == null) return null;
    const efetivo = gasto + (Number(n) || 0) * projecao;
    if (efetivo >= teto) return { blocked: true, reason, today: spend.today, sinceCutoff: spend.sinceCutoff, ...marca };
    if (efetivo + projecao >= teto) {
      return { blocked: true, reason: `${reason}-previsto`, projetado: projecao, today: spend.today, sinceCutoff: spend.sinceCutoff, ...marca };
    }
    return null;
  };
  // o teto do dia (base, ou o override de dia da semana / data única) é quem manda
  return veredito('diario', spend.today, nd.hoje, dailyCapFor(profile, localDay()))
    || veredito('total', spend.sinceCutoff, nd.desde, profile.budgetTotal)
    || { blocked: false, today: spend.today, sinceCutoff: spend.sinceCutoff, ...marca };
}
```

Substitua `budgetStatusFor` por:

```js
function budgetStatusFor(engine, profile) {
  const sessions = (engine.usageSessions && engine.usageSessions.sessions) || [];
  const nd = profile ? contarDesconhecidas(sessions, profile.id, profile.budgetSince, localDay()) : null;
  return profileBudgetStatus(profile, engine.usage, custoTipicoDoEngine(engine), nd);
}
```

Em `linhaDeOrcamento`, troque `    blocked: !!st.blocked, reason: st.reason || null,` por

```js
    blocked: !!st.blocked, reason: st.reason || null,
    // parte do gasto que é reserva de sessão com custo desconhecido (A1, item 4)
    parcialmenteEstimado: !!st.parcialmenteEstimado,
```

Em `budgetsFrom`, troque `  return (profiles || []).map(p => linhaDeOrcamento(p, profileBudgetStatus(p, store, tipico), hoje, tipico, sessions));` por `  return (profiles || []).map(p => linhaDeOrcamento(p, profileBudgetStatus(p, store, tipico, contarDesconhecidas(sessions, p.id, p.budgetSince, hoje)), hoje, tipico, sessions));`. Nos dois exports, acrescente `contarDesconhecidas` depois de `ORIGENS_DESCONHECIDAS`.

- [ ] **Passo 4: rodar e ver passar**

`node --test test/usage-desconhecido-gate.test.js test/usage.test.js test/claude-profiles.test.js test/pushback.test.js` → verdes. `npm run lint` sem regressão (o `veredito` ganhou um parâmetro, nenhuma chave nova).

- [ ] **Passo 5: contraprova**

Em `budgetStatusFor`, troque `custoTipicoDoEngine(engine), nd)` por `custoTipicoDoEngine(engine), null)`. Rode o teste: `sessão de custo desconhecido reserva o custo típico` falha (`blocked` false). Restaure: verde.

- [ ] **Passo 6: commit**

```
git add lib/engine/usage.js test/usage-desconhecido-gate.test.js
git commit -m "fix(orcamento): sessão de custo desconhecido reserva o custo típico no gate local"
```

---

### Tarefa 8: Codex que falha registra a tentativa com custo desconhecido

**Arquivos:**
- Alterar: `lib/codex/stream.js` (`eventoCodex` 87-95, `fecharCodex` 163-174)
- Criar: `test/codex-falha-consumo.test.js`

**Interfaces:**
- Consome: marca `farol_custo_desconhecido` (Tarefa 6), `fecharCodex` exportado (Tarefa 5).
- Produz: toda sessão Codex que termina em `turn.failed` ou com código != 0 sem evento gera linha de consumo (`status` `erro` ou `cancelada`, `costSource: 'desconhecido'`).

Sucesso do Codex (`turn.completed`) segue como hoje: tokens medidos e custo zero com origem `medido`, porque o plano ChatGPT não informa custo e o perfil Codex já é "não controlado" (CT-GRUPO). Mudar isso não é escopo da A1.

- [ ] **Passo 1: escrever o teste que falha**

Crie `test/codex-falha-consumo.test.js`:

```js
// Codex que falha não registrava nada: turn.failed montava resultado com uso vazio e
// custo zero, e o recordUsage descartava tudo zerado (spec 4.1, buraco 1).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-codex-falha-'));

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const { eventoCodex, fecharCodex } = await import('../lib/codex/stream.js');
const usage = (await import('../lib/engine/usage.js')).default;

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

function engineReal() {
  const eng = { usage: usage.defaultUsage(), usageSessions: { sessions: [] }, config: {}, pushState() { }, log() { }, parseEnvelope: (raw) => raw };
  eng.recordUsage = (...args) => usage.recordUsage(eng, ...args);
  return eng;
}

const estado = () => ({ text: '', sessionId: null, resultEvent: null });

test('turn.failed gera linha de erro com custo desconhecido', () => {
  const eng = engineReal();
  const st = estado();
  eventoCodex({ type: 'turn.failed', error: { message: 'modelo recusou a requisição' } }, st, () => { });
  assert.throws(() => fecharCodex(eng, { id: 'a-cx1', account: 'eu', ref: 'o/r#1' }, { cancelled: false, model: '' }, st, '', '', 1));
  const s = eng.usageSessions.sessions.at(-1);
  assert.ok(s, 'a falha do Codex virou linha');
  assert.equal(s.status, 'erro');
  assert.equal(s.costSource, 'desconhecido');
});

test('processo do Codex morto sem evento nenhum também registra', () => {
  const eng = engineReal();
  assert.throws(() => fecharCodex(eng, { id: 'a-cx2', account: 'eu', ref: 'o/r#2' }, { cancelled: false, model: '' }, estado(), '', 'morreu', 137), /codex saiu com código 137/);
  assert.equal(eng.usageSessions.sessions.at(-1).costSource, 'desconhecido');
});

test('cancelamento sem evento vira cancelada, não erro', () => {
  const eng = engineReal();
  assert.throws(() => fecharCodex(eng, { id: 'a-cx3' }, { cancelled: true, model: '' }, estado(), '', '', null), /cancelada por você/);
  assert.equal(eng.usageSessions.sessions.at(-1).status, 'cancelada');
});

test('turn.completed segue como hoje: medido, sem marca de desconhecido', () => {
  const eng = engineReal();
  const st = estado();
  eventoCodex({ type: 'item.completed', item: { type: 'agent_message', text: 'ok' } }, st, () => { });
  eventoCodex({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } }, st, () => { });
  fecharCodex(eng, { id: 'a-cx4' }, { cancelled: false, model: '' }, st, '', '', 0);
  const s = eng.usageSessions.sessions.at(-1);
  assert.equal(s.status, 'ok');
  assert.equal(s.costSource, 'medido');
});

test('saída 0 sem evento nenhum e sem token continua sem linha (stub)', () => {
  const eng = engineReal();
  fecharCodex(eng, { id: 'a-cx5' }, { cancelled: false, model: '' }, estado(), 'texto', '', 0);
  assert.equal(eng.usageSessions.sessions.length, 0);
});
```

- [ ] **Passo 2: rodar e ver falhar**

`node --test test/codex-falha-consumo.test.js` → os três primeiros falham (linha ausente).

- [ ] **Passo 3: implementar**

Em `eventoCodex`, troque

```js
      usage: {},
      is_error: true,
      farol_codex_quota: cotaCodex(detail),
```

por

```js
      usage: {},
      is_error: true,
      // o plano não informa token nem custo da tentativa que falhou: o gasto existe e o
      // valor não se sabe (A1, item 2)
      farol_custo_desconhecido: true,
      farol_codex_quota: cotaCodex(detail),
```

Acrescente antes de `function fecharCodex`:

```js
// Processo que morreu (ou foi cancelado) sem evento nenhum: a tentativa existiu e o
// provedor pode ter gastado, então ela vira linha com custo desconhecido. Saída 0 sem
// evento continua sendo o stub, que devolve envelope.
function falhaSemEventoCodex(estado, code) {
  if (code === 0) return null;
  return resultCodex(estado, { result: '', usage: {}, is_error: true, farol_custo_desconhecido: true });
}
```

Em `fecharCodex`, troque `  registrarUsoCodex(engine, opts, run, resultEvent);` por `  registrarUsoCodex(engine, opts, run, resultEvent || falhaSemEventoCodex(estado, code));`.

- [ ] **Passo 4: rodar e ver passar**

`node --test test/codex-falha-consumo.test.js test/erro-de-sessao-detalhe.test.js test/session-stream.test.js` → verdes.

- [ ] **Passo 5: contraprova**

Troque `  registrarUsoCodex(engine, opts, run, resultEvent || falhaSemEventoCodex(estado, code));` de volta para `  registrarUsoCodex(engine, opts, run, resultEvent);` e apague a linha `farol_custo_desconhecido: true,` de `eventoCodex`. Rode o teste: os três primeiros falham. Restaure os dois trechos: verde.

- [ ] **Passo 6: commit**

```
git add lib/codex/stream.js test/codex-falha-consumo.test.js
git commit -m "fix(consumo): tentativa do Codex que falha vira linha com custo desconhecido"
```

**Gate do bloco:** `npm run check && npm run lint && npm test` verde antes da Tarefa 9.

---

### Tarefa 9: resultado recusado vira desfecho `erro` nos quatro caminhos

**Arquivos:**
- Alterar: `lib/engine/review.js` (import; `lerResultadoDaRevisao` ~878 e a chamada ~1289; exports), `lib/engine/selfpr.js` (import; chamada `parseSelfResult` ~1101), `lib/engine/pushback.js` (import; `classifyPushback` ~243), `lib/engine/tools.js` (import; ~118)
- Criar: `test/resultado-recusado-desfecho.test.js`

**Interfaces:**
- Consome: `marcarErroNoConsumo(engine, id)` (Tarefa 4), `Engine.marcarDesfecho`.
- Produz: `lerResultadoDaRevisao(engine, res, id)` exportado.

A linha de consumo já existe quando o resultado é lido: `registrarConsumo` roda no `close` do processo, antes de a promessa resolver (`lib/engine/session.js:1009`). Por isso a correção é `marcarDesfecho`, não um registro novo.

- [ ] **Passo 1: escrever o teste que falha**

Crie `test/resultado-recusado-desfecho.test.js`:

```js
// Resultado recusado ficava "ok" no Consumo: envelope fora do contrato, prosa sem JSON,
// pushback ilegível e ferramenta sem texto (spec 4.1, buraco 2). Só a autoanálise
// descartada por commit novo carimbava o desfecho.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-recusado-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { Engine } = await import('../server.js');
const { lerResultadoDaRevisao } = await import('../lib/engine/review.js');

after(() => { try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const RAIZ = path.join(import.meta.dirname, '..');
const USO = { usage: { output_tokens: 10 }, total_cost_usd: 0.1 };

function esperar(cond, ms = 3000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (cond()) { clearInterval(iv); resolve(); return; }
      if (Date.now() - t0 > ms) { clearInterval(iv); reject(new Error('timeout esperando a condição')); }
    }, 10);
  });
}

test('revisão: envelope ausente ou fora do contrato marca erro na sessão', () => {
  for (const erro of [Object.assign(new Error('sem JSON'), { code: 'FAROL_RESULT_MISSING' }), new Error('JSON fora do contrato')]) {
    const chamadas = [];
    const engine = { parseHeadlessResult() { throw erro; }, marcarDesfecho: (id, st) => { chamadas.push([id, st]); return true; } };
    assert.throws(() => lerResultadoDaRevisao(engine, { text: 'prosa', sessionId: null }, 'a-rev'));
    assert.deepEqual(chamadas, [['a-rev', 'erro']]);
  }
});

test('revisão: resultado válido não mexe no desfecho', () => {
  const chamadas = [];
  const engine = { parseHeadlessResult: () => ({ verdict: 'approve' }), marcarDesfecho: (...a) => chamadas.push(a) };
  assert.deepEqual(lerResultadoDaRevisao(engine, { text: '{}' }, 'a-ok'), { verdict: 'approve' });
  assert.equal(chamadas.length, 0);
});

test('pushback ilegível marca erro na linha da sessão', async () => {
  const e = new Engine();
  e.pushState = () => { };
  e.accountForPr = () => 'eu';
  e.runClaudeStream = async (prompt, opts) => {
    e.recordUsage(opts.id, 'eu', USO, 'claude-opus-5', '', opts.ref);
    return { text: 'sem json nenhum', sessionId: null };
  };
  assert.equal(await e.classifyPushback({ key: 'o/r#5', url: 'u', author: 'a' }, 'm'), null);
  const s = e.usageSessions.sessions.at(-1);
  assert.match(s.id, /^pb-/);
  assert.equal(s.status, 'erro');
});

test('ferramenta sem texto marca erro na linha da sessão', async () => {
  const e = new Engine();
  e.token = 'tok';
  e.pushState = () => { };
  e.toolPrompt = () => 'prompt';
  e.runClaudeStream = async (prompt, opts) => {
    e.recordUsage(opts.id, 'eu', USO, 'claude-opus-5', '', opts.ref);
    return { text: '   ', sessionId: null };
  };
  assert.equal((await e.launchTool('health')).ok, true);
  await esperar(() => (e.toolRunGet('health') || {}).status === 'error');
  const s = e.usageSessions.sessions.at(-1);
  assert.match(s.id, /^f-/);
  assert.equal(s.status, 'erro');
});

test('autoanálise: a leitura do resultado recusado marca erro antes de propagar', () => {
  const fonte = fs.readFileSync(path.join(RAIZ, 'lib', 'engine', 'selfpr.js'), 'utf8');
  assert.match(fonte, /try \{ result = engine\.parseSelfResult\(res\.text\); \}\s*catch \(err\) \{ marcarErroNoConsumo\(engine, id\); throw err; \}/);
});
```

- [ ] **Passo 2: rodar e ver falhar**

`node --test test/resultado-recusado-desfecho.test.js` → `lerResultadoDaRevisao` não é exportado; o pushback e a ferramenta ficam com `status: 'ok'`; o teste de fonte da autoanálise não casa.

- [ ] **Passo 3: implementar**

`lib/engine/review.js`: troque `import { novoIdDeSessao } from './sessao-id.js';` (Tarefa 3) por

```js
import { novoIdDeSessao } from './sessao-id.js';
import { marcarErroNoConsumo } from './falhas.js';
```

Substitua `lerResultadoDaRevisao` por:

```js
function lerResultadoDaRevisao(engine, res, id) {
  try {
    return engine.parseHeadlessResult(res.text);
  } catch (err) {
    // resultado recusado: o gasto aconteceu e não virou revisão (A1, item 3). A linha de
    // consumo já existe (registrada no close da sessão); o que muda é o desfecho.
    marcarErroNoConsumo(engine, id);
    if (err.code !== 'FAROL_RESULT_MISSING') throw err;
    err.message = `revisão não concluída: a sessão terminou sem entregar o resultado estruturado; ${err.message}. Confira a sessão e as verificações pendentes antes de tentar novamente.`;
    if (res.sessionId) err.sessionId = res.sessionId;
    throw err;
  }
}
```

Troque `    const result = lerResultadoDaRevisao(engine, res);` por `    const result = lerResultadoDaRevisao(engine, res, id);`. Nos dois blocos de export, acrescente `lerResultadoDaRevisao` depois de `rodarSessao`.

`lib/engine/selfpr.js`: depois do import de `./sessao-id.js` acrescente `import { marcarErroNoConsumo } from './falhas.js';`. Troque `    const result = engine.parseSelfResult(res.text);` por

```js
    // resultado recusado marca o desfecho da sessão antes de subir (A1, item 3)
    let result;
    try { result = engine.parseSelfResult(res.text); }
    catch (err) { marcarErroNoConsumo(engine, id); throw err; }
```

`lib/engine/pushback.js`: depois do import de `./sessao-id.js` acrescente `import { marcarErroNoConsumo } from './falhas.js';`. Em `classifyPushback`, troque

```js
  if (!cls) {
    await fecharCoordenacaoPushback(res.coordination, null);
```

por

```js
  if (!cls) {
    marcarErroNoConsumo(engine, id);
    await fecharCoordenacaoPushback(res.coordination, null);
```

`lib/engine/tools.js`: depois do import de `./sessao-id.js` acrescente `import { marcarErroNoConsumo } from './falhas.js';`. Troque `      if (!text) throw new Error('a sessão não devolveu texto');` por

```js
      // sem texto é resultado recusado: o gasto não virou painel (A1, item 3)
      if (!text) { marcarErroNoConsumo(engine, id); throw new Error('a sessão não devolveu texto'); }
```

- [ ] **Passo 4: rodar e ver passar**

`node --test test/resultado-recusado-desfecho.test.js test/review-result-missing.test.js test/sync-callers.test.js test/reentrancy.test.js test/pushback.test.js` → verdes (o `classifyPushback` continua devolvendo `null` para ilegível). `npm run lint` sem regressão: a chave nova do `tools.js` fica na mesma profundidade do `if` que ela substitui; se o gate acusar `profundidadeExcedida` subindo, troque as chaves por duas linhas `if (!text) marcarErroNoConsumo(engine, id);` e `if (!text) throw new Error('a sessão não devolveu texto');`.

- [ ] **Passo 5: contraprova**

Apague `marcarErroNoConsumo(engine, id); ` do `if (!text)` em `lib/engine/tools.js`. Rode o teste: `ferramenta sem texto marca erro` falha com `ok`. Restaure: verde.

- [ ] **Passo 6: commit**

```
git add lib/engine/review.js lib/engine/selfpr.js lib/engine/pushback.js lib/engine/tools.js test/resultado-recusado-desfecho.test.js
git commit -m "fix(consumo): resultado recusado marca erro em revisão, autoanálise, pushback e ferramenta"
```

---

### Tarefa 10: a falha de cada sessão vai para o registro durável, ligada ao Consumo e ao card estacionado

**Arquivos:**
- Alterar: `lib/engine/review.js` (import; `falhaDaAutoanalise` 539; catch do `runOneHeadless` 638-718; catch do `runHeadlessReview` ~1550; `estacionar` 1851; `parkedParaUi` 1875)
- Alterar: `lib/engine/selfpr.js` (import; `runSelfAnalysis`, antes do `finally`)
- Alterar: `lib/engine/tools.js` (catch de `launchTool`)
- Alterar: `lib/engine/usage.js` (import; `usageSummary`)
- Criar: `test/falha-duravel-fiacao.test.js`

**Interfaces:**
- Consome: `registrarFalha`, `detalheDaFalha`, `anotarFalhaDaSessao`, `falhasPorSessao` (Tarefa 4); `err.sessionId` (id do CLI, `session.js`), `err.attemptId` (Tarefa 14; ausente até lá, gravado vazio), `err.resumeOutcome` (A5).
- Produz: `estacionar(engine, key, motivo, tipo, head, sessionId)`; `snapshot().parked[key].sessionId`; `usageSummary().falhasPorSessao`.

- [ ] **Passo 1: escrever o teste que falha**

Crie `test/falha-duravel-fiacao.test.js`:

```js
// A falha estacionada precisa continuar explicável depois de Limpar log e depois de o PR
// ser relançado (spec 4.1: "Limpar log apaga a única cópia", "o motivo do estacionamento
// some ao relançar"). Aqui a fiação: quem falha registra, e o card e o Consumo apontam.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-falha-fiacao-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { Engine } = await import('../server.js');
const { erroDeSessao, anotarFalhaDaSessao } = await import('../lib/engine/falhas.js');
const reviewMod = (await import('../lib/engine/review.js')).default;

after(() => { try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const RAIZ = path.join(import.meta.dirname, '..');

function engineDeFila() {
  const e = new Engine();
  e.pushState = () => { };
  e.processHeadless = () => { };
  e.freeHeadlessSlot = () => { };
  e.writeInflight = () => { };
  e.prState = async () => 'OPEN';
  e.budgetBlockedFor = () => null;
  e.accountForPr = () => 'conta';
  return e;
}

function esperar(cond, ms = 3000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (cond()) { clearInterval(iv); resolve(); return; }
      if (Date.now() - t0 > ms) { clearInterval(iv); reject(new Error('timeout esperando a condição')); }
    }, 10);
  });
}

test('falha permanente de revisão: registro durável, card aponta a sessão e Limpar log não apaga', async () => {
  const e = engineDeFila();
  const pr = { key: 'o/r#7', url: 'https://github.com/o/r/pull/7', repo: 'o/r', number: 7 };
  const cauda = 'x'.repeat(900) + 'CAUDA-DO-STDERR';
  e.runHeadlessReview = async () => {
    throw Object.assign(erroDeSessao('falha de teste sem classe qwerty: ', cauda), {
      sessaoFarol: 'a-falha-1', sessionId: 'cli-1', resumeOutcome: 'recusada',
      etapas: { totalMs: 10, stages: [{ id: 'leitura', label: 'leitura', ms: 10 }] },
    });
  };
  await e.runOneHeadless(pr, 'conta');
  assert.ok(e.autoReviewParked.has(pr.key), 'falha permanente estaciona');
  assert.equal(e.parkedParaUi()[pr.key].sessionId, 'a-falha-1');
  assert.equal(e.clearLog().ok, true);
  const f = new Engine().falhaDaSessao('a-falha-1');
  assert.ok(f.motivo.endsWith('CAUDA-DO-STDERR'), 'motivo inteiro, sem o corte de 300');
  assert.equal(f.kind, 'review');
  assert.equal(f.ref, pr.key);
  assert.equal(f.cliSessionId, 'cli-1');
  assert.equal(f.resumeOutcome, 'recusada');
  assert.equal(f.etapas.stages[0].id, 'leitura');
  reviewMod.desestacionar(e, pr.key);
  assert.ok(e.falhaDaSessao('a-falha-1'), 'relançar não apaga a falha');
});

test('falha transitória também fica registrada, mesmo sem estacionar', async () => {
  const e = engineDeFila();
  const pr = { key: 'o/r#8', url: 'https://github.com/o/r/pull/8', repo: 'o/r', number: 8 };
  e.runHeadlessReview = async () => { throw anotarFalhaDaSessao(new Error('sessão retornou erro: API Error: 529 Overloaded'), 'a-trans', null); };
  await e.runOneHeadless(pr, 'conta');
  assert.equal(e.autoReviewParked.has(pr.key), false);
  assert.ok(e.falhaDaSessao('a-trans'));
});

test('cancelamento não é falha e não registra', async () => {
  const e = engineDeFila();
  const pr = { key: 'o/r#9', url: 'u', repo: 'o/r', number: 9 };
  e.runHeadlessReview = async () => { throw Object.assign(new Error('cancelada por você'), { cancelled: true, sessaoFarol: 'a-cancel' }); };
  await e.runOneHeadless(pr, 'conta');
  assert.equal(e.falhaDaSessao('a-cancel'), null);
});

test('autoanálise que falha registra com tipo self', async () => {
  const e = engineDeFila();
  e.runSelfAnalysis = async () => { throw anotarFalhaDaSessao(new Error('autoanálise quebrou qwerty'), 's-falha-1', null); };
  await e.runOneHeadless({ key: 'o/r#10', url: 'u', kind: 'self' }, 'conta');
  assert.equal(e.falhaDaSessao('s-falha-1').kind, 'self');
});

test('ferramenta que falha registra com tipo tool e o id da sessão', async () => {
  const e = new Engine();
  e.token = 'tok';
  e.pushState = () => { };
  e.toolPrompt = () => 'prompt';
  let idDaSessao = '';
  e.runClaudeStream = async (prompt, opts) => { idDaSessao = opts.id; throw erroDeSessao('claude saiu com código 1: ', 'k'.repeat(400) + 'CAUDA'); };
  await e.launchTool('health');
  await esperar(() => (e.toolRunGet('health') || {}).status === 'error');
  const f = e.falhaDaSessao(idDaSessao);
  assert.equal(f.kind, 'tool');
  assert.ok(f.motivo.endsWith('CAUDA'));
});

test('o resumo do Consumo liga a linha da sessão à falha', () => {
  const e = new Engine();
  e.recordUsage('a-resumo', 'eu', { usage: { output_tokens: 3 }, total_cost_usd: 0.1, is_error: true }, 'claude-opus-5', '', 'o/r#11');
  e.registrarFalha({ sessionId: 'a-resumo', kind: 'review', motivo: 'quebrou' });
  assert.equal(e.usageSummary().falhasPorSessao['a-resumo'].motivo, 'quebrou');
});

test('as sessões anotam a falha antes do finally apagar o feed', () => {
  const review = fs.readFileSync(path.join(RAIZ, 'lib', 'engine', 'review.js'), 'utf8');
  const self = fs.readFileSync(path.join(RAIZ, 'lib', 'engine', 'selfpr.js'), 'utf8');
  assert.match(review, /anotarFalhaDaSessao\(err, id, stageSummaryFrom\(/);
  assert.match(self, /anotarFalhaDaSessao\(err, id, stageSummaryFrom\(/);
});
```

- [ ] **Passo 2: rodar e ver falhar**

`node --test test/falha-duravel-fiacao.test.js` → falham: `sessionId` ausente no `parked`, `falhaDaSessao` devolve `null` nos caminhos, `falhasPorSessao` indefinido, teste de fonte sem casar.

- [ ] **Passo 3: implementar em `lib/engine/review.js`**

Troque `import { marcarErroNoConsumo } from './falhas.js';` (Tarefa 9) por `import { marcarErroNoConsumo, registrarFalha, detalheDaFalha, anotarFalhaDaSessao } from './falhas.js';`.

Acrescente antes de `function falhaDaAutoanalise`:

```js
// Registro durável da falha de uma sessão headless (A1, item 6). Fica fora do catch do
// runOneHeadless para não somar profundidade lá dentro.
function registrarFalhaHeadless(engine, pr, err, kind) {
  return registrarFalha(engine, {
    sessionId: err.sessaoFarol || '', attemptId: err.attemptId || '', cliSessionId: err.sessionId || '',
    kind, account: engine.accountForPr(pr) || '', ref: pr.key,
    motivo: detalheDaFalha(err), classe: classify(err.message || '').id,
    etapas: err.etapas || null, resumeOutcome: err.resumeOutcome,
  });
}
```

Em `falhaDaAutoanalise`, troque `  engine.log('ERROR', \`autoanalise ${pr.key}: ${err.message}\`);` por

```js
  registrarFalhaHeadless(engine, pr, err, 'self');
  engine.log('ERROR', `autoanalise ${pr.key}: ${err.message}`);
```

No catch do `runOneHeadless`, troque

```js
      const cap = limitErr ? 12 : 3;
```

por

```js
      registrarFalhaHeadless(engine, pr, err, 'review');
      const cap = limitErr ? 12 : 3;
```

troque `        estacionar(engine, pr.key, msg, 'esgotado', pr.headLido);` por `        estacionar(engine, pr.key, msg, 'esgotado', pr.headLido, err.sessaoFarol);` e

```js
      estacionar(engine, pr.key, msg, 'falha', pr.headLido);
```

por

```js
      registrarFalhaHeadless(engine, pr, err, 'review');
      estacionar(engine, pr.key, msg, 'falha', pr.headLido, err.sessaoFarol);
```

No catch do `runHeadlessReview` (logo acima do seu `finally`), troque

```js
    if (err && err.coordenacao) labelEmAndamento = '';
    throw err;
```

por

```js
    if (err && err.coordenacao) labelEmAndamento = '';
    // último momento em que o feed existe: o finally apaga activity junto com a sessão
    anotarFalhaDaSessao(err, id, stageSummaryFrom(engine.activity.get(id), (engine.activeReviews.get(id) || {}).startedAt, Date.now()));
    // desfecho da retomada que a A5 mantém no registro ativo (retomada, recusada, nova)
    if (!err.resumeOutcome) err.resumeOutcome = (engine.activeReviews.get(id) || {}).resumeOutcome;
    throw err;
```

Substitua `estacionar` por:

```js
function estacionar(engine, key, motivo, tipo, head, sessionId) {
  engine.retryAfterNet.delete(key);
  engine.autoReviewParked.add(key);
  if (!engine.parkedMotivos || typeof engine.parkedMotivos !== 'object') engine.parkedMotivos = {};
  engine.parkedMotivos[key] = { at: new Date().toISOString(), motivo: String(motivo || ''), tipo: String(tipo || 'falha'), ...(head ? { head: String(head) } : {}), ...(sessionId ? { sessionId: String(sessionId) } : {}) };
  engine.saveAutoReviewParked();
}
```

e acrescente no comentário acima dele a linha `// \`sessionId\` (A1, opcional) é o id opaco da sessão que falhou: liga o card ao registro durável de falha (lib/engine/falhas.js), que sobrevive a Limpar log e ao relançamento.`

Em `parkedParaUi`, troque `    out[k] = { at: String(m.at || ''), motivo: String(m.motivo || '').slice(0, PARKED_MOTIVO_UI_MAX), tipo };` por `    out[k] = { at: String(m.at || ''), motivo: String(m.motivo || '').slice(0, PARKED_MOTIVO_UI_MAX), tipo, ...(m.sessionId ? { sessionId: String(m.sessionId) } : {}) };`.

- [ ] **Passo 4: implementar em `selfpr.js`, `tools.js` e `usage.js`**

`lib/engine/selfpr.js`: troque `import { marcarErroNoConsumo } from './falhas.js';` por

```js
import { marcarErroNoConsumo, anotarFalhaDaSessao } from './falhas.js';
import { stageSummaryFrom } from './review.js';
```

e no fim de `runSelfAnalysis` troque

```js
  } finally {
    await devolverLeaseSelf(coord);
```

por

```js
  } catch (err) {
    // último momento em que o feed existe: o finally apaga activity junto com a sessão
    anotarFalhaDaSessao(err, id, stageSummaryFrom(engine.activity.get(id), (engine.activeReviews.get(id) || {}).startedAt, Date.now()));
    throw err;
  } finally {
    await devolverLeaseSelf(coord);
```

`lib/engine/tools.js`: troque `import { marcarErroNoConsumo } from './falhas.js';` por `import { marcarErroNoConsumo, registrarFalha, detalheDaFalha } from './falhas.js';` e, no catch de `launchTool`, troque `      if (!err.cancelled) engine.log('ERROR', \`ferramenta ${name}: ${err.message}\`);` por

```js
      if (!err.cancelled) engine.log('ERROR', `ferramenta ${name}: ${err.message}`);
      if (!err.cancelled) registrarFalha(engine, { sessionId: id, attemptId: err.attemptId || '', cliSessionId: err.sessionId || '', kind: 'tool', account: '', ref: label, motivo: detalheDaFalha(err), etapas: null, resumeOutcome: err.resumeOutcome });
```

`lib/engine/usage.js`: depois de `import { TEMPOS } from '../constants.js';` acrescente `import { falhasPorSessao } from './falhas.js';`. Em `usageSummary`, troque `    recentSessions: recentSessionsFrom(engine),` por

```js
    recentSessions,
    // falha durável das sessões da tabela, pelo id da linha (A1, item 6)
    falhasPorSessao: falhasPorSessao(engine, recentSessions.map((s) => s && s.id)),
```

e acrescente `  const recentSessions = recentSessionsFrom(engine);` logo depois de `  const sessions = (engine.usageSessions && engine.usageSessions.sessions) || [];`.

- [ ] **Passo 5: rodar e ver passar**

`node --test test/falha-duravel-fiacao.test.js test/estacionamento-visivel.test.js test/retry-net.test.js test/retomada-apos-falha.test.js test/usage.test.js test/reentrancy.test.js` → verdes. `npm run lint`: as linhas novas do catch do `runOneHeadless` são statements sem chave; nenhuma contagem sobe. Se `test/estacionamento-visivel.test.js` fizer `deepEqual` do objeto de `parkedParaUi` com um estacionamento que agora tem `sessionId`, o teste recebe `sessionId` na expectativa, porque é o dado novo pedido pela spec; registrar no `EXECUCAO.md`.

- [ ] **Passo 6: contraprova**

Apague a linha `      registrarFalhaHeadless(engine, pr, err, 'review');` que fica logo antes de `estacionar(engine, pr.key, msg, 'falha', ...)`. Rode o teste: `falha permanente de revisão` falha (`falhaDaSessao` devolve `null`). Restaure: verde.

- [ ] **Passo 7: commit**

```
git add lib/engine/review.js lib/engine/selfpr.js lib/engine/tools.js lib/engine/usage.js test/falha-duravel-fiacao.test.js
git commit -m "feat(consumo): falha de sessão registrada com motivo inteiro, ligada ao Consumo e ao card estacionado"
```

---

### Tarefa 11: pushback que falha tem teto por PR, pela taxonomia

**Arquivos:**
- Alterar: `lib/engine/pushback.js` (imports; `scanPushbacks` 128-155; `classifyPushback` ~243)
- Criar: `test/pushback-teto.test.js`

**Interfaces:**
- Consome: `classify` (`lib/log-taxonomy.js`), `registrarFalha`/`detalheDaFalha` (Tarefa 4).
- Produz: `MAX_FALHAS_PUSHBACK_POR_PR` (3), `pushbackNoTeto(engine, key, marker)`, `contarFalhaPushback(engine, pr, marker, falha)`, estado `engine.pushbackFalhas` persistido em `state/pushback-falhas.json` (`{ [key]: { marker, falhas, classe, at } }`).

Regra: falha de classe `transitorio` ou `espera-reset` não conta (a sessão não chegou a gastar à toa; o teto por ciclo de 2 continua valendo). Falha permanente, desconhecida ou resultado ilegível conta. Na terceira no MESMO marcador, o PR sai do scan até o autor comentar de novo (marcador novo zera a contagem). O contrato de `classifyPushback` não muda: ilegível continua devolvendo `null`.

- [ ] **Passo 1: escrever o teste que falha**

Crie `test/pushback-teto.test.js`:

```js
// Pushback que falha ou sai ilegível tentava de novo a cada ciclo, sem teto por PR, e
// cada tentativa é uma sessão paga (spec 4.1, extras).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-pushback-teto-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { Engine } = await import('../server.js');
const { classify } = await import('../lib/log-taxonomy.js');
const pb = await import('../lib/engine/pushback.js');

after(() => { try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

function engineAlvo(marcador = '2026-08-01T09:00:00Z') {
  const e = new Engine();
  e.decisions = { resolved: [{ key: 'o/r#2', status: 'auto_approved', action: 'approve', reasons: ['confira X'], cardMet: true, resolvedAt: 1 }], pending: [] };
  e.panorama = [{ key: 'o/r#2', updatedAt: '2026-08-01T10:00:00Z' }];
  e.pushbackScanned = {};
  e.pushbackFalhas = {};
  e.isMuted = () => false;
  e.accountForPr = () => 'eu';
  e.config.autoPushback = true;
  e.savePushbackScanned = () => { };
  e.pushState = () => { };
  e.detectAuthorPushback = async () => ({ marker: marcador, hadActivity: true });
  return e;
}

test('falha permanente repetida para no teto do PR, e marcador novo reabre', async () => {
  const e = engineAlvo();
  let chamadas = 0;
  e.classifyPushback = async () => { chamadas++; throw new Error('JSON fora do contrato qwerty'); };
  for (let i = 0; i < 5; i++) await e.scanPushbacks();
  assert.equal(chamadas, pb.MAX_FALHAS_PUSHBACK_POR_PR);
  assert.equal(e.pushbackFalhas['o/r#2'].classe, classify('JSON fora do contrato qwerty').id, 'a contagem passa pela taxonomia');
  e.detectAuthorPushback = async () => ({ marker: '2026-08-02T09:00:00Z', hadActivity: true });
  await e.scanPushbacks();
  assert.equal(chamadas, pb.MAX_FALHAS_PUSHBACK_POR_PR + 1, 'comentário novo do autor volta a classificar');
});

test('falha transitória não conta para o teto', async () => {
  const msg = 'sessão retornou erro: API Error: 529 Overloaded';
  assert.equal(classify(msg).kind, 'transitorio', 'premissa da taxonomia');
  const e = engineAlvo();
  let chamadas = 0;
  e.classifyPushback = async () => { chamadas++; throw new Error(msg); };
  for (let i = 0; i < 5; i++) await e.scanPushbacks();
  assert.equal(chamadas, 5);
  assert.equal(e.pushbackFalhas['o/r#2'], undefined);
});

test('resultado ilegível conta, registra falha e marca erro no consumo', async () => {
  const e = engineAlvo();
  let sessoes = 0;
  e.runClaudeStream = async (prompt, opts) => {
    sessoes++;
    e.recordUsage(opts.id, 'eu', { usage: { output_tokens: 4 }, total_cost_usd: 0.04 }, 'claude-opus-5', '', opts.ref);
    return { text: 'prosa sem json', sessionId: null };
  };
  for (let i = 0; i < 5; i++) await e.scanPushbacks();
  assert.equal(sessoes, pb.MAX_FALHAS_PUSHBACK_POR_PR);
  const ultima = e.usageSessions.sessions.at(-1);
  assert.equal(ultima.status, 'erro');
  assert.equal(e.falhaDaSessao(ultima.id).kind, 'pushback');
});

test('a contagem sobrevive a um engine novo', async () => {
  const e = engineAlvo();
  e.classifyPushback = async () => { throw new Error('JSON fora do contrato qwerty'); };
  for (let i = 0; i < 3; i++) await e.scanPushbacks();
  const outro = engineAlvo();
  delete outro.pushbackFalhas;
  assert.equal(pb.pushbackNoTeto(outro, 'o/r#2', '2026-08-01T09:00:00Z'), true);
});
```

- [ ] **Passo 2: rodar e ver falhar**

`node --test test/pushback-teto.test.js` → `MAX_FALHAS_PUSHBACK_POR_PR` indefinido; as chamadas chegam a 5.

- [ ] **Passo 3: implementar**

Em `lib/engine/pushback.js`, troque `import { writeJsonAtomic } from '../io.js';` por `import { writeJsonAtomic, readJson } from '../io.js';`, troque `import { marcarErroNoConsumo } from './falhas.js';` (Tarefa 9) por

```js
import { marcarErroNoConsumo, registrarFalha, detalheDaFalha } from './falhas.js';
import { classify } from '../log-taxonomy.js';
```

Acrescente logo antes de `async function scanPushbacks`:

```js
/* Teto de falhas por PR (A1, item 8). O teto por ciclo (MAX_PER_CYCLE) soma todos os
   PRs e nunca parava o MESMO PR de repetir sessão paga a cada ciclo. Conta só o que
   insistir não resolve: a taxonomia (lib/log-taxonomy.js) decide, e transitório ou
   espera de reset ficam de fora. A contagem é por marcador (a atividade do autor que
   motivou a classificação): comentário novo zera, porque aí há material novo. */
const MAX_FALHAS_PUSHBACK_POR_PR = 3;
const PUSHBACK_FALHAS_FILE = path.join(STATE_DIR, 'pushback-falhas.json');
const ILEGIVEL = 'pushback: classificação ilegível (a sessão não devolveu o JSON esperado)';

function falhasPushback(engine) {
  const atual = engine.pushbackFalhas;
  if (atual && typeof atual === 'object' && !Array.isArray(atual)) return atual;
  const lido = readJson(PUSHBACK_FALHAS_FILE, {}, (m) => { if (engine.log) engine.log('WARN', m); });
  engine.pushbackFalhas = lido && typeof lido === 'object' && !Array.isArray(lido) ? lido : {};
  return engine.pushbackFalhas;
}

function savePushbackFalhas(engine) {
  try { writeJsonAtomic(PUSHBACK_FALHAS_FILE, falhasPushback(engine)); }
  catch { /* best-effort: perder a contagem só permite mais uma tentativa depois */ }
}

function pushbackNoTeto(engine, key, marker) {
  const r = falhasPushback(engine)[key];
  return !!r && r.marker === String(marker || '') && Number(r.falhas) >= MAX_FALHAS_PUSHBACK_POR_PR;
}

function contarFalhaPushback(engine, pr, marker, falha) {
  const motivo = detalheDaFalha(falha) || ILEGIVEL;
  const classe = classify(motivo);
  registrarFalha(engine, {
    sessionId: (falha && falha.sessaoFarol) || '', attemptId: (falha && falha.attemptId) || '',
    cliSessionId: (falha && falha.sessionId) || '', kind: 'pushback',
    account: engine.accountForPr(pr) || '', ref: pr.key, motivo, classe: classe.id,
    etapas: null, resumeOutcome: falha && falha.resumeOutcome,
  });
  if (classe.kind === 'transitorio' || classe.kind === 'espera-reset') return false;
  const mapa = falhasPushback(engine);
  const marca = String(marker || '');
  const anteriores = mapa[pr.key] && mapa[pr.key].marker === marca ? Number(mapa[pr.key].falhas) || 0 : 0;
  mapa[pr.key] = { marker: marca, falhas: anteriores + 1, classe: classe.id, at: Date.now() };
  savePushbackFalhas(engine);
  if (anteriores + 1 === MAX_FALHAS_PUSHBACK_POR_PR && engine.log) {
    engine.log('WARN', `pushback ${pr.key}: ${MAX_FALHAS_PUSHBACK_POR_PR} falhas seguidas (${classe.label}); parei de classificar este PR até o autor comentar de novo`);
  }
  return true;
}
```

Em `scanPushbacks`, troque

```js
      try {
        const det = await engine.detectAuthorPushback(pr, engine.pushbackScanned[pr.key] || '');
        if (!det) continue; // não deu pra ler: tenta de novo depois (sem marcar)
```

por

```js
      let marcador = '';
      try {
        const det = await engine.detectAuthorPushback(pr, engine.pushbackScanned[pr.key] || '');
        if (!det) continue; // não deu pra ler: tenta de novo depois (sem marcar)
        marcador = det.marker;
```

troque

```js
        classified++;
        const cls = await engine.classifyPushback(pr, det.marker);
```

por

```js
        if (pushbackNoTeto(engine, pr.key, det.marker)) continue; // teto do PR (A1, item 8)
        classified++;
        const cls = await engine.classifyPushback(pr, det.marker);
```

e troque `      } catch (e) { engine.log('WARN', \`scanPushbacks ${pr.key}: ${e.message}\`); }` por `      } catch (e) { engine.log('WARN', \`scanPushbacks ${pr.key}: ${e.message}\`); contarFalhaPushback(engine, pr, marcador, e); }`.

Em `classifyPushback`, troque

```js
  if (!cls) {
    marcarErroNoConsumo(engine, id);
```

por

```js
  if (!cls) {
    marcarErroNoConsumo(engine, id);
    contarFalhaPushback(engine, pr, marker, { sessaoFarol: id, message: ILEGIVEL });
```

Nos dois blocos de export do fim do arquivo, acrescente `MAX_FALHAS_PUSHBACK_POR_PR, pushbackNoTeto, contarFalhaPushback,` depois de `isPushbackTarget, pushbackTargets,`.

- [ ] **Passo 4: rodar e ver passar**

`node --test test/pushback-teto.test.js test/pushback.test.js test/sync-callers.test.js` → verdes. `npm run lint` sem regressão (as mudanças dentro do laço são statements sem chave; o `if` com chaves do log fica em função de primeiro nível).

- [ ] **Passo 5: contraprova**

Apague a linha `        if (pushbackNoTeto(engine, pr.key, det.marker)) continue; // teto do PR (A1, item 8)`. Rode o teste: `falha permanente repetida para no teto` falha (5 chamadas) e `resultado ilegível conta` falha (5 sessões). Restaure: verde.

- [ ] **Passo 6: commit**

```
git add lib/engine/pushback.js test/pushback-teto.test.js
git commit -m "fix(pushback): teto de falhas por PR decidido pela taxonomia"
```

**Gate do bloco:** `npm run check && npm run lint && npm test` verde antes da Tarefa 12.

---

### Tarefa 12: correção de desfecho chega ao banco depois do cursor

**Arquivos:**
- Alterar: `lib/engine/usage.js` (`marcarDesfecho` 136-146), `lib/sync/outbox.js` (`defaultOutbox`, `normalizar`, `retargetOutbox`, `resetForFullSync`, função nova, exports), `lib/engine/sync-usage.js` (import; `outboxReconciliada`)
- Acrescentar: `test/sync-outbox.test.js`

**Interfaces:**
- Consome: `enqueueSession`, `eventIdFor` (inalterados: o `eventId` continua vindo só dos campos imutáveis, e `corrigidoEm` não entra nele).
- Produz: campo `corrigidoEm` na linha de `usage-sessions.json`; campo `correcoesAt` na outbox; `reconcileCorrections(outbox, sessions, deviceId, farolVersion)`.

Por que é uma fila e não uma nova tentativa no gancho: com a consolidação desligada ou sem `deviceId`, `enqueueUsage` sai sem tocar a outbox (contrato de `lib/engine/sync-usage.js`), e o cursor (`cursorAt`) já passou pela sessão, então `reconcileFromSessions` nunca a pega de novo. A pendência mora na própria linha (`corrigidoEm`, durável no arquivo que já existe), e a outbox ganha um segundo cursor só para correções. Nenhum arquivo de sincronização novo nasce com a sincronização desligada (CT-COMPAT (a) 1).

- [ ] **Passo 1: escrever o teste que falha**

No fim de `test/sync-outbox.test.js`, acrescente:

```js
test('reconcileCorrections: correção depois do cursor volta à fila com o mesmo eventId, uma vez', () => {
  const s = sessao({ id: 'a-corr', at: 1000, status: 'erro', corrigidoEm: 5000 });
  const ob = outbox.defaultOutbox();
  ob.cursorAt = 9000;
  assert.equal(outbox.reconcileFromSessions(ob, [s], DEV, VERSAO), 0, 'o cursor sozinho perde a correção');
  assert.equal(outbox.reconcileCorrections(ob, [s], DEV, VERSAO), 1);
  assert.equal(ob.pending[0].eventId, eventIdFor(s, DEV));
  assert.equal(ob.pending[0].payload.status, 'erro');
  assert.equal(ob.correcoesAt, 5000);
  assert.equal(outbox.reconcileCorrections(ob, [s], DEV, VERSAO), 0, 'correção já enfileirada não volta');
});

test('reconcileCorrections sem deviceId não avança o cursor de correções', () => {
  const ob = outbox.defaultOutbox();
  assert.equal(outbox.reconcileCorrections(ob, [sessao({ id: 'a-x', at: 1, corrigidoEm: 7 })], '', VERSAO), 0);
  assert.equal(ob.correcoesAt, 0);
});

test('correção feita com a consolidação desligada chega ao banco quando ela volta (A1, item 7)', async () => {
  const engine = new Engine();
  engine.sync.fetchImpl = fetchDosDubles;
  await salvarSync(engine, syncCfg({ consolidation: { enabled: true } }));
  if (engine.sync.status !== 'conectado') assert.equal((await engine.syncLogin({ email: EMAIL, password: SENHA })).ok, true);
  const deviceId = engine.sync.deviceId;
  engine.recordUsage('a-correcao-tardia', 'Fulano', RESULTADO, 'opus', 'perfil-9', 'Org/Repo#9');
  const id = eventIdFor(engine.usageSessions.sessions.at(-1), deviceId);
  await engine.syncTick();
  assert.equal(eventosRemotos('u1', deviceId)[id].status, 'ok');

  await salvarSync(engine, syncCfg({ consolidation: { enabled: false } }));
  assert.equal(engine.marcarDesfecho('a-correcao-tardia', 'erro'), true);
  assert.ok(engine.usageSessions.sessions.at(-1).corrigidoEm > 0, 'a pendência fica na própria linha');
  await engine.syncTick();
  assert.equal(eventosRemotos('u1', deviceId)[id].status, 'ok', 'desligada, nada sobe');

  await salvarSync(engine, syncCfg({ consolidation: { enabled: true } }));
  if (engine.sync.status !== 'conectado') assert.equal((await engine.syncLogin({ email: EMAIL, password: SENHA })).ok, true);
  await engine.syncTick();
  assert.equal(eventosRemotos('u1', deviceId)[id].status, 'erro', 'a correção posterior ao cursor chegou');
});
```

- [ ] **Passo 2: rodar e ver falhar**

`node --test test/sync-outbox.test.js` → `reconcileCorrections` não é função; no teste de engine o status remoto fica `ok`.

- [ ] **Passo 3: implementar**

`lib/engine/usage.js`, em `marcarDesfecho`, troque

```js
  alvo.status = status;
  saveSessions(engine);
```

por

```js
  alvo.status = status;
  // pendência durável de envio: com a consolidação desligada ou sem identidade do
  // aparelho o gancho abaixo não enfileira, e o cursor da outbox já passou por esta
  // linha. reconcileCorrections (lib/sync/outbox.js) a pega por este carimbo (A1, item 7).
  alvo.corrigidoEm = Date.now();
  saveSessions(engine);
```

`lib/sync/outbox.js`: troque `  return { destino: '', cursorAt: 0, pending: [], enviados: 0, rejeitados: 0, lastSentAt: 0, paused: false };` por `  return { destino: '', cursorAt: 0, correcoesAt: 0, pending: [], enviados: 0, rejeitados: 0, lastSentAt: 0, paused: false };`. Em `normalizar`, troque `    cursorAt: numero(bruto.cursorAt),` por

```js
    cursorAt: numero(bruto.cursorAt),
    correcoesAt: numero(bruto.correcoesAt),
```

Acrescente depois de `reconcileFromSessions`:

```js
// Correção de desfecho feita quando o evento não podia ser enfileirado (consolidação
// desligada, aparelho ainda sem identidade): o cursor já passou pela sessão e nunca a
// pegaria de novo. A pendência mora na própria linha (`corrigidoEm`), que é durável; aqui
// ela volta à fila com o MESMO eventId e o status atual. Segundo cursor, só de correções.
function reconcileCorrections(outbox, sessions, deviceId, farolVersion) {
  const corte = outbox.correcoesAt;
  let n = 0;
  let maior = corte;
  for (const s of Array.isArray(sessions) ? sessions : []) {
    const quando = objeto(s) ? numero(s.corrigidoEm) : 0;
    if (quando <= corte || !enqueueSession(outbox, s, deviceId, farolVersion)) continue;
    n++;
    maior = Math.max(maior, quando);
  }
  outbox.correcoesAt = maior;
  return n;
}
```

Em `retargetOutbox`, troque as duas últimas linhas do corpo

```js
  outbox.cursorAt = 0;
  return true;
```

por

```js
  outbox.cursorAt = 0;
  outbox.correcoesAt = 0;
  return true;
```

e em `resetForFullSync`, troque

```js
  outbox.cursorAt = 0;
  return outbox;
```

por

```js
  outbox.cursorAt = 0;
  outbox.correcoesAt = 0;
  return outbox;
```

Nos dois blocos de export, acrescente `reconcileCorrections` depois de `reconcileFromSessions`.

`lib/engine/sync-usage.js`: no import de `../sync/outbox.js`, acrescente `reconcileCorrections` depois de `reconcileFromSessions`. Em `outboxReconciliada`, troque

```js
  const novas = reconcileFromSessions(rt.outbox, sessoesDe(engine), rt.deviceId, APP_VERSION);
  if (novas || mudouDestino) saveOutbox(rt.outbox);
```

por

```js
  const novas = reconcileFromSessions(rt.outbox, sessoesDe(engine), rt.deviceId, APP_VERSION);
  const corrigidas = reconcileCorrections(rt.outbox, sessoesDe(engine), rt.deviceId, APP_VERSION);
  if (novas || corrigidas || mudouDestino) saveOutbox(rt.outbox);
```

- [ ] **Passo 4: rodar e ver passar**

`node --test test/sync-outbox.test.js test/usage-auditoria.test.js test/sync-engine-boot.test.js` → verdes (o teste `consolidação desligada nunca grava sync-outbox.json` continua verde: `marcarDesfecho` só grava `usage-sessions.json`).

- [ ] **Passo 5: contraprova**

Em `outboxReconciliada`, troque `  const corrigidas = reconcileCorrections(rt.outbox, sessoesDe(engine), rt.deviceId, APP_VERSION);` por `  const corrigidas = 0;`. Rode: `correção feita com a consolidação desligada chega ao banco` falha com `ok`. Restaure: verde.

- [ ] **Passo 6: commit**

```
git add lib/engine/usage.js lib/sync/outbox.js lib/engine/sync-usage.js test/sync-outbox.test.js
git commit -m "fix(sincronizacao): correção de desfecho posterior ao cursor volta à fila pelo carimbo da linha"
```

---

### Tarefa 13: diário de tentativas (`state/usage-tentativas.json`)

**Arquivos:**
- Alterar: `lib/constants.js` (`TEMPOS`)
- Criar: `lib/engine/usage-tentativas.js`, `test/usage-tentativas.test.js`

**Interfaces:**
- Consome: `recordUsage`, `defaultUsage`, `defaultSessions`, `kindFromId` (`lib/engine/usage.js`); marcas `farol_interrompida`, `farol_parcial`, `farol_custo_desconhecido`, `farol_attempt`, `farol_iniciada_em`, `farol_provedor_destacado` (Tarefa 6).
- Produz (contrato): `abrirTentativa(engine, meta)` → `attemptId` (UUID); `registrarParcial(engine, attemptId, parcial)` com `parcial = { usage, model?, fimDeTurno? }`; `fecharTentativa(engine, attemptId)`; `reconciliarInterrompidas(engine)` → número de linhas criadas. Auxiliar: `arquivoDeTentativas()`.

Formato do arquivo: `{ tentativas: { [attemptId]: { attemptId, sessionId, kind, account, profileId, model, ref, provedor, abertaEm, parcial: { input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens }, parcialEm } } }`.

- [ ] **Passo 1: constante de tempo**

Em `lib/constants.js`, dentro de `TEMPOS`, depois de `SESSAO_HEADLESS_MS`, acrescente:

```js
  // intervalo mínimo entre gravações do consumo parcial no diário de tentativas
  // (lib/engine/usage-tentativas.js). O fim de cada turno grava sempre; entre turnos,
  // uma sessão que emite dezenas de eventos por segundo não reescreve o arquivo a cada um.
  TENTATIVA_PARCIAL_MS: 5000,
```

- [ ] **Passo 2: escrever o teste que falha**

Crie `test/usage-tentativas.test.js`:

```js
// O acumulador de consumo vive em memória: app fechado no meio (bandeja, queda) perdia
// o gasto inteiro (spec 4.1, buraco 3). O diário grava a tentativa antes do provedor e o
// parcial durante a sessão; o boot seguinte transforma o que sobrou em linha interrompida.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-tentativas-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const t = await import('../lib/engine/usage-tentativas.js');
const usage = (await import('../lib/engine/usage.js')).default;
const { TEMPOS } = await import('../lib/constants.js');
const { IS_WIN } = await import('../lib/paths.js');

after(() => { try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });
beforeEach(() => { fs.rmSync(t.arquivoDeTentativas(), { force: true }); });

const ler = () => JSON.parse(fs.readFileSync(t.arquivoDeTentativas(), 'utf8')).tentativas;
const engineDeTeste = () => ({ usage: usage.defaultUsage(), usageSessions: usage.defaultSessions(), log() { }, pushState() { throw new Error('boot não avisa a tela'); } });
const META = { sessionId: 'a-diario', account: 'eu', profileId: 'p1', model: 'claude-opus-5', ref: 'o/r#1', provedor: 'claude' };

test('abrirTentativa grava antes do provedor, com id opaco e metadados', () => {
  const id = t.abrirTentativa(engineDeTeste(), META);
  assert.match(id, /^[0-9a-f-]{36}$/);
  const r = ler()[id];
  assert.equal(r.sessionId, 'a-diario');
  assert.equal(r.kind, 'review');
  assert.equal(r.profileId, 'p1');
  assert.ok(r.abertaEm > 0);
  assert.equal(r.parcial.output_tokens, 0);
});

test('registrarParcial respeita o intervalo, mas o fim de turno grava sempre', (ctx) => {
  ctx.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const e = engineDeTeste();
  const id = t.abrirTentativa(e, META);
  assert.equal(t.registrarParcial(e, id, { usage: { output_tokens: 10 } }), true, 'primeira gravação sai na hora');
  assert.equal(t.registrarParcial(e, id, { usage: { output_tokens: 20 } }), false, 'dentro do intervalo não grava');
  assert.equal(ler()[id].parcial.output_tokens, 10);
  assert.equal(t.registrarParcial(e, id, { usage: { output_tokens: 30 }, fimDeTurno: true, model: 'claude-sonnet-5' }), true);
  assert.equal(ler()[id].parcial.output_tokens, 30);
  assert.equal(ler()[id].model, 'claude-sonnet-5');
  ctx.mock.timers.tick(TEMPOS.TENTATIVA_PARCIAL_MS);
  assert.equal(t.registrarParcial(e, id, { usage: { output_tokens: 40 } }), true);
});

test('fecharTentativa tira a tentativa do diário', () => {
  const e = engineDeTeste();
  const id = t.abrirTentativa(e, META);
  assert.equal(t.fecharTentativa(e, id), true);
  assert.equal(ler()[id], undefined);
  assert.equal(t.fecharTentativa(e, id), false, 'fechar de novo é no-op');
});

test('boot: tentativa com tokens vira linha interrompida com o parcial', () => {
  const e = engineDeTeste();
  const id = t.abrirTentativa(e, META);
  t.registrarParcial(e, id, { usage: { input_tokens: 12, output_tokens: 345 }, fimDeTurno: true });
  const boot = engineDeTeste();
  assert.equal(t.reconciliarInterrompidas(boot), 1);
  const s = boot.usageSessions.sessions.at(-1);
  assert.equal(s.status, 'interrompida');
  assert.equal(s.outputTokens, 345);
  assert.equal(s.inputTokens, 12);
  assert.equal(s.attemptId, id);
  assert.equal(s.costSource, 'desconhecido', 'sem base de estimativa no registro vazio');
  assert.equal(s.provedorPodeTerContinuado === true, !IS_WIN);
  assert.deepEqual(ler(), {});
});

test('boot: tentativa sem nenhum consumo vira linha com custo desconhecido, nunca ausência', () => {
  t.abrirTentativa(engineDeTeste(), META);
  const boot = engineDeTeste();
  assert.equal(t.reconciliarInterrompidas(boot), 1);
  const s = boot.usageSessions.sessions.at(-1);
  assert.equal(s.status, 'interrompida');
  assert.equal(s.costSource, 'desconhecido');
  assert.equal(s.costUsd, 0);
  assert.equal(s.outputTokens, 0);
});

test('boot: tentativa já registrada pelo fechamento normal não duplica', () => {
  const e = engineDeTeste();
  const id = t.abrirTentativa(e, META);
  const boot = engineDeTeste();
  usage.recordUsage({ ...boot, pushState() { } }, 'a-diario', 'eu', { usage: { output_tokens: 5 }, total_cost_usd: 0.1, farol_attempt: id }, 'claude-opus-5', 'p1', 'o/r#1');
  assert.equal(t.reconciliarInterrompidas(boot), 0);
  assert.equal(boot.usageSessions.sessions.length, 1);
  assert.deepEqual(ler(), {});
});

test('boot sem diário não faz nada', () => {
  assert.equal(t.reconciliarInterrompidas(engineDeTeste()), 0);
});
```

- [ ] **Passo 3: rodar e ver falhar**

`node --test test/usage-tentativas.test.js` → `ERR_MODULE_NOT_FOUND` para `lib/engine/usage-tentativas.js`.

- [ ] **Passo 4: implementar**

Crie `lib/engine/usage-tentativas.js`:

```js
// Diário de tentativas de sessão de IA (spec 7.A1, item 9). O acumulador de consumo da
// sessão mora em memória (lib/engine/session.js), então app fechado no meio (bandeja,
// queda, kill) perdia o gasto inteiro. Aqui cada tentativa é aberta ANTES do provedor,
// ganha o consumo parcial durante a sessão e sai no fechamento normal, DEPOIS de o
// consumo ser registrado. O que sobra no boot virou, por construção, uma sessão cortada:
// reconciliarInterrompidas a transforma em linha `interrompida`, com os tokens vistos
// ou com custo desconhecido, e nunca a apaga sem registrar.
//
// O id da tentativa é próprio (uma sessão pode ter duas tentativas: retomada recusada
// cai numa sessão nova com o mesmo id do Farol) e viaja para a linha do Consumo como
// `attemptId`, que é o que impede o boot de duplicar uma tentativa já registrada.
//
// LIMITE DECLARADO: no POSIX o provedor roda em grupo de processo próprio (detached) e
// pode continuar consumindo depois que o engine morreu. Esse gasto não é observado; a
// linha diz isso em `provedorPodeTerContinuado`.
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { STATE_DIR, IS_WIN } from '../paths.js';
import { readJson, writeJsonAtomic, ensureDir } from '../io.js';
import { TEMPOS } from '../constants.js';
import usageMod from './usage.js';

const ARQUIVO = path.join(STATE_DIR, 'usage-tentativas.json');
const CAMPOS = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'];
// hora da última gravação de parcial por tentativa: memória do processo, de propósito
// (reinício zera, e a primeira gravação depois dele sai na hora)
const ultimaGravacao = new Map();

function arquivoDeTentativas() { return ARQUIVO; }
function objeto(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function texto(v) { return typeof v === 'string' ? v : ''; }

function avisar(engine, msg) {
  if (engine && typeof engine.log === 'function') engine.log('WARN', msg);
}

function ler(engine) {
  const bruto = readJson(ARQUIVO, null, (m) => avisar(engine, m));
  return objeto(bruto) && objeto(bruto.tentativas) ? bruto : { tentativas: {} };
}

function gravar(engine, dados) {
  try {
    ensureDir(STATE_DIR);
    writeJsonAtomic(ARQUIVO, dados);
    return true;
  } catch (err) {
    avisar(engine, `gravar usage-tentativas.json: ${err.message}`);
    return false;
  }
}

function usoSaneado(u) {
  const out = {};
  for (const c of CAMPOS) out[c] = Math.max(0, Number(u && u[c]) || 0);
  return out;
}

function abrirTentativa(engine, meta) {
  const m = objeto(meta) ? meta : {};
  const attemptId = randomUUID();
  const dados = ler(engine);
  dados.tentativas[attemptId] = {
    attemptId, sessionId: texto(m.sessionId), kind: usageMod.kindFromId(m.sessionId),
    account: texto(m.account), profileId: texto(m.profileId), model: texto(m.model),
    ref: texto(m.ref), provedor: texto(m.provedor) || 'claude',
    abertaEm: Date.now(), parcial: usoSaneado(null), parcialEm: 0,
  };
  gravar(engine, dados);
  return attemptId;
}

// `parcial.usage` é o acumulado da sessão até aqui (substitui, não soma).
function registrarParcial(engine, attemptId, parcial) {
  if (!attemptId || !objeto(parcial)) return false;
  const agora = Date.now();
  const ultima = ultimaGravacao.get(attemptId) || 0;
  if (parcial.fimDeTurno !== true && ultima && agora - ultima < TEMPOS.TENTATIVA_PARCIAL_MS) return false;
  const dados = ler(engine);
  const tentativa = dados.tentativas[attemptId];
  if (!objeto(tentativa)) return false;
  tentativa.parcial = usoSaneado(parcial.usage);
  if (texto(parcial.model)) tentativa.model = texto(parcial.model);
  tentativa.parcialEm = agora;
  ultimaGravacao.set(attemptId, agora);
  return gravar(engine, dados);
}

// Chamado DEPOIS do registro de consumo do fechamento normal. Se o processo morrer entre
// os dois, o boot acha a linha pelo attemptId e só remove.
function fecharTentativa(engine, attemptId) {
  ultimaGravacao.delete(attemptId);
  if (!attemptId) return false;
  const dados = ler(engine);
  if (!dados.tentativas[attemptId]) return false;
  delete dados.tentativas[attemptId];
  return gravar(engine, dados);
}

function eventoInterrompido(tentativa) {
  const usage = usoSaneado(tentativa.parcial);
  const temToken = CAMPOS.some((c) => usage[c] > 0);
  return {
    usage, farol_interrompida: true, farol_parcial: temToken, farol_custo_desconhecido: !temToken,
    farol_attempt: tentativa.attemptId, farol_iniciada_em: Number(tentativa.abertaEm) || 0,
    farol_provedor_destacado: !IS_WIN,
  };
}

// recordUsage avisa a tela (pushState) e a outbox. No boot a tela ainda não existe e o
// snapshot leria campos que o construtor preenche depois; a outbox recupera pelo cursor.
function registroDeBoot(engine) {
  if (!engine.usage) engine.usage = usageMod.defaultUsage();
  if (!engine.usageSessions) engine.usageSessions = usageMod.defaultSessions();
  return {
    usage: engine.usage, usageSessions: engine.usageSessions,
    log: (nivel, msg) => avisar(engine, msg),
    pushState() { /* boot: a tela ainda não existe */ },
  };
}

function jaRegistrada(engine, attemptId) {
  return (engine.usageSessions.sessions || []).some((s) => objeto(s) && s.attemptId === attemptId);
}

function reconciliarInterrompidas(engine) {
  const dados = ler(engine);
  const ids = Object.keys(dados.tentativas);
  if (!ids.length) return 0;
  const alvo = registroDeBoot(engine);
  let criadas = 0;
  for (const id of ids) {
    const tentativa = dados.tentativas[id];
    if (objeto(tentativa) && !jaRegistrada(engine, id)) {
      usageMod.recordUsage(alvo, tentativa.sessionId, tentativa.account, eventoInterrompido(tentativa), tentativa.model, tentativa.profileId, tentativa.ref);
      criadas++;
    }
    // só sai do diário o que tem linha (ou era lixo ilegível): nunca some sem registro
    if (!objeto(tentativa) || jaRegistrada(engine, id)) delete dados.tentativas[id];
  }
  gravar(engine, dados);
  return criadas;
}

const tentativasMod = { arquivoDeTentativas, abrirTentativa, registrarParcial, fecharTentativa, reconciliarInterrompidas };
export default tentativasMod;
export { arquivoDeTentativas, abrirTentativa, registrarParcial, fecharTentativa, reconciliarInterrompidas };
```

- [ ] **Passo 5: rodar e ver passar**

`node --test test/usage-tentativas.test.js` → 7 testes verdes. `npm run check && npm run lint` → verde, sem regressão (`TENTATIVA_PARCIAL_MS` mora em `lib/constants.js`).

- [ ] **Passo 6: contraprova**

Em `reconciliarInterrompidas`, troque `if (objeto(tentativa) && !jaRegistrada(engine, id)) {` por `if (objeto(tentativa)) {`. Rode: `tentativa já registrada pelo fechamento normal não duplica` falha (2 linhas). Restaure: verde.

- [ ] **Passo 7: commit**

```
git add lib/constants.js lib/engine/usage-tentativas.js test/usage-tentativas.test.js
git commit -m "feat(consumo): diário de tentativas que vira linha interrompida no boot"
```

---

### Tarefa 14: a tentativa entra na vida real da sessão e o boot reconcilia

**Arquivos:**
- Alterar: `lib/engine/session.js` (imports; `runProvedor` 857-1038: abertura antes do `spawn`, parcial em `handleEvent` ~961, `finish` ~935, `error` ~998, `close` ~1009; `registrarConsumo` 1061-1073)
- Alterar: `lib/codex/stream.js` (import; `registrarUsoCodex` 149; `fecharCodex`; `ligarCodexChild`; `runCodexStream`)
- Alterar: `server.js` (import; construtor, logo depois de `this.recoverInflight();`, linha 355)
- Criar: `test/usage-tentativas-fiacao.test.js`

**Interfaces:**
- Consome: `abrirTentativa`, `registrarParcial`, `fecharTentativa`, `reconciliarInterrompidas` (Tarefa 13).
- Produz: `err.attemptId` em todo erro de sessão; marca `farol_attempt` no evento entregue a `recordUsage`; `engine.reconciliarInterrompidas` chamado no boot.

A abertura fica imediatamente antes do `spawn` e depois de `engine.ghEnv`, que lança quando a conta não tem token: aberta antes disso, uma sessão que nunca começou viraria linha `interrompida` no boot seguinte. Ordem no fechamento normal: `registrarConsumo` primeiro, `fecharTentativa` depois.

- [ ] **Passo 1: escrever o teste que falha**

Crie `test/usage-tentativas-fiacao.test.js`:

```js
// Fiação do diário de tentativas no caminho de verdade (runClaudeStream com filho falso
// e stream real), mesmo método do test/usage-parcial-stream.test.js: o furo costuma
// estar na fiação, não na função pura.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-tentativa-fio-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import childProcess from 'node:child_process';

const realSpawn = childProcess.spawn;
let spawnImpl = null;
childProcess.spawn = function spawnFalso(...args) { return spawnImpl ? spawnImpl(...args) : realSpawn(...args); };

const { runClaudeStream, parseEnvelope } = await import('../lib/engine/session.js');
const tentativas = await import('../lib/engine/usage-tentativas.js');
const { Engine } = await import('../server.js');

after(() => {
  childProcess.spawn = realSpawn;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});
beforeEach(() => { fs.rmSync(tentativas.arquivoDeTentativas(), { force: true }); });

const diario = () => {
  if (!fs.existsSync(tentativas.arquivoDeTentativas())) return [];
  return Object.values(JSON.parse(fs.readFileSync(tentativas.arquivoDeTentativas(), 'utf8')).tentativas);
};
const tick = () => new Promise((r) => setImmediate(r));

function filho() {
  const c = new EventEmitter();
  c.stdout = new PassThrough();
  c.stderr = new EventEmitter();
  c.stdin = Object.assign(new EventEmitter(), { write() { }, end() { } });
  c.pid = 4545;
  return c;
}

function engineFalso(registros, auth = { kind: 'dir', id: 'p1' }) {
  return {
    config: {}, running: new Map(), killTree() { },
    ghEnv: () => ({ PATH: '' }), resolveClaudeAuth: () => auth,
    recordUsage(id, account, ev) { registros.push({ id, ev }); },
    pushActivity() { }, setSessionModel() { }, toolSummary: () => '',
    parseEnvelope(raw) { return parseEnvelope(this, raw); },
  };
}

test('sessão Claude: tentativa aberta antes do provedor, parcial gravado e fechada depois do consumo', async () => {
  const registros = [];
  const c = filho();
  spawnImpl = () => c;
  const p = runClaudeStream(engineFalso(registros), 'prompt', { id: 'a-fio', account: 'eu', ref: 'o/r#1' });
  spawnImpl = null;
  const [aberta] = diario();
  assert.equal(aberta.sessionId, 'a-fio');
  assert.equal(aberta.provedor, 'claude');
  c.stdout.write(JSON.stringify({ type: 'assistant', message: { id: 'msg_1', stop_reason: 'tool_use', content: [{ type: 'text', text: 'lendo' }], usage: { output_tokens: 30 } } }) + '\n');
  await tick();
  assert.equal(diario()[0].parcial.output_tokens, 30);
  c.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: 'ok', usage: { output_tokens: 30 }, total_cost_usd: 0.3 }) + '\n');
  c.stdout.once('end', () => c.emit('close', 0));
  c.stdout.end();
  await p;
  assert.equal(registros.length, 1);
  assert.equal(registros[0].ev.farol_attempt, aberta.attemptId, 'a linha leva o id da tentativa');
  assert.deepEqual(diario(), [], 'fechamento normal tira a tentativa do diário');
});

test('sessão Claude com erro: o erro leva o attemptId e o diário esvazia', async () => {
  const c = filho();
  spawnImpl = () => c;
  const p = runClaudeStream(engineFalso([]), 'prompt', { id: 'a-fio-erro' });
  spawnImpl = null;
  const [aberta] = diario();
  c.stdout.once('end', () => c.emit('close', 1));
  c.stdout.end();
  await assert.rejects(p, (err) => err.attemptId === aberta.attemptId);
  assert.deepEqual(diario(), []);
});

test('falha no spawn (evento error) também fecha a tentativa', async () => {
  const c = filho();
  spawnImpl = () => c;
  const p = runClaudeStream(engineFalso([]), 'prompt', { id: 'a-fio-spawn' });
  spawnImpl = null;
  assert.equal(diario().length, 1);
  c.emit('error', new Error('ENOENT'));
  await assert.rejects(p, /ENOENT/);
  assert.deepEqual(diario(), []);
});

test('sessão Codex: tentativa aberta antes do provedor e fechada depois do registro da falha', async () => {
  const registros = [];
  process.env.FAROL_HEADLESS_CMD = 'stub-do-teste';
  const criado = new Promise((resolve) => { spawnImpl = () => { const c = filho(); resolve(c); return c; }; });
  const p = runClaudeStream(engineFalso(registros, { kind: 'codex', id: 'cx1' }), 'prompt', { id: 'a-fio-cx', ref: 'o/r#2' });
  try {
    const c = await criado;
    spawnImpl = null;
    const [aberta] = diario();
    assert.equal(aberta.provedor, 'codex');
    c.stdout.write(JSON.stringify({ type: 'turn.failed', error: { message: 'recusado' } }) + '\n');
    await tick();
    c.stdout.once('end', () => c.emit('close', 1));
    c.stdout.end();
    await assert.rejects(p, (err) => err.attemptId === aberta.attemptId);
    assert.equal(registros.at(-1).ev.farol_attempt, aberta.attemptId);
    assert.equal(registros.at(-1).ev.farol_custo_desconhecido, true);
    assert.deepEqual(diario(), []);
  } finally {
    spawnImpl = null;
    delete process.env.FAROL_HEADLESS_CMD;
  }
});

test('boot da Engine reconcilia a tentativa que sobrou', () => {
  tentativas.abrirTentativa({}, { sessionId: 'a-sobrou', account: 'eu', profileId: '', model: 'claude-opus-5', ref: 'o/r#3' });
  const e = new Engine();
  const s = e.usageSessions.sessions.find((x) => x.id === 'a-sobrou');
  assert.equal(s.status, 'interrompida');
  assert.equal(s.costSource, 'desconhecido');
  assert.deepEqual(diario(), []);
});
```

- [ ] **Passo 2: rodar e ver falhar**

`node --test test/usage-tentativas-fiacao.test.js` → falha já no primeiro `diario()` vazio (nenhuma tentativa aberta) e no boot sem linha.

- [ ] **Passo 3: implementar em `lib/engine/session.js`**

Troque `import { erroDeSessao } from './falhas.js';` (Tarefa 5) por

```js
import { erroDeSessao } from './falhas.js';
import { abrirTentativa, registrarParcial, fecharTentativa } from './usage-tentativas.js';
```

Acrescente logo depois da função `acumularParcial`:

```js
// Grava o acumulado no diário de tentativas (throttle dentro do módulo; fim de turno
// grava sempre). Devolve true porque só é chamada quando houve gasto: é o valor que o
// chamador guarda em houveParcial, numa linha só, sem abrir bloco novo no handleEvent.
function anotarParcial(engine, attemptId, parcial, model, message) {
  registrarParcial(engine, attemptId, { usage: parcial, model, fimDeTurno: !!(message && message.stop_reason) });
  return true;
}
```

Em `runProvedor`, troque

```js
    const authProfileId = auth.id || '';
    const child = IS_WIN
```

por

```js
    const authProfileId = auth.id || '';
    // diário da tentativa imediatamente antes do provedor (A1, item 9): se o processo do
    // Farol morrer daqui pra frente, o boot seguinte registra a linha `interrompida`
    const attemptId = abrirTentativa(engine, { sessionId: opts.id, account: opts.account, profileId: authProfileId, model: opts.model || '', ref: opts.ref, provedor: 'claude' });
    const child = IS_WIN
```

Em `finish`, troque `        if (sessionId) err.sessionId = sessionId;` por

```js
        if (sessionId) err.sessionId = sessionId;
        err.attemptId = attemptId;
        // desfecho da retomada desta tentativa, que a A5 passa em opts
        if (opts.resumeOutcome && !err.resumeOutcome) err.resumeOutcome = opts.resumeOutcome;
```

Em `handleEvent`, troque `        if (acumularParcial(parcial, ev.message.usage)) houveParcial = true;` por `        if (acumularParcial(parcial, ev.message.usage)) houveParcial = anotarParcial(engine, attemptId, parcial, usedModel, ev.message);`.

Troque `    child.on('error', e => finish(e));` por `    child.on('error', (e) => { fecharTentativa(engine, attemptId); finish(e); });`.

No `close`, troque `      registrarConsumo(engine, opts, { resultEvent, cancelada: run.cancelled, parcial, houveParcial, usedModel, authProfileId });` por

```js
      registrarConsumo(engine, opts, { resultEvent, cancelada: run.cancelled, parcial, houveParcial, usedModel, authProfileId, attemptId });
      // DEPOIS do registro: morte entre os dois é resolvida no boot pelo attemptId da linha
      fecharTentativa(engine, attemptId);
```

Substitua o corpo de `registrarConsumo` por:

```js
function registrarConsumo(engine, opts, ctx) {
  const { resultEvent, cancelada, parcial, houveParcial, usedModel, authProfileId, attemptId } = ctx;
  let ev = null;
  if (resultEvent) ev = cancelada ? { ...resultEvent, farol_cancelled: true } : { ...resultEvent };
  // SEM evento final e COM token gasto: a sessão morreu no meio. Registrar é o que
  // impede esse dinheiro de sumir da tela E do teto de orçamento, o furo que o
  // cancelamento da autoanálise passou a abrir todo dia. O custo não existe em lugar
  // nenhum do stream: quem estima, e quem carimba que é estimativa, é o recordUsage.
  else if (houveParcial) ev = { usage: parcial, farol_parcial: true };
  if (!ev) return;
  // liga a linha à tentativa do diário: é o que impede o boot de registrar de novo
  if (attemptId) ev.farol_attempt = attemptId;
  // desfecho da retomada (A5) persiste na linha de consumo
  if (opts.resumeOutcome) ev.farol_resume_outcome = opts.resumeOutcome;
  try { engine.recordUsage(opts.id, opts.account, ev, usedModel, authProfileId, opts.ref); }
  catch { /* registro é opcional: nunca derruba o fim da sessão */ }
}
```

- [ ] **Passo 4: implementar em `lib/codex/stream.js`**

Troque `import { erroDeSessao } from '../engine/falhas.js';` (Tarefa 5) por

```js
import { erroDeSessao } from '../engine/falhas.js';
import { abrirTentativa, registrarParcial, fecharTentativa } from '../engine/usage-tentativas.js';
```

Substitua `registrarUsoCodex` por:

```js
function registrarUsoCodex(engine, opts, run, resultEvent) {
  if (!resultEvent) return;
  const ev = run.cancelled ? { ...resultEvent, farol_cancelled: true } : { ...resultEvent };
  if (opts.attemptId) ev.farol_attempt = opts.attemptId;
  const modelo = modelLabel(run.model) || 'Codex (padrão)';
  try { engine.recordUsage(opts.id, opts.account, ev, modelo, opts.authProfileId || '', opts.ref); } catch { /* opcional */ }
}
```

Em `fecharCodex`, troque `  registrarUsoCodex(engine, opts, run, resultEvent || falhaSemEventoCodex(estado, code));` por

```js
  registrarUsoCodex(engine, opts, run, resultEvent || falhaSemEventoCodex(estado, code));
  // DEPOIS do registro, como no Claude (lib/engine/session.js)
  fecharTentativa(engine, opts.attemptId);
```

Acrescente antes de `function ligarCodexChild`:

```js
// O Codex só informa uso no fim do turno: cada turno fechado vai para o diário uma vez.
function anotarParcialCodex(engine, opts, estado) {
  const ev = estado.resultEvent;
  if (!opts.attemptId || !ev || estado.parcialGravado === ev) return;
  estado.parcialGravado = ev;
  registrarParcial(engine, opts.attemptId, { usage: ev.usage, fimDeTurno: true });
}
```

Em `ligarCodexChild`, troque

```js
  const encerrar = (err, value) => {
    clearTimeout(timeout);
```

por

```js
  const encerrar = (err, value) => {
    clearTimeout(timeout);
    if (err && opts.attemptId) err.attemptId = opts.attemptId;
```

troque `  const handleLine = (line) => prepararLinhaCodex(line, estado, onEvent);` por `  const handleLine = (line) => { prepararLinhaCodex(line, estado, onEvent); anotarParcialCodex(engine, opts, estado); };` e troque `  child.on('error', e => encerrar(e));` por `  child.on('error', (e) => { fecharTentativa(engine, opts.attemptId); encerrar(e); });`.

Em `runCodexStream`, troque

```js
      if (opts.reviewCap) childEnv.FAROL_REVIEW_CAP = String(opts.reviewCap);
      ligarCodexChild(engine, opts, run, spawnCodex(stub, args, childEnv), prompt, onEvent, finish);
```

por

```js
      if (opts.reviewCap) childEnv.FAROL_REVIEW_CAP = String(opts.reviewCap);
      // diário da tentativa imediatamente antes do provedor (A1, item 9); a checagem de
      // login acima não é o provedor e não abre tentativa
      const optsTentativa = { ...opts, attemptId: abrirTentativa(engine, { sessionId: opts.id, account: opts.account, profileId: opts.authProfileId || '', model: run.model, ref: opts.ref, provedor: 'codex' }) };
      ligarCodexChild(engine, optsTentativa, run, spawnCodex(stub, args, childEnv), prompt, onEvent, finish);
```

- [ ] **Passo 5: reconciliação no boot (`server.js`)**

Depois de `import falhasMod from './lib/engine/falhas.js';` (Tarefa 4) acrescente `import tentativasMod from './lib/engine/usage-tentativas.js';`. No construtor, troque

```js
    this.recoverInflight();
    // prova por arquivo de PR morto há semanas não serve pra nada (G20, best-effort):
```

por

```js
    this.recoverInflight();
    // tentativa de sessão que o processo anterior deixou aberta (queda, saída pela
    // bandeja) vira linha `interrompida` no Consumo, nunca some (A1, item 9)
    try { tentativasMod.reconciliarInterrompidas(this); }
    catch (err) { this.log('WARN', `reconciliar tentativas interrompidas: ${err.message}`); }
    // prova por arquivo de PR morto há semanas não serve pra nada (G20, best-effort):
```

- [ ] **Passo 6: rodar e ver passar**

`node --test test/usage-tentativas-fiacao.test.js test/usage-parcial-stream.test.js test/session-stream.test.js test/erro-de-sessao-detalhe.test.js test/codex-falha-consumo.test.js test/facades.test.js` → verdes. Depois `npm run check && npm run lint && npm test`. Se um teste que monta várias `Engine` no mesmo `FAROL_HOME` passar a ver uma linha `interrompida` a mais (tentativa aberta por um filho falso que nunca emitiu `close`), a correção é no teste: emitir `close` no filho falso ou apagar `arquivoDeTentativas()` no `beforeEach`; registrar o arquivo ajustado no `EXECUCAO.md`.

- [ ] **Passo 7: contraprova**

(a) Em `runProvedor`, apague a linha `      fecharTentativa(engine, attemptId);` do `close`. Rode: `sessão Claude: tentativa aberta...` falha em `diario()` não vazio. Restaure. (b) Em `server.js`, comente a linha `    try { tentativasMod.reconciliarInterrompidas(this); }` e a do `catch`. Rode: `boot da Engine reconcilia a tentativa que sobrou` falha. Restaure: verde.

- [ ] **Passo 8: commit**

```
git add lib/engine/session.js lib/codex/stream.js server.js test/usage-tentativas-fiacao.test.js
git commit -m "feat(consumo): sessões abrem tentativa antes do provedor e o boot registra as interrompidas"
```

---

### Tarefa 15: encerramento abrupto do processo, provado com processo de verdade

**Arquivos:**
- Criar: `test/usage-interrompida-processo.test.js`

**Interfaces:**
- Consome: `Engine` e `runClaudeStream` em processo filho real; `FAROL_HEADLESS_CMD` apontando para um stub `node` escrito no diretório temporário.
- Produz: prova dos quatro critérios de encerramento da spec 7.A1.

Desenho: o teste escreve um stub que emite eventos `stream-json` e dorme. Um processo filho `node --input-type=module -e` sobe uma `Engine` com `FAROL_HOME` temporário e roda uma sessão contra o stub. O teste espera o diário mostrar o que precisa, mata o filho com `SIGKILL` (`process.kill` também funciona no Windows) e roda um SEGUNDO filho que só constrói a `Engine` e imprime as linhas de consumo. `HOME` e `USERPROFILE` apontam para um diretório falso: o construtor da `Engine` grava `~/.claude.json` (`ensureWorkspaceTrusted`), e o teste não pode tocar o da máquina. O stub é chamado por `process.execPath` com caminho absoluto, porque o `/bin/sh -lc` com `HOME` falso não lê o profile de quem usa nvm. O stub fica órfão quando o filho morre (no POSIX ele está em grupo próprio; no Windows fica pendurado no `cmd.exe`): ele grava o próprio pid e o `after` o mata, e ele sai sozinho em 60 s de qualquer forma.

- [ ] **Passo 1: escrever o teste**

Crie `test/usage-interrompida-processo.test.js`:

```js
// Encerramento abrupto (spec 7.A1, item 9 e critérios de aceite): o processo do Farol
// morre com a sessão aberta e o boot seguinte, no MESMO FAROL_HOME, registra a linha
// interrompida. Só processo de verdade prova isso: em memória o acumulador nunca some.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const RAIZ = path.join(import.meta.dirname, '..');
const SERVER_URL = pathToFileURL(path.join(RAIZ, 'server.js')).href;
const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-interrompida-'));
const STUB = path.join(BASE, 'provedor-falso.mjs');
const MARCA = '@@RESULTADO@@';
const orfaos = [];

after(() => {
  for (const pid of orfaos) { try { process.kill(pid, 'SIGKILL'); } catch { /* já saiu */ } }
  try { fs.rmSync(BASE, { recursive: true, force: true }); } catch { /* best-effort */ }
});

fs.writeFileSync(STUB, [
  "import fs from 'node:fs';",
  'fs.writeFileSync(process.env.STUB_PID_FILE, String(process.pid));',
  "const linha = (o) => process.stdout.write(JSON.stringify(o) + '\\n');",
  "const sid = '11111111-2222-3333-4444-555555555555';",
  "if (process.env.STUB_EMITIR === '1') {",
  "  linha({ type: 'system', subtype: 'init', model: 'claude-opus-5', session_id: sid });",
  "  linha({ type: 'assistant', message: { id: 'msg_1', stop_reason: 'tool_use', content: [{ type: 'text', text: 'lendo' }], usage: { input_tokens: 12, output_tokens: 345 } } });",
  '}',
  "if (process.env.STUB_CONCLUIR === '1') {",
  "  linha({ type: 'result', is_error: false, result: 'ok', session_id: sid, usage: { input_tokens: 12, output_tokens: 345 }, total_cost_usd: 0.5 });",
  '  process.exit(0);',
  '}',
  "if (process.env.STUB_ERRO === '1') {",
  "  linha({ type: 'result', is_error: true, result: 'erro simulado', session_id: sid, usage: { input_tokens: 100, output_tokens: 20 }, total_cost_usd: 0.05 });",
  '  process.exit(0);',
  '}',
  'setTimeout(() => process.exit(0), 60000);',
].join('\n'));

function ambiente(home, extra = {}) {
  const casaFalsa = path.join(home, 'casa-falsa');
  fs.mkdirSync(casaFalsa, { recursive: true });
  return {
    ...process.env, FAROL_HOME: home, HOME: casaFalsa, USERPROFILE: casaFalsa,
    FAROL_HEADLESS_CMD: `"${process.execPath}" "${STUB}"`,
    STUB_PID_FILE: path.join(home, 'stub.pid'), STUB_EMITIR: '0', STUB_CONCLUIR: '0', STUB_ERRO: '0',
    ...extra,
  };
}

const SESSAO = [
  `const { Engine } = await import(${JSON.stringify(SERVER_URL)});`,
  'const e = new Engine();',
  "e.runClaudeStream('prompt', { id: 'a-filho', account: '', ref: 'o/r#1' }).then(() => process.exit(0), () => process.exit(3));",
].join('\n');

const BOOT = [
  `const { Engine } = await import(${JSON.stringify(SERVER_URL)});`,
  'const e = new Engine();',
  `process.stdout.write('\\n${MARCA}' + JSON.stringify(e.usageSessions.sessions));`,
  'process.exit(0);',
].join('\n');

function iniciarSessao(home, extra) {
  return spawn(process.execPath, ['--input-type=module', '-e', SESSAO], { env: ambiente(home, extra), stdio: 'ignore' });
}

function boot(home) {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', BOOT], { env: ambiente(home), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.slice(r.stdout.lastIndexOf(MARCA) + MARCA.length)).filter((s) => s.id === 'a-filho');
}

function tentativas(home) {
  const arquivo = path.join(home, 'workspace', 'state', 'usage-tentativas.json');
  if (!fs.existsSync(arquivo)) return [];
  try { return Object.values(JSON.parse(fs.readFileSync(arquivo, 'utf8')).tentativas); } catch { return []; }
}

function esperar(cond, ms = 20000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (cond()) { clearInterval(iv); resolve(); return; }
      if (Date.now() - t0 > ms) { clearInterval(iv); reject(new Error('timeout esperando a condição')); }
    }, 50);
  });
}

function guardarOrfao(home) {
  const arquivo = path.join(home, 'stub.pid');
  if (fs.existsSync(arquivo)) orfaos.push(Number(fs.readFileSync(arquivo, 'utf8')));
}

function saida(filho) {
  return new Promise((resolve) => {
    if (filho.exitCode !== null || filho.signalCode !== null) return resolve(filho.exitCode);
    filho.once('exit', (code) => resolve(code));
  });
}

async function matar(filho) {
  const fim = saida(filho);
  process.kill(filho.pid, 'SIGKILL');
  await fim;
}

test('morto à força depois de consumo parcial: o boot seguinte registra interrompida com os tokens', async () => {
  const home = path.join(BASE, 'parcial');
  const filho = iniciarSessao(home, { STUB_EMITIR: '1' });
  await esperar(() => tentativas(home).some((t) => t.parcial.output_tokens === 345));
  guardarOrfao(home);
  await matar(filho);
  const linhas = boot(home);
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].status, 'interrompida');
  assert.equal(linhas[0].outputTokens, 345);
  assert.equal(linhas[0].inputTokens, 12);
  assert.ok(linhas[0].attemptId);
  assert.deepEqual(tentativas(home), []);
});

test('morto à força antes de qualquer consumo: linha interrompida com custo desconhecido, não zero e não ausência', async () => {
  const home = path.join(BASE, 'sem-consumo');
  const filho = iniciarSessao(home);
  await esperar(() => tentativas(home).length === 1 && fs.existsSync(path.join(home, 'stub.pid')));
  guardarOrfao(home);
  await matar(filho);
  const linhas = boot(home);
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].status, 'interrompida');
  assert.equal(linhas[0].costSource, 'desconhecido');
  assert.equal(linhas[0].outputTokens, 0);
});

test('fechamento normal seguido de boot não duplica a linha', async () => {
  const home = path.join(BASE, 'normal');
  const filho = iniciarSessao(home, { STUB_EMITIR: '1', STUB_CONCLUIR: '1' });
  assert.equal(await saida(filho), 0);
  assert.deepEqual(tentativas(home), []);
  assert.equal(boot(home).length, 1);
  const depois = boot(home);
  assert.equal(depois.length, 1);
  assert.equal(depois[0].status, 'ok');
});

test('erro devolvido normalmente pelo CLI continua registrado como hoje', async () => {
  const home = path.join(BASE, 'erro-cli');
  const filho = iniciarSessao(home, { STUB_ERRO: '1' });
  assert.equal(await saida(filho), 3);
  const linhas = boot(home);
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].status, 'erro');
  assert.equal(linhas[0].costSource, 'medido');
  assert.equal(linhas[0].costUsd, 0.05);
  assert.deepEqual(tentativas(home), []);
});
```

- [ ] **Passo 2: rodar**

`node --test test/usage-interrompida-processo.test.js` → 4 testes verdes (as Tarefas 13 e 14 já implementaram o comportamento; esta tarefa é a prova de ponta a ponta). Se algum caso falhar, o defeito é da fiação da Tarefa 14: corrigir lá, nunca afrouxar este teste. Rodar também no POSIX (WSL ou CI) antes de fechar a entrega, porque o ramo `/bin/sh -lc` com grupo destacado só existe fora do Windows.

- [ ] **Passo 3: contraprova**

Em `server.js`, comente as duas linhas de `tentativasMod.reconciliarInterrompidas(this)` (try e catch). Rode o teste: os dois primeiros casos falham (`linhas.length` 0). Restaure e rode de novo: verde.

- [ ] **Passo 4: commit**

```
git add test/usage-interrompida-processo.test.js
git commit -m "test(consumo): encerramento abrupto com processo real vira linha interrompida no boot"
```

---

### Tarefa 16: documentação do mantenedor, gate final e registro de execução

**Arquivos:**
- Alterar: `CLAUDE.md` (tabela "Mapa de arquivos")
- Alterar: `docs/superpowers/handoff/2026-09-15-operacao-multidispositivo/EXECUCAO.md`

- [ ] **Passo 1: mapa de arquivos do `CLAUDE.md`**

Na tabela "Mapa de arquivos", depois da linha de `lib/engine/usage.js`, acrescente:

```
| `lib/engine/usage-tentativas.js` | **Diário de tentativas de sessão de IA** (A1). `abrirTentativa` grava em `state/usage-tentativas.json` imediatamente antes do provedor, `registrarParcial` guarda o acumulado (intervalo mínimo `TEMPOS.TENTATIVA_PARCIAL_MS`, fim de turno sempre), `fecharTentativa` sai DEPOIS do registro de consumo e `reconciliarInterrompidas` (boot) transforma o que sobrou em linha `interrompida`, com o parcial ou com custo `desconhecido`, sem duplicar (a linha leva `attemptId`). No POSIX o provedor destacado pode seguir gastando depois da morte do engine, e a linha diz isso (`provedorPodeTerContinuado`) |
| `lib/engine/falhas.js` | **Registro durável de falha por sessão** (A1), em `state/falhas-sessao.json`, FORA do `farol.log`: "Limpar log" não apaga. Motivo inteiro (a mensagem de erro segue cortada em 300; o texto completo viaja em `err.detalheCompleto`, via `erroDeSessao`), teto de 8000 caracteres, máscara de segredo e no máximo 500 registros. Liga ao Consumo por `sessionId`/`attemptId` e ao card estacionado por `parked[key].sessionId`. Guarda `resumeOutcome` quando a A5 informa |
| `lib/engine/sessao-id.js` | **Id opaco de sessão de IA** (A1): `<prefixo>-<uuid>`, único entre boots e aparelhos, com o rótulo curto (`a1`) só para exibição. `kindFromId` lê o prefixo. Sessão de terminal (`t<n>`) fica fora |
```

- [ ] **Passo 2: gate completo**

```
npm run check && npm run lint && npm test
```

Esperado: os três verdes; contagem de testes = contagem da base na mesma máquina + os testes novos das Tarefas 1, 3 a 15; nenhum pulado a mais além dos que já pulam por plataforma. Anote os números exatos.

- [ ] **Passo 3: registrar no `EXECUCAO.md`**

Na tabela "Lote 1", troque a linha da A1 por `| 4 | A1 Consumo fiel (sem o item 1) | \`md/a1\` | concluída, item 1 bloqueado | ver "A1: evidências" |`. Mantenha a linha "A1, item 1" em "Bloqueios". Acrescente a seção:

```
## A1: evidências

| Critério da spec 7.A1 | Teste | Contraprova |
|---|---|---|
| (preencher com a tabela "Critérios de aceite da spec x testes" do plano, uma linha por critério, com o resultado do gate) | | |

Gate: `npm run check` (N arquivos), `npm run lint` (sem regressão), `npm test` (N testes, N aprovados, N pulados, 0 falhas), Windows, Node <versão>. Rodada POSIX do `test/usage-interrompida-processo.test.js`: <ambiente e resultado>.
Ajustes técnicos: <lista, ou "nenhum">.
```

substituindo cada `<...>` e cada `N` pelo valor medido naquele momento (é o registro da execução, não deste plano), e copiando para a tabela as linhas da seção final deste plano com a coluna de contraprova marcada como feita.

- [ ] **Passo 4: commit**

```
git add CLAUDE.md docs/superpowers/handoff/2026-09-15-operacao-multidispositivo/EXECUCAO.md
git commit -m "docs: mapa de arquivos e evidências da A1"
```

---

## Critérios de aceite da spec x testes

| Critério (spec 7.A1) | Teste que prova | Tarefa | Estado esperado |
|---|---|---|---|
| Item 1: medir a contagem dobrada antes de corrigir | instrumento: `test/medicao-contagem-dobrada.test.js`; medição e correção: Tarefa 2 | 1, 2 | **pendente de validação externa**: exige sessões reais do CLI (spec 13); só o instrumento é comprovado aqui |
| Sessão Codex falhando gera linha com custo desconhecido | `test/codex-falha-consumo.test.js` ("turn.failed gera linha de erro com custo desconhecido", "processo do Codex morto sem evento nenhum também registra"); `test/usage-tentativas-fiacao.test.js` ("sessão Codex") | 8, 14 | comprovado |
| Recusa de envelope marca erro nos quatro caminhos | `test/resultado-recusado-desfecho.test.js` (revisão, pushback, ferramenta com comportamento; autoanálise por fonte) | 9 | comprovado (autoanálise por teste de fonte) |
| Sem-base nunca soma zero no gate local | `test/usage-desconhecido-gate.test.js`; `test/usage-desconhecido.test.js` (auditoria) | 6, 7 | comprovado com custo típico conhecido; ver pendência 1 |
| Dois boots não reutilizam id, e `marcarDesfecho` corrige a sessão certa | `test/sessao-id.test.js` | 3 | comprovado |
| Falha estacionada mostra motivo depois de Limpar log | `test/falha-duravel-fiacao.test.js` ("falha permanente de revisão..."), `test/falhas-sessao.test.js` ("Limpar log não apaga") | 4, 10 | comprovado no dado do snapshot; a apresentação na tela é da A3 e do Claude Design |
| Correção posterior ao cursor chega ao fake do banco com a consolidação desligada no momento da correção | `test/sync-outbox.test.js` ("correção feita com a consolidação desligada chega ao banco quando ela volta") | 12 | comprovado |
| Pushback falhando N vezes para no teto | `test/pushback-teto.test.js` | 11 | comprovado |
| Encerramento abrupto depois de consumo parcial registra `interrompida` com os tokens | `test/usage-interrompida-processo.test.js` (primeiro caso) | 13, 14, 15 | comprovado no Windows e no POSIX quando rodado nos dois |
| Encerramento abrupto antes de consumo gera `interrompida` com custo desconhecido | `test/usage-interrompida-processo.test.js` (segundo caso) | 13, 14, 15 | comprovado |
| Fechamento normal seguido de boot não duplica | `test/usage-interrompida-processo.test.js` (terceiro caso), `test/usage-tentativas.test.js` ("já registrada...") | 13, 15 | comprovado |
| Erro devolvido normalmente pelo CLI continua registrado como hoje | `test/usage-interrompida-processo.test.js` (quarto caso), `test/session-stream.test.js` (já existente) | 15 | comprovado |
| Item 6: falha com classe, id do CLI, etapas e desfecho da retomada | `test/falha-duravel-fiacao.test.js`, `test/falhas-sessao.test.js` | 4, 10 | comprovado; `resumeOutcome` real depende de a A5 anotar o erro |
| Limite POSIX: provedor destacado pode seguir consumindo | `test/usage-tentativas.test.js` (campo `provedorPodeTerContinuado`) | 13 | declarado na linha; o consumo depois da morte não é observável por construção |

## Pendências e ambiguidades (não resolvidas por este plano)

1. **Reserva com custo típico zero.** Sem revisão medida nos últimos 30 dias, a reserva do valor desconhecido é zero e o gate local só marca `parcialmenteEstimado`. Isso segue a regra atual da projeção (falta de dado nunca vira ação), mas contraria a leitura literal de "sem-base nunca soma zero". Decidir se, nesse caso, o perfil com teto deve barrar a automação é decisão do dono.
2. **Campo do id da sessão do CLI.** O contrato de `registrarFalha` não lista esse campo; o plano o grava como `cliSessionId`, a mais, e usa `sessionId` para o id opaco do Farol.
3. **`resumeOutcome` na decisão.** Conferido contra `docs/superpowers/plans/2026-09-15-md-a5-retomada-duravel.md` (linhas 26-27): a A5 entrega o campo em `opts.resumeOutcome`, em `activeReviews[id].resumeOutcome` e em `result.resumeOutcome`, e diz que persistir "em uso e decisão" é trabalho da A1. Este plano persiste na linha de consumo (Tarefas 6 e 14) e no registro de falha (Tarefas 10 e 14, pelo registro ativo e por `opts`). A persistência no item de decisão (`recordDecision`, `lib/engine/decision.js`) não está no escopo 7.A1 da spec e ficou de fora: decidir se entra aqui ou na A3.
4. **Tela.** O vínculo com o Consumo e com o card estacionado é entregue como dado no snapshot; mostrar e copiar a falha é da A3, com desenho do Claude Design (D9).
5. **Sessão de terminal.** Continua com `t<n>`; não registra consumo nem desfecho, então fica fora do item 5.
6. **Linha `interrompida` no dia do boot.** O dia de consumo é o do boot e a hora real da tentativa vai em `iniciadaEm`; uma queda à noite com boot no dia seguinte desloca aquele gasto de dia no gráfico e no teto diário.
