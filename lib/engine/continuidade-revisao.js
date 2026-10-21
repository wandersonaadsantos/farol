// Silenciar fecha a admissão; não revoga o trabalho que já começou. A permissão
// nasce no app, nunca no envelope do modelo nem em uma opção enviada pela API.
const trabalhos = new WeakMap();
const porPr = new WeakMap();

function iniciarTrabalho(engine, pr) {
  const account = engine.accountForPr(pr);
  if (!account || engine.isMuted?.(account)) return null;
  // Fixar a identidade impede que uma mudança na resolução por org a substitua.
  pr.account = account;
  const permissao = Object.freeze({});
  trabalhos.set(permissao, { engine, key: pr.key, account, startedAt: Date.now() });
  porPr.set(pr, permissao);
  return permissao;
}

function encerrarTrabalho(permissao) {
  if (permissao) trabalhos.delete(permissao);
}

function reciboDoTrabalho(engine, pr, headSha) {
  const t = trabalhos.get(porPr.get(pr));
  if (!t || t.engine !== engine || !headSha) return null;
  return { key: t.key, account: t.account, startedAt: t.startedAt, headSha };
}

function podeConcluir(engine, pr, payload, permissao) {
  const vivo = permissao && trabalhos.get(permissao);
  if (vivo) return vivo.engine === engine && vivo.key === pr.key && vivo.account === engine.accountForPr(pr);
  // A decisão canônica persistida pode concluir o MESMO commit depois do CI ou
  // de uma falha de rede. Uma cópia fornecida pelo chamador não concede nada.
  if (!engine.decisions?.pending?.includes(permissao)) return false;
  const t = permissao?.trabalhoIniciado;
  return !!t && Number.isFinite(t.startedAt) && t.startedAt > 0 &&
    t.key === pr.key && t.account === engine.accountForPr(pr) &&
    !!t.headSha && t.headSha === permissao.headSha && t.headSha === payload?.commit_id;
}

export { iniciarTrabalho, encerrarTrabalho, reciboDoTrabalho, podeConcluir };
