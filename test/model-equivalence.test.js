import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const taskHome = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-model-equivalence-'));
process.env.FAROL_HOME = taskHome;
const { Engine } = await import('../server.js');
const { modeloEquivalente, catalogoParaTela } = await import('../lib/modelos.js');
const { sincronizarModelos } = await import('../lib/model-selection.js');
const { escolheModelo, rotuloOrigem } = await import('../lib/engine/model-router.js');
const { codexArgs, codexSelection } = await import('../lib/codex/stream.js');
const { sanitizeCodexModel } = await import('../lib/parse.js');
const io = (await import('../lib/io.js')).default;
after(() => fs.rmSync(taskHome, { recursive: true, force: true }));

test('pares atuais seguem o perfil de uso; Sol volta para Opus pela qualidade', () => {
  for (const [claude, codex] of [
    ['fable', 'gpt-6-astra'], ['best', 'gpt-6-astra'], ['opus', 'gpt-6.1-sol'],
    ['sonnet', 'gpt-6.1-sol'], ['haiku', 'gpt-6-luna'],
  ]) assert.equal(modeloEquivalente(claude, 'codex'), codex);
  assert.equal(modeloEquivalente('gpt-6-astra', 'claude'), 'fable');
  assert.equal(modeloEquivalente('gpt-6.1-sol', 'claude'), 'opus');
  assert.equal(modeloEquivalente('gpt-6.1-terra', 'claude'), 'sonnet');
  assert.equal(modeloEquivalente('gpt-6-luna', 'claude'), 'haiku');
  assert.equal(modeloEquivalente('claude-opus-5-5', 'codex'), 'gpt-6.1-sol');
});

test('catálogo expõe Auto e todos os modelos atuais do Codex', () => {
  const valores = catalogoParaTela().codex.map((s) => s.valor);
  for (const m of ['auto', 'gpt-6-astra', 'gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-luna']) {
    assert.ok(valores.includes(m));
    assert.equal(sanitizeCodexModel(m), m);
  }
});

test('escolher em qualquer provedor sincroniza o outro e persiste o par', () => {
  const engine = new Engine();
  engine.updateSettings({ reviewModel: 'fable' });
  assert.equal(engine.config.codexReviewModel, 'gpt-6-astra');
  engine.updateSettings({ codexReviewModel: 'gpt-6-luna' });
  assert.equal(engine.config.reviewModel, 'haiku');
  const salvo = JSON.parse(fs.readFileSync(path.join(taskHome, 'config.json'), 'utf8'));
  assert.equal(salvo.reviewModel, 'haiku');
  assert.equal(salvo.codexReviewModel, 'gpt-6-luna');
  engine.updateSettings({ codexReviewModel: 'auto' });
  assert.equal(engine.config.reviewModel, 'auto');
  engine.updateSettings({ reviewModel: '' });
  assert.equal(engine.config.codexReviewModel, '');
});

test('conflito legado no boot respeita o provedor padrão e mantém o ID explícito dele', () => {
  const config = {
    claudeProfiles: [{ id: 'cx', kind: 'codex' }], claudeProfileId: 'cx',
    reviewModel: 'haiku', codexReviewModel: 'gpt-6.1-sol',
  };
  sincronizarModelos(config);
  assert.equal(config.reviewModel, 'opus');
  assert.equal(config.codexReviewModel, 'gpt-6.1-sol');
});

test('escolha explícita Terra sobrevive ao reinício, mesmo com perfil padrão Claude', () => {
  const engine = new Engine();
  engine.updateSettings({ codexReviewModel: 'gpt-6.1-terra' });
  assert.equal(engine.config.reviewModel, 'sonnet');
  const reiniciado = new Engine();
  assert.equal(reiniciado.config.reviewModel, 'sonnet');
  assert.equal(reiniciado.config.codexReviewModel, 'gpt-6.1-terra');
  assert.equal(reiniciado.config.modelSelectionProvider, 'codex');
});

test('patch com os dois modelos independe da ordem dos campos e prioriza provedor padrão', () => {
  for (const patch of [
    { reviewModel: 'haiku', codexReviewModel: 'gpt-6-astra' },
    { codexReviewModel: 'gpt-6-astra', reviewModel: 'haiku' },
  ]) {
    const config = { ...patch, claudeProfiles: [{ id: 'cx', kind: 'codex' }], claudeProfileId: 'cx' };
    sincronizarModelos(config, patch);
    assert.equal(config.reviewModel, 'fable');
  }
});

test('modelo inválido não muda o par; modelo personalizado fica explícito e sinaliza falta de equivalência', () => {
  const config = { reviewModel: 'opus', codexReviewModel: 'gpt-6.1-sol' };
  assert.equal(sincronizarModelos(config, { codexReviewModel: 'opus && calc.exe' }), null);
  assert.equal(config.reviewModel, 'opus');
  config.codexReviewModel = 'gpt-custom';
  assert.equal(sincronizarModelos(config, { codexReviewModel: 'gpt-custom' }).semEquivalente, true);
  assert.equal(config.reviewModel, 'opus');
  assert.equal(config.codexReviewModel, 'gpt-custom');
});

const autoConfig = {
  reviewModel: 'auto', codexReviewModel: 'auto', reviewEffort: 'low',
  codexReviewEffort: 'minimal', reviewFast: true,
};

test('Auto mantém Opus/Sol em todo tamanho, inclusive sem métricas, sem esforço baixo nem fast', () => {
  for (const metrics of [null, { lines: 1, changedFiles: 1 }, { lines: 400, changedFiles: 10 }, { lines: 5000, changedFiles: 80 }]) {
    const cfg = { ...autoConfig, autoOpus: { caminhosSensiveis: [], prMuitoGrande: false } };
    const claude = escolheModelo(metrics, cfg);
    const codex = escolheModelo(metrics, cfg, { provedor: 'codex' });
    assert.equal(claude.model, 'opus');
    assert.equal(codex.model, 'gpt-6.1-sol');
    assert.equal(codex.effort, claude.effort);
    assert.equal(codex.fast, false);
    const args = codexArgs(cfg, codex);
    assert.equal(args[args.indexOf('--model') + 1], 'gpt-6.1-sol');
    assert.equal(args.some((a) => a.includes('minimal') || a.includes('low')), false);
    assert.doesNotMatch(rotuloOrigem(codex.origem, null, 'codex'), /opus/i);
  }
});

test('Auto no Codex transmite xhigh ao CLI em cada gatilho de risco', () => {
  for (const [metrics, extra, ctx] of [
    [null, { reposCriticos: ['org/repo'] }, { repo: 'org/repo' }],
    [{ lines: 2, changedFiles: 1, files: [{ path: 'src/auth/login.js' }] }, {}, {}],
    [{ lines: 1000, changedFiles: 1 }, { caminhosSensiveis: [] }, {}],
  ]) {
    const cfg = { ...autoConfig, autoOpus: extra };
    const rota = escolheModelo(metrics, cfg, { ...ctx, provedor: 'codex' });
    assert.equal(rota.origem, 'auto-contexto');
    assert.equal(rota.effort, 'xhigh');
    assert.equal(rota.fast, false);
    assert.ok(codexArgs(cfg, rota).includes('model_reasoning_effort="xhigh"'));
    assert.match(rotuloOrigem(rota.origem, rota.gatilho, 'codex'), /gpt-6.1-sol com esforço xhigh/);
  }
});

test('modelo fixo Codex respeita sua seleção e esforço apesar do contexto sensível', () => {
  const cfg = { ...autoConfig, codexReviewModel: 'gpt-6-astra', codexReviewEffort: 'high', reviewFast: false };
  const rota = escolheModelo({ lines: 5000, changedFiles: 30 }, cfg, { provedor: 'codex' });
  assert.equal(rota.model, 'gpt-6-astra');
  assert.equal(rota.effort, 'high');
  assert.equal(rota.origem, 'config');
});

test('Auto fora da revisão não manda auto ou esforço fixo ao Codex; override errado é descartado', () => {
  assert.deepEqual(codexSelection(autoConfig), { model: '', effort: '' });
  const args = codexArgs(autoConfig);
  assert.equal(args.includes('auto'), false);
  assert.equal(args.some((a) => a.includes('minimal')), false);
  assert.equal(codexSelection({}, { model: 'opus && calc.exe' }).model, '');
});

test('revisão real resolve Codex pela conta do PR e passa a rota sensível à sessão', async () => {
  const runOriginal = io.run;
  const arquivo = 'src/auth/token.js';
  io.run = async (_cmd, args = []) => {
    const consulta = args.join(' ');
    if (consulta.includes('{headSha:')) return { ok: true, stdout: JSON.stringify({ headSha: 'a'.repeat(40), baseSha: 'b'.repeat(40), changedFiles: 1 }) };
    if (consulta.includes('/pulls/9/files')) return { ok: true, stdout: JSON.stringify([{ path: arquivo, sha: 'c'.repeat(40), status: 'modified', lines: 3 }]) };
    return { ok: true, stdout: '[]' };
  };
  try {
    const e = new Engine();
    Object.assign(e.config, autoConfig, {
      claudeProfiles: [{ id: 'cx', kind: 'codex', label: 'Codex' }], claudeProfileId: '',
      accounts: [{ user: 'eu', owners: ['acme'], claudeProfileId: 'cx' }],
    });
    e.tokens = { eu: 'token-falso' };
    e.headSha = async () => 'a'.repeat(40);
    e.myReviewStates = async () => [];
    e.pushState = () => {};
    e.log = () => {};
    let recebido;
    e.runClaudeStream = async (_prompt, opts) => {
      recebido = opts;
      throw new Error('fim da captura local da seleção');
    };
    await assert.rejects(e.runHeadlessReview({ key: 'acme/app#9', repo: 'acme/app', number: 9, url: 'https://github.com/acme/app/pull/9', title: 'PR', author: 'dev', requested: true }), /fim da captura local/);
    assert.ok(recebido, 'a revisão precisa alcançar a fronteira da sessão');
    assert.equal(recebido.account, 'eu');
    assert.equal(recebido.model, 'gpt-6.1-sol');
    assert.equal(recebido.effort, 'xhigh');
    assert.equal(recebido.fast, false);
    assert.equal(recebido.modelRoutes.claude.model, 'opus');
    assert.equal(recebido.modelRoutes.codex.model, 'gpt-6.1-sol');
    assert.equal(recebido.modelRoutes.codex.effort, 'xhigh');
  } finally {
    io.run = runOriginal;
  }
});
