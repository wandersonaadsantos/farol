// O pedido de mudanças que o Farol postou sai quando o problema foi resolvido (05/11/2026).
// Regra do dono, medida no biud-frontend#1779: "se o problema que deu o resultado request
// changes foi resolvido, automaticamente deverá remover o request changes, mas isso não quer
// dizer aprovação automática". O GitHub não faz isso sozinho (dispensar review no push só
// derruba aprovação), e sem esta peça a única saída da rodada era postar um veredito novo.
//
// Retirar e aprovar são decisões separadas: aqui nada aprova, e a aprovação continua atrás dos
// gates e da política da conta. Só sai o pedido AUTOMÁTICO desta conta: o feito à mão é decisão
// de uma pessoa, e o de outro revisor não é nosso.
import fs from 'node:fs';
import path from 'node:path';
import io, { writeJsonAtomic } from '../io.js';
import { STATE_DIR } from '../paths.js';
import { roundGap } from './review-findings.js';
import { motivoDeEspera } from './gate-espera.js';
import { defeitosDoPr } from './desfecho-automatico.js';
import { publicTextLanguageIssues } from './public-review.js';
import { recusaDaConta, recusaPorEstado } from './postagem-portao.js';
import { pontosDaProvaEsgotada } from './busca-da-prova.js';

const SEM_PEDIDO = Object.freeze({ ok: false, motivo: 'sem_pedido_anterior' });
// O que o gate da aprovação pode recusar sem que isso diga nada sobre o problema estar resolvido.
const RECUSAS_ALHEIAS = new Set(['politica', 'ci_vermelho', 'ci_em_andamento']);
// Falha que outra tentativa pode resolver; a varredura insiste até este teto.
const MOTIVOS_PASSAGEIROS = new Set(['leitura_falhou', 'envio_falhou']);
const TETO_DE_TENTATIVAS = 5;

// PURO. "Resolvido" é evidência, nunca o texto da sessão. Devolve 'sim', 'ci' (só falta o CI
// fechar verde neste head) ou 'nao'. A régua da memória é a do enforce em qualquer modo, e exige
// rodada anterior: sem ela não há como afirmar que o que foi pedido foi respondido. O resto vem
// do gate da aprovação, com a prova esgotada de fora quando ela dispensou alguma lacuna não dura.
// A marca só diz que esta foi a última tentativa no commit: a rodada que fechou tudo nela prova
// como qualquer outra (biud-esg#522, 05/11/2026: 4 de 4 lidos, nada pendente, pedido mantido).
function provaDaRetirada(engine, pr, result) {
  if (result?.verdict !== 'approve' || result.analysisStatus !== 'complete' || !result.headSha) return 'nao';
  if (pontosDaProvaEsgotada(result).length) return 'nao';
  if (roundGap(result, 'enforce', 'approve') || !result.roundReview?.parentIds?.length) return 'nao';
  if (defeitosDoPr(result).length) return 'nao';
  const gate = engine.shouldAutoApprove(pr, result);
  if (!gate.ok && !RECUSAS_ALHEIAS.has(gate.motivo)) return 'nao';
  return motivoDeEspera(result) || result.checksVerifiedHead !== result.headSha ? 'ci' : 'sim';
}

function textoDaRetirada(head) {
  return `Os pontos que pedi estão resolvidos no commit ${String(head).slice(0, 7)}. Retiro o pedido de mudanças; isso não é aprovação.`;
}

// Minhas decisões no PR, em todas as páginas e em ordem. O `--slurp` não anda junto do `--jq`,
// então cada review vem numa linha. Devolve null quando não deu para ler.
async function meusReviews(engine, pr, conta) {
  const me = String(conta).toLowerCase();
  const r = await io.run('gh', ['api', `repos/${pr.repo}/pulls/${pr.number}/reviews`, '--paginate',
    '--jq', `.[] | select(((.user.login // "") | ascii_downcase) == "${me}") | select(.state == "APPROVED" or .state == "CHANGES_REQUESTED" or .state == "DISMISSED") | {id: .id, state: .state, commit: .commit_id, at: .submitted_at}`],
  { env: engine.ghEnv(conta) });
  if (!r.ok) return null;
  const meus = String(r.stdout || '').split('\n').filter((l) => l.trim()).map((l) => io.parseJson(l, null));
  if (meus.includes(null)) return null;
  return meus.sort((x, y) => String(x.at).localeCompare(String(y.at)));
}

function pedidosAutomaticos(engine, pr, conta) {
  const eu = String(conta).toLowerCase();
  return (engine.decisions?.resolved || []).filter((d) => d.key === pr.key && d.status === 'auto_rejected'
    && (!d.pr?.account || String(d.pr.account).toLowerCase() === eu));
}

// Há o que conferir? Sem pedido automático deste PR, a rodada comum não gasta gh.
function temPedidoAutomatico(engine, pr, head, { mesmoCommit = false } = {}) {
  const conta = engine.accountForPr(pr);
  return pedidosAutomaticos(engine, pr, conta).some((d) => d.headSha && (mesmoCommit || d.headSha !== head));
}

// Um pedido à mão no mesmo commit do automático é indistinguível dele pelo histórico: mais de um
// review meu no mesmo commit segura, contando o já dispensado, senão o pedido humano posto depois
// de dispensar o automático sairia no lugar dele. Pedido meu sem decisão automática também segura,
// e sem rodada gravada o que ele pediu nunca foi respondido. O do CI não depende de rodada: o
// problema dele era o check.
function todosAutomaticos(engine, pr, conta, alvos, meus, { mesmoCommit, head }) {
  const decisoes = pedidosAutomaticos(engine, pr, conta).filter((d) => d.roundId || (mesmoCommit && d.headSha === head));
  const commits = new Set(decisoes.map((d) => d.headSha));
  const noCommit = (commit) => meus.filter((r) => r.commit === commit && r.state !== 'APPROVED').length;
  return alvos.every((r) => commits.has(r.commit) && noCommit(r.commit) === 1);
}

async function enviarRetirada(engine, pr, conta, id, message) {
  const file = path.join(STATE_DIR, `pr-retirada-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  try {
    writeJsonAtomic(file, { message });
    return await io.run('gh', ['api', '-X', 'PUT', `repos/${pr.repo}/pulls/${pr.number}/reviews/${id}/dismissals`, '--input', file], { env: engine.ghEnv(conta) });
  } catch (err) {
    return { ok: false, stderr: err.message };
  } finally {
    try { fs.unlinkSync(file); } catch { /* best-effort: o arquivo não tem segredo */ }
  }
}

// Falha aqui nunca segura o desfecho da revisão: o motivo vai para o log e para o resultado.
// `antesDeEnviar` é a última conferência de quem chama (cancelamento e posse do PR), colada na
// escrita, e pode lançar de propósito. `mesmoCommit` é o pedido pelo CI vermelho: o problema
// era o check, e ele pode ser resolvido sem commit novo. `comRodada` diz que a rodada deste head
// também provou os pedidos anteriores, que então saem junto.
async function retirarPedidoResolvido(engine, pr, head, { antesDeEnviar, mesmoCommit = false, comRodada = false, continuidade } = {}) {
  const conta = engine.accountForPr(pr);
  if (!engine.tokenFor(conta)) return { ok: false, motivo: 'sem_token' };
  if (!temPedidoAutomatico(engine, pr, head, { mesmoCommit })) return SEM_PEDIDO;
  if (recusaDaConta(engine, pr, { event: 'REQUEST_CHANGES', commit_id: head }, continuidade)) return { ok: false, motivo: 'conta' };
  const meus = await meusReviews(engine, pr, conta);
  if (!meus) {
    engine.log('WARN', `retirar pedido de mudanças ${pr.key}: não deu para ler os reviews`);
    return { ok: false, motivo: 'leitura_falhou' };
  }
  const ultimo = meus.at(-1);
  if (ultimo?.state !== 'CHANGES_REQUESTED' || (!mesmoCommit && ultimo.commit === head)) return SEM_PEDIDO;
  // pela marca do CI, os pedidos mais antigos só saem com a prova da rodada
  const alvos = meus.filter((r) => r.state === 'CHANGES_REQUESTED' && (!mesmoCommit || comRodada || r.commit === head));
  if (!alvos.length) return SEM_PEDIDO;
  if (!todosAutomaticos(engine, pr, conta, alvos, meus, { mesmoCommit, head })) return { ok: false, motivo: 'pedido_manual' };
  const message = textoDaRetirada(head);
  if (publicTextLanguageIssues(message, 'body', conta).length) return { ok: false, motivo: 'linguagem' };
  if (await recusaPorEstado(engine, pr, { event: 'REQUEST_CHANGES' })) return { ok: false, motivo: 'pr_fechado' };
  if (antesDeEnviar) antesDeEnviar();
  for (const review of alvos) {
    const r = await enviarRetirada(engine, pr, conta, review.id, message);
    if (!r.ok) {
      engine.log('ERROR', `retirar pedido de mudanças ${pr.key}: ${String(r.stderr || 'erro desconhecido').trim().slice(0, 300)}`);
      return { ok: false, motivo: 'envio_falhou' };
    }
  }
  engine.emit('toast', { kind: 'ok', text: `↩️ ${pr.key}: o problema foi resolvido, então o pedido de mudanças saiu. Retirar não é aprovar.` });
  return { ok: true };
}

const marcaDaRodada = (head) => ({ tipo: 'rodada', head, tentativas: 0 });
// A marca anterior da mesma rodada é a prova dos pedidos antigos: ela não se perde no pedido pelo CI.
const marcaDoCi = (head, anterior) => ({ tipo: 'ci', head, tentativas: 0, comRodada: anterior?.head === head && (anterior.tipo === 'rodada' || anterior.comRodada === true) });

function deveInsistir(r, marca) {
  return !r.ok && MOTIVOS_PASSAGEIROS.has(r.motivo) && (marca.tentativas += 1) < TETO_DE_TENTATIVAS;
}

async function umaRetirada(engine, item, lerCi) {
  const marca = item.retiradaPendente;
  const lido = await lerCi(engine, item);
  if (!lido) return false;
  if (lido.estado !== 'OPEN' || lido.head !== marca.head) { item.retiradaPendente = null; return true; }
  if (!lido.faltando || lido.faltando.length) return false;
  const pr = { ...item.pr, key: item.key };
  const r = await retirarPedidoResolvido(engine, pr, marca.head, { mesmoCommit: marca.tipo === 'ci', comRodada: marca.comRodada === true, continuidade: item });
  if (r.ok) item.pedidoRetirado = { head: marca.head, at: Date.now() };
  if (!deveInsistir(r, marca)) item.retiradaPendente = null;
  return true;
}

// O que ficou para depois: CI que ainda não tinha fechado, pedido feito pelo CI vermelho e
// falha passageira. Vale para qualquer política da conta, porque retirar não depende dela, e
// roda antes da aprovação do mesmo ciclo. `lerCi` vem de espera-ci.js, dono dessa leitura.
async function varrerRetiradas(engine, lerCi) {
  const { pending = [], resolved = [] } = engine.decisions || {};
  let mudou = false;
  for (const item of [...pending, ...resolved].filter((d) => d?.retiradaPendente)) {
    try { mudou = (await umaRetirada(engine, item, lerCi)) || mudou; }
    catch (err) { engine.log('WARN', `retirada do pedido ${item.key}: ${err.message}`); }
  }
  if (mudou) engine.saveDecisions();
}

export { provaDaRetirada, retirarPedidoResolvido, temPedidoAutomatico, textoDaRetirada, varrerRetiradas, marcaDaRodada, marcaDoCi, MOTIVOS_PASSAGEIROS };
