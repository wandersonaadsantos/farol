import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-andamento-feed-'));
process.env.FAROL_HOME = FAROL_HOME;

// dinâmico: `lib/engine/sync-andamento.js` puxa módulos que leem FAROL_HOME na carga, e um
// import estático seria avaliado antes da linha acima rodar (imports são içados)
const andamento = (await import('../lib/sync/andamento.js')).default;
const sincAndamento = (await import('../lib/engine/sync-andamento.js')).default;
const envelope = (await import('../lib/sync/envelope.js')).default;
const kek = (await import('../lib/sync/kek.js')).default;

after(() => { try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ } });

const kId = randomBytes(32);
const sessao = { pr: { key: 'acme/app#1' }, account: 'eu', startedAt: 1, model: 'claude-opus-5-5' };

test('o feed traz as últimas linhas, cortadas, dentro do orçamento', () => {
  const feed = Array.from({ length: 50 }, (_, i) => ({ t: i + 2, k: 'info', text: `linha ${i} ` + 'x'.repeat(300) }));
  const p = andamento.projetar(sessao, feed, { kId, agora: 100 });
  assert.ok(p.feed.length > 0);
  assert.ok(p.feed.every((l) => l.length <= andamento.MAX_LINHA_FEED));
  assert.ok(p.feed.join('').length <= andamento.ORCAMENTO_FEED);
  assert.match(p.feed.at(-1), /^linha 49/, 'a mais recente fica');
});

test('a projeção inteira cabe no nó de operações', () => {
  const feed = Array.from({ length: 120 }, (_, i) => ({ t: i + 2, k: 'info', text: 'ç'.repeat(400), a: 'leitor-' + i, s: 'leitura' }));
  const p = andamento.projetar(sessao, feed, { kId, agora: 200 });
  const claro = JSON.stringify({ p });
  assert.ok(Buffer.byteLength(claro) * 4 / 3 + 200 <= 2048, `claro de ${Buffer.byteLength(claro)} bytes não cabe cifrado em 2048`);
});

/* ---------- fix round 1 (28/09/2026): o orçamento tem de valer contra o cifrar() DE
   VERDADE, não uma estimativa. `ORCAMENTO_FEED` sozinho só limitava o conteúdo das linhas;
   uma enxurrada de linhas CURTAS passava por ele folgada e ainda assim estourava o teto do
   envelope, porque cada linha soma aspas, vírgula e colchete no JSON. As provas abaixo
   cifram de verdade contra lib/sync/envelope.js, com o mesmo `cur`/`material`/`no` que
   lib/engine/sync-andamento.js usa pro nó 'live/operations'. ---------- */

const MATERIAL = kek.novoMaterial();
const UID = 'u1';
const DEV = 'd'.repeat(32);

// cifra a projeção exatamente como `escrever` (lib/engine/sync-andamento.js) cifraria,
// pra provar contra o TETO REAL do envelope, e não contra uma conta de bytes à parte
function cifrarComoOMotor(projecao, { opId = 'o'.repeat(32), t0 = 1000, agora = 2000 } = {}) {
  const no = { v: 1, dev: DEV, t0, x: andamento.vencimentoDe(agora) };
  return envelope.cifrar({
    uid: UID, caminho: `live/operations/${opId}`, campo: 'andamento', no: 'live/operations', esquema: 'op1',
    cur: 'g1', material: MATERIAL, r: 1, extras: [no.dev, no.t0, no.x], dados: { p: projecao },
  });
}

test('pior caso do revisor: 120 linhas curtas, 8 subagentes, modelo e tags reais, cifra de verdade', () => {
  const feed = Array.from({ length: 120 }, (_, i) => ({ t: i + 2, k: 'info', text: `evento ${i} ok agora`, a: 'leitor-' + (i % 8), s: 'leitura' }));
  const sessaoReal = { pr: { key: 'acme/app#1' }, account: 'eu', startedAt: 1, model: 'claude-opus-5-5-20260901' };
  const p = andamento.projetar(sessaoReal, feed, { kId, agora: 200 });
  assert.ok(p.feed.length <= andamento.MAX_LINHAS_FEED, 'o teto de linhas vale mesmo com conteúdo curto');
  const r = cifrarComoOMotor(p);
  assert.equal(r.ok, true, r.motivo);
});

test('linha multibyte (acento, 2 bytes por caractere em UTF-8) cifra de verdade', () => {
  const feed = Array.from({ length: 120 }, (_, i) => ({ t: i + 2, k: 'info', text: 'ç'.repeat(400), a: 'leitor-' + i, s: 'leitura' }));
  const p = andamento.projetar(sessao, feed, { kId, agora: 200 });
  const r = cifrarComoOMotor(p);
  assert.equal(r.ok, true, r.motivo);
});

test('escrever: cifrar que falha por teto tenta de novo sem o feed, e o nó sobe mesmo assim', async () => {
  const material = kek.novoMaterial();
  const puts = [];
  const rt = { uid: UID, cur: 'g1', material, deviceId: DEV, client: { put: async (path, body) => { puts.push({ path, body }); return { ok: true }; } } };
  const reg = { opId: 'o'.repeat(32), t0: 1000, ultimaEscrita: 0, resumo: '' };
  // uma projeção deliberadamente MAIOR do que `andamento.projetar` jamais produziria (o
  // teto de linhas e o de bytes já defendem lá): a defesa aqui tem de valer sozinha
  const feedEnorme = Array.from({ length: 200 }, (_, i) => `evento ${i} ok agora mesmo`);
  const projecao = {
    etapa: 'verificacao', msPorEtapa: { leitura: 1 }, subagentes: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
    feed: feedEnorme, modelo: 'claude-opus-5-5-20260901', prTag: 'a'.repeat(32), acctTag: 'b'.repeat(32),
    matTag: 'c'.repeat(32), heranca: 'parcial', tipo: 'review',
  };
  const direto = envelope.cifrar({
    uid: UID, caminho: `live/operations/${reg.opId}`, campo: 'andamento', no: 'live/operations', esquema: 'op1',
    cur: 'g1', material, r: 1, extras: [rt.deviceId, reg.t0, andamento.vencimentoDe(2000)], dados: { p: projecao },
  });
  assert.equal(direto.ok, false, 'a prova só vale se a projeção FORÇADA realmente estoura o teto');
  assert.equal(direto.motivo, 'teto');
  const ok = await sincAndamento.escrever(rt, reg, projecao, 2000);
  assert.equal(ok, true, 'o nó tem de subir mesmo sem o feed caber');
  assert.equal(puts.length, 1);
  const aberto = envelope.decifrar({
    enc: puts[0].body.enc, material, uid: UID, caminho: `live/operations/${reg.opId}`, campo: 'andamento', esquema: 'op1',
    extras: [rt.deviceId, puts[0].body.t0, puts[0].body.x],
  });
  assert.equal(aberto.ok, true);
  assert.deepEqual(aberto.valor.p.feed, [], 'o feed foi sacrificado, o resto da projeção não');
  assert.equal(aberto.valor.p.etapa, 'verificacao', 'etapa, tempo e o resto sobrevivem ao fallback');
});

/* ---------- revisão final (28/09/2026): o feed ao vivo não leva texto do modelo nem
   argumento de ferramenta. A spec diz "nada de código nem de texto do modelo"; o feed
   passa só linha de sistema (info, warn, error) e, de ferramenta, só o nome. ---------- */

const TOKEN_FALSO = 'ghp_FAKEfakeFAKEfake0123456789abcdefABCD';

test('linha de texto do modelo nunca entra no feed projetado', () => {
  const feed = [
    { t: 2, k: 'text', text: 'o modelo pensou em voz alta sobre src/segredo.js' },
    { t: 3, k: 'info', text: 'sessão do Claude iniciada' },
  ];
  const p = andamento.projetar(sessao, feed, { kId, agora: 10 });
  assert.deepEqual(p.feed, ['sessão do Claude iniciada']);
});

test('linha de ferramenta sobe só com o nome, nunca com o comando', () => {
  const feed = [
    { t: 2, k: 'tool', text: `Bash · curl -H "Authorization: token ${TOKEN_FALSO}" https://api.example.com` },
    { t: 3, k: 'tool', text: 'Read · C:/Users/fulano/projeto/src/segredo.js' },
    { t: 4, k: 'tool', text: 'TodoWrite' },
  ];
  const p = andamento.projetar(sessao, feed, { kId, agora: 10 });
  assert.deepEqual(p.feed, ['ferramenta: Bash', 'ferramenta: Read', 'ferramenta: TodoWrite']);
  const cru = JSON.stringify(p);
  for (const proibido of [TOKEN_FALSO, 'curl', 'segredo', 'example.com']) assert.equal(cru.includes(proibido), false, proibido);
});

test('linha de ferramenta sem nome reconhecível (comando cru do Codex) é descartada', () => {
  const feed = [
    { t: 2, k: 'tool', text: `git push https://x:${TOKEN_FALSO}@github.com/a/b` },
    { t: 3, k: 'tool', text: TOKEN_FALSO },
  ];
  const p = andamento.projetar(sessao, feed, { kId, agora: 10 });
  assert.deepEqual(p.feed, []);
});

test('info, warn e error passam com o texto; tipo desconhecido não', () => {
  const feed = [
    { t: 2, k: 'info', text: 'Card lido' },
    { t: 3, k: 'warn', text: 'instabilidade na conexão' },
    { t: 4, k: 'error', text: 'falhou' },
    { t: 5, k: 'ok', text: 'outra coisa' },
    { t: 6, text: 'sem tipo' },
  ];
  const p = andamento.projetar(sessao, feed, { kId, agora: 10 });
  assert.deepEqual(p.feed, ['Card lido', 'instabilidade na conexão', 'falhou']);
});
