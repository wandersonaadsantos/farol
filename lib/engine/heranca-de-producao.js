// Dívida herdada da production não bloqueia backmerge (05/11/2026). Medido em biud-frontend#1822: o
// merge-back da production na development foi reprovado pela falta de um teste num arquivo idêntico
// ao da production, lacuna que já estava em produção. A primeira reprovação do mesmo PR (hash do
// manifest deixado errado pela resolução de conflito) procedia e continua possível.
//
// A sessão produz a evidência e o app decide (o rebaixamento exige as duas metades):
//   - a sessão marca o achado com `herdadoDaProducao: true` e diz por quê na evidência;
//   - o app confere que o PR é merge-back (o head contém a ponta da production e a base não é ela)
//     e que o arquivo é herdado de verdade: idêntico à ponta da production e não alterado na base
//     desde o ancestral comum. Arquivo em que a base tinha trabalho próprio é resolução de
//     conflito, e o que o PR criou ali continua bloqueando.
// Só causa `defeito_codigo` ou `card` é rebaixada: estado do PR já segue outro caminho.
import io from '../io.js';

const PRODUCAO = 'production';
// a comparação do GitHub lista no máximo 300 arquivos: no teto, não dá para saber o que ficou de fora
const TETO_DA_COMPARACAO = 300;
const CAUSAS_DE_DIVIDA = new Set(['defeito_codigo', 'card']);

const candidato = (f) => f && f.severity === 'blocking' && f.herdadoDaProducao === true && CAUSAS_DE_DIVIDA.has(f.causa);

// null: não deu para ler; NAO_EXISTE: o GitHub disse 404 (repositório sem production)
const NAO_EXISTE = Symbol('nao-existe');
async function ler(engine, conta, args) {
  let env;
  try { env = engine.ghEnv(conta); } catch { return null; /* sem credencial para ler */ }
  const r = await io.run('gh', ['api', ...args], { env });
  if (!r.ok) return /HTTP 404|Not Found/i.test(String(r.stderr || '')) ? NAO_EXISTE : null;
  return io.parseJson(r.stdout, null);
}

const arquivosDe = (c) => (Array.isArray(c?.files) && c.files.length < TETO_DA_COMPARACAO ? c.files.map((f) => f.filename) : null);

// Arquivos do diff herdados de verdade da production, ou null quando o PR não é merge-back ou não
// deu para saber. Repositório sem production fica guardado e não paga a consulta de novo.
async function arquivosHerdados(engine, pr, headSha, arquivosDoPr) {
  const conta = engine.accountForPr(pr);
  if (!headSha || !pr.repo || !pr.number || !arquivosDoPr.length || !engine.tokenFor(conta)) return null;
  if (engine.semProducao?.has(pr.repo)) return null;
  const base = await ler(engine, conta, [`repos/${pr.repo}/pulls/${pr.number}`, '--jq', '{base: .base.ref}']);
  if (!base?.base || base.base === PRODUCAO) return null;
  const doHead = await ler(engine, conta, [`repos/${pr.repo}/compare/${PRODUCAO}...${headSha}`, '--jq', '{behind: .behind_by, files: [.files[] | {filename}]}']);
  // só o 404 é guardado: falha passageira (rede, 5xx, limite) não desliga a regra no repositório
  if (doHead === NAO_EXISTE) { (engine.semProducao ||= new Set()).add(pr.repo); return null; }
  if (!doHead) return null;
  // merge-back: o head contém a ponta da production, e só então a comparação de três pontos é a
  // diferença contra a ponta (o ancestral comum é a própria ponta)
  if (doHead.behind !== 0) return null;
  const daBase = await ler(engine, conta, [`repos/${pr.repo}/compare/${PRODUCAO}...${encodeURIComponent(base.base)}`, '--jq', '{files: [.files[] | {filename}]}']);
  const diferemDaProducao = arquivosDe(doHead);
  const mexidosNaBase = arquivosDe(daBase);
  if (!diferemDaProducao || !mexidosNaBase) return null;
  const fora = new Set([...diferemDaProducao, ...mexidosNaBase]);
  return arquivosDoPr.filter((f) => !fora.has(f));
}

const NOTA = 'conferido pelo app: arquivo idêntico ao da production e sem mudança própria da base; dívida herdada, vale um follow-up na task de origem';

// PURO. Rebaixa no próprio resultado o que a sessão declarou herdado e o app confirmou.
function rebaixarHeranca(result, herdados) {
  if (!Array.isArray(herdados) || !herdados.length || !Array.isArray(result?.findings)) return 0;
  const herdado = new Set(herdados);
  let mudou = 0;
  result.findings = result.findings.map((f) => {
    if (!candidato(f) || !herdado.has(f.file)) return f;
    mudou += 1;
    const evidence = [String(f.evidence || '').trim(), NOTA].filter(Boolean).join(' · ');
    // o que vinha de rodada anterior sai como retirado, para a memória não o guardar vivo
    // `herancaConfirmada` é a marca do APP: só ela isenta a memória de rodadas
    return { ...f, severity: 'suggestion', evidence, herancaConfirmada: true, ...(f.ref ? { status: 'retirado' } : {}) };
  });
  return mudou;
}

function temAprovacaoEscrita(result) {
  const p = result?.payloads?.approve;
  return !!(p && p.event === 'APPROVE' && (String(p.body || '').trim() || (Array.isArray(p.comments) && p.comments.length)));
}

async function aplicarHerancaDeProducao(engine, pr, headSha, inventario, result, gateReason) {
  // a marca do app nunca vem da sessão
  if (Array.isArray(result?.findings)) result.findings = result.findings.map((f) => { if (!f || !('herancaConfirmada' in f)) return f; const { herancaConfirmada, ...resto } = f; return resto; });
  if (!(result?.findings || []).some(candidato)) return;
  const arquivos = (inventario?.files || []).map((f) => f.path).filter(Boolean);
  const antes = result.findings;
  const n = rebaixarHeranca(result, await arquivosHerdados(engine, pr, headSha, arquivos));
  if (!n) return;
  // pedido de mudanças sem bloqueio e sem texto de aprovação seria incoerente (e nova análise
  // paga): nesse caso nada é rebaixado e a decisão fica com a pessoa, como estava
  if (result.verdict === 'request_changes' && !result.findings.some((f) => f?.severity === 'blocking') && !temAprovacaoEscrita(result)) {
    result.findings = antes;
    return;
  }
  result.reasons = [gateReason(`${n} ponto(s) em arquivo herdado da production viraram sugestão: dívida que já estava em produção, não criada por este PR`), ...(result.reasons || [])];
  // sem bloqueio próprio, o pedido de mudanças não tem o que sustentar: a decisão volta à política
  // da conta, com o motivo como ressalva. Sem texto de aprovação escrito, fica com a pessoa.
  if (result.verdict === 'request_changes' && !result.findings.some((f) => f?.severity === 'blocking')) {
    result.verdict = 'approve';
    result.decision = 'needs_decision';
  }
}

export { arquivosHerdados, rebaixarHeranca, aplicarHerancaDeProducao };
