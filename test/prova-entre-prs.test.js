import { criteriaFixture } from './helpers/criteria-fixture.js';
// Herança da LEITURA entre PRs do mesmo repositório, por conteúdo (06/11/2026).
//
// Medido no estado real: biudtech/biud-frontend#1852 (promoção para homologation) tinha os 21
// arquivos com o MESMO blob do #1843, revisado uma hora antes, e mesmo assim gastou uma sessão
// inteira relendo os 21. As réplicas do GitFlow (task para develop, release_hmg e release_prd)
// trazem os mesmos blobs. A prova por arquivo era só do PR; agora um índice por repositório
// guarda, por (caminho, blob), de qual PR e commit veio a leitura, e o PR novo só lê o que não
// tem prova. Alcance com chamador é conferido de novo no head NOVO antes da sessão; falhou,
// o arquivo volta a ser lido. Avaliação técnica e veredito continuam do PR novo.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-prova-entre-prs-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const io = (await import('../lib/io.js')).default;
const runReal = io.run;
let noHead = {};
let lidos = [];
io.run = function runDuble(cmd, args) {
  const sub = (args || []).join(' ');
  const m = sub.match(/repos\/[^/]+\/[^/]+\/contents\/(.+)\?ref=(\S+)/);
  if (m) {
    lidos.push({ arquivo: decodeURI(m[1]), ref: m[2] });
    const porHead = noHead[m[2]] || noHead;
    const texto = porHead[decodeURI(m[1])];
    return Promise.resolve(typeof texto !== 'string' ? { ok: false, stdout: '', stderr: 'Not Found' } : { ok: true, stdout: texto, stderr: '' });
  }
  if (/pulls\/\d+\/reviews/.test(sub) && sub.includes('--jq')) return Promise.resolve({ ok: true, stdout: '[]', stderr: '' });
  return Promise.resolve({ ok: true, stdout: '', stderr: '' });
};

const fileProof = await import('../lib/engine/file-proof.js');
const repoProof = await import('../lib/engine/prova-do-repositorio.js');
const analysis = await import('../lib/engine/analysis-source.js');
const { Engine } = await import('../server.js');

const runtimeOriginal = { ...analysis.sourceRuntime };
afterEach(() => Object.assign(analysis.sourceRuntime, runtimeOriginal));
after(() => {
  io.run = runReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});

const CHAMADOR = 'import { montar } from "./veredito";\n\nexport function rota() {\n  return montar(1);\n}\n';
const DECLARACAO = { alterado: 'src/veredito.ts', chamadores: [{ arquivo: 'src/rota.ts', linha: 4, simbolo: 'montar' }] };
const VEREDITO = { path: 'src/veredito.ts', sha: 'blob-veredito', status: 'modified', lines: 10, patch: '@@ -1 +1 @@\n-a\n+b', patchStatus: 'available' };
const DOC = { path: 'docs/guia.md', sha: 'blob-guia', status: 'modified', lines: 4, patch: '@@ -2 +2 @@\n-c\n+d', patchStatus: 'available' };

/* ---------- ponta a ponta: o PR novo com os mesmos blobs não relê nada ---------- */

function motor(rodadas, prompts) {
  const e = new Engine();
  e.token = 'token-falso';
  e.tokens = { eu: 'token-falso' };
  e.config.accounts = [{ user: 'eu', owners: ['acme'] }];
  e.config.autoApproveAll = true;
  e.approvePolicyFor = () => 'wait';
  e.saveDecisions = () => { };
  e.pushState = () => { };
  e.refreshTokens = async () => { };
  e.log = () => { };
  e.on('toast', () => { });
  e.fetchPrInventory = async (_pr, headSha) => {
    const files = rodadas.atual.files;
    return { status: 'complete', reason: '', headSha, baseSha: 'base', changedFiles: files.length, files };
  };
  e.headSha = async () => rodadas.atual.head;
  e.postReview = async () => ({ ok: true });
  e.runClaudeStream = async (prompt) => {
    prompts.push(prompt);
    return {
      text: JSON.stringify({
        protocolo: { prReviewer: 'rodou' }, ...criteriaFixture('approve'), analysisStatus: 'complete', verdict: 'approve', decision: 'auto_approve', cardMet: true, reasons: [],
        coverage: rodadas.atual.coverage, alcance: rodadas.atual.alcance,
        payloads: { approve: { event: 'APPROVE', body: 'Li o diff e o comportamento fecha com o card.' } }, reportMarkdown: '# ok',
        ...(rodadas.atual.extra || {}),
      }),
      sessionId: '12345678-abcd-1234-abcd-123456789012',
    };
  };
  return e;
}
const daRodada = (e, pr, head) => [...e.decisions.pending, ...e.decisions.resolved].find((d) => d.key === pr.key && d.headSha === head);
const motivos = (d) => (d.reasons || []).map((r) => (typeof r === 'string' ? r : r.text)).join(' | ');

test('PR novo com os mesmos blobs de um PR já revisado do repositório herda toda a leitura, com a origem', async () => {
  const origem = { key: 'acme/app#51', repo: 'acme/app', number: 51, url: 'https://github.com/acme/app/pull/51', author: 'dev', requested: true };
  const promocao = { key: 'acme/app#52', repo: 'acme/app', number: 52, url: 'https://github.com/acme/app/pull/52', author: 'dev', requested: true };
  const prompts = [];
  const rodadas = { atual: {
    head: 'aaaaaaa1', files: [VEREDITO, DOC],
    coverage: { total: 2, reviewed: [VEREDITO.path, DOC.path], missing: [] }, alcance: [DECLARACAO],
  } };
  noHead = { 'src/rota.ts': CHAMADOR };
  const e = motor(rodadas, prompts);
  await e.runHeadlessReview({ ...origem });
  assert.doesNotMatch(motivos(daRodada(e, origem, 'aaaaaaa1')), /cobertura da leitura/);

  // a promoção: mesmo conteúdo, outro head, e a sessão não lê nada
  rodadas.atual = { head: 'bbbbbbb2', files: [VEREDITO, DOC],
    coverage: { total: 2, reviewed: [], missing: [VEREDITO.path, DOC.path] }, alcance: [] };
  lidos = [];
  await e.runHeadlessReview({ ...promocao });
  const decisao = daRodada(e, promocao, 'bbbbbbb2');
  assert.doesNotMatch(motivos(decisao), /cobertura da leitura|uso fora do diff|src\/veredito\.ts|docs\/guia\.md/,
    'sem relê-los, a cobertura e o alcance fecham pela leitura do outro PR');
  const prompt = prompts.at(-1);
  assert.match(prompt, /lidos em outro PR deste repositório/);
  assert.match(prompt, /- src\/veredito\.ts \(lido em acme\/app#51, commit aaaaaaa\)/);
  assert.match(prompt, /- docs\/guia\.md \(lido em acme\/app#51, commit aaaaaaa\)/);
  assert.ok(lidos.some((l) => l.arquivo === 'src/rota.ts' && l.ref === 'bbbbbbb2'), 'o chamador herdado é conferido no head NOVO');
  assert.equal(decisao.provas.cobertura.entrePrs.herdados, 2);
  assert.ok(decisao.provas.cobertura.entrePrs.amostra.includes('src/veredito.ts: lido em acme/app#51, commit aaaaaaa1'),
    'a origem fica nas provas da decisão para auditoria');
  const indice = repoProof.lerIndiceDoRepositorio('acme/app');
  assert.equal(indice[repoProof.chaveDoArquivo(VEREDITO)].pr, origem.key,
    'o PR que herdou não reescreve a origem da leitura');

  // a rodada seguinte do PR que herdou continua dizendo de onde veio a leitura
  assert.deepEqual(fileProof.readFileProof(promocao.key).origens[VEREDITO.path], { pr: origem.key, head: 'aaaaaaa1' });
  rodadas.atual = { ...rodadas.atual, head: 'eeeeeee5' };
  await e.runHeadlessReview({ ...promocao });
  const seguinte = prompts.at(-1);
  assert.match(seguinte, /- src\/veredito\.ts \(lido em acme\/app#51, commit aaaaaaa\)/);
  assert.doesNotMatch(seguinte, /Sua revisão anterior deste PR leu/, 'não finge que a leitura foi deste PR');
});

/* ---------- a leitura antes da sessão ---------- */

const H1 = '1'.repeat(40), H2 = '2'.repeat(40);
function arquivo(p, sha, status = 'modified', patch = '@@ -1 +1 @@\n-x\n+y') {
  return { path: p, sha, status, patch, patchStatus: 'available' };
}
function fonte(head, files) {
  return { status: 'complete', manifest: { H: head, B: 'b'.repeat(40), M: 'c'.repeat(40), files, limitations: [] },
    inventory: { status: 'complete', headSha: head, baseSha: 'b'.repeat(40), files, changedFiles: files.length }, reader: {},
    release: async () => { } };
}
function engineDaLeitura() {
  return { config: { reviewContextMode: 'off' }, activeReviews: new Map([['s1', { mode: 'auto', cancellable: true }]]),
    running: new Map(), decisions: { pending: [], resolved: [] }, log() { }, pushState() { },
    accountForPr: () => ({ user: 'eu' }), ghEnv: () => ({}),
    killTree() { throw new Error('Não deve encerrar processos nesta fixture.'); } };
}
// grava a leitura completa de um PR, como o fim da sessão grava
function revisado(pr, head, files, extra = {}) {
  const arquivos = files.map(({ path: p, sha, status, patch, patchStatus }) => ({ path: p, sha, status, patch, patchStatus }));
  const result = { coverage: { total: arquivos.length, reviewed: arquivos.map((f) => f.path), missing: [] },
    diffMedido: arquivos.map((f) => f.path), sessionId: 'sess-1', ...extra };
  const alcance = fileProof.salvarProvaDaSessao(pr, head, arquivos, result);
  repoProof.registrarNoIndiceDoRepositorio(pr, head, arquivos, result, alcance);
}
async function ler(pr, head, files, eng = engineDaLeitura()) {
  analysis.sourceRuntime.prepareSources = async () => fonte(head, files);
  const leitura = await analysis.prepareReviewReading(eng, pr, 's1', head);
  await analysis.releaseAnalysisSource(leitura.prepared, eng);
  return leitura.inheritance;
}

test('PR novo com um arquivo de blob diferente: só esse vai para leitura', async () => {
  const a = arquivo('src/a.md', 'blob-a'), b = arquivo('src/b.md', 'blob-b'), c = arquivo('src/c.md', 'blob-c');
  revisado({ key: 'org/um#1', repo: 'org/um' }, H1, [a, b, c]);
  const h = await ler({ key: 'org/um#2', repo: 'org/um', number: 2 }, H2, [a, arquivo('src/b.md', 'blob-b2'), c]);
  assert.equal(h.ativa, true);
  assert.deepEqual(h.unchanged.sort(), ['src/a.md', 'src/c.md']);
  assert.deepEqual(h.changed, ['src/b.md']);
  assert.deepEqual(h.origens['src/a.md'], { pr: 'org/um#1', head: H1 });
});

test('mesmo blob em outro repositório, caminho diferente ou blob vazio não herdam', async () => {
  const a = arquivo('src/a.md', 'blob-x');
  revisado({ key: 'org/dois#1', repo: 'org/dois' }, H1, [a]);
  const outroRepo = await ler({ key: 'org/tres#1', repo: 'org/tres', number: 1 }, H2, [a]);
  assert.equal(outroRepo.ativa, false, 'o índice é do repositório: outro repositório não herda');
  assert.deepEqual(outroRepo.unchanged, []);

  // cada repositório tem o seu arquivo: gravar um não apaga o do outro
  revisado({ key: 'org/vizinho#1', repo: 'org/vizinho' }, H1, [arquivo('src/v.md', 'blob-v')]);
  assert.ok(Object.keys(repoProof.lerIndiceDoRepositorio('org/dois')).length, 'o índice de org/dois sobrevive ao de org/vizinho');
  // índice de um repositório no lugar do de outro não empresta leitura: o repositório gravado é conferido
  fs.mkdirSync(path.dirname(repoProof.indiceDoRepositorioPath('org/tres')), { recursive: true });
  fs.copyFileSync(repoProof.indiceDoRepositorioPath('org/dois'), repoProof.indiceDoRepositorioPath('org/tres'));
  assert.deepEqual(repoProof.lerIndiceDoRepositorio('org/tres'), {});
  fs.rmSync(repoProof.indiceDoRepositorioPath('org/tres'));

  const renomeado = await ler({ key: 'org/dois#2', repo: 'org/dois', number: 2 }, H2, [arquivo('src/renomeado.md', 'blob-x', 'renamed')]);
  assert.equal(renomeado.ativa, false, 'caminho diferente não herda, mesmo com o mesmo conteúdo');

  revisado({ key: 'org/dois#3', repo: 'org/dois' }, H1, [arquivo('src/vazio.md', '')]);
  assert.equal(Object.values(repoProof.lerIndiceDoRepositorio('org/dois')).some((e) => e.caminho === 'src/vazio.md'), false, 'blob vazio nem entra no índice');
  const vazio = arquivo('src/vazio.md', '');
  const entradas = { [`:${repoProof.hashDoPatch(vazio.patch)}:src/vazio.md`]: { pr: 'org/dois#9', head: H1, at: Date.now(), status: 'modified' } };
  const puro = repoProof.herancaDoRepositorio({ key: 'org/dois#4' }, [vazio], entradas, []);
  assert.deepEqual(puro.unchanged, [], 'blob vazio nunca prova igualdade');
});

// Revisão independente de 06/11/2026: o que se revisa é o patch contra o merge-base, e ele muda
// entre PRs com o mesmo blob (réplica do GitFlow, promoção com outras tasks na base). A chave é
// caminho, blob E patch, e o status tem de ser igual.
const entrada = (f, extra = {}) => ({ [repoProof.chaveDoArquivo(f)]: { caminho: f.path, pr: 'o/r#1', head: H1, at: Date.now(), status: f.status, ...extra } });

test('mesmo blob com patch diferente não herda: o PR B traz linhas de outras tasks no patch contra a base dele', async () => {
  const lidoEmA = arquivo('src/x.ts', 'blob-x', 'modified', '@@ -10,3 +10,3 @@\n-a\n+b');
  revisado({ key: 'org/nove#1', repo: 'org/nove' }, H1, [lidoEmA]);
  const emB = arquivo('src/x.ts', 'blob-x', 'modified', '@@ -10,3 +10,3 @@\n-a\n+b\n@@ -100,200 +100,200 @@\n-outra\n+task');
  const h = await ler({ key: 'org/nove#2', repo: 'org/nove', number: 2 }, H2, [emB]);
  assert.equal(h.ativa, false);
  assert.deepEqual(h.unchanged, [], 'o patch de B é outro: o arquivo volta a ser lido');
  const igual = await ler({ key: 'org/nove#3', repo: 'org/nove', number: 3 }, H2, [arquivo('src/x.ts', 'blob-x', 'modified', '@@ -10,3 +10,3 @@\n-a\n+b')]);
  assert.deepEqual(igual.unchanged, ['src/x.ts'], 'controle: mesmo blob e mesmo patch herdam');
});

test('status diferente não herda, nem entre added e modified', () => {
  const a = { path: 'src/a.md', sha: 'sa', status: 'modified', patch: 'p', patchStatus: 'available' };
  const h = repoProof.herancaDoRepositorio({ key: 'o/r#2' }, [a], entrada(a, { status: 'added' }), []);
  assert.deepEqual(h.unchanged, []);
  const r = { ...a, status: 'removed' };
  assert.deepEqual(repoProof.herancaDoRepositorio({ key: 'o/r#2' }, [r], entrada(r), []).unchanged, ['src/a.md'], 'controle: status igual herda');
});

test('arquivo sem patch (grande ou binário) ou com patch parcial não herda nem entra no índice', () => {
  const semPatch = { path: 'src/grande.json', sha: 'sg', status: 'modified' };
  const parcial = { path: 'src/parcial.ts', sha: 'sp', status: 'modified', patch: '@@ -1 +1 @@', patchStatus: 'partial' };
  assert.equal(repoProof.chaveDoArquivo(semPatch), '');
  assert.equal(repoProof.chaveDoArquivo(parcial), '');
  const pr = { key: 'org/dez#1', repo: 'org/dez' };
  repoProof.registrarNoIndiceDoRepositorio(pr, H1, [semPatch, parcial], { coverage: { reviewed: [semPatch.path, parcial.path] } }, {});
  assert.deepEqual(repoProof.lerIndiceDoRepositorio('org/dez'), {});
  const forjada = { [`sg::src/grande.json`]: { pr: 'o/r#1', head: H1, at: Date.now(), status: 'modified' },
    [`sg:${repoProof.hashDoPatch('')}:src/grande.json`]: { pr: 'o/r#1', head: H1, at: Date.now(), status: 'modified' } };
  assert.deepEqual(repoProof.herancaDoRepositorio({ key: 'o/r#2' }, [semPatch], forjada, []).unchanged, []);
});

test('a chave carrega o patch: tirar o patch da chave faria o PR B herdar', () => {
  const a = arquivo('src/k.ts', 'blob-k', 'modified', 'patch-a');
  const b = arquivo('src/k.ts', 'blob-k', 'modified', 'patch-b');
  assert.notEqual(repoProof.chaveDoArquivo(a), repoProof.chaveDoArquivo(b));
  assert.ok(repoProof.chaveDoArquivo(a).includes(repoProof.hashDoPatch('patch-a')));
});

test('alcance herdado entre PRs cuja conferência no head novo falha: perde a herança e o arquivo volta a ser lido', async () => {
  const v = arquivo('src/veredito.ts', 'blob-v'), u = arquivo('src/util.ts', 'blob-u'), w = arquivo('src/motivo.ts', 'blob-w');
  const declaracoes = [DECLARACAO,
    { alterado: 'src/util.ts', chamadores: [{ arquivo: 'src/tela.ts', linha: 1, simbolo: 'util' }] },
    { alterado: 'src/motivo.ts', semChamador: 'rota nova, registrada só pelo roteador do framework' }];
  const verificados = [{ arquivo: 'src/rota.ts', linha: 4, simbolo: 'montar', ok: true, motivo: '' },
    { arquivo: 'src/tela.ts', linha: 1, simbolo: 'util', ok: true, motivo: '' }];
  revisado({ key: 'org/quatro#1', repo: 'org/quatro' }, H1, [v, u, w], { alcance: declaracoes, alcanceVerificado: verificados });
  // no head novo o chamador de util deixou de citá-lo; o de veredito continua
  noHead = { [H2]: { 'src/rota.ts': CHAMADOR, 'src/tela.ts': 'export const tela = 1;\n' } };
  lidos = [];
  const h = await ler({ key: 'org/quatro#2', repo: 'org/quatro', number: 2 }, H2, [v, u, w]);
  assert.ok(lidos.every((l) => l.ref === H2), 'a conferência é no head NOVO');
  assert.deepEqual(h.changed, ['src/util.ts'], 'conferência falhou: o arquivo volta a ser lido');
  assert.deepEqual(h.unchanged.sort(), ['src/motivo.ts', 'src/veredito.ts']);
  assert.ok(h.alcance['src/veredito.ts'], 'o alcance que conferiu no head novo vem junto');
  assert.equal(h.alcance['src/motivo.ts'], undefined,
    '"sem uso fora do diff" depende da base do PR novo: a leitura herda, a declaração é refeita');
  assert.equal(h.alcance['src/veredito.ts'].origem.pr, 'org/quatro#1');
});

test('prova própria do PR vence a do índice; no mesmo head fora da rodada complementar nada é herdado', async () => {
  const a = arquivo('src/a.md', 'blob-pa'), b = arquivo('src/b.md', 'blob-pb');
  revisado({ key: 'org/cinco#1', repo: 'org/cinco' }, H1, [a, b]);
  const pr = { key: 'org/cinco#2', repo: 'org/cinco', number: 2 };
  fileProof.saveFileProof(pr.key, { head: 'f'.repeat(40), at: Date.now(), files: [{ path: 'src/a.md', sha: 'blob-pa', status: 'modified' }], reviewed: ['src/a.md'] });
  const h = await ler(pr, H2, [a, b]);
  assert.deepEqual(h.unchanged.sort(), ['src/a.md', 'src/b.md']);
  assert.equal(h.origens['src/a.md'], undefined, 'a.md vem da prova do próprio PR');
  assert.deepEqual(h.origens['src/b.md'], { pr: 'org/cinco#1', head: H1 });

  // a própria sessão do PR 2 no head H2 alimenta o índice; o relançamento no mesmo head é cheio
  revisado(pr, H2, [a, b]);
  const mesmoHead = await ler(pr, H2, [a, b]);
  assert.equal(mesmoHead.ativa, false, 'relançamento no mesmo head não herda nem do índice');
});

test('o índice não serve ao próprio PR que o gravou', () => {
  const a = arquivo('src/a.md', 'sa');
  const h = repoProof.herancaDoRepositorio({ key: 'o/r#7' }, [a], entrada(a, { pr: 'o/r#7' }), []);
  assert.deepEqual(h.unchanged, []);
});

test('o índice só guarda o que a sessão leu: nem o herdado, nem o que ficou em missing, nem fora do diff medido', () => {
  const pr = { key: 'org/seis#1', repo: 'org/seis' };
  const arquivos = [arquivo('src/lido.md', 's1'), arquivo('src/herdado.md', 's2'), arquivo('src/faltou.md', 's3')];
  const result = { coverage: { total: 3, reviewed: ['src/lido.md', 'src/herdado.md', 'src/inventado.md'], missing: ['src/faltou.md'], inherited: ['src/herdado.md'] } };
  repoProof.registrarNoIndiceDoRepositorio(pr, H1, arquivos, result, fileProof.salvarProvaDaSessao(pr, H1, arquivos, result));
  const indice = repoProof.lerIndiceDoRepositorio('org/seis');
  assert.deepEqual(Object.values(indice).map((e) => e.caminho), ['src/lido.md']);
});

test('teto e poda do índice: o velho sai e, acima do teto, ficam as leituras mais recentes', () => {
  const agora = 10 * 24 * 3600 * 1000;
  const entradas = {};
  for (let i = 0; i < 6; i++) entradas[repoProof.chaveDoArquivo(arquivo(`f${i}`, `s${i}`))] = { caminho: `f${i}`, pr: 'o/r#1', head: H1, at: agora - i * 1000, status: 'modified' };
  entradas[repoProof.chaveDoArquivo(arquivo('velho', 'sv'))] = { caminho: 'velho', pr: 'o/r#1', head: H1, at: agora - 5 * 24 * 3600 * 1000, status: 'modified' };
  const podado = repoProof.podarIndice(entradas, { agora, maxAgeMs: 24 * 3600 * 1000, teto: 4 });
  assert.deepEqual(Object.values(podado).map((e) => e.caminho).sort(), ['f0', 'f1', 'f2', 'f3']);

  // a gravação aplica a poda
  const pr = { key: 'org/sete#1', repo: 'org/sete' };
  const arquivos = Array.from({ length: 5 }, (_, i) => arquivo(`src/${i}.md`, `b${i}`));
  repoProof.registrarNoIndiceDoRepositorio(pr, H1, arquivos, { coverage: { reviewed: arquivos.map((f) => f.path) } }, {}, { teto: 3 });
  assert.equal(Object.keys(repoProof.lerIndiceDoRepositorio('org/sete')).length, 3);
});

test('poda do diretório: índice de repositório sem uso há mais que a idade máxima sai inteiro', () => {
  repoProof.registrarNoIndiceDoRepositorio({ key: 'org/oito#1', repo: 'org/oito' }, H1, [arquivo('a.md', 'x', 'added')], { coverage: { reviewed: ['a.md'] } }, {});
  const alvo = repoProof.indiceDoRepositorioPath('org/oito');
  const antigo = new Date(Date.now() - 40 * 24 * 3600 * 1000);
  fs.utimesSync(alvo, antigo, antigo);
  repoProof.pruneIndicesDoRepositorio();
  assert.equal(fs.existsSync(alvo), false);
});

test('o bloco do prompt separa a leitura deste PR da leitura de outro PR, com PR e commit', () => {
  const bloco = fileProof.fileProofBlock({ ativa: true, unchanged: ['src/a.md', 'src/b.md'], changed: ['src/c.md'],
    origens: { 'src/b.md': { pr: 'o/r#1843', head: 'abcdef1234567890' } } }, '9999999aaaa');
  assert.match(bloco, /Sua revisão anterior deste PR leu/);
  assert.match(bloco, /- src\/b\.md \(lido em o\/r#1843, commit abcdef1\)/);
  const soDeOutro = fileProof.fileProofBlock({ ativa: true, unchanged: ['src/b.md'], changed: [],
    origens: { 'src/b.md': { pr: 'o/r#1843', head: 'abcdef1234567890' } } }, undefined);
  assert.doesNotMatch(soDeOutro, /Sua revisão anterior deste PR leu/, 'sem prova própria, o texto não finge leitura deste PR');
});

test('o arquivo do índice tem nome em minúsculas e o repositório gravado é conferido sem caixa', () => {
  const a = arquivo('src/caixa.md', 'blob-caixa');
  repoProof.registrarNoIndiceDoRepositorio({ key: 'Org/Caixa#1', repo: 'Org/Caixa' }, H1, [a], { coverage: { reviewed: [a.path] } }, {});
  assert.equal(path.basename(repoProof.indiceDoRepositorioPath('Org/Caixa')), path.basename(repoProof.indiceDoRepositorioPath('org/caixa')));
  assert.equal(path.basename(repoProof.indiceDoRepositorioPath('Org/Caixa')), `${encodeURIComponent('org/caixa')}.json`);
  assert.ok(repoProof.lerIndiceDoRepositorio('org/caixa')[repoProof.chaveDoArquivo(a)], 'a outra grafia lê o mesmo índice');
});

// Revisão independente de 06/11/2026: o índice entre PRs só recebe a leitura de uma análise que
// pode sustentar decisão. Incompleta, incoerente, com lacuna dura ou cancelada não empresta
// leitura a outro PR; a prova do próprio PR continua sendo gravada como antes.
for (const [nome, extra] of [
  ['análise incompleta', { analysisStatus: 'incomplete', decision: 'needs_decision' }],
  ['lacuna dura (a parte do card deste PR dita não entregue)', { card: 'CARD-1', cardMet: false, cardParteDestePr: false }],
]) {
  test(`${nome}: a leitura não entra no índice entre PRs, e a prova do próprio PR segue gravada`, async () => {
    const pr = { key: 'acme/onze#1', repo: 'acme/onze', number: 1, url: 'https://github.com/acme/onze/pull/1', author: 'dev', requested: true };
    const f = arquivo('src/onze.md', `blob-onze-${nome.length}`);
    const rodadas = { atual: { head: 'ccccccc3', files: [f], coverage: { total: 1, reviewed: [f.path], missing: [] }, alcance: [], extra } };
    const e = motor(rodadas, []);
    await e.runHeadlessReview({ ...pr });
    assert.equal(repoProof.lerIndiceDoRepositorio('acme/onze')[repoProof.chaveDoArquivo(f)], undefined);
    assert.deepEqual(fileProof.readFileProof(pr.key).reviewed, [f.path], 'a prova do PR continua');
  });
}

test('controle: análise completa e sem lacuna dura alimenta o índice entre PRs', async () => {
  const pr = { key: 'acme/doze#1', repo: 'acme/doze', number: 1, url: 'https://github.com/acme/doze/pull/1', author: 'dev', requested: true };
  const f = arquivo('src/doze.md', 'blob-doze');
  const rodadas = { atual: { head: 'ddddddd4', files: [f], coverage: { total: 1, reviewed: [f.path], missing: [] }, alcance: [] } };
  await motor(rodadas, []).runHeadlessReview({ ...pr });
  assert.equal(repoProof.lerIndiceDoRepositorio('acme/doze')[repoProof.chaveDoArquivo(f)].pr, pr.key);
});

test('a guarda do índice: cancelamento, incompleta, incoerente e lacuna exigida ficam de fora', () => {
  const limpo = { analysisStatus: 'complete', approvalEvidence: [], headSha: H1, checksVerifiedHead: H1, diffMedido: [],
    verificationCheckpoint: { total: 0, conflicts: [] }, protocolo: { prReviewer: 'rodou' }, technicalReview: { semDeclaracao: true },
    coverage: { total: 0, reviewed: [], missing: [] } };
  assert.equal(repoProof.podeEntrarNoIndice(limpo), true);
  assert.equal(repoProof.podeEntrarNoIndice({ ...limpo, cancelled: true }), false);
  assert.equal(repoProof.podeEntrarNoIndice({ ...limpo, analysisStatus: 'incomplete' }), false);
  assert.equal(repoProof.podeEntrarNoIndice({ ...limpo, approvalEvidence: ['veredito e texto público incompatíveis com os achados'] }), false);
  assert.equal(repoProof.podeEntrarNoIndice({ ...limpo, approvalEvidence: ['commit revisado não confirmado'] }), false);
  assert.equal(repoProof.podeEntrarNoIndice({ ...limpo, approvalEvidence: ['ci_em_andamento'] }), true, 'CI não diz nada da leitura');
  assert.equal(repoProof.podeEntrarNoIndice({ ...limpo, approvalEvidence: undefined }), false, 'sem a prova da rodada calculada não entra');
});

// Segunda revisão independente de 06/11/2026: a lacuna de qualidade da leitura que vira ressalva
// (protocolo de revisão não comprovado, verificação de afirmações ausente, divergência no
// checkpoint) também barra o índice. Sem isto o PR que herda ficava limpo, sem a ressalva da origem.
test('PR A com protocolo de revisão não comprovado não alimenta o índice, e o PR B não herda', async () => {
  const a = { key: 'acme/treze#1', repo: 'acme/treze', number: 1, url: 'https://github.com/acme/treze/pull/1', author: 'dev', requested: true };
  const f = arquivo('src/treze.md', 'blob-treze');
  const rodadas = { atual: { head: 'fffffff6', files: [f], coverage: { total: 1, reviewed: [f.path], missing: [] }, alcance: [],
    extra: { protocolo: { prReviewer: 'pulado' } } } };
  await motor(rodadas, []).runHeadlessReview({ ...a });
  assert.deepEqual(repoProof.lerIndiceDoRepositorio('acme/treze'), {});
  const h = await ler({ key: 'acme/treze#2', repo: 'acme/treze', number: 2 }, H2, [f]);
  assert.deepEqual(h.unchanged, [], 'o PR B lê o arquivo');
});

test('a guarda do índice tolera só a pendência de cobertura entre as lacunas dispensadas', () => {
  const limpo = { analysisStatus: 'complete', approvalEvidence: [], provaEsgotada: true, headSha: H1, checksVerifiedHead: H1, diffMedido: [],
    verificationCheckpoint: { total: 0, conflicts: [] }, protocolo: { prReviewer: 'rodou' }, technicalReview: { semDeclaracao: true },
    coverage: { total: 0, reviewed: [], missing: [] } };
  assert.equal(repoProof.podeEntrarNoIndice(limpo), true, 'controle');
  assert.equal(repoProof.podeEntrarNoIndice({ ...limpo, protocolo: { prReviewer: 'pulado' } }), false);
  assert.equal(repoProof.podeEntrarNoIndice({ ...limpo, verificationCheckpoint: undefined }), false);
  assert.equal(repoProof.podeEntrarNoIndice({ ...limpo, diffMedido: ['src/a.md'], coverage: { total: 1, reviewed: [], missing: ['src/a.md'] } }), true,
    'cobertura de arquivo é filtrada arquivo a arquivo em lidosNaSessao');
});
