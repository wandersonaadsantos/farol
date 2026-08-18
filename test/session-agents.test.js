// Rastreio de subagentes da sessão headless (visível na UI): o registro nasce no
// tool_use de Task da sessão principal, eventos com parent_tool_use_id carregam o
// rótulo do agente nas linhas do feed, o tool_result do Task encerra a contagem, e
// projectSessions entrega ao snapshot só a projeção compacta (nunca fileBlobs nem
// o mapa cru). É o que sustenta o 👥 vivos/total do card "Analisando agora".
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-session-agents-' + process.pid);

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const { registrarAgenteDeTask, rotuloDoAgente, concluirAgentesDoEvento, projectSessions, pushActivity } =
  await import('../lib/engine/session.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

function engineFake() {
  const review = { id: 'a1', keys: ['org/app#1'], mode: 'auto', pr: { key: 'org/app#1', url: 'u' } };
  return {
    review,
    pushes: 0,
    activeReviews: new Map([['a1', review]]),
    activity: new Map([['a1', []]]),
    emitted: [],
    pushState() { this.pushes++; },
    emit(ev, payload) { this.emitted.push({ ev, payload }); },
  };
}

const TASK = { type: 'tool_use', id: 'tu-1', name: 'Task', input: { subagent_type: 'claim-verifier', description: 'verificar ruleset de tag' } };

test('registrarAgenteDeTask: Task da sessão principal vira agente numerado', () => {
  const e = engineFake();
  registrarAgenteDeTask(e, { id: 'a1' }, TASK);
  const a = e.review.agents['tu-1'];
  assert.equal(a.n, 1);
  assert.equal(a.label, 'claim-verifier 1');
  assert.equal(a.desc, 'verificar ruleset de tag');
  assert.equal(a.done, false);
  assert.equal(e.pushes, 1, 'a UI é avisada na hora (contagem no card)');
});

test('registrarAgenteDeTask: mesmo Task duas vezes não duplica; segundo Task numera 2', () => {
  const e = engineFake();
  registrarAgenteDeTask(e, { id: 'a1' }, TASK);
  registrarAgenteDeTask(e, { id: 'a1' }, TASK);
  registrarAgenteDeTask(e, { id: 'a1' }, { ...TASK, id: 'tu-2', input: { subagent_type: 'pr-reviewer' } });
  assert.equal(Object.keys(e.review.agents).length, 2);
  assert.equal(e.review.agents['tu-2'].label, 'pr-reviewer 2');
});

test('registrarAgenteDeTask: aceita o nome novo da ferramenta (Agent, CLI 2.1.x)', () => {
  // caso real de 17/08/2026: o CLI renomeou Task pra Agent e o badge ficou mudo,
  // com as linhas do feed caindo no fallback "agente" sem contagem no card
  const e = engineFake();
  registrarAgenteDeTask(e, { id: 'a1' }, { type: 'tool_use', id: 'tu-9', name: 'Agent', input: { subagent_type: 'pr-reviewer', description: 'Review PR 774' } });
  assert.equal(e.review.agents['tu-9'].label, 'pr-reviewer 1');
});

test('registrarAgenteDeTask: ignora tool_use que não é Task e sessão sem registro', () => {
  const e = engineFake();
  registrarAgenteDeTask(e, { id: 'a1' }, { type: 'tool_use', id: 'x', name: 'Bash', input: {} });
  assert.equal(e.review.agents, undefined);
  registrarAgenteDeTask(e, { id: 'chat-sem-registro' }, TASK);
  assert.equal(e.review.agents, undefined, 'chat/ferramenta não rastreia agente');
});

test('rotuloDoAgente: parent conhecido dá o rótulo, desconhecido cai em "agente", sem parent é principal', () => {
  const e = engineFake();
  registrarAgenteDeTask(e, { id: 'a1' }, TASK);
  assert.equal(rotuloDoAgente(e, { id: 'a1' }, 'tu-1'), 'claim-verifier 1');
  assert.equal(rotuloDoAgente(e, { id: 'a1' }, 'tu-nunca-visto'), 'agente',
    'evento de subagente nunca passa como linha da principal');
  assert.equal(rotuloDoAgente(e, { id: 'a1' }, null), '');
});

test('concluirAgentesDoEvento: tool_result do Task encerra o agente; resultado interno de subagente não', () => {
  const e = engineFake();
  registrarAgenteDeTask(e, { id: 'a1' }, TASK);
  const fim = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu-1' }] } };
  concluirAgentesDoEvento(e, { id: 'a1' }, { ...fim, parent_tool_use_id: 'tu-1' });
  assert.equal(e.review.agents['tu-1'].done, false, 'tool_result DE DENTRO do subagente não é o fim dele');
  concluirAgentesDoEvento(e, { id: 'a1' }, fim);
  assert.equal(e.review.agents['tu-1'].done, true);
});

test('projectSessions: entrega contagem compacta e nunca vaza fileBlobs nem o mapa cru', () => {
  const e = engineFake();
  registrarAgenteDeTask(e, { id: 'a1' }, TASK);
  registrarAgenteDeTask(e, { id: 'a1' }, { ...TASK, id: 'tu-2' });
  e.review.agents['tu-2'].done = true;
  e.review.fileBlobs = { 'src/a.ts': 'blob-a' };
  const [p] = projectSessions([e.review]);
  assert.equal(p.fileBlobs, undefined, 'mapa de blobs é interno, nunca vai no snapshot');
  assert.equal(p.agentsLive, 1);
  assert.equal(p.agents.length, 2);
  assert.deepEqual(Object.keys(p.agents[0]).sort(), ['desc', 'done', 'label', 'n'],
    'projeção compacta, sem startedAt nem id de tool_use');
});

test('projectSessions: sessão sem agente passa intocada (sem campos novos)', () => {
  const [p] = projectSessions([{ id: 't1', mode: 'terminal', keys: [] }]);
  assert.equal('agents' in p, false);
  assert.equal('agentsLive' in p, false);
});

test('pushActivity: linha de subagente carrega o rótulo (item.a); linha da principal não', () => {
  const e = engineFake();
  pushActivity(e, 'a1', 'tool', 'Bash · comparar heads', 'claim-verifier 1');
  pushActivity(e, 'a1', 'tool', 'Bash · consolidar');
  const [deAgente, daPrincipal] = e.activity.get('a1');
  assert.equal(deAgente.a, 'claim-verifier 1');
  assert.equal('a' in daPrincipal, false);
  assert.equal(e.emitted[0].payload.item.a, 'claim-verifier 1', 'o SSE de atividade leva a etiqueta pra UI');
});
