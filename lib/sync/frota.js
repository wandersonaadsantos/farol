// Quem está na frota v2 (7.C3): o gate que decide se vale publicar conteúdo compartilhado.
// Puro: sem estado, sem IO, sem rede.
//
// A REGRA: só se publica quando existe OUTRO aparelho que declara o contrato v2, diz que a
// chave está aberta, não foi aposentado, e foi visto nas últimas 24 horas. Sem alguém para
// ler, escrever é cota gasta e superfície de dado sem leitor. A spec exige o gate para o
// andamento ao vivo e para o Panorama; o Farol o aplica também à capacidade e ao catálogo,
// porque o motivo é o mesmo.
//
// O PRÓPRIO APARELHO NUNCA CONTA. Parece detalhe e é o centro: sem isso, um aparelho
// sozinho passaria no gate por causa de si mesmo e publicaria para sempre, para ninguém.
//
// `keyReady` exige `true` explícito, e contrato exige o NÚMERO 2: valor truthy ou texto
// vindo de outro aparelho (ou de uma versão futura) não pode virar "pronto" por descuido.
import { SYNC } from '../constants.js';

const CONTRATO = 2;

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function aparelhoV2(d, { agora, janelaMs } = {}) {
  if (!objeto(d)) return false;
  if (d.contract !== CONTRATO || d.keyReady !== true) return false;
  if (Number(d.retiredAt) > 0) return false;
  const visto = Number(d.lastSeenAt);
  if (!Number.isFinite(visto) || visto <= 0) return false;
  const janela = Number(janelaMs) || SYNC.FROTA_JANELA_MS;
  // relógio adiantado do outro aparelho produz carimbo no futuro: isso continua sendo
  // "visto agora", e não pode virar "nunca visto"
  return Number(agora) - visto <= janela;
}

function outrosV2(devices, ctx = {}) {
  if (!objeto(devices)) return [];
  const meu = String(ctx.meuId || '');
  return Object.entries(devices).filter(([id, d]) => id !== meu && aparelhoV2(d, ctx)).map(([id]) => id);
}

function valePublicar(devices, ctx = {}) {
  return outrosV2(devices, ctx).length > 0;
}

export default { CONTRATO, aparelhoV2, outrosV2, valePublicar };
export { CONTRATO, aparelhoV2, outrosV2, valePublicar };
