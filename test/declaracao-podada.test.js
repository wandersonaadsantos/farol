// Pasta ausente com o resto da declaração de pé vira ressalva (07/11/2026).
//
// Medido no admin da Hostinger: a declaração do biud-frontend listava 1206 pastas de teste, três
// delas apagadas da development em 01/11 e ainda vivas na production. Toda revisão de PR da linha
// de desenvolvimento parava em "recuperação pausada" (21 PRs desde 31/10), porque uma declaração só
// por repositório não serve às duas linhas. Agora a conferência tira da cópia avaliada só as pastas
// ausentes e segue com o resto, e o card diz quais ficaram de fora. A trava continua quando um campo
// ficaria sem pasta nenhuma: aí não sobra material para avaliar (declaracao-desatualizada.test.js).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-declaracao-podada-'));
process.env.FAROL_HOME = path.join(root, 'home');
const { podarDeclaracao, pontoDaDeclaracaoPodada } = await import('../lib/technical-review/declaracao.js');
const { relatorioTecnico } = await import('../lib/technical-review/runtime.js');
const { attentionPoints } = await import('../lib/engine/ressalvas.js');
after(() => fs.rmSync(root, { recursive: true, force: true }));

const AUSENTES = [
  { campo: 'testDirs', dir: 'src/sumiu', motivo: 'ausente' },
  { campo: 'testDirs', dir: 'src/Outra', motivo: 'outra caixa' },
];

test('tira só as pastas ausentes da cópia e não toca a declaração original', () => {
  const original = { scopes: ['core'], testDirs: ['src', 'src/sumiu', 'src/Outra', 'e2e/specs'], e2eDirs: null, sourceDirs: ['src'] };
  const copia = structuredClone(original);
  const poda = podarDeclaracao(original, AUSENTES);
  assert.deepEqual(poda.vazios, []);
  assert.deepEqual(poda.declaration, { scopes: ['core'], testDirs: ['src', 'e2e/specs'], e2eDirs: null, sourceDirs: ['src'] });
  assert.deepEqual(original, copia);
});

test('campo que ficaria sem pasta nenhuma continua travando, e lista inválida também', () => {
  const tudoAusente = podarDeclaracao({ testDirs: ['src/sumiu'], sourceDirs: ['src'] }, [AUSENTES[0]]);
  assert.deepEqual(tudoAusente.vazios, ['testDirs']);
  const invalida = podarDeclaracao({ testDirs: [] }, [{ campo: 'testDirs', dir: '', motivo: 'lista inválida' }]);
  assert.deepEqual(invalida.vazios, ['testDirs']);
});

test('entrada que não é texto não é podada: o campo segue travando com nome', () => {
  const poda = podarDeclaracao({ testDirs: ['src', 5] }, [{ campo: 'testDirs', dir: '', motivo: 'entrada inválida' }]);
  assert.deepEqual(poda.vazios, ['testDirs']);
});

test('a falha gravada pela conferência 2 (que travava) não segura mais a recuperação', async () => {
  const { VERSAO_DA_CONFERENCIA } = await import('../lib/technical-review/declaracao.js');
  const { PROFILE_FILE, profileFor } = await import('../lib/technical-review/profiles.js');
  const { pausaDaRecuperacao } = await import('../lib/engine/recuperacao-prova.js');
  assert.equal(VERSAO_DA_CONFERENCIA, 3);
  fs.mkdirSync(path.dirname(PROFILE_FILE), { recursive: true });
  fs.writeFileSync(PROFILE_FILE, JSON.stringify({ repositories: { 'org/front': { declaration: { testDirs: ['src', 'src/sumiu'] } } } }));
  const fp = profileFor('org/front').fingerprint;
  const engine = { accountForPr: () => 'eu', autoReviewFor: () => true, isMuted: () => false, tokenFor: () => 't', autoReviewParked: new Set() };
  const gravada = { schema: 1, verdict: 'not-run', failure: 'declaration', missingDirs: [AUSENTES[0]], declarationProfile: fp, declarationCheck: 2 };
  assert.equal(await pausaDaRecuperacao(engine, { key: 'org/front#1', pr: { repo: 'org/front' }, technicalReview: gravada }), '');
  fs.rmSync(PROFILE_FILE, { force: true });
});

test('a entrada com espaço sai pela forma conferida, não pela crua', () => {
  const poda = podarDeclaracao({ testDirs: ['src', ' src/sumiu '] }, [AUSENTES[0]]);
  assert.deepEqual(poda.declaration.testDirs, ['src']);
});

test('o relatório técnico carrega as pastas podadas, e o card as mostra como ressalva', () => {
  const declaracaoPodada = { missingDirs: AUSENTES, missingCount: 7 };
  const context = { repo: 'org/front', base: 'b'.repeat(40), head: 'a'.repeat(40), profile: { fingerprint: 'f1' }, objections: { fingerprint: 'h' }, declaracaoPodada };
  const report = relatorioTecnico(context, { catalogFingerprint: 'c', verdict: 'pass', rules: [], findings: [], coverage: {} });
  assert.deepEqual(report.declaracaoPodada, declaracaoPodada);
  const texto = pontoDaDeclaracaoPodada(report);
  assert.match(texto, /testDirs "src\/sumiu", testDirs "src\/Outra" \(outra caixa\) e mais 5/);
  assert.match(texto, /ficaram de fora da avaliação técnica/);
  const pontos = attentionPoints(null, { analysisStatus: 'complete', verdict: 'approve', decision: 'auto_approve', cardMet: true, technicalReview: report });
  assert.ok(pontos.some(p => p.text === texto && p.kind === 'gate'), JSON.stringify(pontos));
});

test('sem poda não há ponto, e o texto nunca vem de caminho gravado fora das pastas conferidas', () => {
  assert.equal(pontoDaDeclaracaoPodada({ verdict: 'pass' }), '');
  const sujo = pontoDaDeclaracaoPodada({ declaracaoPodada: { missingDirs: [{ campo: 'testDirs', dir: 'x', motivo: String.raw`C:\Users\a` }], missingCount: 1 } });
  assert.doesNotMatch(sujo, /Users/);
});
