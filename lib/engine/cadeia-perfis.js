// Cadeia de perfis (20/10/2026): qual assinatura paga a revisão, em ordem de prioridade.
//
// Pedido do dono: "definir por ordem qual a conta que consome primeiro e qual é fallback da
// conta prioritária, assim sempre vou ter algumas opções sem travar o Farol". Exemplo dele:
// Gemini X principal, Gemini Y fallback 1, Claude Max fallback 2. "Caso estourou a conta
// Gemini X, salva quando volta o limite e vai direto pra Gemini Y, e assim por diante, e
// segue a prioridade de qual vai consumir primeiro."
//
// `config.cadeiaPerfis` é a lista ordenada `[{ id, ativo }]` com TODOS os perfis salvos. A
// sessão usa o primeiro perfil ligado e disponível. "No limite" vem do registro por
// assinatura que já existia (lib/engine/limite-plano.js): não há segundo registro. Quando o
// reset passa, o registro vence sozinho e o perfil prioritário volta a ser o escolhido sem
// ninguém fazer nada, porque a escolha é refeita a cada pergunta.
//
// O que NÃO muda, de propósito (nada fica mais permissivo do que era):
//   - conta do GitHub com perfil próprio (`accounts[].claudeProfileId`) usa SÓ esse perfil.
//     A cadeia vale para as contas sem perfil próprio. Deixar a conta transbordar para a
//     cadeia faria uma conta presa à assinatura do trabalho gastar a pessoal.
//   - orçamento do perfil não troca de perfil: estourou, a automação pausa como antes. O
//     orçamento é ritmo escolhido pelo dono, e a cadeia não é jeito de contorná-lo.
//   - grupo de consumo e política do admin seguem valendo sobre o perfil escolhido.
//   - perfil novo entra na cadeia DESLIGADO: nenhuma assinatura passa a gastar sem escolha.
//
// `claudeProfileId` (o antigo "perfil padrão do Farol") continua existindo, derivado: é o
// primeiro perfil ligado da cadeia. Quem ainda o lê (versão antiga, diagnóstico) vê o mesmo
// que a cadeia diria sem nenhum limite.
import { authFromProfile } from './perfil-claude.js';
import { registroDaAssinatura } from './limite-plano.js';
import { provedorDoPerfil } from './provedores.js';
import { agendarLeitura, cotaParaTela } from '../agy/cota.js';

const MAX_ENTRADAS = 64;

function lista(v) { return Array.isArray(v) ? v : []; }

// Só a forma: o que existe como perfil quem confere é `reconciliar`, que tem a lista inteira.
function normalizarCadeia(v) {
  const vistos = new Set();
  const out = [];
  for (const e of lista(v)) {
    const id = typeof e?.id === 'string' ? e.id.trim() : '';
    if (!id || vistos.has(id) || out.length >= MAX_ENTRADAS) continue;
    vistos.add(id);
    out.push({ id, ativo: e.ativo === true });
  }
  return out;
}

// Roda no boot e depois de toda gravação de configuração. Idempotente.
// Migração: config sem `cadeiaPerfis` ganha a cadeia com o perfil padrão de hoje, ligado, e
// os outros perfis desligados. Comportamento idêntico ao de antes.
function reconciliar(config, patch = null) {
  const perfis = lista(config.claudeProfiles);
  const ids = new Set(perfis.map(p => p.id));
  const padrao = config.claudeProfileId || '';
  let cadeia;
  if (!Array.isArray(config.cadeiaPerfis)) cadeia = ids.has(padrao) ? [{ id: padrao, ativo: true }] : [];
  else cadeia = normalizarCadeia(config.cadeiaPerfis).filter(e => ids.has(e.id));
  // gravação que só troca o padrão (adoção do legado, listar o login da máquina, tela de
  // versão antiga): o escolhido vai para o topo, ligado, que é o que "padrão" queria dizer
  const soOPadrao = patch && Object.hasOwn(patch, 'claudeProfileId') && !Object.hasOwn(patch, 'cadeiaPerfis');
  // o mesmo vale para o padrão que a cadeia nem conhece (config editada à mão, ou gravada
  // por uma versão sem cadeia depois da migração): ele roda hoje, então entra no topo
  const desconhecido = ids.has(padrao) && !cadeia.some(e => e.id === padrao);
  if ((soOPadrao || desconhecido) && ids.has(padrao)) cadeia = [{ id: padrao, ativo: true }, ...cadeia.filter(e => e.id !== padrao)];
  for (const p of perfis) if (!cadeia.some(e => e.id === p.id)) cadeia.push({ id: p.id, ativo: false });
  config.cadeiaPerfis = cadeia;
  const primeiro = cadeia.find(e => e.ativo);
  // id que não existe fica como estava: é o problema que lib/engine/perfil-claude.js mostra
  // ("perfil apontado não existe"), e apagá-lo esconderia o aviso sem mudar o que roda
  if (primeiro) config.claudeProfileId = primeiro.id;
  else if (ids.has(padrao)) config.claudeProfileId = '';
}

// Perfil Codex: o diagnóstico lista todos como prontos (o login é o do Codex CLI da máquina),
// e quem diz se esse login vale é o `codexChatGPT` do mesmo diagnóstico.
function prontidaoDoDoctor(engine, perfil) {
  const id = perfil.id;
  if (perfil.kind === 'codex' && engine?.doctorInfo?.codexChatGPT === false) return false;
  const lidos = lista(engine?.doctorInfo?.claudeAuth);
  const p = lidos.find(x => x?.id === id);
  return p ? p.ready !== false : true;
}

// O estado de um perfil da cadeia, na ordem em que a escolha o considera.
function estadoDoPerfil(engine, perfil, entrada, agora) {
  if (!entrada.ativo) return { estado: 'desligado' };
  const auth = authFromProfile(perfil, engine?.config);
  if (!auth) return { estado: 'problema' };
  // Antigravity: a cota se lê sem gastar nada (lib/agy/cota.js). A pergunta não espera: cota
  // velha agenda a leitura, e o grupo esgotado entra no registro abaixo para a próxima
  if (auth.kind === 'agy') agendarLeitura(engine, perfil, auth, agora);
  const limite = registroDaAssinatura(engine, auth, agora);
  if (limite) return { estado: 'limite', ate: limite.ate, estimado: limite.estimado };
  if (!prontidaoDoDoctor(engine, perfil)) return { estado: 'sem-login' };
  return { estado: 'pronto' };
}

function avaliar(engine, agora) {
  const config = engine?.config ?? {};
  const perfis = lista(config.claudeProfiles);
  return normalizarCadeia(config.cadeiaPerfis)
    .map(e => ({ entrada: e, perfil: perfis.find(p => p.id === e.id) }))
    .filter(x => x.perfil)
    .map(x => ({ id: x.perfil.id, perfil: x.perfil, ativo: x.entrada.ativo, ...estadoDoPerfil(engine, x.perfil, x.entrada, agora) }));
}

// A escolha: o primeiro pronto. Sem nenhum pronto, o de reset mais cedo (a fila espera por
// ele, sem estacionar e sem abrir sessão, pelo limiteAte da conta). Sem limite nenhum, o
// primeiro sem login, que é o que a cadeia de um perfil só já fazia: tenta e mostra a falha.
// '' = cadeia sem perfil ligado; quem chama cai no login legado, como antes.
function escolher(avaliados) {
  const pronto = avaliados.find(a => a.estado === 'pronto');
  if (pronto) return pronto.id;
  const limitados = avaliados.filter(a => a.estado === 'limite').sort((a, b) => a.ate - b.ate);
  if (limitados.length) return limitados[0].id;
  const semLogin = avaliados.find(a => a.estado === 'sem-login');
  return semLogin ? semLogin.id : '';
}

function perfilDaCadeia(engine, agora = Date.now()) {
  return escolher(avaliar(engine, agora));
}

// Qual AUTENTICAÇÃO usar nas sessões desta conta do GitHub (era o corpo do
// Engine.resolveClaudeAuth, que virou fachada). Cascata: 1) o perfil próprio da conta, fixo;
// 2) a cadeia; 3) sem perfil utilizável, o claudeConfigDir legado (sempre kind dir).
function authDaConta(engine, user, agora = Date.now()) {
  const config = engine.config ?? {};
  const acc = lista(config.accounts).find(a => a?.user === user);
  const profiles = lista(config.claudeProfiles);
  if (profiles.length) {
    const id = acc?.claudeProfileId || perfilDaCadeia(engine, agora) || config.claudeProfileId || '';
    const resolved = authFromProfile(profiles.find(p => p.id === id), config);
    if (resolved) return resolved;
  }
  return { kind: 'dir', id: '', dir: config.claudeConfigDir || '' };
}

function estadoNaTela(a, emUso) {
  if (a.id === emUso && a.estado === 'pronto') return 'em-uso';
  return a.estado;
}

// O que a tela recebe: allowlist, sem chave, sem pasta.
function cadeiaParaTela(engine, agora = Date.now()) {
  const avaliados = avaliar(engine, agora);
  const emUso = escolher(avaliados);
  const ligados = avaliados.filter(a => a.ativo);
  const contas = lista(engine?.config?.accounts);
  return {
    emUso,
    todosNoLimite: ligados.length > 0 && ligados.every(a => a.estado === 'limite'),
    entradas: avaliados.map(a => {
      const prov = provedorDoPerfil(a.perfil);
      return {
        id: a.id,
        label: String(a.perfil.label || ''),
        provedor: prov?.id ?? '',
        provedorRotulo: prov?.rotulo ?? '',
        ativo: a.ativo,
        estado: estadoNaTela(a, emUso),
        ate: a.ate || 0,
        estimado: a.estimado === true,
        // Antigravity: a cota lida por grupo, com a hora do reset (null nos outros provedores)
        cota: a.perfil.kind === 'agy' ? cotaParaTela(engine, a.perfil) : null,
      };
    }),
    contasComPerfilProprio: contas.filter(c => c?.claudeProfileId).map(c => ({ user: String(c.user || ''), perfil: String(c.claudeProfileId) })),
  };
}

export default { normalizarCadeia, reconciliar, perfilDaCadeia, authDaConta, cadeiaParaTela, escolher };
export { normalizarCadeia, reconciliar, perfilDaCadeia, authDaConta, cadeiaParaTela, escolher };
