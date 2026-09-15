// Co-assinatura com a coordenação entre aparelhos ligada (7.C0b da spec
// 2026-09-15-operacao-multidispositivo). Continua opt-in e continua NÃO sendo revisão: não
// abre sessão, não fabrica envelope para shouldAutoApprove e não conta consumo. O que muda
// é a ordem das provas:
//   1. posse de postagem (o mesmo lease das análises, tipo 'post');
//   2. DEPOIS da posse: o commit atual ainda é o do endosso, a aprovação de quem pegou o
//      PR é NESSE commit (head vazio ou review sem commit_id não provam) e eu ainda não
//      aprovei esse commit;
//   3. a postagem sai ancorada no commit confirmado, pelo funil, sem recuo sem âncora.
// Commit novo é desfecho explícito, com aviso: o endosso anterior não aprova o commit novo.
import { adquirirPosseDePostagem } from '../sync/posse-postagem.js';

function logar(engine, nivel, msg) {
  if (typeof engine.log === 'function') engine.log(nivel, msg);
}

// PURA: a pessoa do endosso aprovou ESTE commit?
function aprovouNoMesmoSha(reviews, quem, head) {
  if (!Array.isArray(reviews) || !head) return false;
  const alvo = String(quem || '').toLowerCase();
  return reviews.some((r) => !!r && r.state === 'APPROVED' && String(r.quem).toLowerCase() === alvo && r.commit === head);
}

async function headAtual(engine, pr) {
  try {
    return String((await engine.headSha(pr)) || '');
  } catch {
    return '';
  }
}

async function soltar(handle) {
  try { await handle.abort(); } catch { /* lease que não sai agora expira sozinho pelo TTL */ }
}

function avisarCommitNovo(engine, pr, quem, head, vivo) {
  logar(engine, 'INFO', `co-assinatura de ${pr.key}: o commit ${head.slice(0, 8)} deu lugar a ${vivo.slice(0, 8)}; a aprovação de @${quem} não vale para o commit novo`);
  engine.emit('toast', { kind: 'info', text: `${pr.key}: chegou commit novo depois da aprovação de @${quem}, então não aprovei; o endosso anterior não vale para o commit novo.` });
  return false;
}

async function postarEndosso(engine, pr, dados) {
  const { quem, head, corpo, concluir, handle } = dados;
  const payload = { event: 'APPROVE', body: corpo, comments: [], commit_id: head };
  const post = await engine.postReview(pr, payload, { via: 'coassinatura', handle, commitIdObrigatorio: head, recuoPermitido: false });
  if (!post.ok) {
    logar(engine, 'WARN', `co-assinatura de ${pr.key} não saiu: ${post.error}`);
    return false;
  }
  concluir();
  if (post.deduped) return false;
  engine.emit('toast', { kind: 'ok', text: `✅ ${pr.key} aprovado junto com @${quem} (você não gastou revisão).` });
  return true;
}

async function comPosse(engine, pr, dados) {
  const { quem, head, reler, concluir } = dados;
  const vivo = await headAtual(engine, pr);
  if (!vivo) return false;
  if (vivo !== head) return avisarCommitNovo(engine, pr, quem, head, vivo);
  if (!aprovouNoMesmoSha(await reler(), quem, head)) return false;
  const meus = await engine.myReviewStates(pr, head);
  if (meus === null) return false;
  if (meus.includes('APPROVED')) {
    concluir();
    return false;
  }
  return postarEndosso(engine, pr, dados);
}

async function coAssinarCoordenado(engine, pr, dados) {
  if (!dados || !dados.head) return false;
  const posse = await adquirirPosseDePostagem(engine, { prKey: pr.key, account: engine.accountForPr(pr), headSha: dados.head });
  if (!posse.ok) return false;
  try {
    return await comPosse(engine, pr, { ...dados, handle: posse.handle });
  } finally {
    await soltar(posse.handle);
  }
}

export default { coAssinarCoordenado, aprovouNoMesmoSha };
export { coAssinarCoordenado, aprovouNoMesmoSha };
