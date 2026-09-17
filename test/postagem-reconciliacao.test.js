// Regras puras da reconciliação de `enviando` (CT-POST): o que prova que a postagem saiu e
// quando uma leitura sem o review conta para concluir que ela não saiu.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-reconciliacao-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { TEMPOS } from '../lib/constants.js';

const rec = await import('../lib/engine/postagem-reconciliacao.js');

after(() => { try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ } });

const T0 = 1_800_000_000_000;
const E = TEMPOS.POSTAGEM_RECONCILIACAO_ESPERA_MS;
const HEAD = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const REG = { estado: 'enviando', tentativaId: 't1', intencaoEm: T0, evento: 'APPROVE', head: HEAD, leiturasVazias: [] };

test('leitura que começa antes da janela depois da intenção não conta', () => {
  assert.equal(rec.leituraConta(REG, T0 + E - 1), false);
  assert.equal(rec.leituraConta(REG, T0 + E), true);
});

test('segunda leitura só conta com a janela inteira depois da primeira', () => {
  const comUma = { ...REG, leiturasVazias: [T0 + E] };
  assert.equal(rec.leituraConta(comUma, T0 + 2 * E - 1), false);
  assert.equal(rec.leituraConta(comUma, T0 + 2 * E), true);
});

test('prova: mesmo veredito, mesmo commit, criado depois da intenção', () => {
  assert.equal(rec.provaDaTentativa(REG, { state: 'APPROVED', commit: HEAD, at: T0 }), true);
  assert.equal(rec.provaDaTentativa(REG, { state: 'APPROVED', commit: HEAD, at: T0 - 1 }), false, 'anterior à intenção');
  assert.equal(rec.provaDaTentativa(REG, { state: 'CHANGES_REQUESTED', commit: HEAD, at: T0 }), false, 'outro veredito');
  assert.equal(rec.provaDaTentativa(REG, { state: 'APPROVED', commit: 'b'.repeat(40), at: T0 }), false, 'outro commit');
  assert.equal(rec.provaDaTentativa(REG, { state: 'APPROVED', commit: HEAD, at: null }), false, 'rascunho sem horário');
});

test('coordenação desligada: nada é lido e nada muda', async () => {
  const e = { syncCoordenacaoAtiva: () => false, postagensArquivo: path.join(FAROL_HOME, 'nao-existe.json') };
  assert.equal(await rec.reconciliarPostagensIncertas(e), 0);
  assert.equal(fs.existsSync(e.postagensArquivo), false);
});

// O caso acima, sozinho, não prova a guarda: com o arquivo ausente a lista sai vazia e o
// resultado é 0 com ou sem ela. Aqui existe um incerto no disco, e o banco e o GitHub
// anotam qualquer consulta: só a guarda explica nenhuma delas acontecer.
test('coordenação desligada com incerto no arquivo: nem o banco nem o GitHub são consultados', async () => {
  const arquivo = path.join(FAROL_HOME, 'postagens-desligada.json');
  const incerto = { estado: 'enviando', tentativaId: 't1', intencaoEm: T0, account: 'eu', prKey: 'o/r#1', head: HEAD, evento: 'APPROVE', leiturasVazias: [] };
  fs.writeFileSync(arquivo, JSON.stringify({ [`eu|o/r#1|${HEAD}|APPROVE`]: incerto }));
  const consultas = [];
  const e = {
    syncCoordenacaoAtiva: () => false,
    postagensArquivo: arquivo,
    sync: { status: 'conectado', uid: 'u1', deviceId: 'd1', agora: () => T0, client: { get: async (p) => { consultas.push(p); return { ok: false }; } } },
    myReviewsWithTime: async () => { consultas.push('github'); return []; },
  };
  assert.equal(await rec.reconciliarPostagensIncertas(e), 0);
  assert.deepEqual(consultas, [], 'com a coordenação desligada nada é consultado');
});
