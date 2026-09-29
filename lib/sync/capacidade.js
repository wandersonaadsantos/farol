// Abrir a capacidade que outro aparelho publicou em `live/deviceStatus/{dev}` (C3a). Folha:
// sem estado, sem rede; quem lê o banco é quem chama.
//
// Dois leitores dependem dela, e por isso ela mora num lugar só: o agendador da
// distribuição (ocupação e pausa) e o teto do grupo (sequência do consumo e reservas por
// grupo). Falha FECHADA: envelope que não abre, de outro caminho ou de outro esquema,
// devolve `null`, nunca um objeto parcial.
import envelope from './envelope.js';

const CAMPO = 'capacidade';
const ESQUEMA = 'cap1';

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function abrirCapacidade({ uid, material, dev, no }) {
  if (!objeto(no) || !no.enc || !material) return null;
  const aberto = envelope.decifrar({
    enc: no.enc, material, uid, caminho: `live/deviceStatus/${dev}`, campo: CAMPO, esquema: ESQUEMA,
  });
  if (!aberto.ok || !objeto(aberto.valor) || !objeto(aberto.valor.c)) return null;
  return { u: Number(no.u) || 0, c: aberto.valor.c };
}

// --- o painel do aparelho (controle do celular, 28/09/2026) ---------------------------
//
// A capacidade ganhou a política efetiva de cada conta e as últimas falhas, e as duas vão
// COMPACTAS porque o nó tem teto de 2048 no banco e o resto da capacidade já ocupa metade:
//   politicas: um item por conta, NA MESMA ORDEM de `contas`, com os cinco valores na ordem
//              de CAMPOS_POLITICA;
//   falhas:    até MAX_FALHAS itens `[classe, instante, prTag]`, a mais recente primeiro.
// Quem lê passa por `painelDaCapacidade`, que devolve nomes por extenso e descarta o que não
// é do vocabulário. Nada de texto livre: classe é um id da taxonomia, e o PR é tag.
const CAMPOS_POLITICA = Object.freeze(['autoReview', 'muted', 'onClean', 'onCaveats', 'onReject']);
const VALORES_POLITICA = Object.freeze({
  autoReview: [true, false], muted: [true, false],
  onClean: ['approve', 'wait'], onCaveats: ['approve', 'wait'], onReject: ['request_changes', 'wait'],
});
const MAX_FALHAS = 3;
const CLASSE_RE = /^[a-z0-9-]{1,40}$/;
const TAG_RE = /^[0-9a-f]{32}$/;

function politicaCompacta(p) {
  const o = objeto(p) ? p : {};
  return CAMPOS_POLITICA.map((k) => (VALORES_POLITICA[k].includes(o[k]) ? o[k] : null));
}

function politicaPorExtenso(arr) {
  const a = Array.isArray(arr) ? arr : [];
  return Object.fromEntries(CAMPOS_POLITICA.map((k, i) => [k, VALORES_POLITICA[k].includes(a[i]) ? a[i] : null]));
}

function falhaCompacta(f) {
  const o = objeto(f) ? f : {};
  const classe = CLASSE_RE.test(String(o.classe || '')) ? String(o.classe) : 'desconhecido';
  return [classe, Math.max(0, Math.floor(Number(o.at) || 0)), TAG_RE.test(String(o.prTag || '')) ? String(o.prTag) : ''];
}

function falhaPorExtenso(arr) {
  const a = Array.isArray(arr) ? arr : [];
  if (!CLASSE_RE.test(String(a[0] || ''))) return null;
  return { classe: String(a[0]), at: Math.max(0, Math.floor(Number(a[1]) || 0)), prTag: TAG_RE.test(String(a[2] || '')) ? String(a[2]) : '' };
}

function tags(v) {
  return (Array.isArray(v) ? v : []).map(String).filter((t) => TAG_RE.test(t));
}

// CRU de propósito, como na distribuição: `true`, `false` e ausente são três coisas
function consentimento(v) {
  return v === true || v === false ? v : null;
}

function contasDoPainel(o) {
  const politicas = Array.isArray(o.politicas) ? o.politicas : [];
  const politicaDe = (i) => (politicas[i] === undefined ? null : politicaPorExtenso(politicas[i]));
  return tags(o.contas).map((acctTag, i) => ({ acctTag, politica: politicaDe(i) }));
}

function falhasDoPainel(o) {
  const lista = Array.isArray(o.falhas) ? o.falhas : [];
  return lista.slice(0, MAX_FALHAS).map(falhaPorExtenso).filter(Boolean);
}

// O que a tela do admin recebe de cada aparelho: allowlist, com os tipos estritos. Campo
// ausente num aparelho de versão antiga vira vazio, nunca um valor inventado.
function painelDaCapacidade(c) {
  const o = objeto(c) ? c : {};
  const adm = objeto(o.admissao) ? o.admissao : {};
  const ocupadas = Math.max(0, Number(adm.total) || 0);
  return {
    pausado: o.pausado === true,
    paralelismo: Math.max(1, Number(o.paralelismo) || 1),
    ocupadas,
    iaPronta: o.iaPronta === true,
    aceitarAdmin: consentimento(o.aceitarAdmin),
    contasComToken: tags(o.contasComToken),
    contas: contasDoPainel(o),
    falhas: falhasDoPainel(o),
  };
}

export default { abrirCapacidade, CAMPO, ESQUEMA, CAMPOS_POLITICA, VALORES_POLITICA, MAX_FALHAS, politicaCompacta, falhaCompacta, painelDaCapacidade };
export { abrirCapacidade, CAMPO, ESQUEMA, CAMPOS_POLITICA, VALORES_POLITICA, MAX_FALHAS, politicaCompacta, falhaCompacta, painelDaCapacidade };
