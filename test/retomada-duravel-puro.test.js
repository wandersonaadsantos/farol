// Funções puras da retomada durável (CT-RET, 7.A5 da spec
// docs/superpowers/specs/2026-09-15-operacao-multidispositivo-design.md).
// O módulo não importa lib/paths.js, então não precisa de FAROL_HOME; o import
// dinâmico segue o padrão da suíte mesmo assim.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const r = await import('../lib/engine/retomada-duravel.js');

const SID = 'abcd-1234-efgh';
const HEAD = 'c0ffee1234ab';
const PR = { key: 'o/r#1', url: 'https://github.com/o/r/pull/1', title: 't', author: 'a' };
const CTX = { provedor: 'dir', perfilId: '' };

function motorFalso(extra = {}) {
  return {
    activeReviews: new Map(),
    headlessQueue: [],
    decisions: { pending: [], resolved: [] },
    accountForPr: () => 'eu',
    resolveClaudeAuth: () => ({ kind: 'dir', id: '', dir: '' }),
    ...extra,
  };
}

test('listas congeladas do contrato', () => {
  assert.deepEqual([...r.DESFECHOS_RETOMADA], ['retomada', 'recusada', 'nova', 'nenhuma']);
  assert.deepEqual([...r.ESTADOS_INFLIGHT], ['pendente', 'fila', 'execucao']);
  assert.deepEqual([...r.CAMPOS_INFLIGHT], ['key', 'url', 'title', 'author', 'kind', 'estado', 'retomarSid', 'knownHead', 'provedor', 'perfilId', 'sessionId', 'headSha', 'atualizadoEm']);
  assert.equal(Object.isFrozen(r.DESFECHOS_RETOMADA), true);
  assert.equal(Object.isFrozen(r.CAMPOS_INFLIGHT), true);
  assert.equal(Object.isFrozen(r.AVISO_DESCARTE), true);
  for (const frase of Object.values(r.AVISO_DESCARTE)) assert.ok(!frase.includes(String.fromCharCode(0x2014)), 'sem travessão');
});

test('validarRetomada: só retoma com PR, head confirmado e contexto iguais', () => {
  const entrada = { key: PR.key, retomarSid: SID, knownHead: HEAD, provedor: 'dir', perfilId: '' };
  const base = { prKey: PR.key, headConfirmado: HEAD, contexto: CTX, concluida: false };
  const v = (e, o) => r.validarRetomada(e, { ...base, ...o });
  assert.deepEqual(v(entrada, {}), { acao: 'retomar', motivo: 'valida' });
  assert.deepEqual(v(null, {}), { acao: 'nenhuma', motivo: 'sem_retomada' });
  assert.deepEqual(v({ ...entrada, retomarSid: 'x; rm -rf /' }, {}), { acao: 'nenhuma', motivo: 'sem_retomada' });
  assert.deepEqual(v(entrada, { prKey: 'o/r#99' }), { acao: 'descartar', motivo: 'outro_pr' });
  assert.deepEqual(v({ ...entrada, provedor: '' }, {}), { acao: 'descartar', motivo: 'contexto_ausente' });
  assert.deepEqual(v(entrada, { contexto: { provedor: 'dir', perfilId: 'p2' } }), { acao: 'descartar', motivo: 'contexto_incompativel' });
  assert.deepEqual(v(entrada, { contexto: { provedor: 'apikey', perfilId: '' } }), { acao: 'descartar', motivo: 'contexto_incompativel' });
  assert.deepEqual(v(entrada, { contexto: null }), { acao: 'descartar', motivo: 'contexto_incompativel' });
  assert.deepEqual(v(entrada, { concluida: true }), { acao: 'descartar', motivo: 'concluida' });
  assert.deepEqual(v({ ...entrada, knownHead: '' }, {}), { acao: 'descartar', motivo: 'sem_head_salvo' });
  assert.deepEqual(v(entrada, { headConfirmado: '' }), { acao: 'aguardar', motivo: 'head_nao_confirmado' });
  assert.deepEqual(v(entrada, { headConfirmado: 'facada998877' }), { acao: 'descartar', motivo: 'head_mudou' });
});

test('guardarRetomada: sid fora da allowlist não grava nada', () => {
  const e = motorFalso();
  assert.equal(r.guardarRetomada(e, PR, { retomarSid: 'x; rm -rf /', knownHead: HEAD, ...CTX }), null);
  assert.equal(r.guardarRetomada(e, { url: 'sem key' }, { retomarSid: SID }), null);
  assert.equal(r.lerRetomada(e, PR.key), null);
});

test('guardarRetomada: grava o formato exato e herda head e contexto só da MESMA sessão', () => {
  const e = motorFalso();
  const primeira = r.guardarRetomada(e, PR, { retomarSid: SID, knownHead: HEAD, ...CTX });
  assert.deepEqual(Object.keys(primeira), [...r.CAMPOS_INFLIGHT]);
  assert.equal(primeira.estado, 'pendente');
  assert.equal(primeira.kind, 'auto');
  assert.equal(primeira.sessionId, SID);
  assert.equal(primeira.headSha, HEAD);
  assert.ok(Number.isFinite(Date.parse(primeira.atualizadoEm)));
  // mesma sessão, sem head nem contexto novos: herda
  const mesma = r.guardarRetomada(e, PR, { retomarSid: SID });
  assert.equal(mesma.knownHead, HEAD);
  assert.equal(mesma.provedor, 'dir');
  // sessão nova: não herda nada da anterior
  const nova = r.guardarRetomada(e, PR, { retomarSid: 'outra-sessao-01' });
  assert.equal(nova.knownHead, '');
  assert.equal(nova.provedor, '');
  // contexto explícito com perfil vazio vale como está, não herda o perfil anterior
  r.guardarRetomada(e, PR, { retomarSid: 'sessao-perfil-1', knownHead: HEAD, provedor: 'dir', perfilId: 'p2' });
  const semPerfil = r.guardarRetomada(e, PR, { retomarSid: 'sessao-perfil-1', provedor: 'dir', perfilId: '' });
  assert.equal(semPerfil.perfilId, '');
});

test('consumirRetomada devolve se havia e tira do Map', () => {
  const e = motorFalso();
  r.guardarRetomada(e, PR, { retomarSid: SID, knownHead: HEAD, ...CTX });
  assert.equal(r.consumirRetomada(e, PR.key), true);
  assert.equal(r.consumirRetomada(e, PR.key), false);
  assert.equal(r.lerRetomada(e, PR.key), null);
});

test('contextoDaConta lê provedor e perfil do auth resolvido', () => {
  const e = motorFalso({ resolveClaudeAuth: () => ({ kind: 'apikey', id: 'p9', apiKey: 'segredo' }) });
  assert.deepEqual(r.contextoDaConta(e, PR), { provedor: 'apikey', perfilId: 'p9' });
  assert.deepEqual(r.contextoDaConta({}, PR), { provedor: '', perfilId: '' });
});

test('restaurarRetomadas: legado vira retomarSid sem contexto, sid inválido cai, existente não é sobrescrito', () => {
  const e = motorFalso();
  r.guardarRetomada(e, { key: 'o/r#3' }, { retomarSid: 'viva-sessao-03', knownHead: 'h3', ...CTX });
  r.restaurarRetomadas(e, [
    { key: 'o/r#1', url: 'u1', title: 't1', sessionId: SID, headSha: HEAD },
    { key: 'o/r#2', url: 'u2', sessionId: 'curto' },
    { key: 'o/r#3', url: 'u3', retomarSid: 'velha-sessao-03', knownHead: 'h0', provedor: 'dir', perfilId: '', estado: 'fila' },
    null,
    { url: 'sem key', retomarSid: SID },
  ]);
  const legado = r.lerRetomada(e, 'o/r#1');
  assert.equal(legado.retomarSid, SID);
  assert.equal(legado.knownHead, HEAD);
  assert.equal(legado.provedor, '');
  assert.equal(legado.estado, 'pendente');
  assert.deepEqual(Object.keys(legado), [...r.CAMPOS_INFLIGHT]);
  assert.equal(r.lerRetomada(e, 'o/r#2'), null);
  assert.equal(r.lerRetomada(e, 'o/r#3').retomarSid, 'viva-sessao-03');
});

test('emAndamentoNoBoot: fila, execução e legado sem estado; pendente fica de fora', () => {
  const lista = [
    { key: 'a#1', estado: 'pendente' }, { key: 'a#2', estado: 'fila' },
    { key: 'a#3', estado: 'execucao' }, { key: 'a#4' }, null, { estado: 'fila' },
  ];
  assert.deepEqual(r.emAndamentoNoBoot(lista).map(p => p.key), ['a#2', 'a#3', 'a#4']);
});

test('montarInflight: três estados, formato exato, sem duplicar e sem autoanálise', () => {
  const e = motorFalso();
  r.guardarRetomada(e, PR, { retomarSid: SID, knownHead: HEAD, ...CTX });
  r.guardarRetomada(e, { key: 'o/r#2', url: 'u2' }, { retomarSid: 'sessao-fila-02', knownHead: 'h2', ...CTX });
  e.headlessQueue.push({ key: 'o/r#2', url: 'u2', title: 't2', author: 'b' });
  e.headlessQueue.push({ key: 'o/r#9', url: 'u9', kind: 'self' });
  e.headlessQueue.push({ key: 'o/r#4', url: 'u4', title: 't4', knownHead: 'h4' });
  e.activeReviews.set('a1', { mode: 'auto', pr: { key: 'o/r#3', url: 'u3', title: 't3', author: 'c' }, sessionId: 'sessao-exec-03', headSha: 'h3' });
  e.activeReviews.set('a2', { mode: 'terminal', pr: { key: 'o/r#8' } });
  e.headlessQueue.push({ key: 'o/r#3', url: 'u3' });
  const lista = r.montarInflight(e);
  for (const item of lista) assert.deepEqual(Object.keys(item), [...r.CAMPOS_INFLIGHT]);
  const por = Object.fromEntries(lista.map(i => [i.key, i]));
  assert.deepEqual(Object.keys(por).sort(), ['o/r#1', 'o/r#2', 'o/r#3', 'o/r#4']);
  assert.equal(por['o/r#3'].estado, 'execucao');
  assert.equal(por['o/r#3'].sessionId, 'sessao-exec-03');
  assert.equal(por['o/r#3'].headSha, 'h3');
  assert.equal(por['o/r#3'].retomarSid, '');
  assert.equal(por['o/r#2'].estado, 'fila');
  assert.equal(por['o/r#2'].retomarSid, 'sessao-fila-02');
  assert.equal(por['o/r#4'].estado, 'fila');
  assert.equal(por['o/r#4'].knownHead, 'h4');
  assert.equal(por['o/r#1'].estado, 'pendente');
  assert.equal(por['o/r#1'].provedor, 'dir');
  assert.equal(lista.filter(i => i.key === 'o/r#3').length, 1, 'execução vence a fila, sem linha dobrada');
  assert.deepEqual(r.montarInflight({}), [], 'motor sem Map e sem fila não lança');
});

test('concluidaDepois: só decisão do mesmo PR e head, criada depois da referência', () => {
  const agora = Date.now();
  const entrada = { key: PR.key, knownHead: HEAD, atualizadoEm: new Date(agora - 60000).toISOString() };
  const com = (d) => motorFalso({ decisions: { pending: [], resolved: [d] } });
  assert.equal(r.concluidaDepois(com({ key: PR.key, headSha: HEAD, createdAt: agora }), entrada), true);
  assert.equal(r.concluidaDepois(motorFalso({ decisions: { pending: [{ key: PR.key, headSha: HEAD, createdAt: agora }], resolved: [] } }), entrada), true);
  assert.equal(r.concluidaDepois(com({ key: PR.key, headSha: HEAD, createdAt: agora - 120000 }), entrada), false, 'decisão anterior à queda');
  assert.equal(r.concluidaDepois(com({ key: PR.key, headSha: 'outro', createdAt: agora }), entrada), false);
  assert.equal(r.concluidaDepois(com({ key: 'o/r#2', headSha: HEAD, createdAt: agora }), entrada), false);
  assert.equal(r.concluidaDepois(com({ key: PR.key, headSha: HEAD, createdAt: agora }), { ...entrada, knownHead: '' }), false);
  assert.equal(r.concluidaDepois(com({ key: PR.key, headSha: HEAD, createdAt: agora }), { ...entrada, atualizadoEm: 'lixo' }), false);
  assert.equal(r.concluidaDepois(motorFalso({ decisions: undefined }), entrada), false);
  assert.equal(r.concluidaDepois(motorFalso(), null), false);
});
