// A conta que AGE no GitHub (06/10/2026). Regra de produto: conta silenciada continua
// monitorada, mas nunca é a identidade que age.
//
// Incidente: no Farol de um celular, o `gh` tinha duas contas cobrindo a mesma org, a
// primeira silenciada e a segunda ativa. O dono quis agir como a ativa num PR da org e a
// ação saiu com a identidade da silenciada (um review dispensado, reviews re-solicitados).
// A escolha por org era "a primeira conta que cobre a org", sem olhar silêncio nem token,
// e os caminhos de escrita por clique não conferiam o silêncio da conta resolvida.
//
// Duas metades, as duas aqui:
// 1. RESOLVER: a conta de uma org é a primeira ativa com token, senão a primeira ativa, e a
//    silenciada só quando ninguém mais cobre a org (`contaDaOrg`). No dedup das buscas, a
//    conta capaz vence a incapaz, e empate mantém a primeira (`guardarPelaCapaz`, o G18).
// 2. RECUSAR: se mesmo assim a conta resolvida for silenciada, a escrita não sai e o motivo
//    é dito (`recusaDeSilenciada`). Nunca se troca de conta em silêncio no caminho de
//    escrita: quem escolhe a conta é a resolução acima, não a hora de postar.

function minusculo(v) {
  return String(v || '').toLowerCase();
}

function silenciada(engine, conta) {
  return !!conta && typeof engine.isMuted === 'function' && engine.isMuted(conta);
}

// Sem `tokenFor` (engine de teste mínimo) o token não decide nada.
function temToken(engine, conta) {
  return typeof engine.tokenFor !== 'function' || !!engine.tokenFor(conta);
}

// Capaz de agir: não silenciada e com token desta conta no `gh`.
function capazDeAgir(engine, conta) {
  return !!conta && !silenciada(engine, conta) && temToken(engine, conta);
}

// A conta monitorada que responde pela org, ou null quando nenhuma cobre a org.
function contaDaOrg(engine, owner) {
  const o = minusculo(owner);
  const cobrem = engine.accountList().filter((a) => (a.owners || []).some((x) => minusculo(x) === o));
  const ativas = cobrem.filter((a) => !a.muted);
  return ativas.find((a) => temToken(engine, a.user)) || ativas[0] || cobrem[0] || null;
}

// G18 do dedup por chave: o mesmo PR chega pela busca de duas contas (as duas cobrem a org,
// ou o time pediu revisão às duas). A capaz de agir vence a incapaz; empate mantém a primeira.
function guardarPelaCapaz(engine, mapa, pr, conta) {
  const anterior = mapa.get(pr.key);
  if (!anterior || (!capazDeAgir(engine, engine.accountForPr(anterior)) && capazDeAgir(engine, conta))) {
    mapa.set(pr.key, pr);
  }
}

function textoDeSilenciada(conta) {
  return `conta ${conta} está silenciada e não age; reative a conta ou use outra`;
}

// Recusa de escrita no GitHub com conta silenciada. null = pode seguir (para o silêncio).
function recusaDeSilenciada(engine, conta) {
  if (!silenciada(engine, conta)) return null;
  return { ok: false, blocked: 'conta_silenciada', error: textoDeSilenciada(conta) };
}

// As duas travas de conta de um clique que escreve (silêncio e token), com o aviso na tela.
// O texto e o erro de "sem token" são os de antes, byte a byte.
function barrarEscrita(engine, conta) {
  const recusa = recusaDeSilenciada(engine, conta);
  if (recusa) {
    engine.emit('toast', { kind: 'error', text: `Nada foi feito: ${recusa.error}.` });
    return recusa;
  }
  if (conta && engine.tokenFor(conta)) return null;
  engine.emit('toast', { kind: 'error', text: `Conta ${conta || '(nenhuma)'} não autenticada no gh. Rode: gh auth login` });
  return { ok: false, error: 'gh sem token' };
}

// A conta de um PR MEU é a autora, a da busca `--author @me` que o achou (`myPRs`), e não a
// que a org resolve: com duas contas na org, a resolução por org entregaria a outra pessoa,
// que se atribuiria e pediria revisão no PR de outro autor.
function contaDoMeuPr(engine, key, repo) {
  const k = minusculo(key);
  const meu = (engine.myPRs || []).find((p) => p && minusculo(p.key) === k && p.account);
  return meu ? meu.account : engine.accountForOwner(String(repo || '').split('/')[0]);
}

export default {
  contaDaOrg, guardarPelaCapaz, textoDeSilenciada, recusaDeSilenciada, barrarEscrita, contaDoMeuPr,
};
export {
  contaDaOrg, guardarPelaCapaz, textoDeSilenciada, recusaDeSilenciada, barrarEscrita, contaDoMeuPr,
};
