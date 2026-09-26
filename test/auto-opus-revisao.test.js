// O Auto pelo contexto do PR, na revisão de verdade (25/09/2026; qualidade primeiro desde 26/09/2026).
//
// O roteador é puro e tem os próprios testes (model-router.test.js). Aqui se prova a
// FIAÇÃO: o repositório do PR da fila chega ao roteador, o modelo escolhido é o que vai
// para a sessão, e a atividade da revisão diz qual gatilho subiu o PR. Sem isto o roteador
// podia estar certo e a revisão nunca receber o repositório.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = path.join(os.tmpdir(), 'farol-test-auto-opus-' + process.pid);
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

// o gh é a fronteira de rede: a medição do PR devolve os arquivos que cada teste escolhe
const io = (await import('../lib/io.js')).default;
const runReal = io.run;
let arquivos = [];
io.run = function runDuble(cmd, args) {
  const sub = (args || []).join(' ');
  if (sub.includes('additions,deletions,changedFiles,files')) {
    const files = arquivos.map((p) => ({ path: p, additions: 5, deletions: 5 }));
    return Promise.resolve({ ok: true, stdout: JSON.stringify({ additions: 5 * files.length, deletions: 5 * files.length, changedFiles: files.length, files }), stderr: '' });
  }
  if (/pulls\/\d+\/reviews/.test(sub) && sub.includes('--jq')) return Promise.resolve({ ok: true, stdout: '[]', stderr: '' });
  return Promise.resolve({ ok: true, stdout: '', stderr: '' });
};

const { Engine } = await import('../server.js');

after(() => {
  io.run = runReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});

function motor(autoOpus) {
  const e = new Engine();
  e.token = 'token-falso';
  e.tokens = { eu: 'token-falso' };
  e.config.accounts = [{ user: 'eu', owners: ['acme'] }];
  e.config.reviewModel = 'auto';
  e.config.autoOpus = autoOpus;
  e.saveDecisions = () => { };
  e.pushState = () => { };
  e.refreshTokens = async () => { };
  e.log = () => { };
  e.on('toast', () => { });
  e.atividades = [];
  const push = e.pushActivity.bind(e);
  e.pushActivity = (id, tipo, texto) => { e.atividades.push(texto); return push(id, tipo, texto); };
  e.sessoes = [];
  e.runClaudeStream = async (_prompt, opts) => {
    e.sessoes.push({ model: opts.model, effort: opts.effort, fast: opts.fast });
    return { text: JSON.stringify({ analysisStatus: 'complete', verdict: 'comment', decision: 'manual', cardMet: true, reasons: [], payloads: {}, reportMarkdown: '# ok' }), sessionId: 's1' };
  };
  return e;
}

function pr(n, repo = 'acme/app') {
  return { key: `${repo}#${n}`, repo, number: n, url: `https://github.com/${repo}/pull/${n}`, title: 'PR', author: 'dev', requested: true };
}

test('repositório crítico: a sessão roda no Opus com raciocínio xhigh e a atividade diz por quê', async () => {
  arquivos = ['src/a.js'];
  const e = motor({ reposCriticos: ['acme/infra'] });
  await e.runHeadlessReview(pr(1, 'acme/infra'));
  assert.deepEqual(e.sessoes[0], { model: 'opus', effort: 'xhigh', fast: false });
  assert.ok(e.atividades.some((t) => t.includes('auto: repositório crítico acme/infra, opus com esforço xhigh')), e.atividades.join(' | '));
});

test('caminho sensível da lista inicial, sem config: Opus, com o arquivo citado', async () => {
  arquivos = ['src/a.js', 'k8s/deploy.yaml'];
  const e = motor(undefined);
  await e.runHeadlessReview(pr(2));
  assert.equal(e.sessoes[0].model, 'opus');
  assert.ok(e.atividades.some((t) => t.includes('auto: caminho sensível k8s/deploy.yaml, opus')), e.atividades.join(' | '));
});

test('sem gatilho, o PR médio fica no Opus fixo: nunca abaixo dele (26/09/2026)', async () => {
  arquivos = ['src/a.js', 'src/b.js'];
  const e = motor({ reposCriticos: ['acme/infra'] });
  await e.runHeadlessReview(pr(3));
  assert.deepEqual(e.sessoes[0], { model: 'opus', effort: '', fast: false });
});
