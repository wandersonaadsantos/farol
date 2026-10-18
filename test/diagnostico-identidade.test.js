import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-diagnostico-'));
const { coletarIdentidade } = await import('../lib/engine/diagnostico-identidade.js');
const { publicarDiagnostico, lerDiagnostico } = await import('../lib/engine/sync-diagnostico.js');
const { prTag } = await import('../lib/sync/tags.js');
const { STATE_DIR } = await import('../lib/paths.js');
const io = (await import('../lib/io.js')).default;
const comando = (await import('../lib/sync/comando.js')).default;
const rodar = io.run;
const T = 1800000000000;
const CMD = 'a'.repeat(32);
const PR = { key: 'org/repo#117', author: 'autor', account: 'revisor', token: 'segredo-do-objeto' };
after(() => { io.run = rodar; fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); });

function motor() {
  return {
    config: {}, accountList: () => [{ user: 'revisor' }], tokenFor: () => 'credencial-privada',
    ghEnv: () => ({ GH_TOKEN: 'credencial-privada' }), accountForPr: p => p?.account || 'padrao',
    queue: [{ ...PR }], activeReviews: new Map([['a1', { id: 'a1', account: 'revisor', pr: { ...PR, account: '' } }]]),
    decisions: { pending: [] },
  };
}

test('retrata divergência entre a conta esperada, o token autenticado e cada fonte, sem credenciais', async () => {
  const e = motor();
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(path.join(STATE_DIR, 'inflight.json'), JSON.stringify([{ ...PR, account: 'autor', secret: 'segredo-do-disco' }]));
  const r = await coletarIdentidade(e, { run: async () => ({ ok: true, stdout: 'autor' }) });
  assert.deepEqual(r.contas, [{ esperada: 'revisor', autenticada: 'autor', estado: 'divergente' }]);
  assert.equal(r.itens.find(p => p.fonte === 'inflight.json').resolvida, 'autor');
  assert.equal(r.itens.find(p => p.fonte === 'activeReviews').contaDaSessao, 'revisor');
  for (const segredo of ['credencial-privada', 'segredo-do-objeto', 'segredo-do-disco']) assert.equal(JSON.stringify(r).includes(segredo), false);
  const desconhecido = await coletarIdentidade(e, { run: async () => ({ ok: false, stdout: '', stderr: 'credencial-privada' }) });
  assert.equal(desconhecido.contas[0].estado, 'nao-confirmada');
  assert.equal(JSON.stringify(desconhecido).includes('credencial-privada'), false);
});

test('filtro pelo PR não inclui dados de outro trabalho e não aceita caminho ou shell', async () => {
  const e = motor();
  e.queue.push({ key: 'org/secreto#1', author: 'alguem', account: 'revisor' });
  const kId = randomBytes(32);
  const r = await coletarIdentidade(e, { kId, tagDoPr: prTag(kId, PR.key), run: async () => ({ ok: true, stdout: 'revisor' }) });
  assert.ok(r.itens.length);
  assert.ok(r.itens.every(p => p.key === PR.key));
  assert.deepEqual(comando.sanearComando({ tipo: 'diagnosticar', args: { shell: 'rm -rf', arquivo: '/etc/passwd' } }), { tipo: 'diagnosticar', args: {} });
  assert.equal(comando.sanearComando({ tipo: 'diagnosticar', args: { prTag: '../invalido' } }), null);
  assert.equal(comando.sanearComando({ tipo: 'diagnosticar', args: { prTag: 0 } }), null);
});

test('diagnóstico atravessa o transporte cifrado com limite do banco, alvo e comando conferidos', async () => {
  const e = motor();
  const material = { id: randomBytes(32).toString('base64'), enc: { g1: randomBytes(32).toString('base64') } };
  const arvore = new Map();
  const client = {
    async put(p, no) { assert.ok(no.enc.length <= 2048); arvore.set(p, structuredClone(no)); return { ok: true }; },
    async get(p) { return { ok: true, data: arvore.get(p) || null }; },
  };
  e.sync = { uid: 'u1', deviceId: 'android', cur: 'g1', material, client };
  io.run = async () => ({ ok: true, stdout: 'autor' });
  assert.deepEqual(await publicarDiagnostico(e, CMD, {}, T), { estado: 'aplicado', code: '' });
  const leitor = { sync: { ...e.sync, deviceId: 'pc', comandosEmitidos: [{ cmdId: CMD, tipo: 'diagnosticar', alvo: 'android' }] } };
  const recebido = await lerDiagnostico(leitor, { cmdId: CMD }, T + 1);
  assert.equal(recebido.ok, true);
  assert.equal(recebido.diagnostico.contas[0].estado, 'divergente');
  assert.equal(JSON.stringify([...arvore.values()]).includes('org/repo'), false);
  leitor.sync.comandosEmitidos[0].alvo = 'terceiro';
  assert.equal((await lerDiagnostico(leitor, { cmdId: CMD }, T + 1)).ok, false);
  leitor.sync.comandosEmitidos[0].alvo = 'android';
  assert.equal((await lerDiagnostico(leitor, { cmdId: CMD }, T + 300001)).ok, false);
  arvore.delete([...arvore.keys()][0]);
  assert.equal((await lerDiagnostico(leitor, { cmdId: CMD }, T + 1)).code, 'diagnostico_incompleto');
  leitor.sync.comandosEmitidos = [];
  assert.equal((await lerDiagnostico(leitor, { cmdId: CMD }, T + 1)).code, 'comando_desconhecido');
});

test('estado antigo malformado não impede carregar o motor nem coletar o diagnóstico', async () => {
  fs.writeFileSync(path.join(STATE_DIR, 'inflight.json'), JSON.stringify([null, { key: PR.key, repo: {}, author: {} }]));
  fs.writeFileSync(path.join(STATE_DIR, 'decisions.json'), JSON.stringify({ pending: {} }));
  const recarregado = await import('../lib/engine/diagnostico-identidade.js?estado-malformado');
  const r = await recarregado.coletarIdentidade(motor(), { run: async () => ({ ok: true, stdout: 'revisor' }) });
  assert.equal(r.contas[0].estado, 'confere');
  assert.ok(r.itens.some(p => p.fonte === 'boot:inflight.json'));
});
