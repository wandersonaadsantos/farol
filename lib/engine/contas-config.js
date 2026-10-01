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
import { migrarParalelismo, migrarPolitica, politicaExplicita } from './contas-migracao.js';

// O que a tela pode editar numa conta. `user` fica de fora: trocar o login é outra conta.
const CAMPOS_EDITAVEIS = Object.freeze([
  'label', 'color', 'kind', 'owners', 'muted',
  'autoReview', 'onClean', 'onCaveats', 'onReject', 'claudeProfileId', 'budgetWeight',
]);

// O que decide se o Farol age sozinho. `muted` entra porque conta silenciada sai da
// auto-revisão; cor, rótulo e perfil não mudam o que é postado.
const POLITICA_DA_CONTA = Object.freeze(['muted', 'autoReview', 'onClean', 'onCaveats', 'onReject']);
// As chaves gerais de revisar e de aprovar com ressalvas saíram daqui em 30/09/2026 (a
// política mora só na conta, lib/engine/contas-migracao.js), e a de aprovar discordando
// de outro review também: discordância é sempre ressalva, e quem decide é a conta.
const POLITICA_GERAL = Object.freeze(['coAssinarReview', 'aguardarCiParaRevisar']);

// O domínio de cada seletor da política. Valor fora dele não é gravado: ausente passaria a valer o
// padrão da conta nova, e um valor torto não pode virar, em silêncio, "aprova" ou "reprova sozinho".
const DOMINIO_DA_POLITICA = Object.freeze({
  autoReview: [true, false], onClean: ['approve', 'wait'], onCaveats: ['approve', 'wait'], onReject: ['request_changes', 'wait'],
});

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
    const tortos = Object.keys(campos).filter((k) => DOMINIO_DA_POLITICA[k] && !vazio(campos[k]) && !DOMINIO_DA_POLITICA[k].includes(campos[k]));
    const ignorados = [...Object.keys(campos).filter((k) => !CAMPOS_EDITAVEIS.includes(k)), ...tortos];
    const conta = { ...lista[indice] };
    for (const k of Object.keys(campos).filter((c) => CAMPOS_EDITAVEIS.includes(c) && !tortos.includes(c))) {
      // vazio remove o campo; nos quatro da política, a gravação o reescreve com o padrão
      if (vazio(campos[k])) delete conta[k];
      else conta[k] = campos[k];
    }
    // O com ressalvas nunca é mais permissivo que o limpo, também na escrita (30/09/2026).
    // Pedir "aprova" nas ressalvas de conta cujo limpo espera você é recusa, não gravação
    // calada de outro valor: quem pediu (a tela ou o admin à distância) precisa saber.
    if (conta.onClean === 'wait' && campos.onCaveats === 'approve') {
      return { ok: false, erro: `o "sem ressalvas" de @${o.user} espera você, então o "com ressalvas" também espera` };
    }
    if (conta.onClean === 'wait') conta.onCaveats = 'wait';
    return { ok: true, ignorados, contas: lista.map((a, i) => (i === indice ? conta : a)) };
  }
  if (o.tipo === 'adicionar') {
    if (indice >= 0) return { ok: false, erro: `a conta @${o.user} já está no Farol` };
    // a política da conta nova é escrita por extenso na gravação (depoisDeAplicar)
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

/* ---------- a política de cada conta ----------
   Lida SÓ da conta (30/09/2026). Não existe mais padrão geral a herdar: a migração
   (lib/engine/contas-migracao.js) escreveu em cada conta o que ela já fazia. Campo
   ausente (conta que ainda não passou pela gravação) vale o padrão da conta nova, pela
   mesma função que a migração usa, para as duas leituras nunca se desencontrarem. */
function politicaDaConta(engine, user) {
  const u = minusculo(user);
  return engine.accountList().find((a) => minusculo(a.user) === u) || {};
}

function revisaSozinho(engine, user) {
  return politicaExplicita(politicaDaConta(engine, user)).autoReview;
}

// `limpo` = aprovável sem ressalvas. O com ressalvas nunca é mais permissivo que o limpo:
// quem garante é politicaExplicita, na leitura, e aplicarEdicao, na escrita.
function acaoAoAprovar(engine, user, limpo) {
  const p = politicaExplicita(politicaDaConta(engine, user));
  return limpo ? p.onClean : p.onCaveats;
}

/* ---------- a migração aplicada no engine ----------
   Na carga da config e quando a conta do gh é detectada: escreve a política por extenso,
   descarta as chaves gerais antigas e registra o que mudou, uma vez, com origem
   "migração". Devolve se mudou, para quem chama saber que precisa gravar. */
function escreverPoliticaPorExtenso(engine) {
  const r = migrarPolitica(engine.config);
  if (!r.mudou) return r;
  engine.config.accounts = r.contas;
  for (const k of r.descartar) delete engine.config[k];
  return r;
}

// O teto total de quem já tinha o compartilhamento ligado (contas-migracao.js explica):
// roda só aqui, na carga, e o marcador `esquemaConfig` garante que é uma vez.
function preservarTetoTotal(engine) {
  const r = migrarParalelismo(engine.config);
  if (!r.mudou) return r;
  engine.config.esquemaConfig = r.esquemaConfig;
  if ('globalParallelReviews' in r) engine.config.globalParallelReviews = r.globalParallelReviews;
  return r;
}

function aplicarMigracao(engine) {
  const politica = escreverPoliticaPorExtenso(engine);
  const paralelismo = preservarTetoTotal(engine);
  registrarMudancas(engine, [...(politica.mudou ? politica.mudancas : []), ...paralelismo.mudancas], 'migração');
  return politica.mudou || paralelismo.mudou;
}

// reprovar sozinho é política por conta (padrão da conta nova desde 01/10/2026): não existe reprovação automática geral
function acaoAoReprovar(engine, user) {
  return politicaExplicita(politicaDaConta(engine, user)).onReject;
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

// O que mudou entre dois retratos: primeiro as chaves gerais, depois conta a conta.
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

// A origem é o texto da tela local ('janela do Farol', 'navegador') ou, desde o controle do
// celular (28/09/2026), `{ origem: 'admin', aparelho }`: a mudança veio de um comando do
// aparelho admin, e o nome dele fica no rastro junto da data.
function origemDoRastro(origem) {
  if (origem && typeof origem === 'object') {
    const aparelho = String(origem.aparelho || '').trim().slice(0, 64);
    return { origem: String(origem.origem || '') || 'desconhecida', ...(aparelho ? { aparelho } : {}) };
  }
  return { origem: origem || 'desconhecida' };
}

function registrarMudancas(engine, mudancas, origem, agora = Date.now()) {
  if (!mudancas.length) return;
  const rastro = origemDoRastro(origem);
  const novas = mudancas.map((m) => ({ at: agora, ...m, ...rastro }));
  engine.politicaHistorico = aparar([...historico(engine), ...novas]);
  try { writeJsonAtomic(POLITICA_HISTORICO_FILE, engine.politicaHistorico); }
  catch (err) { engine.log('ERROR', `gravar politica-historico.json: ${err.message}`); }
}

// Conexões (modo simples) edita `ghUser` e `owners`. Desde que a conta única virou conta
// de verdade na lista (30/09/2026), quem monitora é a lista: com UMA conta, os dois campos
// de Conexões são dela, e sem este espelho eles passariam a não mudar nada.
function espelharModoSimples(engine, patch) {
  const contas = engine.config.accounts;
  if ('accounts' in patch || !Array.isArray(contas) || contas.length !== 1) return;
  const conta = { ...contas[0] };
  if ('owners' in patch && Array.isArray(engine.config.owners)) conta.owners = [...engine.config.owners];
  if ('ghUser' in patch && engine.config.ghUser) conta.user = engine.config.ghUser;
  engine.config.accounts = [conta];
}

// O que o updateSettings faz depois de aplicar o patch: limpar perfil órfão, escrever a
// política por extenso em conta que chegou sem ela e registrar o que mudou. Um lugar só,
// para as duas rotas (Contas e Automação) passarem igual.
function depoisDeAplicar(engine, antes, patch, origem) {
  if (patch && 'claudeProfiles' in patch) {
    engine.config.accounts = semPerfisOrfaos(engine.config.accounts, engine.config.claudeProfiles);
  }
  if (patch && ('owners' in patch || 'ghUser' in patch)) espelharModoSimples(engine, patch);
  escreverPoliticaPorExtenso(engine);
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
  const admin = mudanca.aparelho ? `pelo admin (${mudanca.aparelho})` : 'pelo admin';
  const migracao = 'quando a política passou das chaves gerais para a conta';
  const por = { 'janela do Farol': 'pela janela do Farol', navegador: 'pelo navegador', admin, 'migração': migracao }[mudanca.origem] || 'por origem desconhecida';
  return ` (definido em ${data}, ${por})`;
}

// O motivo que o card mostra quando a política segurou a aprovação, com a configuração que
// DE FATO segurou e quando ela foi definida. Com ressalvas, quem segura é a regra de
// ressalvas da conta ou o "sem ressalvas" dela (o com ressalvas nunca é mais permissivo).
function motivoDaPolitica(engine, conta, limpo) {
  const label = engine.scopeLabel(conta) || conta || 'esta conta';
  if (limpo) {
    return `aprovável sem ressalvas, mas a política da conta ${label} manda aguardar sua aprovação${quandoEOrigem(ultimaMudanca(engine, conta, 'onClean'))} (ajuste em Sistema > Contas)`;
  }
  if (politicaExplicita(politicaDaConta(engine, conta)).onClean === 'wait') {
    return `aprovável com ressalvas, e o "sem ressalvas" da conta ${label} espera você, então o com ressalvas também espera${quandoEOrigem(ultimaMudanca(engine, conta, 'onClean'))} (ajuste em Sistema > Contas)`;
  }
  return `aprovável com ressalvas, e a política da conta ${label} é aguardar você${quandoEOrigem(ultimaMudanca(engine, conta, 'onCaveats'))} (mude pra "aprova (as ressalvas ficam no app)" em Sistema > Contas se quiser que aprove sozinho)`;
}

// As últimas mudanças, para o Diagnóstico. Só campo, valores e origem: nada de caminho.
function historicoRecente(engine, limite = 20) {
  return historico(engine).slice(-limite).reverse();
}

export default {
  CAMPOS_EDITAVEIS, TETO_DO_HISTORICO,
  politicaDaConta, revisaSozinho, acaoAoAprovar, acaoAoReprovar, aplicarMigracao,
  aplicarEdicao, editarConta, semPerfisOrfaos, retratoDaPolitica, mudancasDePolitica, origemDaRequisicao,
  aparar, registrarMudancas, depoisDeAplicar, motivoDaPolitica, historicoRecente,
};
export {
  CAMPOS_EDITAVEIS, TETO_DO_HISTORICO,
  politicaDaConta, revisaSozinho, acaoAoAprovar, acaoAoReprovar, aplicarMigracao,
  aplicarEdicao, editarConta, semPerfisOrfaos, retratoDaPolitica, mudancasDePolitica, origemDaRequisicao,
  aparar, registrarMudancas, depoisDeAplicar, motivoDaPolitica, historicoRecente,
};
