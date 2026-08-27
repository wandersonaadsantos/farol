// Modelo e esforço das sessões autônomas: saneamento (lib/parse) e montagem da linha de
// comando (lib/engine/session.buildModelFlags). Runner nativo do Node, ZERO dependências.
//
// Por que este arquivo existe: estes são os ÚNICOS valores de configuração que entram na
// linha de comando montada por concatenação e passada a um shell. Até a v2.27.0 a
// montagem morava dentro do runClaudeStream, que faz spawn, e o stub suprimia a flag, ou
// seja: era impossível provar o que ia pra linha. Extrair a função pura resolveu isso.
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-model-' + process.pid);

import { test } from 'node:test';
import assert from 'node:assert/strict';
const {
  sanitizeModel, sanitizeEffort, sanitizeCodexEffort, sanitizeClaudeModel,
  effortForModel, MODEL_ALIASES, EFFORT_LEVELS, CODEX_EFFORT_LEVELS,
} = await import('../lib/parse.js');
const { buildModelFlags } = await import('../lib/engine/session.js');
const { codexSelection, codexArgs } = await import('../lib/codex/stream.js');
const { modelLabel } = await import('../lib/format.js');

/* ---------- sanitizeModel ---------- */

test('sanitizeModel: vazio e os aliases expostos passam', () => {
  assert.equal(sanitizeModel(''), '');
  assert.equal(sanitizeModel(null), '');
  assert.equal(sanitizeModel(undefined), '');
  for (const a of MODEL_ALIASES) assert.equal(sanitizeModel(a), a, `alias ${a}`);
});

test('sanitizeModel: normaliza espaço e caixa', () => {
  assert.equal(sanitizeModel('  SONNET '), 'sonnet');
  assert.equal(sanitizeModel('Opus'), 'opus');
});

test('sanitizeModel: alias fora da lista é rejeitado', () => {
  // opusplan: `claude -p` não tem plan mode, a sessão inteira cairia pra Sonnet
  assert.equal(sanitizeModel('opusplan'), null);
  // default: indistinguível de '' porque o Farol nunca seta ANTHROPIC_MODEL
  assert.equal(sanitizeModel('default'), null);
});

test('sanitizeModel: auto é alias do Farol (roteador), não do CLI', () => {
  assert.equal(sanitizeModel('auto'), 'auto');
  assert.equal(sanitizeClaudeModel('auto'), 'auto', 'persiste na config');
});

test('sanitizeModel: rejeita metacaractere de shell (injeção)', () => {
  // este é o teste que importa: o valor vai pra uma string passada a cmd.exe / /bin/sh
  for (const mau of [
    'opus && calc.exe',
    'opus; rm -rf /',
    'opus`id`',
    'opus$(id)',
    'opus | tee /tmp/x',
    'opus > /tmp/x',
    'opus\nrm -rf /',
    'opus "quebra"',
    "opus 'quebra'",
    'opus[1m]',        // colchete é glob pro /bin/sh, casaria com um arquivo `opus1`
    'sonnet[1m]',
  ]) {
    assert.equal(sanitizeModel(mau), null, `deveria rejeitar: ${JSON.stringify(mau)}`);
  }
});

test('sanitizeModel: aceita nome completo validado (escotilha pra modelo novo)', () => {
  assert.equal(sanitizeModel('claude-opus-5'), 'claude-opus-5');
  assert.equal(sanitizeModel('claude-haiku-4-5-20251001'), 'claude-haiku-4-5-20251001');
  assert.equal(sanitizeModel('gpt-4o'), 'gpt-4o');
  assert.equal(sanitizeModel('gpt-5.5'), 'gpt-5.5');
  // e só o que casa a regex estrita
  assert.equal(sanitizeModel('claude-opus-5; whoami'), null);
  assert.equal(sanitizeModel('gpt-5.5; whoami'), null);
  assert.equal(sanitizeModel('claude opus'), null);
  assert.equal(sanitizeModel('opus-5'), null, 'sem o prefixo claude- não passa');
  assert.equal(sanitizeModel('claude-' + 'a'.repeat(80)), null, 'teto de tamanho');
});

/* ---------- sanitizeEffort ---------- */

test('sanitizeEffort: vazio e os níveis dos dois CLIs passam', () => {
  assert.equal(sanitizeEffort(''), '');
  assert.equal(sanitizeEffort(null), '');
  for (const n of EFFORT_LEVELS) assert.equal(sanitizeEffort(n), n, `nível ${n}`);
  assert.deepEqual(EFFORT_LEVELS, ['low', 'medium', 'high', 'xhigh']);
  assert.deepEqual(CODEX_EFFORT_LEVELS, ['minimal', 'low', 'medium', 'high', 'xhigh']);
  assert.equal(sanitizeEffort('minimal'), 'minimal');
});

test('sanitizeEffort: normaliza espaço e caixa', () => {
  assert.equal(sanitizeEffort('  HIGH '), 'high');
});

test('sanitizeCodexEffort acompanha a allowlist do config-reference do Codex CLI', () => {
  assert.equal(sanitizeCodexEffort('minimal'), 'minimal');
  assert.equal(sanitizeCodexEffort('xhigh'), 'xhigh');
  assert.equal(sanitizeEffort('max'), null);
  assert.equal(sanitizeEffort('ultra'), null);
  assert.equal(sanitizeEffort('ultracode'), null);
  assert.equal(sanitizeEffort('auto'), null);
  assert.equal(sanitizeEffort('high;id'), null);
  assert.equal(sanitizeEffort('altíssimo'), null);
});

/* ---------- effortForModel ---------- */

test('effortForModel: Haiku nunca leva esforço', () => {
  // nenhum Haiku aparece na matriz de esforço do CLI
  assert.equal(effortForModel('haiku', 'xhigh'), '');
  assert.equal(effortForModel('haiku', 'low'), '');
});

test('effortForModel: nos demais o nível passa (o CLI decide o resto)', () => {
  assert.equal(effortForModel('opus', 'xhigh'), 'xhigh');
  assert.equal(effortForModel('sonnet', 'low'), 'low');
  assert.equal(effortForModel('fable', 'high'), 'high');
  assert.equal(effortForModel('', 'high'), 'high', 'sem modelo, o esforço ainda vale');
  assert.equal(effortForModel('opus', ''), '', 'sem esforço, nada');
});

/* ---------- buildModelFlags ---------- */

test('buildModelFlags: sem config nenhuma, nenhuma flag', () => {
  assert.equal(buildModelFlags({}), '');
  assert.equal(buildModelFlags(null), '');
  assert.equal(buildModelFlags({ reviewModel: '', reviewEffort: '' }), '');
});

test('buildModelFlags: só modelo devolve exatamente a flag de antes (regressão)', () => {
  // byte a byte igual ao que o Farol montava até a v2.27.0: se isto mudar, toda
  // instalação que já usava sonnet/haiku muda de comportamento sem aviso
  assert.equal(buildModelFlags({ reviewModel: 'sonnet' }), ' --model sonnet');
  assert.equal(buildModelFlags({ reviewModel: 'haiku' }), ' --model haiku');
  assert.equal(buildModelFlags({ reviewModel: 'opus' }), ' --model opus');
});

test('buildModelFlags: modelo e esforço juntos, nessa ordem', () => {
  assert.equal(buildModelFlags({ reviewModel: 'opus', reviewEffort: 'xhigh' }), ' --model opus --effort xhigh');
  assert.equal(buildModelFlags({ reviewModel: 'fable', reviewEffort: 'low' }), ' --model fable --effort low');
});

test('buildModelFlags: esforço sem modelo é válido', () => {
  assert.equal(buildModelFlags({ reviewEffort: 'high' }), ' --effort high');
  assert.equal(buildModelFlags({ reviewEffort: 'minimal' }), '', 'Claude filtra esforço exclusivo do Codex');
});

test('buildModelFlags: Haiku derruba o esforço', () => {
  assert.equal(buildModelFlags({ reviewModel: 'haiku', reviewEffort: 'xhigh' }), ' --model haiku');
});

test('buildModelFlags: com stub não anexa nada', () => {
  // pina o contrato do qual TODA a bateria stubada depende: o stub é um binário falso
  // que não conhece --model nem --effort
  assert.equal(buildModelFlags({ reviewModel: 'opus', reviewEffort: 'xhigh' }, { stub: true }), '');
});

test('buildModelFlags: config envenenada nunca chega na linha', () => {
  // defesa em profundidade: mesmo que o config.json escape do saneamento de boot
  assert.equal(buildModelFlags({ reviewModel: 'opus && calc.exe', reviewEffort: 'high;id' }), '');
  assert.equal(buildModelFlags({ reviewModel: 'opus[1m]' }), '');
  assert.equal(buildModelFlags({ reviewModel: 'gpt-5.5', reviewEffort: 'minimal' }), '', 'modelo e esforço Codex não entram no claude -p');
  assert.equal(buildModelFlags({ reviewModel: { toString: () => 'opus; id' } }), '');
});

test('buildModelFlags: a linha montada não tem metacaractere de shell', () => {
  // invariante que vale nos DOIS shells (cmd.exe e /bin/sh)
  const PERIGO = /[`$;&|<>()*?[\]{}'"\\]/;
  const base = 'claude -p --output-format stream-json --verbose --dangerously-skip-permissions';
  const combos = [];
  for (const m of ['', ...MODEL_ALIASES, 'claude-opus-5']) {
    for (const e of ['', ...EFFORT_LEVELS]) combos.push({ reviewModel: m, reviewEffort: e });
  }
  for (const cfg of combos) {
    const flags = buildModelFlags(cfg);
    assert.equal(PERIGO.test(flags), false, `flags perigosas pra ${JSON.stringify(cfg)}: ${flags}`);
    assert.equal(PERIGO.test(base + flags), false);
  }
});

/* ---------- modelLabel ---------- */

test('modelLabel: versão em duas partes segue igual (regressão)', () => {
  assert.equal(modelLabel('claude-opus-4-8'), 'Opus 4.8');
  assert.equal(modelLabel('claude-sonnet-4-5'), 'Sonnet 4.5');
  assert.equal(modelLabel('claude-3-5-haiku'), 'Haiku 3.5');
});

test('modelLabel: geração de major único agora traz a versão', () => {
  // antes o extrator exigia dois números separados por hífen, então claude-opus-5
  // devolvia só "Opus" e o eixo byModel do Consumo perdia a versão
  assert.equal(modelLabel('claude-opus-5'), 'Opus 5');
  assert.equal(modelLabel('claude-sonnet-5'), 'Sonnet 5');
});

test('modelLabel: conhece a família Fable', () => {
  assert.equal(modelLabel('claude-fable-5'), 'Fable 5');
  assert.equal(modelLabel('fable'), 'Fable');
});

test('modelLabel: não confunde data com versão', () => {
  assert.equal(modelLabel('claude-haiku-4-5-20251001'), 'Haiku 4.5');
});

test('buildModelFlags: auto fora do roteador não vira flag de modelo nem de esforço', () => {
  assert.equal(buildModelFlags({ reviewModel: 'auto', reviewEffort: 'high' }), '');
});

test('buildModelFlags: override do roteador vence a config auto', () => {
  assert.equal(
    buildModelFlags({ reviewModel: 'auto' }, { model: 'haiku', effort: '', fast: true }),
    ' --model haiku',
  );
  assert.equal(
    buildModelFlags({ reviewModel: 'auto' }, { model: 'sonnet', effort: 'high' }),
    ' --model sonnet --effort high',
  );
});

test('modelLabel: auto tem rótulo humano', () => {
  assert.equal(modelLabel('auto'), 'Auto (custo-benefício)');
  assert.equal(modelLabel('AUTO'), 'Auto (custo-benefício)');
});

/* ---------- Codex: configuração própria, modo rápido e retomada ---------- */

test('codexSelection usa somente as chaves Codex', () => {
  const cfg = {
    reviewModel: 'opus', reviewEffort: 'low',
    codexReviewModel: 'gpt-5.6-terra', codexReviewEffort: 'high',
  };
  assert.deepEqual(codexSelection(cfg), { model: 'gpt-5.6-terra', effort: 'high' });
});

test('codexSelection: modo rápido preserva minimal/low e derruba os demais pra medium', () => {
  assert.equal(codexSelection({ codexReviewEffort: 'minimal' }, { fast: true }).effort, 'minimal');
  assert.equal(codexSelection({ codexReviewEffort: 'low' }, { fast: true }).effort, 'low');
  assert.equal(codexSelection({ codexReviewEffort: 'xhigh' }, { fast: true }).effort, 'medium');
  assert.equal(codexSelection({}, { fast: true }).effort, 'medium');
});

test('codexArgs monta modelo/esforço sem aceitar configuração Claude', () => {
  const args = codexArgs({
    reviewModel: 'opus', reviewEffort: 'xhigh',
    codexReviewModel: 'gpt-5.6-luna', codexReviewEffort: 'minimal',
  });
  assert.equal(args[args.indexOf('--model') + 1], 'gpt-5.6-luna');
  assert.ok(args.includes('model_reasoning_effort="minimal"'));
  assert.equal(args.includes('opus'), false);
});

test('codexArgs converte --resume do fluxo comum em codex exec resume', () => {
  const sid = '019abcde-1234-7890-abcd-0123456789ab';
  const args = codexArgs({ codexReviewModel: 'gpt-5.6-terra' }, { extraArgs: ['--resume', sid] });
  assert.deepEqual(args.slice(0, 4), ['-a', 'never', 'exec', 'resume']);
  assert.equal(args.includes('--color'), false, 'resume não aceita a opção de cor do exec comum');
  assert.deepEqual(args.slice(-2), [sid, '-']);
});

/* ---------- modo rápido: o esforço cai na LINHA DE COMANDO, não só no prompt ----------
   Medido em 17/08/2026 (#776): com fast ligado e effort default, a "leitura" ainda
   levava 6m28s, quase tudo raciocínio pré-comando. O prompt não alcança essa parte;
   a flag --effort alcança. Regra: fast usa medium, salvo low explícito do usuário. */

test('buildModelFlags: fast derruba o esforço default pra medium', () => {
  assert.equal(buildModelFlags({ reviewModel: 'opus', reviewEffort: '' }, { fast: true }),
    ' --model opus --effort medium');
});

test('buildModelFlags: fast vence esforço explícito ALTO (é o ponto do modo)', () => {
  assert.equal(buildModelFlags({ reviewModel: 'opus', reviewEffort: 'xhigh' }, { fast: true }),
    ' --model opus --effort medium');
});

test('buildModelFlags: low explícito do usuário fica (é ainda mais rápido que o fast)', () => {
  assert.equal(buildModelFlags({ reviewModel: 'opus', reviewEffort: 'low' }, { fast: true }),
    ' --model opus --effort low');
});

test('buildModelFlags: sem fast, nada muda (chat/autoanálise/ferramentas não passam a flag)', () => {
  assert.equal(buildModelFlags({ reviewModel: 'opus', reviewEffort: 'xhigh' }),
    ' --model opus --effort xhigh');
});

test('buildModelFlags: fast + stub continua vazio (contrato da bateria stubada)', () => {
  assert.equal(buildModelFlags({ reviewModel: 'opus' }, { stub: true, fast: true }), '');
});

test('buildModelFlags: fast respeita a incompatibilidade do haiku (effortForModel decide)', () => {
  const flags = buildModelFlags({ reviewModel: 'haiku', reviewEffort: 'xhigh' }, { fast: true });
  assert.match(flags, /--model haiku/);
  assert.doesNotMatch(flags, /xhigh/);
});
