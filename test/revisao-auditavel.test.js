// Duas correções de 03/10/2026, depois de uma análise externa do Farol:
//   1. o que só uma pessoa decide (segurança, produto, escopo além do card) chega ao texto
//      público do APPROVE (num PR de infraestrutura, a revisão escreveu "é uma decisão de
//      segurança e produto" só no relatório interno, e quem mergeou leu só o texto público);
//   2. a decisão guarda o que a sustentou (decision, cobertura, alcance, checks, protocolo):
//      nenhuma das 60 aprovações automáticas desde 30/09 preservava esses campos.
// E o prompt da revisão deixa de prometer travas que a configuração pode ter desligado.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = path.join(os.tmpdir(), 'farol-test-auditavel-' + process.pid);
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { Engine } = await import('../server.js');
const { parseEnvelope, parseHeadlessResult } = await import('../lib/engine/session.js');
const { incorporarParaQuemMergeia, itensParaQuemMergeia } = await import('../lib/engine/para-quem-mergeia.js');
const { provasDaDecisao } = await import('../lib/engine/provas-da-decisao.js');
const { publicReviewLanguageIssues } = await import('../lib/engine/public-review.js');
const { attentionPoints } = await import('../lib/engine/ressalvas.js');

after(() => { try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const PONTO = 'Liga em produção a criação de identidade sem passo humano: é uma decisão de segurança e de produto.';
const envelope = (extra = {}) => ({
  decision: 'needs_decision', verdict: 'approve', analysisStatus: 'complete', cardMet: true, reasons: [],
  reportMarkdown: 'relatório interno',
  payloads: { approve: { event: 'APPROVE', body: 'A chave está certa. Tenho dois pontos, nenhum segura o merge.', comments: [] } },
  ...extra,
});

/* ---------- 1. o que só uma pessoa decide chega ao texto público ---------- */

test('1: o ponto entra no corpo do APPROVE, na voz do revisor, uma vez só', () => {
  const r = envelope({ paraQuemMergeia: [PONTO] });
  assert.equal(incorporarParaQuemMergeia(r), 1);
  assert.equal(r.payloads.approve.body,
    `A chave está certa. Tenho dois pontos, nenhum segura o merge.\n\nFica para quem decide o merge, porque não é questão de código:\n- ${PONTO}`);
  assert.equal(incorporarParaQuemMergeia(r), 0, 'rodar de novo não duplica');
  assert.equal(r.payloads.approve.body.split(PONTO).length, 2);
});

test('1: o texto anexado passa no firewall de linguagem pública', () => {
  const r = envelope({ paraQuemMergeia: [PONTO] });
  incorporarParaQuemMergeia(r);
  assert.deepEqual(publicReviewLanguageIssues(r.payloads.approve, 'eu'), []);
});

test('1: o que a sessão já escreveu no corpo não repete; lista vazia, ausente ou torta não mexe', () => {
  const ja = envelope({ paraQuemMergeia: [PONTO] });
  ja.payloads.approve.body += `\n\n${PONTO}`;
  const antes = ja.payloads.approve.body;
  assert.equal(incorporarParaQuemMergeia(ja), 0);
  assert.equal(ja.payloads.approve.body, antes);
  for (const valor of [[], undefined, 'texto solto', [7, null, '  ']]) {
    const r = envelope(valor === undefined ? {} : { paraQuemMergeia: valor });
    assert.equal(incorporarParaQuemMergeia(r), 0, JSON.stringify(valor));
  }
  assert.deepEqual(itensParaQuemMergeia({ paraQuemMergeia: Array(9).fill('x') }).length, 5, 'teto de itens');
});

test('1: só o APPROVE recebe; pedido de mudanças já segura o merge por si', () => {
  const r = envelope({ paraQuemMergeia: [PONTO], payloads: { request_changes: { event: 'REQUEST_CHANGES', body: 'bloqueio', comments: [] } } });
  assert.equal(incorporarParaQuemMergeia(r), 0);
  assert.equal(r.payloads.request_changes.body, 'bloqueio');
});

test('1: vale em todo caminho que lê o envelope (o parseHeadlessResult anexa)', () => {
  const engine = { parseEnvelope: (raw) => parseEnvelope(null, raw) };
  const lido = parseHeadlessResult(engine, JSON.stringify(envelope({ paraQuemMergeia: [PONTO] })));
  assert.match(lido.payloads.approve.body, /Fica para quem decide o merge, porque não é questão de código:\n- Liga em produção/);
  const sem = parseHeadlessResult(engine, JSON.stringify(envelope()));
  assert.equal('paraQuemMergeia' in sem, false, 'envelope sem o campo continua sem ele');
});

test('1: e fica visível no app como ressalva', () => {
  const pts = attentionPoints(null, envelope({ paraQuemMergeia: [PONTO] }));
  assert.ok(pts.some((p) => p.text === `Para quem decide o merge (vai no texto do review): ${PONTO}`));
});

/* ---------- 2. a decisão guarda o que a sustentou ---------- */

test('2: provasDaDecisao resume decision, cobertura, alcance, checks, protocolo e o que foi para quem mergeia', () => {
  const p = provasDaDecisao(envelope({
    coverage: { total: ['a.ts', 'b.ts', 'c.ts'], reviewed: ['a.ts'], missing: ['b.ts', 'c.ts'] },
    alcance: [{ alterado: 'a.ts', chamadores: [], semChamador: 'arquivo novo sem consumidor ainda' }],
    checksObrigatorios: [{ nome: 'typecheck', estado: 'vermelho' }],
    dependenciasAbertas: ['acme/infra#9 aberto'],
    paraQuemMergeia: [PONTO],
    protocolo: { prReviewer: 'dispensado', motivo: 'diff só de configuração' },
  }));
  assert.equal(p.decision, 'needs_decision');
  assert.deepEqual([p.cobertura.total, p.cobertura.lidos, p.cobertura.faltando], [3, 1, 2]);
  assert.ok(p.cobertura.lacunas >= 2, 'as lacunas vêm do mesmo coverageGap do gate');
  assert.ok(p.cobertura.amostra.length <= 10);
  assert.deepEqual(p.alcance, { declarados: 1 });
  assert.deepEqual(p.checksNaoVerdes, ['typecheck:vermelho']);
  assert.deepEqual(p.dependenciasAbertas, ['acme/infra#9 aberto']);
  assert.deepEqual(p.paraQuemMergeia, [PONTO]);
  assert.deepEqual(p.protocolo, { prReviewer: 'dispensado', motivo: 'diff só de configuração' });
});

test('2: protocolo omitido ou com valor fora da lista vira "nao_declarado", nunca "rodou"', () => {
  assert.equal(provasDaDecisao(envelope()).protocolo.prReviewer, 'nao_declarado');
  assert.equal(provasDaDecisao(envelope({ protocolo: { prReviewer: 'sim' } })).protocolo.prReviewer, 'nao_declarado');
  assert.equal(provasDaDecisao(envelope({ protocolo: { prReviewer: 'rodou' } })).protocolo.prReviewer, 'rodou');
  assert.equal(provasDaDecisao(envelope()).checksNaoVerdes, null, 'sem leitura de checks é null, não "tudo verde"');
});

test('2: o recordDecision grava as provas na decisão', () => {
  const e = new Engine();
  e.decisions = { pending: [], resolved: [] };
  e.saveDecisions = () => { };
  e.pushState = () => { };
  const pr = { key: 'acme/app#1', repo: 'acme/app', number: 1, url: 'https://github.com/acme/app/pull/1', title: 't', author: 'dev' };
  const item = e.recordDecision(pr, envelope({ protocolo: { prReviewer: 'rodou' }, checksObrigatorios: [] }), { status: 'auto_approved', action: 'approve' });
  assert.equal(item.provas.decision, 'needs_decision');
  assert.equal(item.provas.protocolo.prReviewer, 'rodou');
  assert.deepEqual(item.provas.checksNaoVerdes, []);
});

/* ---------- o prompt não promete trava que a configuração pode ter desligado ---------- */

test('o prompt da revisão não promete mais travas que podem estar desligadas, e pede os campos novos', () => {
  const prompt = fs.readFileSync(path.join(import.meta.dirname, '..', 'workspace-template', 'prompts', 'pr-review-auto.md'), 'utf8');
  for (const falsa of [
    'segura a aprovação enquanto um obrigatório estiver rodando',
    'é motivo pra decisão humana, e o app cuida disso sozinho',
    'O app não posta APPROVE com obrigatório vermelho em nenhuma política',
  ]) assert.equal(prompt.includes(falsa), false, falsa);
  assert.match(prompt, /"paraQuemMergeia": \[/);
  assert.match(prompt, /"protocolo": \{ "prReviewer": "rodou" \| "dispensado"/);
});
