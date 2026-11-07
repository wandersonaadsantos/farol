import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dividasRelacionadas, causaNoDiff, conferirDividaDaSessao } from '../lib/technical-review/divida-da-sessao.js';
import { classificarPorLinhas, VERSAO_DAS_LINHAS } from '../lib/technical-review/divida-fora-das-linhas.js';
import { relatorioTecnico } from '../lib/technical-review/runtime.js';
import { normalizeFindings, classifyFindings } from '../lib/engine/review-findings.js';

const HEAD = 'a'.repeat(40), BLOB = 'b'.repeat(40), RULE = 'core.suppression.declared';
const FILE = 'src/legado.ts';
const inventario = { status: 'complete', headSha: HEAD, files: [{ path: FILE, sha: BLOB, status: 'modified',
  patchStatus: 'available', patch: '@@ -20,3 +20,3 @@\n contexto\n-antigo\n+novo\n contexto\n' }] };
const finding = extra => ({ file: FILE, line: 3, severity: 'blocking', causa: 'defeito_codigo', technicalRule: RULE,
  title: 'Supressão sem motivo', summary: 'Supressão no trecho antigo.', evidence: 'A supressão está no comentário.',
  criteria: { key: 'supressao', criterion: 'Supressão justificada', source: RULE, scope: 'Este PR' }, ...extra });
const tecnico = linha => ({ file: FILE, rule: RULE, message: `supressor "@ts-expect-error" na linha ${linha} sem motivo`,
  intervaloVerificado: { inicio: linha, fim: linha + 1, blob: BLOB } });
function result(f = finding({})) {
  return { verdict: 'request_changes', findings: [f], technicalReview: { head: HEAD,
    foraDasLinhas: { versao: VERSAO_DAS_LINHAS },
    dividasDaSessao: [{ indice: 0, file: FILE, line: 3, rule: RULE }] } };
}

test('o mesmo achado mecânico vira sugestão, mas o app exige texto e veredito novos da sessão', () => {
  const r = result();
  const issues = conferirDividaDaSessao(r, inventario, HEAD);
  assert.equal(r.findings[0].severity, 'suggestion');
  assert.equal(r.findings[0].dividaForaDasLinhasConfirmada, true);
  assert.equal(r.verdict, 'request_changes', 'o app não fabrica APPROVE com o texto antigo');
  assert.ok(issues.some(text => text.includes('reescreva os payloads')));
});

test('correlação não infere que outro defeito na mesma linha é a violação mecânica', () => {
  const r = result(finding({ technicalRule: undefined, criteria: { key: 'fluxo', criterion: 'Contrato da API', source: 'contrato.ts', scope: 'Este PR' } }));
  const issues = conferirDividaDaSessao(r, inventario, HEAD);
  assert.equal(r.findings[0].severity, 'blocking');
  assert.equal(r.findings[0].dividaForaDasLinhasConfirmada, undefined);
  assert.ok(issues.some(text => text.includes('regressão distinta')));
});

test('a sessão pode citar linha interna da construção medida, sem escapar da conferência', () => {
  const classificados = classificarPorLinhas({ findings: [tecnico(3)], rules: [{ rule: RULE, verdict: 'fail' }] }, inventario, HEAD);
  const r = result(finding({ line: 4 }));
  r.technicalReview.dividasDaSessao = dividasRelacionadas(classificados.findings, r.findings);
  assert.equal(r.technicalReview.dividasDaSessao.length, 1);
  assert.ok(conferirDividaDaSessao(r, inventario, HEAD).length);
  assert.equal(r.findings[0].severity, 'suggestion');
});

test('regressão em linha intacta causada por linha alterada continua bloqueando', () => {
  const r = result(finding({ introduzidoPor: { file: FILE, line: 21, side: 'head', evidence: 'O chamador novo transmite null à função antiga.' } }));
  assert.equal(causaNoDiff(r.findings[0], inventario, HEAD), true);
  assert.deepEqual(conferirDividaDaSessao(r, inventario, HEAD), []);
  assert.equal(r.findings[0].severity, 'blocking');
  assert.equal(r.findings[0].dividaForaDasLinhasConfirmada, undefined);
});

test('causa aceita remoção, mas recusa contexto, outro commit, patch parcial e argumento sem evidência', () => {
  const causa = { file: FILE, line: 21, side: 'base', evidence: 'O PR remove a garantia anterior.' };
  assert.equal(causaNoDiff(finding({ introduzidoPor: causa }), inventario, HEAD), true);
  for (const introduzidoPor of [{ ...causa, line: 20 }, { ...causa, evidence: '' }, { ...causa, side: 'outra' }]) {
    assert.equal(causaNoDiff(finding({ introduzidoPor }), inventario, HEAD), false);
  }
  assert.equal(causaNoDiff(finding({ introduzidoPor: causa }), inventario, 'c'.repeat(40)), false);
  const parcial = { ...inventario, files: [{ ...inventario.files[0], patch: '@@ -20,4 +20,4 @@\n-antigo\n+novo\n' }] };
  assert.equal(causaNoDiff(finding({ introduzidoPor: { ...causa, line: 20 } }), parcial, HEAD), false);
});

test('alegação causal fora da mudança precisa ser reparada, sem rebaixar por palpite', () => {
  const r = result(finding({ introduzidoPor: { file: FILE, line: 20, evidence: 'Contexto, não mudança.' } }));
  const issues = conferirDividaDaSessao(r, inventario, HEAD);
  assert.equal(r.findings[0].severity, 'blocking');
  assert.ok(issues.some(text => text.includes('linha alterada verificável')));
});

test('a sessão não escreve a marca e envelope inválido não ganha validade na classificação', () => {
  const r = result(finding({ dividaForaDasLinhasConfirmada: true }));
  delete r.technicalReview;
  conferirDividaDaSessao(r, inventario, HEAD);
  assert.equal(r.findings[0].dividaForaDasLinhasConfirmada, undefined);
  const invalido = result(finding({ evidence: {} }));
  conferirDividaDaSessao(invalido, inventario, HEAD);
  assert.equal(normalizeFindings(invalido.findings).status, 'invalid');
});

test('retirada de dívida anterior permanece rastreável, sem ressuscitar blocker em blob inalterado', () => {
  const anterior = { ...finding({}), id: 'r1:f1', status: null };
  const r = result(finding({ ref: anterior.id, status: 'persiste' }));
  conferirDividaDaSessao(r, inventario, HEAD);
  const normalized = normalizeFindings(r.findings);
  const parents = [{ baseSha: 'base', findings: [anterior], unresolved: [anterior], files: [{ path: FILE, sha: BLOB }] }];
  const comparison = classifyFindings({ baseSha: 'base', parents, status: 'ready' }, normalized, inventario.files);
  assert.equal(normalized.findings[0].dividaForaDasLinhasConfirmada, true);
  assert.deepEqual(comparison.unresolved, []);
  assert.deepEqual(comparison.resolvedOnUnchanged, []);
});

test('correlação usa o resultado técnico completo, inclusive o achado que não cabe nos dez públicos', () => {
  const findings = Array.from({ length: 12 }, (_, index) => tecnico(index + 1));
  const sessao = finding({ line: 12 });
  const classificados = classificarPorLinhas({ findings, rules: [{ rule: RULE, verdict: 'fail' }] }, inventario, HEAD);
  assert.deepEqual(dividasRelacionadas(classificados.findings, [sessao]), [{ indice: 0, file: FILE, line: 12, rule: RULE }]);
  const report = relatorioTecnico({ head: HEAD, base: 'b'.repeat(40), repo: 'o/r', profile: { fingerprint: 'p' }, objections: { fingerprint: 'h' } },
    { verdict: 'fail', findings, rules: [{ rule: RULE, verdict: 'fail' }], catalogFingerprint: 'c' },
    { inventario, achadosDaSessao: [sessao] });
  assert.equal(report.findings.length, 10);
  assert.deepEqual(report.dividasDaSessao, [{ indice: 0, file: FILE, line: 12, rule: RULE }]);
});

test('a causa vale no lado declarado: linha só acrescentada no head não é remoção da base', () => {
  const soAcrescimo = { ...inventario, files: [{ ...inventario.files[0], patch: '@@ -20,2 +20,3 @@\n contexto\n+novo\n contexto\n' }] };
  const causa = { file: FILE, line: 21, evidence: 'O chamador novo transmite null à função antiga.' };
  assert.equal(causaNoDiff(finding({ introduzidoPor: { ...causa, side: 'head' } }), soAcrescimo, HEAD), true);
  assert.equal(causaNoDiff(finding({ introduzidoPor: { ...causa, side: 'base' } }), soAcrescimo, HEAD), false);
});

test('bloqueio de outra causa que não defeito de código não é rebaixado como dívida da ferramenta', () => {
  const r = result(finding({ causa: 'card' }));
  assert.deepEqual(conferirDividaDaSessao(r, inventario, HEAD), []);
  assert.equal(r.findings[0].severity, 'blocking');
  assert.equal(r.findings[0].dividaForaDasLinhasConfirmada, undefined);
});
