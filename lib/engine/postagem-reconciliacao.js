// Reconciliação das postagens INCERTAS (CT-POST, "Reconciliação de enviando"). O check()
// chama logo depois do reconcilePending e antes do retryFailedPosts. Para cada registro
// local em `enviando`:
//   - achou review MEU naquele head, com o mesmo veredito, criado depois da intenção:
//     `confirmada`, e o recibo do head passa a publicado;
//   - só conclui `nao_enviada` com DUAS leituras bem-sucedidas da lista de reviews,
//     separadas por TEMPOS.POSTAGEM_RECONCILIACAO_ESPERA_MS e ambas começando pelo menos
//     essa janela depois da intenção, sem o review. A gravação exige posse e vai primeiro
//     ao banco: sem o banco, a dúvida continua;
//   - leitura que falha não conta e mantém a dúvida.
// Enquanto a dúvida dura, o funil recusa qualquer POST daquele head e veredito.
import { TEMPOS } from '../constants.js';
import { adquirirPosseDePostagem } from '../sync/posse-postagem.js';
import { lerRegistro, gravarDesfecho, listarIncertos, gravarLeituras, adotarLocal, marcarPublicado, agoraDe } from './registro-postagem.js';

const ESTADO_NO_GITHUB = { APPROVE: 'APPROVED', REQUEST_CHANGES: 'CHANGES_REQUESTED' };

function coordenacaoLigada(engine) {
  return !!engine && typeof engine.syncCoordenacaoAtiva === 'function' && engine.syncCoordenacaoAtiva() === true;
}

// PURA: a leitura que começou em `inicio` conta para a regra das duas leituras?
function leituraConta(registro, inicio) {
  const espera = TEMPOS.POSTAGEM_RECONCILIACAO_ESPERA_MS;
  if (!(inicio >= Number(registro.intencaoEm) + espera)) return false;
  const leituras = Array.isArray(registro.leiturasVazias) ? registro.leiturasVazias : [];
  if (!leituras.length) return true;
  return inicio - Number(leituras[leituras.length - 1]) >= espera;
}

// PURA: este review prova que a tentativa saiu?
function provaDaTentativa(registro, review) {
  if (!review || review.state !== ESTADO_NO_GITHUB[registro.evento]) return false;
  if (review.commit !== registro.head) return false;
  return Number.isFinite(review.at) && review.at >= Number(registro.intencaoEm);
}

function contextoDe(registro) {
  return { account: registro.account, prKey: registro.prKey, head: registro.head, evento: registro.evento };
}

function prDe(registro) {
  const partes = String(registro.prKey || '').split('#');
  return { key: registro.prKey, repo: partes[0], number: parseInt(partes[1], 10), account: registro.account };
}

async function lerReviews(engine, pr) {
  try {
    return await engine.myReviewsWithTime(pr);
  } catch {
    return null;
  }
}

async function confirmar(engine, ctx, registro) {
  await gravarDesfecho(engine, ctx, registro.tentativaId, { estado: 'confirmada', motivo: 'reconciliada-no-github' });
  await marcarPublicado(engine, ctx);
  return true;
}

async function concluirNaoEnviada(engine, ctx, registro) {
  const posse = await adquirirPosseDePostagem(engine, { prKey: ctx.prKey, account: ctx.account, headSha: ctx.head });
  if (!posse.ok) return false;
  try {
    const r = await gravarDesfecho(engine, ctx, registro.tentativaId, { estado: 'nao_enviada', motivo: 'reconciliada-sem-review' }, { remotoPrimeiro: true });
    return r.remoto === true;
  } finally {
    try { await posse.handle.abort(); } catch { /* lease que não sai agora expira sozinho pelo TTL */ }
  }
}

async function reconciliarUm(engine, registro) {
  const ctx = contextoDe(registro);
  const lido = await lerRegistro(engine, ctx);
  if (!lido.ok) return false;
  const ef = lido.efetivo;
  if (ef && !ef.invalido && ef.tentativaId !== registro.tentativaId) {
    adotarLocal(engine, ctx, ef);
    return false;
  }
  if (ef && !ef.invalido && ef.estado !== 'enviando') {
    adotarLocal(engine, ctx, ef);
    return true;
  }
  const inicio = agoraDe(engine);
  const reviews = await lerReviews(engine, prDe(registro));
  if (!Array.isArray(reviews)) return false;
  if (reviews.some((r) => provaDaTentativa(registro, r))) return confirmar(engine, ctx, registro);
  if (!leituraConta(registro, inicio)) return false;
  const anteriores = Array.isArray(registro.leiturasVazias) ? registro.leiturasVazias : [];
  const leituras = [...anteriores, inicio];
  gravarLeituras(engine, ctx, leituras);
  if (leituras.length < 2) return false;
  return concluirNaoEnviada(engine, ctx, registro);
}

async function reconciliarPostagensIncertas(engine) {
  if (!coordenacaoLigada(engine)) return 0;
  let resolvidas = 0;
  for (const registro of listarIncertos(engine)) {
    if (await reconciliarUm(engine, registro)) resolvidas++;
  }
  if (resolvidas && typeof engine.pushState === 'function') engine.pushState();
  return resolvidas;
}

export default { reconciliarPostagensIncertas, leituraConta, provaDaTentativa };
export { reconciliarPostagensIncertas, leituraConta, provaDaTentativa };
