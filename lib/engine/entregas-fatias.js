// Busca FATIADA por data de merge da aba Entregas. Existe porque a busca do GitHub
// devolve no maximo 1000 resultados por consulta (o gh 2.92.0 recusa `--limit`
// acima disso com "`--limit` must be between 1 and 1000", e a API de busca nao
// pagina alem desse ponto), enquanto o teto que a aba promete por org e maior
// (DELIVERIES_LIMIT, lib/paths.js). A saida e quebrar a janela em intervalos de
// `merged:<inicio>..<fim>` que caibam, um de cada vez.
//
// Nada aqui toca rede nem estado: quem busca e o callback `buscar`, entao a decisao
// de quando fatiar e testavel sem gh (test/entregas-fatias.test.js).
import { TEMPOS } from '../constants.js';

// teto do GitHub POR CONSULTA. Nenhuma chamada pode pedir mais que isto.
const CONSULTA_MAX = 1000;

// menor intervalo que ainda vale dividir. Uma hora porque: (a) uma org com mais de
// 1000 merges numa hora e implausivel, entao fatia minima cheia e sinal real de perda
// e nao de fatiamento raso; (b) a janela maior da aba (30 dias = 720 horas) chega nela
// em ~10 divisoes, o que limita a profundidade e o numero de consultas contra o limite
// de ~30 buscas por minuto da API; (c) fica muito acima da precisao de 1 segundo do
// qualificador, entao o ponto do meio sempre avanca.
const FATIA_MINIMA_MS = TEMPOS.HORA_MS;

// ISO 8601 UTC sem milissegundos, o formato que o qualificador `merged:` aceita.
function isoSegundos(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function chaveDoPr(p) {
  return `${(p.repository && p.repository.nameWithOwner) || ''}#${p.number}`;
}

// Busca [inicioMs, fimMs] de uma org e devolve { list, capped, partial }.
// `buscar(inicioIso, fimIso, limite)` resolve { ok, list } (ok false = falha do gh ou
// JSON invalido). Regras:
// - fatia so quando a consulta VOLTOU no teto, nunca de antemao: a janela comum cabe
//   numa chamada so, e cada consulta a mais gasta o limite de busca da API;
// - metade mais RECENTE primeiro, pra que um corte no teto total fique com os merges
//   mais novos (o que o grafico e os cartoes de "hoje" mostram primeiro);
// - o `..` do GitHub e inclusivo nas duas pontas, entao o PR exatamente no ponto do
//   meio aparece nas duas metades: a dedup por chave cobre;
// - capped so quando ha perda real: a org chegou ao teto total, ou uma fatia minima
//   ainda voltou cheia;
// - falha numa fatia marca partial e segue as outras (dado parcial e melhor que nada,
//   e a UI avisa).
async function buscarFatiado({ inicioMs, fimMs, buscar, tetoTotal }) {
  const limite = CONSULTA_MAX;
  const vistos = new Set();
  const list = [];
  const estado = { capped: false, partial: false };

  const acrescentar = (itens) => {
    for (const p of itens) {
      const k = chaveDoPr(p);
      if (vistos.has(k)) continue;
      if (list.length >= tetoTotal) { estado.capped = true; return; }
      vistos.add(k);
      list.push(p);
    }
  };

  const fatia = async (ini, fim) => {
    if (list.length >= tetoTotal) { estado.capped = true; return; }
    const r = await buscar(isoSegundos(ini), isoSegundos(fim), limite);
    if (!r || !r.ok) { estado.partial = true; return; }
    const itens = Array.isArray(r.list) ? r.list : [];
    if (itens.length < limite) { acrescentar(itens); return; }
    // divide no segundo inteiro: o qualificador nao enxerga milissegundo. Meio que
    // nao avanca conta como fatia minima, senao a recursao nunca terminaria.
    const meio = Math.floor((ini + (fim - ini) / 2) / 1000) * 1000;
    if (fim - ini <= FATIA_MINIMA_MS || meio <= ini) {
      estado.capped = true;
      acrescentar(itens);
      return;
    }
    await fatia(meio, fim);
    await fatia(ini, meio);
  };

  await fatia(inicioMs, fimMs);
  return { list, capped: estado.capped, partial: estado.partial };
}

export { CONSULTA_MAX, FATIA_MINIMA_MS, isoSegundos, buscarFatiado };
export default { CONSULTA_MAX, FATIA_MINIMA_MS, isoSegundos, buscarFatiado };
