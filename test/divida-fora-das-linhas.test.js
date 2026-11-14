// Achado técnico em linha que o PR não tocou é dívida anterior e não bloqueia (05/11/2026,
// biud-frontend#1818). Achado em linha do trecho alterado, regra sem linha e falta de dado seguem
// bloqueando como antes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linhaDoAchado, trechosDoDiff, trechosDoPatch, classificarPorLinhas, pontoDaDivida, VERSAO_DAS_LINHAS } from '../lib/technical-review/divida-fora-das-linhas.js';
import { technicalGap, technicalSummary, relatorioComViolacao, TOOL, VERSAO_DAS_REGRAS, REVIEW_COHERENCE_GAP } from '../lib/technical-review/verdict.js';
import { relatorioTecnico } from '../lib/technical-review/runtime.js';
import { attentionPoints } from '../lib/engine/ressalvas.js';

const HEAD = 'd'.repeat(40);
const BLOB = 'c'.repeat(40);
const faixa = linha => ({ intervaloVerificado: { inicio: linha, fim: linha, blob: BLOB } });
const SUPRESSAO = 'core.suppression.declared';
const UNIDADE = 'frontend.component.scalable-units';
const DUPLICACAO = 'core.duplication.business-rule';
const TERNARIO = 'core.javascript.no-nested-ternary';

const supressor = (file, linha) => ({ rule: SUPRESSAO, file, ...faixa(linha),
  message: `supressor "@ts-expect-error" na linha ${linha} sem motivo; a ficha e "<supressor> <identificador> -- <motivo>"`,
  assinatura: `${SUPRESSAO}|${file}|@ts-expect-error:motivo` });
const unidade = (file, linha) => ({ rule: UNIDADE, file, ...faixa(linha), message: `unidade fixa escalavel na linha ${linha}: md:max-w-[480px]; use rem ou token escalavel`, assinatura: `${UNIDADE}|${file}|x` });
const avaliacao = (rule, file, texto) => ({ rule, file, message: `avaliada como violacao: ${texto}`, assinatura: `${rule}|${file}|violacao` });

// o inventário que o engine mede (pr-scope / review-source): patch do GitHub por arquivo
const arquivo = (path, patch, extra = {}) => ({ path, sha: BLOB, status: 'modified', patch, patchStatus: 'available',
  patchOrigin: { status: 'available', policy: null }, representation: null, ...extra });
const TESTE = 'src/lib/auth/index.test.ts';
const TELA = 'src/features/first-steps/RegisterFlow.tsx';
const NOVO = 'src/app/api/jornada/marco/route.ts';
const inventario = (files, extra = {}) => ({ status: 'complete', headSha: HEAD, baseSha: 'b'.repeat(40), changedFiles: files.length, files, ...extra });
const INVENTARIO = inventario([
  arquivo(TESTE, '@@ -1938,6 +1938,12 @@ describe\n ctx\n+novo\n ctx\n@@ -2380,3 +2386,4 @@\n a\n+b\n c\n'),
  arquivo(TELA, '@@ -10,3 +10,4 @@\n a\n+b\n c\n'),
  arquivo(NOVO, '@@ -0,0 +1,54 @@\n+export const x = 1;\n', { status: 'added' }),
]);

const relatorio = (rules, findings, extra = {}) => ({
  schema: 1, version: TOOL.version, toolCommit: TOOL.commit, repo: 'o/r', base: 'b'.repeat(40), head: HEAD, profile: 'p',
  humanReviewFingerprint: 'h', catalogFingerprint: 'c', verdict: rules.some(r => r.verdict === 'fail') ? 'fail' : 'pass',
  rules, findings, coverage: {}, ...extra,
});
const fail = rule => ({ rule, verdict: 'fail', conhecidos: 0 });

// ------------------------------------------------------------------ a linha do achado

test('a linha vem só do verificador mecânico; avaliação, texto entre aspas e ambiguidade não dão linha', () => {
  assert.equal(linhaDoAchado(supressor(TESTE, 1973)), 1973);
  assert.equal(linhaDoAchado(unidade(TELA, 403)), 403);
  assert.equal(linhaDoAchado({ message: 'supressor "x" na linha 7 sem motivo na linha acima; a ficha e "// x -- <motivo>"' }), 7);
  // texto da sessão nunca é lido em busca de linha
  assert.equal(linhaDoAchado(avaliacao(DUPLICACAO, NOVO, 'a regra na linha 3 duplica a da linha 90')), null);
  // o código revisado (entre aspas) não escreve a própria linha
  assert.equal(linhaDoAchado({ message: 'supressor "eslint na linha 5" na linha 1973 e proibido' }), 1973);
  for (const message of ['arquivo declara 2 componentes', 'na linha 3 e na linha 4', 'na linha 0', '', undefined]) {
    assert.equal(linhaDoAchado({ message }), null, String(message));
  }
  assert.equal(linhaDoAchado(null), null);
});

// ------------------------------------------------------------------ o diff medido

test('só o inventário completo do mesmo commit, com patch cru e inteiro, dá trechos', () => {
  assert.deepEqual(trechosDoDiff(INVENTARIO, HEAD).get(TESTE), [[1938, 1949], [2386, 2389]]);
  assert.equal(trechosDoDiff(INVENTARIO, 'e'.repeat(40)), null, 'inventário de outro commit');
  assert.equal(trechosDoDiff({ ...INVENTARIO, status: 'partial' }, HEAD), null);
  assert.equal(trechosDoDiff(null, HEAD), null);
  for (const [nome, extra] of [
    ['patch indisponível', { patchStatus: 'unavailable' }],
    ['patch parcial do GitHub', { patchOrigin: { status: 'partial' } }],
    ['arquivo de ambiente reescrito', { representation: { kind: 'env-changes', hiddenValues: 1 } }],
    ['trecho oculto', { representation: { kind: 'github-patch', redactions: [{ start: 1, end: 2 }] } }],
    ['patch sem trecho', { patch: 'Binary files differ' }],
    ['sem patch', { patch: null }],
  ]) {
    assert.equal(trechosDoDiff(inventario([arquivo(TESTE, '@@ -1,1 +1,2 @@\n a\n+b\n', extra)]), HEAD).has(TESTE), false, nome);
  }
  assert.equal(trechosDoDiff(inventario([arquivo(TESTE, '@@ -1 +1 @@\n-a\n+b\n', { representation: { kind: 'github-patch', redactions: [] } })]), HEAD).has(TESTE), true);
});

// ------------------------------------------------------------------ a classificação

test('biud-frontend#1818: supressor e unidade fixa em linha intacta viram dívida; a regra inteira deixa de bloquear', () => {
  const r = classificarPorLinhas({
    rules: [fail(SUPRESSAO), fail(UNIDADE), fail(DUPLICACAO), fail(TERNARIO)],
    findings: [supressor(TESTE, 1973), supressor(TESTE, 2394), unidade(TELA, 403), avaliacao(DUPLICACAO, NOVO, 'três fontes'),
      { rule: TERNARIO, file: TESTE, ...faixa(1148), message: 'ternario aninhado na linha 1148; use fluxo explicito' }],
  }, INVENTARIO, HEAD);
  assert.deepEqual(r.findings.map(f => f.foraDasLinhas === true), [true, true, true, false, true]);
  assert.deepEqual(r.rules.filter(x => x.dividaForaDasLinhas).map(x => x.rule), [SUPRESSAO, UNIDADE, TERNARIO]);
  assert.equal(r.rules.find(x => x.rule === DUPLICACAO).dividaForaDasLinhas, undefined, 'regra sem linha, em arquivo que o PR criou, segue bloqueando');
  assert.equal(r.resumo.achados, 4);
  assert.deepEqual(r.resumo.amostra[0], { rule: SUPRESSAO, file: TESTE, linha: 1973 });
});

test('achado no trecho do PR, inclusive no contexto em volta da mudança, segue bloqueando, e segura a regra inteira', () => {
  for (const linha of [1938, 1941, 1949, 2386, 2389]) {
    const r = classificarPorLinhas({ rules: [fail(SUPRESSAO)], findings: [supressor(TESTE, 2394), supressor(TESTE, linha)] }, INVENTARIO, HEAD);
    assert.equal(r.findings[1].foraDasLinhas, undefined, String(linha));
    assert.equal(r.rules[0].dividaForaDasLinhas, undefined, `linha ${linha}: um achado do trecho segura a regra`);
  }
  // arquivo novo: toda linha é do PR
  const novo = classificarPorLinhas({ rules: [fail(UNIDADE)], findings: [unidade(NOVO, 30)] }, INVENTARIO, HEAD);
  assert.equal(novo.rules[0].dividaForaDasLinhas, undefined);
});

test('falta de dado segue bloqueando: arquivo fora do inventário, inventário de outro commit, regra reprovada sem achado', () => {
  const fora = classificarPorLinhas({ rules: [fail(SUPRESSAO)], findings: [supressor('src/outro.ts', 9)] }, INVENTARIO, HEAD);
  assert.equal(fora.rules[0].dividaForaDasLinhas, undefined);
  const outro = classificarPorLinhas({ rules: [fail(SUPRESSAO)], findings: [supressor(TESTE, 1973)] }, INVENTARIO, 'e'.repeat(40));
  assert.equal(outro.findings[0].foraDasLinhas, undefined);
  assert.equal(outro.resumo, null);
  const semAchado = classificarPorLinhas({ rules: [fail(SUPRESSAO)], findings: [] }, INVENTARIO, HEAD);
  assert.equal(semAchado.rules[0].dividaForaDasLinhas, undefined);
  for (const intervaloVerificado of [undefined, { inicio: 1973, fim: 1973, blob: 'outro' }, { inicio: 2000, fim: 1973, blob: BLOB }]) {
    const semFaixa = classificarPorLinhas({ rules: [fail(SUPRESSAO)], findings: [{ ...supressor(TESTE, 1973), intervaloVerificado }] }, INVENTARIO, HEAD);
    assert.equal(semFaixa.findings[0].foraDasLinhas, undefined, 'linha sozinha ou intervalo de outro blob não concede dívida');
  }
});

// ------------------------------------------------------------------ o veredito técnico

test('relatório só com dívida fora das linhas não é violação; o resumo diz quantos ficaram como dívida', () => {
  const c = classificarPorLinhas({ rules: [fail(SUPRESSAO), fail(UNIDADE)], findings: [supressor(TESTE, 1973), unidade(TELA, 403)] }, INVENTARIO, HEAD);
  const r = relatorio(c.rules, c.findings, { foraDasLinhas: c.resumo });
  assert.equal(technicalGap(r, { head: HEAD }), '');
  assert.equal(relatorioComViolacao(r), false);
  const resumo = technicalSummary(r);
  assert.equal(resumo.state, 'pass');
  assert.equal(resumo.violated, 0);
  assert.match(resumo.message, /2 achado\(s\) em linha que o PR não alterou seguem como dívida anterior/);
});

test('sem a marca do app, o mesmo relatório segue violação; com achado no trecho ou dívida agravada, também', () => {
  assert.equal(technicalGap(relatorio([fail(SUPRESSAO)], [supressor(TESTE, 1973)])), 'violação técnica confirmada');
  const c = classificarPorLinhas({ rules: [fail(SUPRESSAO)], findings: [supressor(TESTE, 1973), supressor(TESTE, 1940)] }, INVENTARIO, HEAD);
  assert.equal(technicalGap(relatorio(c.rules, c.findings)), 'violação técnica confirmada');
  const d = classificarPorLinhas({ rules: [fail(SUPRESSAO)], findings: [supressor(TESTE, 1973)] }, INVENTARIO, HEAD);
  assert.equal(technicalGap(relatorio(d.rules, d.findings, { error: 'dívida anterior agravada pela entrega' })), 'violação técnica confirmada');
  // achado marcado de regra que bloqueia por outro achado sem marca: o achado sem marca segura
  const misto = relatorio([{ ...fail(SUPRESSAO), dividaForaDasLinhas: true }], [{ ...supressor(TESTE, 1973), foraDasLinhas: true }, { rule: 'backend.output.sanitized', file: 'a.ts', message: 'x' }]);
  assert.equal(relatorioComViolacao(misto), true);
  assert.equal(technicalGap(misto), 'achados técnicos não resolvidos', 'classificação antiga de outra regra não mascara o achado bloqueante');
});

test('desconto antigo sem intervalo verificado exige reconferência só da dívida classificada', () => {
  const c = classificarPorLinhas({ rules: [fail(SUPRESSAO)], findings: [supressor(TESTE, 1973)] }, INVENTARIO, HEAD);
  assert.equal(c.resumo.versao, VERSAO_DAS_LINHAS);
  const antigo = relatorio(c.rules, c.findings, { foraDasLinhas: { ...c.resumo, versao: undefined } });
  assert.equal(technicalGap(antigo), 'classificação da dívida anterior requer reconferência');
  for (const evidenceVersion of [7, VERSAO_DAS_REGRAS]) {
    assert.equal(technicalSummary(antigo, [], { provaEsgotada: true, evidenceVersion }).state, 'pending', 'nem a decisão na primeira rodada dispensa reconferir dívida antiga');
  }
  assert.equal(technicalGap(relatorio([{ rule: SUPRESSAO, verdict: 'pass' }], [])), '', 'relatório sem desconto continua válido sem versão nova');
});

test('decidir na primeira rodada não dispensa o texto cuja correção de escopo está pendente ou esgotada', () => {
  const c = classificarPorLinhas({ rules: [fail(SUPRESSAO)], findings: [supressor(TESTE, 1973)] }, INVENTARIO, HEAD);
  const r = relatorio(c.rules, c.findings, { foraDasLinhas: c.resumo });
  const prova = { provaEsgotada: true, evidenceVersion: VERSAO_DAS_REGRAS };
  assert.equal(technicalSummary(r, [], prova).state, 'pass', 'controle: a dívida medida sozinha não bloqueia');
  for (const flag of ['escopoSessaoPendente', 'escopoSessaoInconclusivo']) {
    const pendente = { ...r, [flag]: true };
    assert.equal(technicalGap(pendente), REVIEW_COHERENCE_GAP);
    const resumo = technicalSummary(pendente, [], prova);
    assert.equal(resumo.state, 'pending', flag);
    assert.equal(resumo.message, REVIEW_COHERENCE_GAP, 'a ressalva técnica não autoriza publicar o texto anterior');
  }
});

// ------------------------------------------------------------------ o relatório público

test('o relatório público leva as marcas, põe o que bloqueia primeiro e guarda o resumo da dívida', () => {
  const dividas = Array.from({ length: 11 }, (_, i) => supressor(TESTE, 3000 + i));
  const bloqueia = unidade(TELA, 11);
  const r = relatorioTecnico({ repo: 'o/r', base: 'b'.repeat(40), head: HEAD, profile: { fingerprint: 'p' }, objections: { fingerprint: 'h' } },
    { catalogFingerprint: 'c', verdict: 'fail', rules: [fail(SUPRESSAO), fail(UNIDADE)], findings: [...dividas, bloqueia], coverage: {} },
    { privateEvidence: 'x.json', inventario: INVENTARIO });
  assert.equal(r.findings.length, 10);
  assert.deepEqual(r.findings[0], bloqueia, 'o achado que bloqueia não fica de fora do corte de dez');
  assert.equal(r.rules.find(x => x.rule === SUPRESSAO).dividaForaDasLinhas, true);
  assert.equal(r.rules.find(x => x.rule === UNIDADE).dividaForaDasLinhas, undefined);
  assert.equal(r.foraDasLinhas.achados, 11);
  assert.equal(technicalGap(r, { head: HEAD }), 'violação técnica confirmada', 'a unidade fixa na linha alterada segue bloqueando');
  const semInventario = relatorioTecnico({ repo: 'o/r', base: 'b'.repeat(40), head: HEAD, profile: { fingerprint: 'p' }, objections: { fingerprint: 'h' } },
    { catalogFingerprint: 'c', verdict: 'fail', rules: [fail(SUPRESSAO)], findings: [supressor(TESTE, 1973)], coverage: {} }, { privateEvidence: 'x.json' });
  assert.equal(semInventario.foraDasLinhas, undefined);
  assert.equal(technicalGap(semInventario, { head: HEAD }), 'violação técnica confirmada', 'sem inventário, nada é rebaixado');
});

// backoffice#365 (14/11/2026): dez sugestões de organização ocuparam as dez vagas e os achados de px, os
// únicos que bloqueavam, ficaram fora do relatório. O pedido de mudanças saiu sem dizer o quê nem onde.
test('sugestão de organização não tira a vaga do achado que bloqueia no corte de dez', () => {
  const organizacao = Array.from({ length: 10 }, (_, i) => ({ rule: 'frontend.component.named-structural-branches', file: `src/c${i}.tsx`, message: 'componente possui multiplos retornos visuais' }));
  const bloqueia = unidade(TELA, 11);
  const r = relatorioTecnico({ repo: 'o/r', base: 'b'.repeat(40), head: HEAD, profile: { fingerprint: 'p' }, objections: { fingerprint: 'h' } },
    { catalogFingerprint: 'c', verdict: 'fail', rules: [fail('frontend.component.named-structural-branches'), fail(UNIDADE)], findings: [...organizacao, bloqueia], coverage: {} },
    { privateEvidence: 'x.json', inventario: INVENTARIO });
  assert.equal(r.findings.length, 10);
  assert.deepEqual(r.findings[0], bloqueia, 'o que bloqueia vem antes da sugestão de organização');
  assert.equal(r.findings[1].rule, 'frontend.component.named-structural-branches', 'a sugestão ocupa o que sobra');
});

// ------------------------------------------------------------------ a ressalva

test('a dívida vira ressalva da revisão aprovável, nunca some calada', () => {
  const c = classificarPorLinhas({ rules: [fail(SUPRESSAO)], findings: [supressor(TESTE, 1973), supressor(TESTE, 2394)] }, INVENTARIO, HEAD);
  const texto = pontoDaDivida({ foraDasLinhas: c.resumo });
  assert.match(texto, /^2 achado\(s\) da avaliação técnica em linha que este PR não alterou ficaram como dívida anterior/);
  assert.match(texto, /src\/lib\/auth\/index\.test\.ts:1973/);
  const pontos = attentionPoints(null, { decision: 'auto_approve', reasons: [], technicalReview: relatorio(c.rules, c.findings, { foraDasLinhas: c.resumo }) });
  assert.ok(pontos.some(p => p.kind === 'gate' && p.text === texto), JSON.stringify(pontos));
  assert.equal(pontoDaDivida({}), null);
  assert.equal(pontoDaDivida(null), null);
});

test('o fim do trecho é inclusivo: +10,3 cobre 10 a 12, e a linha 13 já é dívida anterior', () => {
  const nl = String.fromCharCode(10);
  assert.deepEqual(trechosDoPatch(['@@ -1,3 +10,3 @@', ' a', '+b', ' c'].join(nl)), [[10, 12]]);
  assert.deepEqual(trechosDoPatch(['@@ -5,2 +7,0 @@', '-x', '-y'].join(nl)), [[7, 7]], 'trecho só de remoção fica na linha onde caiu');
  assert.deepEqual(trechosDoPatch(['@@ -4 +4 @@', '-x', '+y'].join(nl)), [[4, 4]], 'sem tamanho é uma linha');
});
