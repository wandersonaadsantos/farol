// Autoanálise pedida por um agente (issue #346): pedir, ler e listar, e nada mais. Só PR
// aberto de autoria do usuário da conta, num dono que essa conta monitora; o pedido roda no
// modo restrito e respeita o gasto da conta. Nenhuma função aqui escreve no GitHub nem no
// git: elas leem o engine e, no caminho feliz do pedido, chamam o mesmo lançamento do botão
// Analisar. A credencial própria é conferida antes, pelo porteiro (lib/local-auth/acesso.js).
import { parecerAprovavel } from './selfpr.js';

const FORA_DO_ESCOPO = 'só PR aberto de sua autoria, num dono monitorado pela conta (URL exata do PR)';

function recusa(code, motivo) { return { ok: false, code, motivo }; }

function mesmoNome(a, b) { return String(a || '').toLowerCase() === String(b || '').toLowerCase(); }

// myPRs vem do `gh search prs --author @me` de cada conta, que não filtra dono: o filtro do
// dono monitorado (e o autor, por defesa) é explícito aqui.
function doEscopo(engine, pr) {
  const conta = engine.accountForPr(pr);
  const owners = (engine.accountList().find(a => mesmoNome(a.user, conta)) || {}).owners || [];
  const dono = String(pr.repo || '').split('/')[0];
  return mesmoNome(pr.author, conta) && owners.some(o => mesmoNome(o, dono));
}

function prDoAgente(engine, url) {
  const pr = engine.myPRs.find(p => p.url === url);
  return pr && doEscopo(engine, pr) ? pr : null;
}

function estadoDe(engine, pr) {
  if ([...engine.activeReviews.values()].some(s => s.mode === 'self' && (s.keys || []).includes(pr.key))) return 'rodando';
  if (engine.headlessQueue.some(p => p.kind === 'self' && p.key === pr.key)) return 'na_fila';
  return engine.selfAnalyses[pr.key] ? 'pronta' : 'sem_analise';
}

// null quando não dá para saber: o head atual chega pelo enrichMyPRBranches, depois da busca.
// Análise sem head registrado não prova que vale para commit nenhum (mesma regra do motor).
function desatualizada(analise, pr) {
  if (analise.observed?.stale === true) return true;
  if (!pr.headSha) return null;
  return analise.headSha !== pr.headSha;
}

function resultado(engine, pr) {
  const base = { url: pr.url, key: pr.key, titulo: pr.title || '', estado: estadoDe(engine, pr), headAtual: pr.headSha || null };
  const a = engine.selfAnalyses[pr.key];
  if (!a) return base;
  // itens e dicas são texto livre no contrato da autoanálise; arquivo:linha garantido só no relatório
  return { ...base, veredito: a.verdict ?? null, aprovavel: parecerAprovavel(a), resumo: a.summary || '',
    itens: a.blockers || [], itensForaDoPr: a.externalBlockers || [], dicas: a.tips || [], relatorio: a.reportMarkdown || '',
    headAnalisado: a.headSha || null, analisadoEm: a.at || null, desatualizado: desatualizada(a, pr) };
}

// Pedido repetido não paga sessão: análise válida no mesmo head recusa, e com o head atual
// ainda não lido neste ciclo também (não dá para provar que é outro commit).
function recusaDoHead(analise, pr) {
  if (!analise || analise.observed?.stale === true) return null;
  if (!pr.headSha) return recusa('head_desconhecido', 'o commit atual do PR ainda não foi lido; tente de novo depois do próximo ciclo');
  if (analise.headSha === pr.headSha) return recusa('ja_analisado_neste_head', 'já existe autoanálise válida para o commit atual');
  return null;
}

// Os mesmos quatro freios que seguram a fila automática, com o motivo escrito: um agente em
// laço não gasta a assinatura sozinho.
const FREIOS_DE_GASTO = [
  ['grupo_em_espera', (e, conta) => e.grupoSegura(conta) && 'o teto do grupo de consumo está em espera'],
  ['limite_do_plano', (e, conta) => e.limiteDoPlanoAte(conta) && 'a assinatura do Claude está no limite do plano'],
  ['orcamento', (e, conta) => { const p = e.budgetBlockedFor(conta); return p && `o orçamento do perfil "${p.label}" estourou`; }],
  ['cota', (e, conta) => { const q = e.quotaBlockedFor(conta); return q && `a cota do perfil "${q.profile?.label || ''}" está no limite`; }],
];

function recusaDeGasto(engine, conta) {
  for (const [code, motivoDe] of FREIOS_DE_GASTO) {
    const motivo = motivoDe(engine, conta);
    if (motivo) return recusa(code, motivo);
  }
  return null;
}

async function pedir(engine, url) {
  const pr = prDoAgente(engine, url);
  if (!pr) return recusa('pr_fora_do_escopo', FORA_DO_ESCOPO);
  if (['na_fila', 'rodando'].includes(estadoDe(engine, pr))) return recusa('em_andamento', 'essa autoanálise já está na fila ou rodando');
  const barrado = recusaDoHead(engine.selfAnalyses[pr.key], pr) || recusaDeGasto(engine, engine.accountForPr(pr));
  if (barrado) return barrado;
  return engine.launchSelfAnalysis(pr.url, 'restricted-read');
}

function ler(engine, url) {
  const pr = prDoAgente(engine, url);
  return pr ? { ok: true, ...resultado(engine, pr) } : recusa('pr_fora_do_escopo', FORA_DO_ESCOPO);
}

function listar(engine) {
  const prs = engine.myPRs.filter(pr => doEscopo(engine, pr)).map((pr) => {
    const { resumo, itens, itensForaDoPr, dicas, relatorio, ...curto } = resultado(engine, pr);
    return curto;
  });
  return { ok: true, prs };
}

export default { pedir, ler, listar };
export { pedir, ler, listar };
