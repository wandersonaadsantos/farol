// Os avisos nativos prontos (28/10/2026), PURO: quando o motor roda como sidecar das cascas
// nativas (Swift no macOS, C# no Windows), elas não rodam no mesmo processo e não podem
// montar notificação, contador do Dock e cores da janela a partir dos eventos do engine, como
// o main.js faz no Electron (wireEngine, updateBadge, tituloDePrsNovos, themeColors). O motor
// entrega tudo pronto pelo SSE (eventos `aviso-nativo` e `casca`, em lib/http-server.js).
//
// Os textos são IDÊNTICOS aos do main.js, de propósito: a duplicação vale até o Electron sair
// de cena, e os casos de test/avisos-nativos.test.js viram test/fixtures/casca/eventos.json,
// o contrato de paridade das duas cascas. Texto mudou aqui, muda lá também.
import { interventionEvent, quietNow } from '../../ui/pure/interventions.js';
import { prKeyFromUrl } from '../../ui/pure/mencoes.js';
// motivo viaja como { text, kind }: interpolar o objeto cru escreveria "[object Object]"
import { reasonText } from '../format.js';

function tituloDePrsNovos(n, auto) {
  if (auto) return n === 1 ? 'PR novo, na fila da revisão automática' : `${n} PRs novos, na fila da revisão automática`;
  return n === 1 ? 'PR aguardando sua revisão' : `${n} PRs aguardando sua revisão`;
}

const montar = (titulo, corpo, url, pr, silencioso = false) => ({ titulo, corpo, url: url || null, pr: pr || null, silencioso });

function avisoDeNovos({ items = [], auto } = {}) {
  const n = items.length;
  if (!n) return null;
  const um = n === 1 ? items[0] : null;
  const corpo = um ? `${um.key}: ${um.title}` : items.map(i => i.key).join('  ·  ');
  return montar(`Farol · ${tituloDePrsNovos(n, auto)}`, corpo, um && um.url, um && um.key);
}

// alertas dizem o DESFECHO e o MOTIVO (aprovado sem/com ressalvas, reprovado)
function avisoDeAprovado({ pr, result = {}, points }) {
  const ressalvas = points || [];
  if (ressalvas.length) {
    const extra = ressalvas.length > 1 ? ` (+${ressalvas.length - 1})` : '';
    return montar('Farol · aprovado com ressalvas ⚠️', `${pr.key}: APPROVE postado. Ressalva: ${reasonText(ressalvas[0])}${extra}. Detalhes em Revisões recentes.`, pr.url, pr.key);
  }
  return montar('Farol · aprovado sem ressalvas ✅', `${pr.key} (${result.card || 'sem card'}): revisão completa, nenhum ponto de atenção. APPROVE postado.`, pr.url, pr.key);
}

function avisoDeReprovado({ pr, result = {} }) {
  const motivo = reasonText((result.reasons || [])[0]) || 'ver relatório';
  return montar('Farol · reprovado 🔴', `${pr.key}: mudanças pedidas. Motivo: ${motivo}`, pr.url, pr.key);
}

// PR da própria conta que revisa: o GitHub recusa a revisão decisiva do autor
function avisoDeComentado({ pr }) {
  return montar('Farol · comentado 💬', `${pr.key}: o PR é da própria conta que revisa, então a revisão saiu como comentário.`, pr.url, pr.key);
}

function avisoDeFerramenta({ name, label }) {
  return montar(`Farol · ${label}`, name === 'kudos' ? 'Kudos prontos pra copiar na aba Destaques.' : 'Relatório disponível na aba Sistema.');
}

// sem url, como no main.js: o clique leva à pendência dentro do app, não ao GitHub
function avisoDeIntervencao(raw, config, agora) {
  const event = interventionEvent(raw);
  if (!event) return null;
  const pr = event.target.type === 'pr' ? prKeyFromUrl(event.target.url) : null;
  return montar(`Farol · ${event.title}`, event.body, null, pr, quietNow(config || {}, new Date(agora)));
}

// o título não repete "Farol" (o sistema já mostra o nome do app); no agrupado o clique leva
// ao primeiro PR
function avisoDaBase(a) {
  const primeiro = (a.itens || [])[0] || {};
  return montar(a.tituloSistema, a.corpo, a.url || primeiro.url, primeiro.key);
}

const POR_EVENTO = {
  'new-prs': avisoDeNovos,
  'auto-approved': avisoDeAprovado,
  'auto-rejected': avisoDeReprovado,
  'auto-commented': avisoDeComentado,
  'tool-done': avisoDeFerramenta,
  intervention: avisoDeIntervencao,
  'meu-pr-base': avisoDaBase,
};

// { titulo, corpo, url, pr, silencioso } ou null (evento que não vira notificação)
function avisoDe(evento, payload, { config, agora = Date.now() } = {}) {
  const montador = Object.hasOwn(POR_EVENTO, evento) ? POR_EVENTO[evento] : null;
  if (!montador || !payload) return null;
  return montador(payload, config, agora);
}

// pendência que espera o CI ou a prova não é "esperando você": o Farol decide sozinho
function badgeDe(snapshot) {
  const pendentes = ((snapshot && snapshot.decisions) || {}).pending || [];
  const contador = pendentes.filter(d => d && !d.esperaCi && !d.esperaProva).length;
  if (!contador) return { contador, rotulo: '' };
  return { contador, rotulo: contador === 1 ? '1 decisão esperando você' : `${contador} decisões esperando você` };
}

function coresDe(config) {
  return config && config.theme === 'light'
    ? { bg: '#f4f6f9', symbol: '#1c2536' }
    : { bg: '#0b0e14', symbol: '#e7ecf5' };
}

// O retrato da casca. O `state` traz o snapshot e o `settings-changed` traz a config, e quem
// os tem passa; sem eles, lê do engine.
function cascaDe(engine, { snapshot, config } = {}) {
  const cfg = config || engine.config || {};
  return {
    badge: badgeDe(snapshot || engine.snapshot()),
    ocupado: engine.activeReviews.size > 0,
    autostart: !!cfg.autostart,
    cores: coresDe(cfg),
  };
}

const avisos = { avisoDe, badgeDe, cascaDe, tituloDePrsNovos };
export default avisos;
export { avisoDe, badgeDe, cascaDe, tituloDePrsNovos };
