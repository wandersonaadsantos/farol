// Contrato da segunda leitura: parecer do modelo separado da avaliação humana.
import { check, safeText, sourceRef, digest, SHA, ID, identityOf } from '../specialists/contract.js';
import { parseJson } from '../io.js';

const KINDS = ['confirmed', 'incorrect', 'omitted', 'inconclusive'];
function text(value, max = 2000) { return safeText(value, max, 'Texto da auditoria'); }
function json(raw) {
  check(typeof raw === 'string' && Buffer.byteLength(raw) <= 256 * 1024, 'Resposta de auditoria acima do limite ou ausente.');
  const result = parseJson(raw);
  check(result && typeof result === 'object', 'Auditoria sem JSON válido.');
  return result;
}
function evidence(raw, snapshot) {
  check(Array.isArray(raw) && raw.length <= 8, 'Evidências inválidas.');
  return raw.map(value => {
    const ref = sourceRef(value);
    check(['base', 'head'].includes(value.side), 'Lado da evidência inválido.');
    const file = snapshot.files.find(f => f.path === ref.path);
    const content = file?.[value.side]?.text;
    check(typeof content === 'string', 'Evidência fora do retrato auditado.');
    const quote = content.split(/\r?\n/).slice(ref.start - 1, ref.end).join('\n');
    check(ref.end <= content.split(/\r?\n/).length && value.quote === quote, 'Trecho não confere com a fonte auditada.');
    text(quote, 4000);
    return { ...ref, side: value.side, quote };
  });
}
function blindResult(raw, snapshot) {
  const result = json(raw);
  check(Array.isArray(result.observations) && result.observations.length <= 100 && Array.isArray(result.limitations) && result.limitations.length <= 30, 'Primeira leitura incompleta ou acima do limite; não truncar.');
  return { observations: result.observations.map((o, i) => {
    const refs = evidence(o.evidence, snapshot);
    check(refs.length, 'Observação sem evidência.');
    return { id: `b${i + 1}`, title: text(o.title, 140), explanation: text(o.explanation), evidence: refs };
  }), limitations: result.limitations.map(l => text(l)) };
}
function reportResult(raw, snapshot, blind, original) {
  const result = json(raw);
  check(Array.isArray(result.items) && result.items.length <= 150 && Array.isArray(result.limitations) && result.limitations.length <= 30, 'Relatório incompleto ou acima do limite; não truncar.');
  const refs = new Set(), blindRefs = new Set();
  const items = result.items.map(value => {
    check(KINDS.includes(value.kind), 'Classificação desconhecida.');
    const ref = value.ref ?? null, blindRef = value.blindRef ?? null;
    if (value.kind === 'omitted') check(ref === null, 'Omissão não pode reaproveitar achado original.');
    else if (value.kind === 'inconclusive' && ref === null) check(blindRef !== null, 'Conclusão inconclusiva sem referência independente.');
    else {
      check(typeof ref === 'string' && original.findings.some(f => f.id === ref) && !refs.has(ref), 'Achado original sem referência única.'); refs.add(ref);
    }
    if (blindRef !== null) { check(blind.observations.some(f => f.id === blindRef) && !blindRefs.has(blindRef), 'Observação independente repetida ou desconhecida.'); blindRefs.add(blindRef); }
    const proof = evidence(value.evidence, snapshot);
    check(value.kind === 'inconclusive' || proof.length, 'Conclusão sem evidência no código.');
    const item = { kind: value.kind, ref, blindRef, title: text(value.title, 140), explanation: text(value.explanation), evidence: proof };
    return { id: digest(item).slice(0, 32), ...item };
  });
  check(refs.size === original.findings.length && blindRefs.size === blind.observations.length, 'Relatório omitiu achado original ou observação independente.');
  check(new Set(items.map(i => i.id)).size === items.length, 'Itens duplicados.');
  return { items, limitations: [...blind.limitations, ...result.limitations.map(l => text(l))] };
}
function policy(raw = {}) {
  check(raw && typeof raw === 'object' && Array.isArray(raw.accounts) && raw.accounts.length <= 30, 'Informe as contas autorizadas da amostragem.');
  check(typeof raw.enabled === 'boolean' && Number.isInteger(raw.dailyLimit) && raw.dailyLimit >= 0 && raw.dailyLimit <= 10,
    'Quantidade diária deve ficar entre 0 e 10.');
  check([raw.budgetUsd, raw.reserveUsd].every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1000), 'Orçamento e reserva inválidos.');
  const accounts = [...new Set(raw.accounts.map(a => identityOf({ account: a, repo: 'audit/scope' }).account))];
  check(!raw.enabled || (accounts.length && raw.dailyLimit > 0 && raw.reserveUsd > 0 && raw.budgetUsd >= raw.reserveUsd), 'Amostragem exige conta, quantidade, orçamento e reserva por auditoria.');
  return { enabled: raw.enabled, accounts, dailyLimit: raw.dailyLimit, budgetUsd: raw.budgetUsd, reserveUsd: raw.reserveUsd };
}
const DEFAULT_POLICY = Object.freeze({ enabled: false, accounts: [], dailyLimit: 0, budgetUsd: 0, reserveUsd: 0 });
export { KINDS, text, blindResult, reportResult, policy, DEFAULT_POLICY, check, digest, SHA, ID };
