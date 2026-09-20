// POR QUE O ITEM AINDA ESPERA, para o aparelho que publicou o candidato (divergência 5 da
// evidência da tela do Radar).
//
// O PROBLEMA QUE ISTO RESOLVE: o veredito do agendador nascia e morria no admin
// (`cicloDoAgendador` devolvia o relatório ao chamador e mais nada), então o aparelho que
// publicou o candidato via o PR parado sem motivo nenhum. "Esperando distribuição" sem
// porquê é exatamente o silêncio que a spec proíbe.
//
// NÃO É UM SISTEMA NOVO DE SINCRONIZAÇÃO. O veredito entra como um CAMPO do nó que já
// existe para o item (`live/assign/{item}/espera`), cifrado como todo o resto, com prazo
// próprio; e as outras duas fontes o aparelho já lê no mesmo ciclo: a atribuição viva (o
// próprio nó) e a recusa do executor (`live/ack/{item}`).
//
// É APRESENTAÇÃO, nunca decisão: nada aqui escolhe aparelho, reserva vaga ou posta. O
// campo não é assinado de propósito, pelo mesmo motivo do nome do owner do candidato, e
// nenhum caminho de decisão o lê. Veredito que não abre simplesmente não aparece.
import { SYNC } from '../constants.js';
import envelope from '../sync/envelope.js';
import publicar from './sync-publicar.js';

const NO_ATRIBUICAO = 'live/assign';
const CAMPO = 'espera';
const ESQUEMA = 'esp1';
// o veredito vale por uma janela curta: motivo velho é pior que motivo nenhum, porque o
// aparelho já pode ter ganhado vaga desde então
const TTL_MS = SYNC.ATRIBUICAO_TTL_MS;
const MAX_APARELHOS = 8;

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function mapaDe(v) {
  return objeto(v) ? v : {};
}

function caminhoDe(itemId) {
  return `${NO_ATRIBUICAO}/${itemId}/${CAMPO}`;
}

function aparelhosDe(lista) {
  return (Array.isArray(lista) ? lista : [])
    .filter((a) => objeto(a) && a.dev && a.motivo)
    .slice(0, MAX_APARELHOS)
    .map((a) => ({ d: String(a.dev), m: String(a.motivo) }));
}

// A impressão do que foi publicado: sem ela o admin reescreveria o mesmo veredito a cada
// giro de 10 segundos, e o campo viraria ruído de escrita.
function impressaoDe(motivo, aparelhos) {
  return `${motivo}|${aparelhos.map((a) => `${a.d}:${a.m}`).join(',')}`;
}

function publicadas(rt) {
  if (!(rt.esperasPublicadas instanceof Map)) rt.esperasPublicadas = new Map();
  return rt.esperasPublicadas;
}

async function publicarUma(rt, { itemId, motivo, aparelhos, agora }) {
  const caminho = caminhoDe(itemId);
  const cifrado = envelope.cifrar({
    uid: rt.uid, caminho, campo: CAMPO, no: NO_ATRIBUICAO, esquema: ESQUEMA,
    cur: rt.cur, material: rt.material, r: 1, extras: [itemId],
    dados: { m: String(motivo), a: aparelhos },
  });
  if (!cifrado.ok) return false;
  const w = await rt.client.put(`/users/${rt.uid}/${caminho}`, { v: 1, ttl: agora + TTL_MS, enc: cifrado.enc }, {});
  return !!(w && w.ok);
}

// Só o admin chama isto, e só para item que ficou sem aparelho: item atribuído tem o
// próprio nó dizendo para quem foi, e o nó inteiro é reescrito pela atribuição.
async function publicarEsperas(engine, avaliados, { agora = Date.now() } = {}) {
  const rt = engine.sync;
  if (!rt || !rt.client || !rt.uid || !rt.material || !rt.cur) return { ok: false, escritas: [] };
  const mapa = publicadas(rt);
  const escritas = [];
  for (const a of Array.isArray(avaliados) ? avaliados : []) {
    if (!objeto(a) || !a.itemId || a.desfecho !== 'sem-aparelho-apto') continue;
    const aparelhos = aparelhosDe(a.aparelhos);
    const impressao = impressaoDe(a.motivo || '', aparelhos);
    if (mapa.get(a.itemId) === impressao) continue;
    if (!await publicarUma(rt, { itemId: a.itemId, motivo: a.motivo || '', aparelhos, agora })) continue;
    mapa.set(a.itemId, impressao);
    escritas.push(a.itemId);
  }
  return { ok: true, escritas };
}

function abrirEspera(rt, itemId, no) {
  if (!objeto(no) || !no.enc) return null;
  const aberto = envelope.decifrar({
    enc: no.enc, material: rt.material, uid: rt.uid, caminho: caminhoDe(itemId), campo: CAMPO, esquema: ESQUEMA, extras: [itemId],
  });
  if (!aberto.ok || !objeto(aberto.valor)) return null;
  const lista = Array.isArray(aberto.valor.a) ? aberto.valor.a : [];
  return {
    motivo: String(aberto.valor.m || ''),
    aparelhos: lista.filter((a) => objeto(a) && a.d).map((a) => ({ deviceId: String(a.d), motivo: String(a.m || '') })),
  };
}

// As três fontes convivem, e a mais NOVA vale. Comparar por instante é o que evita dizer
// "o distribuidor escolheu alguém" depois de esse alguém já ter recusado, e o contrário
// também: recusa velha não apaga a atribuição que veio depois dela. O instante de cada uma
// sai do prazo que ela carrega, porque é o dado que viaja.
// `papel` diz DE QUEM é o `dev` de cada fonte, e existe desde 20/09/2026 porque o campo
// carregava três sujeitos diferentes com o mesmo nome: o aparelho ESCOLHIDO (atribuição
// viva), o que RECUSOU (resposta do executor) e ninguém (veredito do agendador). Quem lia
// tinha de adivinhar pelo `motivo`, e uma fonte nova com `dev` seria lida como "escolhido"
// sem ninguém notar.
function daAtribuicao(no, agora) {
  const a = objeto(no) ? no : {};
  if (!a.dev || !(Number(a.ttl) > Number(agora))) return null;
  return { motivo: 'atribuicao-viva', dev: String(a.dev), papel: 'escolhido', aparelhos: [], at: Number(a.ttl) - SYNC.ATRIBUICAO_TTL_MS };
}

function doVeredito(rt, itemId, no, agora) {
  const a = objeto(no) ? no : {};
  if (!objeto(a.espera) || !(Number(a.espera.ttl) > Number(agora))) return null;
  const aberto = abrirEspera(rt, itemId, a.espera);
  if (!aberto) return null;
  return { motivo: aberto.motivo, dev: '', papel: '', aparelhos: aberto.aparelhos, at: Number(a.espera.ttl) - TTL_MS };
}

function maisNova(candidatas) {
  const vivas = candidatas.filter(Boolean);
  if (!vivas.length) return null;
  return vivas.sort((a, b) => b.at - a.at)[0];
}

const CODIGOS_DA_RECUSA = ['saida_de_cena', 'sem_token', 'head_mudou', 'orcamento', 'sem_vaga', 'inapto'];

// A recusa do executor é dele, não do agendador: ela chega pelo `live/ack` e vale enquanto
// a espera que ela declarou não vencer.
function daResposta(no, agora) {
  const r = objeto(no) ? no : {};
  if (r.estado !== 'recusada' || !CODIGOS_DA_RECUSA.includes(String(r.code || ''))) return null;
  const ate = Number(r.esperaAte) || 0;
  if (ate && ate <= Number(agora)) return null;
  return {
    motivo: String(r.code), dev: String(r.dev || ''), papel: 'recusou', at: Number(r.at) || 0,
    aparelhos: [{ deviceId: String(r.dev || ''), motivo: String(r.detalhe || r.code) }],
  };
}

// Lê, para os candidatos DESTE aparelho, o que o conjunto já sabe. A resposta do executor
// (`ack`) só é buscada quando existe candidato próprio esperando: sem isso seria uma
// leitura por giro que não responde nada.
async function lerEsperas(engine, { atribuicoes, agora = Date.now() } = {}) {
  const rt = engine.sync;
  const meus = rt && rt.candidatos instanceof Map ? [...rt.candidatos.keys()] : [];
  if (!meus.length || !rt.client) return new Map();
  const respostas = await publicar.lerNo(rt.client, `/users/${rt.uid}/live/ack`);
  const arvore = mapaDe(atribuicoes);
  const acks = respostas ? mapaDe(respostas.valor) : {};
  const saida = new Map();
  for (const itemId of meus) {
    const escolhido = maisNova([
      daAtribuicao(arvore[itemId], agora),
      doVeredito(rt, itemId, arvore[itemId], agora),
      daResposta(acks[itemId], agora),
    ]);
    if (escolhido) saida.set(itemId, escolhido);
  }
  return saida;
}

export default { publicarEsperas, lerEsperas, caminhoDe, TTL_MS };
export { publicarEsperas, lerEsperas, caminhoDe, TTL_MS };
