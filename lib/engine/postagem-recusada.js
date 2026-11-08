// A postagem que a trava de instância isolada recusou volta ao reenvio (08/11/2026).
//
// A trava recusava toda postagem da instalação hospedada (FAROL_HOME próprio), e a recusa é
// permanente: o PR ficava em "Precisa de você" com a conta decidindo sozinha. Quando a instância
// deixa de contar como isolada, a pendência volta ao reenvio de sempre, que confere o commit e o
// que já foi publicado. Como ela pode ter dias, antes confere o que o reenvio não confere: a
// política da conta (em "espera você", fica na mesa) e a decisão de gente no mesmo commit (a
// postagem deixa de ser necessária, como na espera do CI).
import { recusaDeIsolada } from './instancia-isolada.js';
import { publicarRecibo } from './decision.js';

// O evento vem do que foi recusado, não do veredito: defeito confirmado sai como pedido de
// mudanças com veredito aprovar, e PR próprio sai como comentário.
const RECUSA = /^falha ao postar o (APPROVE|REQUEST_CHANGES|COMMENT): instância isolada \(FAROL_HOME/;
const EVENTO = { APPROVE: 'approve', REQUEST_CHANGES: 'request_changes', COMMENT: 'comment' };

function eventoRecusado(d) {
  for (const r of d.reasons || []) {
    const m = r?.kind === 'infra' ? RECUSA.exec(String(r.text || '')) : null;
    if (m) return EVENTO[m[1]];
  }
  return '';
}

const semInfra = (d) => (d.reasons || []).filter((r) => r?.kind !== 'infra');

// Em reenvio, em espera automática ou com bloqueio próprio (credencial no texto), quem cuida é outro.
function rearmavel(d, evento) {
  return !!evento && !d.postRetry && !d.blockedReason && !d.esperaProva && !d.esperaCi && !!d.payloads?.[evento];
}

function politicaAindaPosta(engine, d, evento) {
  const conta = engine.accountForPr({ ...d.pr, key: d.key });
  if (evento === 'approve') return engine.approvePolicyFor(conta, semInfra(d).length === 0) === 'approve';
  return evento === 'comment' || engine.rejectPolicyFor(conta) === 'request_changes';
}

async function dispensar(engine, d, hist) {
  const idx = engine.decisions.pending.findIndex((x) => x.id === d.id);
  if (idx < 0) return;
  const nomes = (hist.quem || []).map((u) => `@${u}`).join(', ');
  engine.decisions.pending.splice(idx, 1);
  engine.resolveIntoHistory({ ...d, status: 'approval_not_needed', action: 'skip', postRetry: null,
    reasons: [{ text: `outra pessoa já decidiu este commit (${nomes}): a postagem que tinha ficado presa não é necessária, nada foi postado`, kind: 'gate' }, ...semInfra(d)] });
  engine.saveDecisions();
  await publicarRecibo(engine, d, d.headSha);
}

// Devolve quantas voltaram ao reenvio. Sem confirmar o commit, o próximo ciclo decide.
async function rearmarPostagensRecusadas(engine, { isolada } = {}) {
  if (recusaDeIsolada(engine, 'postar', { isolada })) return 0;
  let n = 0;
  for (const d of [...(engine.decisions?.pending || [])]) {
    const evento = eventoRecusado(d);
    if (!rearmavel(d, evento) || !politicaAindaPosta(engine, d, evento)) continue;
    const hist = await engine.bloqueadoPorHistorico({ ...d.pr, key: d.key });
    if (!hist || hist.head !== d.headSha) continue;
    if (hist.decidido) { await dispensar(engine, d, hist); continue; }
    d.postRetry = { event: evento, attempts: 0 };
    n += 1;
  }
  if (n) engine.saveDecisions();
  return n;
}

export { rearmarPostagensRecusadas };
