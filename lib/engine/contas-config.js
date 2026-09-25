// A configuração das contas: a política efetiva de cada uma, a edição por OPERAÇÃO e o
// rastro de toda mudança na política de automação (25/09/2026).
//
// Pedido do Wanderson: "Essas configurações precisam serem respeitadas". Quatro PRs
// aprováveis sem ressalva esperaram clique numa conta que estava em "aprova sozinho", e
// ninguém conseguiu dizer quem pôs a conta em "aguardar" naquela meia hora. A investigação
// achou a classe do defeito: a tela salvava a LISTA INTEIRA de contas a cada edição, com o
// que ela tinha na memória, e o servidor gravava a lista como veio. Um campo que a tela não
// conhecia (o peso na cota nunca chegava a ela) era apagado em todas as contas por uma
// mudança de cor; um que ela conhecia velho era ressuscitado.
//
// Aqui a tela diz O QUE mudou (editar este campo desta conta, adicionar, remover) e o
// servidor aplica sobre a config ATUAL. E cada mudança de política, venha da tela de Contas
// ou da de Automação, fica registrada com data e origem, para o próximo "aguardar" que
// ninguém lembra de ter posto ter resposta.
import { readJson, writeJsonAtomic } from '../io.js';
import { POLITICA_HISTORICO_FILE } from '../paths.js';

// O que a tela pode editar numa conta. `user` fica de fora: trocar o login é outra conta.
const CAMPOS_EDITAVEIS = Object.freeze([
  'label', 'color', 'kind', 'owners', 'muted',
  'autoReview', 'onClean', 'onCaveats', 'onReject', 'claudeProfileId', 'budgetWeight',
]);

// O que decide se o Farol age sozinho. `muted` entra porque conta silenciada sai da
// auto-revisão; cor, rótulo e perfil não mudam o que é postado.
const POLITICA_DA_CONTA = Object.freeze(['muted', 'autoReview', 'onClean', 'onCaveats', 'onReject']);
const POLITICA_GERAL = Object.freeze(['autoReview', 'autoApproveAll', 'autoApproveContested', 'coAssinarReview']);

const TETO_DO_HISTORICO = 200;

function minusculo(v) {
  return String(v || '').trim().toLowerCase();
}

function vazio(v) {
  return v === '' || v === null || v === undefined;
}

// Aplica UMA operação sobre as contas atuais. PURA: devolve a lista nova, e quem grava
// (e saneia pelo parseAccounts, a fronteira de persistência) é o updateSettings.
function aplicarEdicao(contas, op) {
  const lista = Array.isArray(contas) ? contas : [];
  const o = op && typeof op === 'object' ? op : {};
  const alvo = minusculo(o.user);
  const indice = lista.findIndex((a) => minusculo(a && a.user) === alvo);
  if (!alvo) return { ok: false, erro: 'conta sem login' };
  if (o.tipo === 'editar') {
    if (indice < 0) return { ok: false, erro: `a conta @${o.user} não existe mais no Farol` };
    const campos = o.campos && typeof o.campos === 'object' ? o.campos : {};
    const ignorados = Object.keys(campos).filter((k) => !CAMPOS_EDITAVEIS.includes(k));
    const conta = { ...lista[indice] };
    for (const k of Object.keys(campos).filter((c) => CAMPOS_EDITAVEIS.includes(c))) {
      // vazio volta a herdar o padrão geral, e herdar é não ter o campo
      if (vazio(campos[k])) delete conta[k];
      else conta[k] = campos[k];
    }
    return { ok: true, ignorados, contas: lista.map((a, i) => (i === indice ? conta : a)) };
  }
  if (o.tipo === 'adicionar') {
    if (indice >= 0) return { ok: false, erro: `a conta @${o.user} já está no Farol` };
    const nova = { user: String(o.user).trim(), owners: Array.isArray(o.owners) ? o.owners : [] };
    if (!vazio(o.label)) nova.label = String(o.label);
    return { ok: true, ignorados: [], contas: [...lista, nova] };
  }
  if (o.tipo === 'remover') {
    if (indice < 0) return { ok: false, erro: `a conta @${o.user} não existe mais no Farol` };
    if (lista.length <= 1) return { ok: false, erro: 'precisa de ao menos uma conta configurada' };
    return { ok: true, ignorados: [], contas: lista.filter((_, i) => i !== indice) };
  }
  return { ok: false, erro: 'operação de conta desconhecida' };
}

// A operação aplicada e gravada pelo updateSettings, que saneia pelo parseAccounts e
// registra o rastro. Recusa volta como veio, sem gravar nada.
function editarConta(engine, op, origem) {
  const r = aplicarEdicao(engine.config.accounts, op);
  return r.ok ? { ...engine.updateSettings({ accounts: r.contas }, origem), ignorados: r.ignorados } : r;
}

// Perfil de IA apagado não pode continuar apontado por conta. Antes a tela limpava e mandava
// a lista inteira de contas junto com a de perfis; agora o servidor faz, sobre a config atual.
function semPerfisOrfaos(contas, perfis) {
  const vivos = new Set((Array.isArray(perfis) ? perfis : []).map((p) => p && p.id).filter(Boolean));
  return (Array.isArray(contas) ? contas : []).map((a) => {
    if (!a || !a.claudeProfileId || vivos.has(a.claudeProfileId)) return a;
    const { claudeProfileId: _orfao, ...resto } = a;
    return resto;
  });
}

/* ---------- a política efetiva de cada conta ----------
   Campo ausente na conta herda o padrão geral. Morava no server.js como quatro métodos; veio
   para cá quando a edição e o rastro da mesma configuração vieram, para uma pergunta sobre
   "o que esta conta faz sozinha" ter um endereço só. */
function politicaDaConta(engine, user) {
  const u = minusculo(user);
  return engine.accountList().find((a) => minusculo(a.user) === u) || {};
}

function revisaSozinho(engine, user) {
  const a = politicaDaConta(engine, user);
  if (a.autoReview === true || a.autoReview === false) return a.autoReview;
  return engine.config.autoReview !== false;
}

function acaoAoAprovar(engine, user, limpo) {
  const a = politicaDaConta(engine, user);
  const seLimpo = a.onClean || 'approve';
  if (limpo) return seLimpo;
  if (a.onCaveats) return a.onCaveats; // valor explícito da conta vale
  // com ressalvas, sem valor próprio: herda o geral, MAS nunca mais permissivo que o
  // limpo (um PR com ressalva não pode auto-aprovar se o impecável foi posto pra aguardar)
  const geral = engine.config.autoApproveAll !== false ? 'approve' : 'wait';
  return seLimpo === 'wait' ? 'wait' : geral;
}

// reprovar sozinho é opt-in por conta: não existe reprovação automática geral
function acaoAoReprovar(engine, user) {
  return politicaDaConta(engine, user).onReject === 'request_changes' ? 'request_changes' : 'wait';
}

function valorOuNulo(v) {
  return v === undefined ? null : v;
}

function retratoDaPolitica(config) {
  const c = config && typeof config === 'object' ? config : {};
  const geral = Object.fromEntries(POLITICA_GERAL.map((k) => [k, valorOuNulo(c[k])]));
  const contas = {};
  for (const a of Array.isArray(c.accounts) ? c.accounts : []) {
    if (!a || !a.user) continue;
    contas[a.user] = Object.fromEntries(POLITICA_DA_CONTA.map((k) => [k, valorOuNulo(a[k])]));
  }
  return { geral, contas };
}

// O que mudou entre dois retratos: primeiro o padrão geral, depois conta a conta.
function mudancasDePolitica(antes, depois) {
  const saida = [];
  for (const campo of POLITICA_GERAL) {
    const de = antes.geral[campo];
    const para = depois.geral[campo];
    if (de !== para) saida.push({ conta: null, campo, de, para });
  }
  const nomes = [...new Set([...Object.keys(depois.contas), ...Object.keys(antes.contas)])];
  for (const conta of nomes) {
    for (const campo of POLITICA_DA_CONTA) {
      const de = valorOuNulo((antes.contas[conta] || {})[campo]);
      const para = valorOuNulo((depois.contas[conta] || {})[campo]);
      if (de !== para) saida.push({ conta, campo, de, para });
    }
  }
  return saida;
}

// Todo pedido à API local vem desta máquina (a allowlist de Host garante), então o que
// distingue a origem é QUAL tela: a janela do app ou um navegador aberto no endereço local.
function origemDaRequisicao(userAgent) {
  const ua = String(userAgent || '');
  if (!ua) return 'desconhecida';
  return /\bElectron\//.test(ua) ? 'janela do Farol' : 'navegador';
}

function aparar(lista) {
  return lista.length > TETO_DO_HISTORICO ? lista.slice(lista.length - TETO_DO_HISTORICO) : lista;
}

function historico(engine) {
  if (!Array.isArray(engine.politicaHistorico)) {
    const lido = readJson(POLITICA_HISTORICO_FILE, []);
    engine.politicaHistorico = Array.isArray(lido) ? lido : [];
  }
  return engine.politicaHistorico;
}

function registrarMudancas(engine, mudancas, origem, agora = Date.now()) {
  if (!mudancas.length) return;
  const novas = mudancas.map((m) => ({ at: agora, ...m, origem: origem || 'desconhecida' }));
  engine.politicaHistorico = aparar([...historico(engine), ...novas]);
  try { writeJsonAtomic(POLITICA_HISTORICO_FILE, engine.politicaHistorico); }
  catch (err) { engine.log('ERROR', `gravar politica-historico.json: ${err.message}`); }
}

// O que o updateSettings faz depois de aplicar o patch: limpar perfil órfão e registrar o
// que mudou na política. Um lugar só, para as duas rotas (Contas e Automação) passarem igual.
function depoisDeAplicar(engine, antes, patch, origem) {
  if (patch && 'claudeProfiles' in patch) {
    engine.config.accounts = semPerfisOrfaos(engine.config.accounts, engine.config.claudeProfiles);
  }
  registrarMudancas(engine, mudancasDePolitica(antes, retratoDaPolitica(engine.config)), origem);
}

function ultimaMudanca(engine, conta, campo) {
  const alvo = conta === null ? null : minusculo(conta);
  const achadas = historico(engine).filter((h) => h && h.campo === campo &&
    (alvo === null ? h.conta === null : minusculo(h.conta) === alvo));
  return achadas.length ? achadas[achadas.length - 1] : null;
}

function doisDigitos(n) {
  return String(n).padStart(2, '0');
}

function quandoEOrigem(mudanca) {
  if (!mudanca) return '';
  const d = new Date(Number(mudanca.at) || 0);
  const data = `${doisDigitos(d.getDate())}/${doisDigitos(d.getMonth() + 1)} ${doisDigitos(d.getHours())}:${doisDigitos(d.getMinutes())}`;
  const por = { 'janela do Farol': 'pela janela do Farol', navegador: 'pelo navegador' }[mudanca.origem] || 'por origem desconhecida';
  return ` (definido em ${data}, ${por})`;
}

// O motivo que o card mostra quando a política segurou a aprovação, com a configuração que
// DE FATO segurou e quando ela foi definida. Com ressalvas, quem segura pode ser a própria
// regra de ressalvas da conta, o "sem ressalvas" dela (nunca mais permissivo) ou o padrão geral.
function motivoDaPolitica(engine, conta, limpo) {
  const label = engine.scopeLabel(conta) || conta || 'esta conta';
  const a = politicaDaConta(engine, conta);
  if (limpo) {
    return `aprovável sem ressalvas, mas a política da conta ${label} manda aguardar sua aprovação${quandoEOrigem(ultimaMudanca(engine, conta, 'onClean'))} (ajuste em Sistema > Contas)`;
  }
  if (a.onCaveats || a.onClean === 'wait') {
    const campo = a.onCaveats ? 'onCaveats' : 'onClean';
    return `aprovável com ressalvas, e a política da conta ${label} é aguardar você${quandoEOrigem(ultimaMudanca(engine, conta, campo))} (mude pra "aprova e destaca as ressalvas" em Sistema > Contas se quiser que aprove sozinho)`;
  }
  return `aprovável com ressalvas, e o padrão geral é aguardar você${quandoEOrigem(ultimaMudanca(engine, null, 'autoApproveAll'))} (ligue "Aprovar sozinho também os aprováveis com ressalvas" em Sistema > Automação)`;
}

// As últimas mudanças, para o Diagnóstico. Só campo, valores e origem: nada de caminho.
function historicoRecente(engine, limite = 20) {
  return historico(engine).slice(-limite).reverse();
}

export default {
  CAMPOS_EDITAVEIS, TETO_DO_HISTORICO,
  politicaDaConta, revisaSozinho, acaoAoAprovar, acaoAoReprovar,
  aplicarEdicao, editarConta, semPerfisOrfaos, retratoDaPolitica, mudancasDePolitica, origemDaRequisicao,
  aparar, registrarMudancas, depoisDeAplicar, motivoDaPolitica, historicoRecente,
};
export {
  CAMPOS_EDITAVEIS, TETO_DO_HISTORICO,
  politicaDaConta, revisaSozinho, acaoAoAprovar, acaoAoReprovar,
  aplicarEdicao, editarConta, semPerfisOrfaos, retratoDaPolitica, mudancasDePolitica, origemDaRequisicao,
  aparar, registrarMudancas, depoisDeAplicar, motivoDaPolitica, historicoRecente,
};
