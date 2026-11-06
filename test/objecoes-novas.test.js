// Só objeção NOVA de pessoa invalida o APPROVE (05/11/2026).
//
// Medido no estado real: das sete recusas "histórico de objeções mudou depois da revisão"
// gravadas até 05/11/2026, a impressão gravada no relatório foi reconstruída byte a byte a
// partir dos reviews do GitHub, e o que mudou entre a leitura e a postagem foi: review de
// ferramenta (acrity-advesarial-code-review[bot], dois casos), aprovação de pessoa (quatro
// casos, dois com comentários de linha "Optional"/"Nit" dentro da própria aprovação) e um
// review COMMENTED de pessoa com defeitos apontados (o único que segue recusando). A
// impressão antiga era o hash de TUDO, então qualquer evento descartava a revisão paga.
// As fixtures abaixo reproduzem o FORMATO desses eventos, com nomes sintéticos.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-objecoes-novas-'));
process.env.FAROL_HOME = path.join(root, 'home');
const { reviewSnapshot, objecoesMudaram, impressaoDasObjecoes } = await import('../lib/technical-review/reviews.js');
const { registrarLeiturasDeObjecoes, promptDeLeituraDeObjecoes } = await import('../lib/technical-review/objection-reading.js');
const { main: lerNaSessao } = await import('../lib/technical-review/query-objections.js');
const { approvalRefusal } = await import('../lib/technical-review/publication.js');
const { technicalRuntime } = await import('../lib/technical-review/runtime.js');
const { PROFILE_FILE, profileFor } = await import('../lib/technical-review/profiles.js');
const { VERSAO_DAS_REGRAS } = await import('../lib/technical-review/verdict.js');
const { technicalReport } = await import('./helpers/technical-proof.js');
const io = (await import('../lib/io.js')).default;
after(() => fs.rmSync(root, { recursive: true, force: true }));

const HEAD = 'a'.repeat(40);
const engine = { accountForPr: () => 'eu', ghEnv: () => ({}) };
const pr = { repo: 'org/repo', number: 1 };

const pessoa = login => ({ login, type: 'User' });
const bot = { login: 'acrity-advesarial-code-review[bot]', type: 'Bot' };
const review = (id, user, state, body = '') => ({ id, user, state, body, commit_id: HEAD });
const comentario = (id, user, body, reviewId) => ({ id, user, body, path: 'src/a.ts', line: 3, commit_id: HEAD, pull_request_review_id: reviewId });

async function snapshotDe(reviews, comments, metadata = pr) {
  const original = io.run;
  io.run = async (_cmd, args) => ({ ok: true, stdout: JSON.stringify([args.some(a => a.endsWith('/reviews')) ? reviews : comments]) });
  try { return await reviewSnapshot(engine, metadata); } finally { io.run = original; }
}

// o que a revisão leu: um pedido de mudanças de pessoa já respondido e um review antigo da ferramenta
const lidoReviews = [review(10, pessoa('colega'), 'CHANGES_REQUESTED', 'O contrato quebra no caso vazio.'), review(11, bot, 'CHANGES_REQUESTED', 'WARNING: alias.')];
const lidoComments = [comentario(100, pessoa('colega'), 'Aqui o vazio passa direto.', 10)];

test('review e comentário de ferramenta depois da leitura não são objeção nova', async () => {
  const antes = await snapshotDe(lidoReviews, lidoComments);
  const depois = await snapshotDe([...lidoReviews, review(12, bot, 'COMMENTED'), review(13, bot, 'CHANGES_REQUESTED', 'WARNING: import.')],
    [...lidoComments, comentario(101, bot, '**WARNING**: import pelo alias genérico.', 12)]);
  assert.notEqual(depois.fingerprint, antes.fingerprint, 'a impressão antiga (hash de tudo) mudou, e era isso que recusava');
  assert.equal(objecoesMudaram(impressaoDasObjecoes(antes), depois), false);
});

test('aprovação de pessoa, mesmo com comentários de linha dentro dela, não é objeção nova', async () => {
  const antes = await snapshotDe(lidoReviews, lidoComments);
  const depois = await snapshotDe([...lidoReviews, review(14, pessoa('outro'), 'APPROVED', 'O ponto que me preocupa é a ordem de deploy.')],
    [...lidoComments, comentario(102, pessoa('outro'), 'Nit: o docblock ainda fala do texto antigo.', 14), comentario(103, pessoa('outro'), 'Optional: um caso com a chave desligada.', 14)]);
  assert.equal(objecoesMudaram(impressaoDasObjecoes(antes), depois), false);
});

test('dispensa e remoção não acrescentam objeção', async () => {
  const antes = await snapshotDe(lidoReviews, lidoComments);
  const dispensado = await snapshotDe([{ ...lidoReviews[0], state: 'DISMISSED' }, lidoReviews[1]], lidoComments);
  assert.equal(objecoesMudaram(impressaoDasObjecoes(antes), dispensado), false);
  const removido = await snapshotDe([lidoReviews[1]], []);
  assert.equal(objecoesMudaram(impressaoDasObjecoes(antes), removido), false);
});

test('objeção nova de pessoa invalida: review comentado com texto, pedido de mudanças, comentário solto e corpo editado', async () => {
  const visto = impressaoDasObjecoes(await snapshotDe(lidoReviews, lidoComments));
  const casos = {
    'review COMMENTED com defeitos (o caso que segue recusando)': [[...lidoReviews, review(15, pessoa('outro'), 'COMMENTED', 'A MIA fica no carregando sem fim.')], lidoComments],
    'pedido de mudanças': [[...lidoReviews, review(16, pessoa('outro'), 'CHANGES_REQUESTED', 'Falta tratar o erro.')], lidoComments],
    'comentário de linha fora de aprovação': [[...lidoReviews, review(17, pessoa('outro'), 'COMMENTED')], [...lidoComments, comentario(104, pessoa('outro'), 'Isto vaza o token.', 17)]],
    'corpo editado de objeção já vista': [[{ ...lidoReviews[0], body: 'O contrato quebra no caso vazio e no nulo.' }, lidoReviews[1]], lidoComments],
    'intervenção da própria conta': [[...lidoReviews, review(18, pessoa('eu'), 'CHANGES_REQUESTED', 'A alteração viola o contrato.')], lidoComments],
  };
  for (const [nome, [r, c]] of Object.entries(casos)) {
    assert.equal(objecoesMudaram(visto, await snapshotDe(r, c)), true, nome);
  }
});

test('review de pessoa sem texto e sem comentário não é objeção', async () => {
  const visto = impressaoDasObjecoes(await snapshotDe(lidoReviews, lidoComments));
  assert.equal(objecoesMudaram(visto, await snapshotDe([...lidoReviews, review(19, pessoa('outro'), 'COMMENTED')], lidoComments)), false);
});

test('resposta do autor não invalida aprovação; intervenção de outro revisor continua invalidando', async () => {
  const metadata = { ...pr, author: 'Dev' };
  const visto = impressaoDasObjecoes(await snapshotDe(lidoReviews, lidoComments, metadata));
  const resposta = comentario(200, pessoa('dev'), 'Corrigi esse comportamento.', 10);
  const depois = await snapshotDe([...lidoReviews, review(20, pessoa('dev'), 'COMMENTED', 'Ajustado.')], [...lidoComments, resposta], metadata);
  assert.equal(objecoesMudaram(visto, depois), false);
  const revisor = await snapshotDe(lidoReviews, [...lidoComments, resposta, comentario(201, pessoa('eu'), 'O caso vazio continua errado.', 10)], metadata);
  assert.equal(objecoesMudaram(visto, revisor), true);
  assert.equal(objecoesMudaram(visto, await snapshotDe(lidoReviews, [...lidoComments, resposta])), true, 'sem identidade não presume quem é o autor');
});

test('PR avulso confirma o autor no GitHub antes de classificar suas respostas', async () => {
  const original = io.run;
  const resposta = comentario(210, pessoa('dev'), 'Corrigido.', 10);
  io.run = async (_cmd, args) => {
    if (args.some(a => a.endsWith('/reviews'))) return { ok: true, stdout: JSON.stringify([lidoReviews]) };
    if (args.some(a => a.endsWith('/comments'))) return { ok: true, stdout: JSON.stringify([[...lidoComments, resposta]]) };
    return { ok: true, stdout: JSON.stringify({ author: 'dev' }) };
  };
  try {
    const snapshot = await reviewSnapshot(engine, pr);
    assert.equal(snapshot.leituras.some(r => r.id === resposta.id), false);
    assert.equal(snapshot.leituras.some(r => r.id === lidoComments[0].id), true);
  } finally { io.run = original; }
});

test('leitura adicional cobre somente o mesmo conteúdo de reviews e comentários efetivamente declarados', async () => {
  const antes = await snapshotDe(lidoReviews, lidoComments);
  const novosReviews = [...lidoReviews, review(21, pessoa('outro'), 'COMMENTED', 'Conferir o caminho vazio.')];
  const novosComments = [...lidoComments, comentario(202, pessoa('outro'), 'A condição precisa tratar nulo.', 21)];
  const lido = await snapshotDe(novosReviews, novosComments);
  const report = { ...impressaoDasObjecoes(antes), humanObjectionReads: lido.leituras };
  assert.equal(objecoesMudaram(report, lido), false);
  assert.equal(objecoesMudaram({ ...report, humanObjectionReads: lido.leituras.filter(r => r.tipo !== 'comment') }, lido), true);
  assert.equal(objecoesMudaram({ ...report, humanObjectionReads: [{ tipo: 'review', id: 21 }] }, lido), true, 'id não comprova conteúdo');
  assert.equal(objecoesMudaram({ ...report, humanObjectionReads: 'inválido' }, lido), true);
  const editado = await snapshotDe(novosReviews, [...lidoComments, { ...novosComments.at(-1), body: 'Também quebra no valor false.' }]);
  assert.equal(objecoesMudaram(report, editado), true, 'edição posterior à leitura é objeção nova');
  const outraObjecao = await snapshotDe([...novosReviews, review(22, pessoa('colega'), 'CHANGES_REQUESTED', 'Outro defeito.')], novosComments);
  assert.equal(objecoesMudaram(report, outraObjecao), true);
});

test('consulta da sessão entrega texto e recibo compatíveis e só recibos válidos chegam ao relatório', async () => {
  const original = io.run;
  io.run = async (_cmd, args) => ({ ok: true, stdout: JSON.stringify([args.some(a => a.endsWith('/reviews')) ? lidoReviews : lidoComments]) });
  try {
    const consulta = await lerNaSessao(['org/repo', '1']);
    assert.equal(consulta.reviews[0].body, lidoReviews[0].body);
    assert.equal(consulta.comments[0].body, lidoComments[0].body);
    const result = { technicalReview: { humanObjections: [] }, objecoesLidas: [...consulta.objecoesLidas, { tipo: 'review', id: 10 }, null] };
    registrarLeiturasDeObjecoes(result);
    assert.equal(Object.hasOwn(result, 'objecoesLidas'), false);
    assert.deepEqual(result.technicalReview.humanObjectionReads, consulta.objecoesLidas);
    assert.equal(objecoesMudaram(result.technicalReview, await snapshotDe(lidoReviews, lidoComments)), false);
    await assert.rejects(lerNaSessao(['org/repo;echo', '1']), /Use:/);
    await assert.rejects(lerNaSessao(['org/repo', '1.5']), /Use:/);
  } finally { io.run = original; }
});

test('a consulta usa runtime explícito, módulo distribuído e alvo GitHub canônico', () => {
  const consulta = JSON.parse(promptDeLeituraDeObjecoes(pr).trim().split('\n').at(-1));
  assert.deepEqual(consulta.runtime, { executable: process.execPath, environment: { ELECTRON_RUN_AS_NODE: '1' } });
  assert.deepEqual(consulta.read, [process.execPath, path.resolve(import.meta.dirname, '../lib/technical-review/query-objections.js'), 'org/repo', '1']);
  assert.equal(fs.existsSync(consulta.read[1]), true);
  assert.equal(promptDeLeituraDeObjecoes({ ...pr, repo: 'org/repo;echo x' }), '');
});

test('relatório gravado antes desta versão segue comparando a impressão inteira', async () => {
  const antes = await snapshotDe(lidoReviews, lidoComments);
  const legado = { humanReviewFingerprint: antes.fingerprint };
  assert.equal(objecoesMudaram(legado, antes), false);
  const comBot = await snapshotDe([...lidoReviews, review(12, bot, 'COMMENTED')], lidoComments);
  assert.equal(objecoesMudaram(legado, comBot), true, 'sem a lista gravada não há como provar que nada novo é de pessoa');
  assert.equal(objecoesMudaram({ humanReviewFingerprint: 'x', humanObjections: [] }, { fingerprint: 'y' }), true, 'leitura sem a lista atual recusa');
});

test('a impressão antiga continua a mesma: relatório pendente na atualização não é recusado à toa', async () => {
  const snap = await snapshotDe(lidoReviews, lidoComments);
  const { createHash } = await import('node:crypto');
  const projetar = r => ({ id: r.id, author: r.user.login, state: r.state || '', head: r.commit_id || '', body: r.body || '', file: r.path || '', line: r.line || r.original_line || null });
  const esperado = createHash('sha256').update(JSON.stringify({ reviews: lidoReviews.map(projetar), comments: lidoComments.map(projetar) })).digest('hex');
  assert.equal(snap.fingerprint, esperado);
  assert.deepEqual(Object.keys(snap), ['reviews', 'comments', 'fingerprint'], 'a lista das objeções não vai ao prompt');
  assert.deepEqual(Object.keys(snap.reviews[0]), ['id', 'author', 'state', 'head', 'body', 'file', 'line'], 'o que vai ao prompt não ganha campo');
});

test('o relatório da avaliação grava a lista das objeções de pessoa junto da impressão', async () => {
  const { relatorioTecnico } = await import('../lib/technical-review/runtime.js');
  const objections = Object.defineProperty({ reviews: [], comments: [], fingerprint: 'impressao' }, 'objecoes', { value: ['r:1'], enumerable: false });
  const rel = relatorioTecnico({ repo: 'o/r', base: 'b', head: 'h', profile: { fingerprint: 'p' }, objections },
    { catalogFingerprint: 'c', verdict: 'pass', rules: [], findings: [], coverage: {} });
  assert.equal(rel.humanReviewFingerprint, 'impressao');
  assert.deepEqual(rel.humanObjections, ['r:1']);
  assert.deepEqual(Object.keys(impressaoDasObjecoes({ fingerprint: 'f', objecoes: ['a'] })), ['humanReviewFingerprint', 'humanObjections']);
});

function comCadastro(repo, corpo) {
  fs.mkdirSync(path.dirname(PROFILE_FILE), { recursive: true });
  fs.writeFileSync(PROFILE_FILE, JSON.stringify({ repositories: { [repo]: { declaration: { scopes: ['core'] } } } }));
  return Promise.resolve().then(corpo).finally(() => fs.rmSync(PROFILE_FILE, { force: true }));
}

test('publicação: ferramenta e aprovação depois da leitura não descartam o APPROVE; objeção de pessoa descarta', () => comCadastro('org/repo', async () => {
  const visto = await snapshotDe(lidoReviews, lidoComments);
  const comFerramentaEAprovacao = await snapshotDe([...lidoReviews, review(13, bot, 'CHANGES_REQUESTED', 'WARNING.'), review(14, pessoa('outro'), 'APPROVED', 'Ok.')], lidoComments);
  const comObjecao = await snapshotDe([...lidoReviews, review(15, pessoa('outro'), 'COMMENTED', 'Defeito no carregando.')], lidoComments);
  const original = { ...technicalRuntime };
  const repo = 'org/repo';
  const key = `${repo}#1`;
  const payload = { event: 'APPROVE', commit_id: HEAD };
  try {
    technicalRuntime.requireTool = async () => 'tool';
    for (const provaEsgotada of [false, true]) {
      const base = { ...technicalReport(HEAD, repo), profile: profileFor(repo).fingerprint, ...impressaoDasObjecoes(visto) };
      const report = provaEsgotada ? { ...base, verdict: 'not-run', rules: [{ rule: 'x', verdict: 'not-run' }] } : base;
      technicalRuntime.targetFor = async () => ({ head: HEAD, base: report.base });
      const motor = () => ({ technicalApprovals: new Map([[key, { report, evidence: [], provaEsgotada, evidenceVersion: VERSAO_DAS_REGRAS }]]),
        decisions: { pending: [] }, saveDecisions: () => {}, bloqueadoPorChecks: async () => ({ verifiedHead: HEAD, faltando: [] }) });
      technicalRuntime.reviewSnapshot = async () => comFerramentaEAprovacao;
      assert.equal(await approvalRefusal(motor(), { key, repo }, payload), null, `provaEsgotada=${provaEsgotada}: sai o APPROVE`);
      technicalRuntime.reviewSnapshot = async () => comObjecao;
      const recusa = await approvalRefusal(motor(), { key, repo }, payload);
      assert.equal(recusa && recusa.error, 'histórico de objeções mudou depois da revisão', `provaEsgotada=${provaEsgotada}`);
      const result = { technicalReview: report, objecoesLidas: comObjecao.leituras };
      registrarLeiturasDeObjecoes(result);
      assert.equal(await approvalRefusal(motor(), { key, repo }, payload), null, 'a sessão já leu e incorporou a objeção nova');
      technicalRuntime.reviewSnapshot = async () => snapshotDe([...lidoReviews, review(15, pessoa('outro'), 'COMMENTED', 'O conteúdo mudou depois da leitura.')], lidoComments);
      assert.equal((await approvalRefusal(motor(), { key, repo }, payload))?.error, 'histórico de objeções mudou depois da revisão');
    }
  } finally { Object.assign(technicalRuntime, original); }
}));
