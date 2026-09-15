// Resultado incerto (CT-POST): queda depois do aceite e queda na fronteira. Nenhum dos dois
// pode virar "não enviado" por ausência de desfecho, e a reconciliação é a única saída.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-postagem-incerta-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import { criarGithubFalso } from './helpers/github-reviews-falso.js';
import { montarAparelho } from './helpers/aparelho-coordenado.js';
import { TEMPOS } from '../lib/constants.js';

const io = (await import('../lib/io.js')).default;
const { Engine } = await import('../server.js');
const { createRtdbClient } = await import('../lib/sync/rtdb.js');
const registro = await import('../lib/engine/registro-postagem.js');

const TOKEN = 'tok-ok';
const AGORA = 1_800_000_000_000;
const E = TEMPOS.POSTAGEM_RECONCILIACAO_ESPERA_MS;
const HEAD = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const PR_KEY = 'o/r#1';
const CTX_REG = { account: 'eu', prKey: PR_KEY, head: HEAD, evento: 'APPROVE' };
const relogio = { agora: AGORA, head: HEAD };
const runReal = io.run;
let fake;
let gh;
let n = 0;

before(async () => { fake = await startFakeRtdb({ token: TOKEN }); });
after(async () => {
  io.run = runReal;
  await fake.close();
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => {
  fake.setTree(null);
  relogio.agora = AGORA;
  relogio.head = HEAD;
  gh = criarGithubFalso({ conta: 'eu', agora: () => relogio.agora, head: () => relogio.head });
  io.run = (cmd, args, opts) => gh.run(cmd, args, opts);
});

function aparelho(deviceId, dir) {
  n++;
  return montarAparelho({ Engine, createRtdbClient, fake, token: TOKEN, deviceId, dir: dir || path.join(FAROL_HOME, `ap-${n}`), relogio });
}

function reiniciar(e) {
  return aparelho(e.sync.deviceId, path.dirname(e.postagensArquivo));
}

function pendencia() {
  return {
    id: 'd1', key: PR_KEY, createdAt: AGORA, status: 'pending', verdict: 'approve',
    pr: { repo: 'o/r', number: 1, url: 'https://github.com/o/r/pull/1', author: 'dev', account: 'eu' }, headSha: HEAD, reasons: [],
    payloads: { approve: { event: 'APPROVE', body: 'Leitura atenta, tudo certo por aqui.', comments: [] } },
  };
}

async function estado(e) {
  return (await registro.lerRegistro(e, CTX_REG)).efetivo.estado;
}

test('publicação aceita e queda antes do desfecho: fica enviando, ninguém reposta, a reconciliação confirma', async () => {
  const a = aparelho('dA');
  const b = aparelho('dB');
  gh.estado.aoPostar = () => 'aceitar-e-cair';
  gh.estado.ocultarNovos = true;
  a.decisions.pending = [pendencia()];
  const r = await a.decide('d1', 'approve');
  assert.equal(r.ok, false);
  assert.equal(r.estado, 'enviando');
  gh.estado.aoPostar = null;
  const a2 = reiniciar(a);
  a2.decisions.pending = [pendencia()];
  await a2.decide('d1', 'approve');
  b.decisions.pending = [pendencia()];
  await b.decide('d1', 'approve');
  assert.equal(gh.posts.length, 1, 'nem a recuperação nem outro aparelho postam de novo');
  assert.equal(await estado(b), 'enviando');
  gh.revelar();
  assert.equal(await a2.reconciliarPostagensIncertas(), 1);
  assert.equal(await estado(a2), 'confirmada');
  assert.equal(await estado(b), 'confirmada', 'o banco carrega o desfecho para os outros aparelhos');
  assert.equal(gh.posts.length, 1);
});

test('queda na fronteira: enviando sem io.run só vira nao_enviada com as duas leituras', async () => {
  const a = aparelho('dA');
  const intencao = { estado: 'enviando', tentativaId: 't-fronteira', intencaoEm: AGORA, atualizadoEm: AGORA, deviceId: 'dA', via: 'clique', evento: 'APPROVE', head: HEAD, payloadHash: '', reviewId: '', commitId: '', motivo: '', leiturasVazias: [] };
  assert.deepEqual(await registro.gravarIntencao(a, CTX_REG, intencao), { ok: true });
  const a2 = reiniciar(a);
  a2.decisions.pending = [pendencia()];
  await a2.decide('d1', 'approve');
  assert.equal(gh.posts.length, 0, 'enviando nunca é lido como não enviado');

  relogio.agora = AGORA + E / 2;
  await a2.reconciliarPostagensIncertas();
  relogio.agora = AGORA + E + 1;
  await a2.reconciliarPostagensIncertas();
  relogio.agora = AGORA + E + E / 2;
  await a2.reconciliarPostagensIncertas();
  gh.estado.falharLeitura = true;
  relogio.agora = AGORA + 2 * E + 5;
  await a2.reconciliarPostagensIncertas();
  gh.estado.falharLeitura = false;
  assert.equal(await estado(a2), 'enviando', 'leitura cedo, espaçamento curto e leitura falha não concluem');
  assert.equal(registro.listarIncertos(a2)[0].leiturasVazias.length, 1);

  relogio.agora = AGORA + 2 * E + 10;
  assert.equal(await a2.reconciliarPostagensIncertas(), 1);
  assert.equal(await estado(a2), 'nao_enviada');
  await a2.decide('d1', 'approve');
  assert.equal(gh.posts.length, 1, 'só depois da conclusão a via tenta de novo');
});

test('check() reconcilia postagens incertas depois do reconcilePending e antes do retryFailedPosts', () => {
  const fonte = fs.readFileSync(path.join(import.meta.dirname, '..', 'server.js'), 'utf8');
  const pend = fonte.indexOf('await this.reconcilePending();');
  const inc = fonte.indexOf('await this.reconciliarPostagensIncertas();');
  const retry = fonte.indexOf('await this.retryFailedPosts();');
  assert.ok(pend > 0 && inc > pend && retry > inc, `ordem no check(): ${pend} < ${inc} < ${retry}`);
});
