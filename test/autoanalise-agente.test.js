// Autoanálise pedida por um agente (issue #346): pedir, ler e listar. As recusas acontecem
// antes de qualquer sessão de IA, e as três funções só leem o engine e, no caminho feliz,
// chamam o lançamento da autoanálise no modo restrito. Nada escreve no GitHub nem no git.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-autoanalise-agente-'));
process.env.FAROL_HOME = HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const { pedir, ler, listar } = await import('../lib/engine/autoanalise-agente.js');

after(() => { fs.rmSync(HOME, { recursive: true, force: true }); });

const URL_PR = 'https://github.com/acme/app/pull/7';
const HEAD = 'a'.repeat(40);

function prMeu(extra = {}) {
  return { key: 'acme/app#7', url: URL_PR, title: 'Ajuste', author: 'Dona', repo: 'acme/app', number: 7, account: 'dona', headSha: HEAD, ...extra };
}

function analise(extra = {}) {
  return { key: 'acme/app#7', at: 1000, headSha: HEAD, verdict: 'needs_work', summary: 'falta teste',
    blockers: ['falta teste em lib/x.js:10'], externalBlockers: [], tips: ['nome melhor'], reportMarkdown: '- 🔴 falta teste · [lib/x.js:10](u)', ...extra };
}

// Engine falso que registra todo membro acessado: a prova de que as funções só leem e só
// lançam a autoanálise restrita, sem tocar em nada que posta, mergeia ou pede revisão.
function engineFalso({ myPRs = [prMeu()], selfAnalyses = {}, owners = ['ACME'], gasto = {}, fila = [], ativas = [] } = {}) {
  const lancadas = [];
  const alvo = {
    myPRs, selfAnalyses, headlessQueue: fila, activeReviews: new Map(ativas.map((s, i) => [`s${i}`, s])),
    accountForPr: (pr) => pr.account,
    accountList: () => [{ user: 'dona', owners }],
    grupoSegura: () => gasto.grupo === true,
    limiteDoPlanoAte: () => gasto.limite || 0,
    budgetBlockedFor: () => gasto.orcamento || null,
    quotaBlockedFor: () => gasto.cota || null,
    launchSelfAnalysis: async (url, isolation) => { lancadas.push({ url, isolation }); return { ok: true, isolation }; },
  };
  const acessos = new Set();
  const engine = new Proxy(alvo, { get(t, nome) { acessos.add(nome); return t[nome]; } });
  return { engine, lancadas, acessos };
}

const LEITURAS_PERMITIDAS = new Set(['myPRs', 'selfAnalyses', 'headlessQueue', 'activeReviews', 'accountForPr', 'accountList',
  'grupoSegura', 'limiteDoPlanoAte', 'budgetBlockedFor', 'quotaBlockedFor', 'launchSelfAnalysis']);

test('pedido válido lança a autoanálise no modo restrito e só toca membros de leitura', async () => {
  const { engine, lancadas, acessos } = engineFalso();
  const r = await pedir(engine, URL_PR);
  assert.equal(r.ok, true);
  assert.deepEqual(lancadas, [{ url: URL_PR, isolation: 'restricted-read' }]);
  ler(engine, URL_PR);
  listar(engine);
  const fora = [...acessos].filter(n => typeof n === 'string' && !LEITURAS_PERMITIDAS.has(n));
  assert.deepEqual(fora, [], 'nada além de leitura e do lançamento restrito');
});

const RECUSAS = [
  ['PR fora da lista de PRs meus', { myPRs: [] }, 'pr_fora_do_escopo'],
  ['PR de outro autor', { myPRs: [prMeu({ author: 'outra' })] }, 'pr_fora_do_escopo'],
  ['dono não monitorado', { owners: ['outra-org'] }, 'pr_fora_do_escopo'],
  ['conta sem dono monitorado', { owners: [] }, 'pr_fora_do_escopo'],
  ['já na fila', { fila: [{ kind: 'self', key: 'acme/app#7' }] }, 'em_andamento'],
  ['já rodando', { ativas: [{ mode: 'self', keys: ['acme/app#7'] }] }, 'em_andamento'],
  ['pronta no mesmo head', { selfAnalyses: { 'acme/app#7': analise() } }, 'ja_analisado_neste_head'],
  ['head atual desconhecido com análise existente', { myPRs: [prMeu({ headSha: '' })], selfAnalyses: { 'acme/app#7': analise() } }, 'head_desconhecido'],
  ['teto do grupo em espera', { gasto: { grupo: true } }, 'grupo_em_espera'],
  ['limite do plano', { gasto: { limite: 5000 } }, 'limite_do_plano'],
  ['orçamento estourado', { gasto: { orcamento: { id: 'p1', label: 'Pessoal' } } }, 'orcamento'],
  ['cota reservada', { gasto: { cota: { profile: { label: 'Pessoal' } } } }, 'cota'],
];

for (const [nome, cenario, code] of RECUSAS) {
  test(`recusa antes de qualquer sessão: ${nome}`, async () => {
    const { engine, lancadas } = engineFalso(cenario);
    const r = await pedir(engine, URL_PR);
    assert.equal(r.ok, false);
    assert.equal(r.code, code);
    assert.ok(r.motivo, 'a recusa diz o motivo');
    assert.deepEqual(lancadas, [], 'nenhuma sessão lançada');
  });
}

test('orçamento estourado diz qual perfil', async () => {
  const { engine } = engineFalso({ gasto: { orcamento: { id: 'p1', label: 'Pessoal' } } });
  assert.match((await pedir(engine, URL_PR)).motivo, /Pessoal/);
});

test('análise desatualizada ou de head diferente pode ser pedida de novo', async () => {
  for (const a of [analise({ observed: { stale: true } }), analise({ headSha: 'b'.repeat(40) })]) {
    const { engine, lancadas } = engineFalso({ selfAnalyses: { 'acme/app#7': a } });
    assert.equal((await pedir(engine, URL_PR)).ok, true);
    assert.equal(lancadas.length, 1);
  }
});

test('ler devolve estado, veredito, itens, dicas, relatório e o head analisado', () => {
  const { engine } = engineFalso({ selfAnalyses: { 'acme/app#7': analise() } });
  const r = ler(engine, URL_PR);
  assert.equal(r.ok, true);
  assert.equal(r.estado, 'pronta');
  assert.equal(r.veredito, 'needs_work');
  assert.equal(r.aprovavel, false);
  assert.deepEqual(r.itens, ['falta teste em lib/x.js:10']);
  assert.deepEqual(r.dicas, ['nome melhor']);
  assert.match(r.relatorio, /lib\/x\.js:10/);
  assert.equal(r.headAnalisado, HEAD);
  assert.equal(r.analisadoEm, 1000);
  assert.equal(r.desatualizado, false);
});

test('commit novo no PR marca o veredito anterior como desatualizado na leitura', () => {
  const novo = 'c'.repeat(40);
  const { engine } = engineFalso({ myPRs: [prMeu({ headSha: novo })], selfAnalyses: { 'acme/app#7': analise() } });
  const r = ler(engine, URL_PR);
  assert.equal(r.desatualizado, true);
  assert.equal(r.headAtual, novo);
  assert.equal(r.headAnalisado, HEAD);
});

test('desatualizado: carimbo do motor vale; sem head atual não se sabe; análise sem head vale como desatualizada', () => {
  const casos = [
    [prMeu({ headSha: '' }), analise({ observed: { stale: true } }), true],
    [prMeu({ headSha: '' }), analise(), null],
    [prMeu(), analise({ headSha: null }), true],
  ];
  for (const [pr, a, esperado] of casos) {
    const { engine } = engineFalso({ myPRs: [pr], selfAnalyses: { 'acme/app#7': a } });
    assert.equal(ler(engine, URL_PR).desatualizado, esperado);
  }
});

test('registro antigo sem campos sai com o vazio do mesmo tipo, nunca undefined', () => {
  const { engine } = engineFalso({ myPRs: [prMeu({ title: undefined })], selfAnalyses: { 'acme/app#7': {} } });
  const r = ler(engine, URL_PR);
  assert.equal(r.titulo, '');
  assert.deepEqual([r.veredito, r.resumo, r.itens, r.itensForaDoPr, r.dicas, r.relatorio, r.headAnalisado, r.analisadoEm],
    [null, '', [], [], [], '', null, null]);
  assert.equal(r.desatualizado, true, 'sem head registrado não prova que vale para o commit atual');
});

test('revisão oficial do mesmo PR, ou autoanálise de outro PR, não conta como autoanálise em andamento', async () => {
  const { engine, lancadas } = engineFalso({
    fila: [{ kind: 'review', key: 'acme/app#7' }, { kind: 'self', key: 'outra/app#1' }],
    ativas: [{ mode: 'auto', keys: ['acme/app#7'] }, { mode: 'self', keys: ['outra/app#1'] }],
  });
  assert.equal(ler(engine, URL_PR).estado, 'sem_analise');
  assert.equal((await pedir(engine, URL_PR)).ok, true);
  assert.equal(lancadas.length, 1);
});

test('ler diz na fila, rodando ou sem análise, e recusa PR fora do escopo', () => {
  assert.equal(ler(engineFalso({ fila: [{ kind: 'self', key: 'acme/app#7' }] }).engine, URL_PR).estado, 'na_fila');
  assert.equal(ler(engineFalso({ ativas: [{ mode: 'self', keys: ['acme/app#7'] }] }).engine, URL_PR).estado, 'rodando');
  const sem = ler(engineFalso().engine, URL_PR);
  assert.equal(sem.estado, 'sem_analise');
  assert.equal(sem.veredito, undefined);
  assert.equal(ler(engineFalso({ owners: ['x'] }).engine, URL_PR).code, 'pr_fora_do_escopo');
});

test('listar traz só os PRs no escopo, com o último veredito e o head, sem o relatório', () => {
  const outro = prMeu({ key: 'outra/repo#1', url: 'https://github.com/outra/repo/pull/1', repo: 'outra/repo' });
  const { engine } = engineFalso({ myPRs: [prMeu(), outro], selfAnalyses: { 'acme/app#7': analise() } });
  const r = listar(engine);
  assert.equal(r.ok, true);
  assert.deepEqual(r.prs.map(p => p.key), ['acme/app#7']);
  assert.equal(r.prs[0].veredito, 'needs_work');
  assert.equal(r.prs[0].headAnalisado, HEAD);
  assert.equal(r.prs[0].relatorio, undefined);
});

test('o módulo não importa executor de processo (nada roda gh nem git)', () => {
  const fonte = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'engine', 'autoanalise-agente.js'), 'utf8');
  assert.doesNotMatch(fonte, /child_process|\brun\b|io\.js/);
});
