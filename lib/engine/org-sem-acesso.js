// Organização que a conta NÃO consegue buscar (15/10/2026). O GitHub responde
// `Invalid search query "... user:<org>"` quando a conta não enxerga nenhum repositório
// da organização: saiu dela, a org só tem repositório privado sem acesso, ou o nome foi
// cadastrado errado. Não é falha passageira: repete igual a cada ciclo.
//
// POR QUE IMPORTA: o Panorama de uma conta só é publicado depois que TODAS as orgs dela
// responderam (arranque a frio, lib/engine/sync-andamento.js). Uma org assim travava o
// Panorama da conta inteira para sempre, e o admin nunca via os PRs pedidos a ela (a
// conta do Alex no celular, com `team-ascent-consulting` entre 11 orgs, falhando a cada
// 5 min no farol.log). Org sem acesso não tem PR a perder, então conta como lida.
// Falha de rede continua segurando: aí o PR pode existir e só não chegou.
//
// O aviso sai UMA vez por conta e org (estado em memória), não a cada ciclo: o farol.log
// é só de falha, e a mesma linha a cada 5 min escondia o resto.
const SEM_ACESSO = /invalid search query/i;

function chave(user, owner) {
  return `${String(user || '').toLowerCase()}|${String(owner || '').toLowerCase()}`;
}

function conjunto(engine) {
  if (!(engine.ownersSemAcesso instanceof Set)) engine.ownersSemAcesso = new Set();
  return engine.ownersSemAcesso;
}

function ownerDaBusca(extraArgs) {
  const lista = Array.isArray(extraArgs) ? extraArgs : [];
  const i = lista.indexOf('--owner');
  return i >= 0 ? String(lista[i + 1] || '') : '';
}

// true = era falha de org sem acesso (registrada, e quem chama não loga de novo)
function registrarFalha(engine, user, extraArgs, stderr) {
  const owner = ownerDaBusca(extraArgs);
  if (!owner || !SEM_ACESSO.test(String(stderr || ''))) return false;
  const k = chave(user, owner);
  const c = conjunto(engine);
  if (!c.has(k)) {
    c.add(k);
    engine.log('WARN', `a conta ${user} não consegue buscar PRs da organização ${owner} (sem acesso a nenhum repositório dela); o Farol segue sem essa organização. Tire-a da conta se ela não for mais usada.`);
  }
  return true;
}

// a busca voltou a responder: a org deixa de ser tratada como sem acesso
function registrarSucesso(engine, user, extraArgs) {
  const owner = ownerDaBusca(extraArgs);
  if (owner) conjunto(engine).delete(chave(user, owner));
}

function semAcesso(engine, user, owner) {
  return conjunto(engine).has(chave(user, owner));
}

export default { registrarFalha, registrarSucesso, semAcesso };
export { registrarFalha, registrarSucesso, semAcesso };
