// Dívida herdada da production não bloqueia (05/11/2026). Medido em biud-frontend#1822: o
// backmerge da production na development foi reprovado pela falta de um teste num arquivo
// idêntico ao da production, uma lacuna que já estava em produção desde 31/10. Segurar o
// backmerge não melhora nada no que roda e trava a development.
//
// A régua: o que o PR traz idêntico à production é herança; o que o próprio PR cria (resolução
// de conflito, linha nova, arquivo que difere) continua podendo bloquear. Achado bloqueante em
// arquivo herdado vira sugestão, e o que vinha de rodada anterior sai como retirado, com a
// evidência. Quem decide é o app, pela comparação com a production, nunca o texto da sessão.
import io from '../io.js';

const BRANCH_DE_PRODUCAO = 'production';
// a comparação do GitHub lista no máximo 300 arquivos: no teto, não dá para saber o que ficou de fora
const TETO_DA_COMPARACAO = 300;

// Arquivos do diff do PR idênticos à production. null quando não deu para saber (repositório sem
// production, comparação truncada, falha de leitura): falta de dado nunca rebaixa nada.
async function arquivosHerdados(engine, pr, headSha, arquivosDoPr) {
  if (!headSha || !Array.isArray(arquivosDoPr) || !arquivosDoPr.length) return null;
  const conta = engine.accountForPr(pr);
  if (!pr.repo || !engine.tokenFor(conta)) return null;
  let env;
  try { env = engine.ghEnv(conta); } catch { return null; /* sem credencial para ler */ }
  const r = await io.run('gh', ['api', `repos/${pr.repo}/compare/${BRANCH_DE_PRODUCAO}...${headSha}`, '--jq', '[.files[].filename]'], { env });
  const diferentes = r.ok ? io.parseJson(r.stdout, null) : null;
  if (!Array.isArray(diferentes) || diferentes.length >= TETO_DA_COMPARACAO) return null;
  const naoIguais = new Set(diferentes);
  return arquivosDoPr.filter((f) => !naoIguais.has(f));
}

const EVIDENCIA = 'arquivo idêntico ao da production: dívida herdada, não criada por este PR; vale um follow-up na task de origem';

// PURO. Rebaixa no próprio resultado e devolve quantos achados mudaram.
function rebaixarHeranca(result, herdados) {
  if (!Array.isArray(herdados) || !herdados.length || !Array.isArray(result?.findings)) return 0;
  const herdado = new Set(herdados);
  let mudou = 0;
  result.findings = result.findings.map((f) => {
    if (!f || f.severity !== 'blocking' || !herdado.has(f.file)) return f;
    mudou += 1;
    // o que vinha de rodada anterior sai como retirado, para a memória não o guardar vivo
    if (f.ref) return { ...f, severity: 'suggestion', status: 'retirado', evidence: EVIDENCIA, herdado: true };
    return { ...f, severity: 'suggestion', herdado: true };
  });
  return mudou;
}

// Sem bloqueio próprio do PR, o pedido de mudanças da sessão não tem mais o que sustentar: o
// veredito vira aprovar, com a aprovação que a sessão já escreveu, e a decisão volta a ser da
// política da conta (o motivo vira ressalva visível no app). Sem esse texto, fica para a pessoa.
function semBloqueioProprio(result) {
  return !(result.findings || []).some((f) => f && f.severity === 'blocking');
}

function temAprovacaoEscrita(result) {
  const p = result?.payloads?.approve;
  return !!(p && p.event === 'APPROVE' && (String(p.body || '').trim() || (Array.isArray(p.comments) && p.comments.length)));
}

async function aplicarHerancaDeProducao(engine, pr, headSha, inventario, result, gateReason) {
  if (result?.verdict !== 'request_changes' && !(result?.findings || []).some((f) => f?.severity === 'blocking')) return;
  const arquivos = (inventario?.files || []).map((f) => f.path).filter(Boolean);
  const herdados = await arquivosHerdados(engine, pr, headSha, arquivos);
  const n = rebaixarHeranca(result, herdados);
  if (!n) return;
  result.reasons = [gateReason(`${n} ponto(s) em arquivo idêntico ao da production viraram sugestão: dívida herdada, não criada por este PR`), ...(result.reasons || [])];
  if (result.verdict === 'request_changes' && semBloqueioProprio(result)) {
    if (temAprovacaoEscrita(result)) result.verdict = 'approve';
    result.decision = 'needs_decision';
  }
}

export { arquivosHerdados, rebaixarHeranca, aplicarHerancaDeProducao };
