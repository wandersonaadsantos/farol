// A autoanálise PERSISTE, e ocultar deixou de apagar (01/09/2026).
//
// O defeito de origem tinha duas metades que se somavam:
//  (a) o botão dizia "Ocultar análise" com o title "é só sua, some da tela; dá pra
//      reanalisar quando quiser" e chamava um `delete` no registro. Recuperar exigia
//      REANALISAR, que custa uma sessão paga pra reproduzir o que já tinha sido pago;
//  (b) commit novo no PR apagava a análise inteira, quando o que envelhece é o
//      VEREDITO, não o texto: o relatório continua descrevendo o código que foi lido.
//
// Estes testes travam as duas metades E a contenção que elas exigem: registro que
// persiste vencido NÃO pode continuar liberando o botão Merge.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = path.join(os.tmpdir(), 'farol-test-persistente-' + process.pid);
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { evaluateQualityEligibility, qualityOf, setSelfAnalysisVisibility, projectSelfAnalyses } =
  await import('../lib/engine/selfpr.js');
const { selfAnalysisBadge, selfAnalysisToggle, selfAnalysisStale, qualityReasonLabel } =
  await import('../ui/pure.js');

after(() => { try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const CHAVE = 'acme/app#42';

function observedCompleto(over = {}) {
  return {
    headSha: 'a'.repeat(40),
    sessionOutcome: 'complete',
    scope: { total: ['src/a.js'], reviewed: ['src/a.js'], missing: [] },
    verification: { status: 'satisfied' },
    card: { requirement: 'not_required', code: 'desligado' },
    ...over
  };
}

function analiseElegivel(over = {}) {
  return {
    key: CHAVE, headSha: 'a'.repeat(40), verdict: 'approvable', approvable: true,
    blockers: [], tips: [], coverageLimitations: [], reportMarkdown: '# relatório',
    observed: observedCompleto(), ...over
  };
}

/* ---------- o gate: persistir vencido não pode liberar merge ---------- */

test('análise carimbada como stale vira INELIGIBLE, não fica elegível por persistir', () => {
  const boa = analiseElegivel();
  assert.equal(qualityOf(boa).status, 'eligible', 'a mesma análise, fresca, libera');

  const vencida = analiseElegivel({ observed: observedCompleto({ stale: true, staleHeadSha: 'b'.repeat(40) }) });
  const q = qualityOf(vencida);
  assert.equal(q.status, 'ineligible',
    'evidência CONTRA (o engine mediu o head mudar), não evidência faltando');
  assert.deepEqual(q.reasons.map(r => r.code), ['ANALYSIS_STALE']);
  assert.equal(q.reasons[0].detail.head, 'b'.repeat(40), 'o motivo carrega o head que passou a valer');
});

test('ANALYSIS_STALE é diferente de EVIDENCE_STALE: provas diferentes, motivos diferentes', () => {
  // EVIDENCE_STALE: parecer e evidência falam de shas DIFERENTES (incoerência DENTRO
  // do registro). Ele nunca pegaria o caso do PR que andou, porque ali os dois lados
  // continuam carimbados com o mesmo sha; foi por isso que o carimbo novo precisou existir.
  const incoerente = analiseElegivel({ headSha: 'c'.repeat(40) });
  const codes = qualityOf(incoerente).reasons.map(r => r.code);
  assert.ok(codes.includes('EVIDENCE_STALE'));
  assert.ok(!codes.includes('ANALYSIS_STALE'), 'o PR não andou; o que está torto é o registro');

  assert.notEqual(qualityReasonLabel('ANALYSIS_STALE'), qualityReasonLabel('EVIDENCE_STALE'),
    'a tela precisa dizer coisas diferentes, senão a distinção não serve pra ninguém');
  assert.notEqual(qualityReasonLabel('ANALYSIS_STALE'), qualityReasonLabel('CODIGO_INEXISTENTE'),
    'e o código novo tem frase própria, não cai no genérico');
});

test('ocultar NÃO participa do gate: preferência de leitura não decide merge', () => {
  const a = analiseElegivel({ hidden: true });
  assert.equal(qualityOf(a).status, 'eligible',
    'recolher o parecer da tela não pode mudar o que ele comprova');
});

/* ---------- visibilidade: alterna e persiste, nunca apaga ---------- */

function engineFalso(analises) {
  return {
    selfAnalyses: analises,
    salvou: 0, empurrou: 0,
    saveSelfAnalyses() { this.salvou++; },
    pushState() { this.empurrou++; }
  };
}

test('ocultar e mostrar alternam o campo e o registro continua no disco', () => {
  const eng = engineFalso({ [CHAVE]: analiseElegivel() });

  assert.deepEqual(setSelfAnalysisVisibility(eng, CHAVE, true), { ok: true, hidden: true });
  assert.equal(eng.selfAnalyses[CHAVE].hidden, true);
  assert.ok(eng.selfAnalyses[CHAVE].reportMarkdown, 'O RELATÓRIO CONTINUA: ocultar não é apagar');
  assert.equal(eng.salvou, 1, 'a preferência sobrevive a um restart');

  assert.deepEqual(setSelfAnalysisVisibility(eng, CHAVE, false), { ok: true, hidden: false });
  assert.equal(eng.selfAnalyses[CHAVE].hidden, undefined, 'volta a ser ausência, não `false`');
  assert.ok(eng.selfAnalyses[CHAVE].reportMarkdown, 'e o mesmo relatório volta sem custar sessão nenhuma');
});

test('alternar pro estado em que já está não grava nem empurra estado', () => {
  const eng = engineFalso({ [CHAVE]: analiseElegivel() });
  assert.deepEqual(setSelfAnalysisVisibility(eng, CHAVE, false), { ok: true, hidden: false });
  assert.equal(eng.salvou, 0, 'clique idempotente não vira escrita em disco');
  assert.equal(eng.empurrou, 0);
});

test('chave inexistente recusa em vez de criar registro vazio', () => {
  const eng = engineFalso({});
  const r = setSelfAnalysisVisibility(eng, 'acme/app#999', true);
  assert.equal(r.ok, false);
  assert.equal(eng.selfAnalyses['acme/app#999'], undefined,
    'ocultar o que não existe não pode inventar uma análise vazia');
});

test('a projeção leva hidden e o quality derivado pra tela', () => {
  const proj = projectSelfAnalyses({ [CHAVE]: analiseElegivel({ hidden: true }) });
  assert.equal(proj[CHAVE].hidden, true, 'a UI precisa saber se está recolhida');
  assert.equal(proj[CHAVE].quality.status, 'eligible', 'e quality segue derivado, nunca lido do disco');
});

/* ---------- a tela: o selo e o par de rótulos ---------- */

test('o selo de desatualizada VENCE o parecer', () => {
  const vencida = analiseElegivel({ observed: observedCompleto({ stale: true }) });
  assert.equal(selfAnalysisStale(vencida), true);
  assert.equal(selfAnalysisBadge(vencida).label, 'desatualizada',
    'mostrar "aprovável" sobre código que já mudou é a única leitura que faz alguém agir errado');
  assert.ok(selfAnalysisBadge(vencida).title, 'e o selo explica o que aconteceu ao passar o mouse');

  assert.equal(selfAnalysisBadge(analiseElegivel()).label, 'aprovável');
  assert.equal(selfAnalysisBadge(analiseElegivel({ approvable: false })).label, 'precisa de ajuste');
  assert.equal(selfAnalysisBadge(null), null, 'PR sem análise não ganha selo nenhum');
});

test('registro legado (sem observed) não é lido como desatualizado', () => {
  assert.equal(selfAnalysisStale({ key: CHAVE, approvable: true }), false,
    'ausência de carimbo é ausência de medição, e o gate já trata isso pelos outros códigos');
});

test('o par de rótulos alterna e nenhum dos dois promete apagar', () => {
  const mostrando = selfAnalysisToggle(analiseElegivel());
  assert.equal(mostrando.label, 'Ocultar análise');
  assert.equal(mostrando.alvo, true, 'o botão manda pro estado OPOSTO ao atual');

  const oculta = selfAnalysisToggle(analiseElegivel({ hidden: true }));
  assert.equal(oculta.label, 'Mostrar análise');
  assert.equal(oculta.alvo, false);

  for (const t of [mostrando, oculta]) {
    assert.doesNotMatch(t.title, /apag|delet|remov|perde/i,
      'o title não pode prometer destruição: foi um title mentiroso que originou a feature');
  }
});

/* ---------- a regra de sempre, aplicada ao campo novo ---------- */

test('stale só conta como true explícito: ausência não vira satisfação nem carimbo', () => {
  for (const valor of [undefined, null, 'true', 1, {}]) {
    const q = evaluateQualityEligibility(analiseElegivel(), observedCompleto({ stale: valor }));
    assert.ok(!q.reasons.some(r => r.code === 'ANALYSIS_STALE'),
      `stale=${JSON.stringify(valor)} não é o booleano que o engine escreve`);
  }
});
