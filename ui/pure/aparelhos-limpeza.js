// Sistema > Aparelhos: os navegadores pareados com ESTE aparelho e os dois atos
// irreversíveis (limpeza protegida e revogação do conjunto).
//
// PURO: recebe o que a tela leu sob demanda (sessões da A4, estado da chave de limpeza) e
// devolve HTML ou o texto do desfecho.
//
// NENHUMA LISTA DA LIMPEZA MORA AQUI. As categorias alcançáveis e as nunca apagadas são
// do engine (lib/sync/limpeza.js) e chegam na leitura do estado da chave; aqui só existe o
// RÓTULO de cada id. Id sem rótulo sai como está: esconder uma categoria que a tela não
// conhece faria a lista parecer mais curta do que a remoção.
import { esc, fmtWhenDay, plural, identidadeDeAparelho } from './comum.js';

function chip(classe, texto) {
  return `<span class="sync-chip ${classe}">${esc(texto)}</span>`;
}

const ROTULO_DO_NO = {
  'live/deviceStatus': 'capacidade dos aparelhos',
  'live/devicePolicies': 'políticas dos aparelhos',
  'live/groups': 'grupos de consumo',
  catalog: 'catálogo de PRs',
  recentReviews: 'revisões recentes',
  reviewBodies: 'corpos das revisões',
  panorama: 'Panorama',
  panoramaMeta: 'controle do Panorama',
  myPrs: 'Meus PRs',
  myPrsMeta: 'controle de Meus PRs',
  pushbacks: 'contestações',
  'live/queue': 'fila compartilhada',
  'live/assign': 'atribuições',
  'live/ack': 'aceites de atribuição',
  'live/commands': 'comandos',
  commandReceipts: 'recibos de comando',
  checkpoints: 'checkpoints',
  usageEvents: 'eventos de consumo',
  usageDaily: 'consumo diário',
  keyring: 'chaveiro',
  'live/control': 'controle do conjunto',
  leases: 'posses',
  receipts: 'recibos',
  dailyRounds: 'rodadas do dia',
};

function rotuloDoNo(id) {
  return Object.hasOwn(ROTULO_DO_NO, id) ? ROTULO_DO_NO[id] : String(id);
}

function rotulos(lista) {
  return (Array.isArray(lista) ? lista : []).map(rotuloDoNo);
}

/* ---------- navegadores pareados ---------- */

function linhaDaSessao(s, agora) {
  const atual = s.atual ? chip('info', 'este navegador') : '';
  const criado = Number(s.criadoEm) > 0 ? `pareado ${fmtWhenDay(s.criadoEm, agora)}` : 'pareado em data desconhecida';
  const usado = Number(s.ultimoUsoEm) > 0 ? `usado ${fmtWhenDay(s.ultimoUsoEm, agora)}` : 'nunca usado';
  return `<div class="sync-linha apar-sessao"><span class="sync-nome">${esc(s.rotulo || 'navegador sem rótulo')}${atual}</span><span class="sync-fraco">${esc(criado)}</span><span class="sync-fraco">${esc(usado)}</span><button class="btn sm ghost" data-apar-revogar-sessao="${esc(String(s.id || ''))}">Revogar</button></div>`;
}

// Cinco saídas, nunca uma só: quem lê precisa distinguir "ainda não sei" de "não há" e de
// "não deu para saber".
const NAVEGADORES_AVISO = {
  carregando: 'carregando as sessões pareadas…',
  'nao-exigida': 'A API local deste aparelho não exige credencial, então não há navegador pareado. A exigência é configurada fora desta tela.',
};

function corpoDosNavegadores(auth, agora) {
  const a = auth || {};
  if (Object.hasOwn(NAVEGADORES_AVISO, a.estado)) return `<p class="sync-vago sync-vazio">${esc(NAVEGADORES_AVISO[a.estado])}</p>`;
  if (a.estado === 'falha') return `<p class="apar-recusa">Não deu para ler as sessões: ${esc(a.motivo || 'o servidor não respondeu')}.</p>`;
  const lista = Array.isArray(a.sessoes) ? a.sessoes : [];
  if (!lista.length) return '<p class="sync-vago sync-vazio">Nenhum navegador pareado com este aparelho agora.</p>';
  return lista.map((s) => linhaDaSessao(s || {}, agora)).join('');
}

export function aparelhosNavegadoresHtml(auth, agora) {
  return `<div class="sync-sub-head">Navegadores pareados com este aparelho</div>
  <div class="card sync-lista">${corpoDosNavegadores(auth, agora)}
    <p class="apar-nota">Revogar o navegador que você está usando leva direto ao pareamento. Para revogar todos de uma vez, no terminal: <code>node tools/farol-parear.js --revogar-todas</code>.</p>
  </div>`;
}

/* ---------- chave de limpeza ---------- */

// A chave de limpeza tem QUATRO respostas do engine mais dois estados da tela, e cada uma
// diz uma coisa diferente sobre o que dá para fazer. "Desligada ou não verificável" é o
// caso em que o banco não confirmou a chave: oferecer limpar ali seria prometer um ato que
// o servidor vai recusar.
const LIMPEZA = {
  carregando: { classe: 'mute', selo: 'carregando', texto: 'carregando o estado da chave de limpeza…' },
  'compartilhamento-desligado': { classe: 'mute', selo: 'não se aplica', texto: 'O compartilhamento cifrado está desligado, então não há dado sincronizado para apagar.' },
  desligada: { classe: 'mute', selo: 'desligada', texto: 'A limpeza de dados sincronizados está desligada. Ligar é ato do admin, e a chave fica registrada no banco.' },
  ligada: { classe: 'warn', selo: 'ligada', texto: 'A limpeza está liberada. Ela apaga o conteúdo sincronizado das categorias alcançáveis, em todos os aparelhos, e não tem volta.' },
  'desligada-ou-nao-verificavel': { classe: 'bad', selo: 'não confirmada', texto: 'O banco não dá para confirmar a chave de limpeza agora (ela pode estar desligada, ou a autoridade do admin não está verificável). Enquanto isso a limpeza não é oferecida, e apagar dado compartilhado fica no console do Firebase.' },
};

function nomeDoAparelho(devices, id) {
  const achado = (Array.isArray(devices) ? devices : []).find((d) => d && String(d.deviceId || '') === String(id || ''));
  return identidadeDeAparelho(id, { nome: achado ? achado.name : '' });
}

// A trava do banco ou o clique ainda esperando a rota: nos dois casos há limpeza correndo,
// e oferecer outra seria abrir um segundo ato sobre o primeiro.
function visaoDaLimpeza(limpeza, o) {
  const l = limpeza || {};
  if (l.estado === 'falha') return { classe: 'bad', selo: 'falha na leitura', texto: `Não deu para ler a chave de limpeza: ${l.motivo || 'o servidor não respondeu'}.` };
  if (l.travada) {
    const quem = nomeDoAparelho(o.devices, l.travada.dev);
    return { classe: 'warn', selo: 'limpando', texto: `Uma limpeza está em andamento, disparada pelo ${quem}. A trava vale até ${fmtWhenDay(l.travada.ate, o.agora)}, e enquanto isso nenhuma outra é oferecida.`, correndo: true };
  }
  if (o.limpando) return { classe: 'warn', selo: 'limpando', texto: 'A limpeza pedida daqui está em andamento; o resultado aparece quando a rota responder.', correndo: true };
  return LIMPEZA[l.estado] || LIMPEZA.carregando;
}

function acoesDaLimpeza(estado, souAdmin) {
  if (!souAdmin) return '';
  if (estado === 'desligada') return '<div class="row-actions"><button class="btn sm" id="aparLigarLimpeza">Ligar a chave de limpeza</button></div>';
  if (estado === 'ligada') return '<div class="row-actions"><button class="btn sm ghost" id="aparDesligarLimpeza">Desligar a chave</button><button class="btn sm danger-ghost" id="aparLimpar">Limpar com a senha…</button></div>';
  return '';
}

function listasDaLimpeza(l) {
  const alcance = rotulos(l.categorias);
  const nunca = rotulos(l.nuncaApagadas);
  const partes = [];
  if (alcance.length) partes.push(`<span class="sync-dica">Alcança: ${esc(alcance.join(', '))}.</span>`);
  if (nunca.length) partes.push(`<span class="sync-dica">Nunca apagados pelo app: ${esc(nunca.join(', '))}.</span>`);
  return partes.join('');
}

export function aparelhosLimpezaHtml(limpeza, opcoes) {
  const o = opcoes || {};
  const l = limpeza || {};
  const v = visaoDaLimpeza(l, o);
  const acoes = v.correndo ? '' : acoesDaLimpeza(l.estado, o.souAdmin === true);
  return `<div class="sync-sub-head">Limpeza e revogação</div>
  <div class="apar-duo">
    <div class="card apar-corpo">
      <div class="apar-titulo"><span class="set-title">Chave de limpeza</span>${chip(v.classe, v.selo)}</div>
      <span class="set-desc">${esc(v.texto)}</span>
      ${acoes}
      ${listasDaLimpeza(l)}
    </div>
    <div class="card apar-corpo">
      <span class="set-title">Revogar o conjunto</span>
      <span class="set-desc">Corta todos os acessos anteriores a agora e obriga cada aparelho a entrar de novo. Não cancela sessão em andamento em outro aparelho, não apaga o que eles já receberam e não depõe o admin.</span>
      <span class="sync-dica">Revogar não retira o consentimento deste aparelho: isso é o interruptor "Aceitar políticas e comandos do admin", acima, e vale só aqui.</span>
      <div class="row-actions"><button class="btn sm danger-ghost" id="aparRevogar">Revogar com a senha…</button></div>
    </div>
  </div>`;
}

// O desfecho da limpeza, para o aviso. Falha parcial NÃO é sucesso: a remoção é uma por
// nó, e o que ficou no banco precisa ser nomeado. Corte não gravado também não é sucesso
// limpo, porque sem ele a outbox não sabe o que descartar.
export function aparelhosResultadoDaLimpeza(r) {
  if (!r || !r.ok) return { tipo: 'error', texto: `A limpeza não foi feita: ${(r && r.motivo) || 'o servidor não respondeu'}` };
  const apagadas = Array.isArray(r.apagadas) ? r.apagadas : [];
  const falharam = rotulos(r.falharam);
  const feito = `${plural(apagadas.length, 'categoria apagada', 'categorias apagadas')}`;
  if (falharam.length) return { tipo: 'error', texto: `Limpeza parcial: ${feito}, e não saíram: ${falharam.join(', ')}. Tente de novo ou use o console do Firebase.` };
  if (r.corteGravado !== true) return { tipo: 'error', texto: `✓ ${feito}, mas o corte da limpeza não foi gravado: os aparelhos podem reenviar sessões antigas.` };
  return { tipo: 'ok', texto: `✓ ${feito}.` };
}
