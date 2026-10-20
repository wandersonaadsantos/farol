// Revisão que morreu por limite do plano, com a cadeia de perfis (20/10/2026).
//
// Antes: o limite era registrado só com hora citada, e o PR esperava o reset (ou, sem hora,
// tentava de novo a cada ciclo até o teto e estacionava). Com a cadeia
// (lib/engine/cadeia-perfis.js), o perfil que bateu no limite fica indisponível até o
// reset e a conta passa a resolver para o próximo perfil ligado. O PR volta sozinho já no
// ciclo seguinte, nesse perfil, sem esperar clique. Só quando TODOS os perfis da conta
// estão no limite o PR espera, e espera o primeiro reset: sem estacionar e sem abrir sessão
// até lá (o limiteAte da conta segura a boca da sessão e o retry).
//
// Reset desconhecido: o provedor não disse a hora. Fica registrado um prazo ESTIMADO
// (TEMPOS.LIMITE_PLANO_SEM_HORA_MS), visível como estimado na tela. Uma hora é o meio-termo
// entre o ciclo de polling (relançar a cada 3 minutos é pagar sessão para descobrir de novo
// o mesmo limite) e a janela de 5 horas do plano (esperar a janela inteira à toa quando o
// limite era por modelo ou já passou). Uma sessão que dá certo libera o perfil antes.
import { registrarLimite, limiteAte, liberarLimite } from './limite-plano.js';
import { limiteDaMensagem, provedorDoKind } from './provedores.js';
import { TEMPOS } from '../constants.js';

// "21:00". Hora local da máquina, o mesmo fuso em que resetAtFrom interpreta a mensagem
// (ver a nota de FUSO em lib/log-taxonomy.js).
function horaCurta(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function rotuloDoPerfil(engine, id) {
  const p = (engine.config?.claudeProfiles ?? []).find(x => x.id === id);
  return String(p?.label ?? '');
}

// Devolve { notBefore, aviso, ate, estimado, seguinte }. notBefore null = a cadeia tem outro
// perfil livre e o PR relança no próximo ciclo.
function aposLimite(engine, pr, err, msg, agora = Date.now()) {
  const conta = engine.accountForPr(pr);
  const usado = err?.perfilDaSessao ?? null;
  const prov = provedorDoKind(usado?.kind);
  // a hora exata que o provedor leu (o `/usage` do Antigravity) vale antes do texto
  const lido = err?.limitePlano?.ate > agora ? { limite: true, ate: err.limitePlano.ate } : limiteDaMensagem(prov?.id ?? 'claude', msg, agora);
  const estimado = !(lido.ate > agora);
  const ate = estimado ? agora + TEMPOS.LIMITE_PLANO_SEM_HORA_MS : lido.ate;
  registrarLimite(engine, conta, ate, agora, { auth: usado, estimado });
  const nome = (usado && rotuloDoPerfil(engine, usado.id)) || 'do Farol';
  const hora = `${horaCurta(ate)}${estimado ? ' (hora estimada: o provedor não informou o reset)' : ''}`;
  const espera = limiteAte(engine, conta, agora);
  if (!espera) {
    const seguinte = rotuloDoPerfil(engine, engine.resolveClaudeAuth(conta).id) || 'seguinte da cadeia';
    return { notBefore: null, ate, estimado, seguinte, aviso: `O perfil "${nome}" chegou ao limite do plano até ${hora}. Retomo ${pr.key} no perfil "${seguinte}"; ele está na sua fila.` };
  }
  const quando = espera === ate ? hora : horaCurta(espera);
  return { notBefore: espera, ate, estimado, seguinte: '', aviso: `Limite do plano atingido no perfil "${nome}" e não há outro perfil livre na cadeia. Retomo ${pr.key} sozinho depois das ${quando}; ele está na sua fila.` };
}

// A sessão amarra o desfecho à assinatura que USOU (sem a chave, só o que identifica o
// limite). Com a cadeia de perfis (lib/engine/cadeia-perfis.js) a conta pode resolver para
// outro perfil quando o desfecho chega: a falha leva a assinatura para o limite travar o
// perfil que bateu nele, e o sucesso libera exatamente esse perfil.
// Chamada por runProvedor (lib/engine/session.js) e pelo ramo do Antigravity (lib/agy/sessao.js).
function comPerfilDaSessao(engine, promessa, auth) {
  const usado = { kind: auth.kind, id: auth.id || '', dir: auth.dir || '', ...(auth.grupo ? { grupo: auth.grupo } : {}) };
  return promessa.then((res) => {
    liberarLimite(engine, '', usado);
    return res;
  }, (err) => {
    if (err && typeof err === 'object' && !err.perfilDaSessao) err.perfilDaSessao = usado;
    throw err;
  });
}

export default { aposLimite, horaCurta, comPerfilDaSessao };
export { aposLimite, horaCurta, comPerfilDaSessao };

