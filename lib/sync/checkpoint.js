// Checkpoint de verificação compartilhado (7.C7). Puro: sem estado, sem IO, sem rede.
//
// AS DUAS LOJAS NUNCA SE MISTURAM. `review` é a revisão oficial e `self` é a autoanálise
// do MEU PR; misturar as duas faria a análise que eu fiz do meu próprio PR alimentar o
// gate de uma revisão feita por outra conta. A loja entra no caminho E no envelope, então
// uma entrada movida de loja não abre.
//
// FALHA FECHADA: entrada que não decifra, que não tem a forma ou cujo veredito é
// desconhecido fica de fora INTEIRA. Ela não vira "sem veredito" nem entra no gate pela
// metade, e a contagem de ignoradas existe para a tela poder dizer que existe algo que não
// deu para verificar.
//
// A IDENTIDADE É DO CONTEÚDO. O id da entrada sai do aparelho, do PR, do instante, do
// arquivo, da linha e da afirmação: reenviar a mesma entrada cai no mesmo lugar, e duas
// passadas diferentes sobre a mesma afirmação continuam sendo duas entradas (é o que
// deixa a divergência entre passadas aparecer no `checkpointGap`).
import { tag } from './tags.js';

const LOJAS = ['review', 'self'];
const VEREDITOS = ['confirmado', 'refutado', 'parcial'];
const MAX_TEXTO = 400;
const MAX_ENTRADAS = 200;

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function texto(v, max = MAX_TEXTO) {
  const t = typeof v === 'string' ? v.trim() : '';
  return t.slice(0, max);
}

function lojaValida(loja) {
  return LOJAS.includes(String(loja || '')) ? String(loja) : '';
}

// Allowlist da entrada: o que não está aqui não viaja, e o que falta invalida.
function sanearEntrada(bruta) {
  const e = objeto(bruta) ? bruta : {};
  const claim = texto(e.claim);
  const file = texto(e.file, 300);
  const verdict = VEREDITOS.includes(String(e.verdict)) ? String(e.verdict) : '';
  if (!claim || !file || !verdict) return null;
  return {
    claim, file, verdict,
    line: Number(e.line) || 0,
    evidence: texto(e.evidence),
    headSha: texto(e.headSha, 64),
    blobSha: texto(e.blobSha, 64),
    // a passada é o que separa duas verificações da MESMA afirmação (o gate compara
    // vereditos entre passadas); ela viaja prefixada pelo aparelho, senão dois ids locais
    // iguais em aparelhos diferentes virariam a mesma passada
    sessionId: texto(e.sessionId, 80),
    at: texto(e.at, 40),
  };
}

function idDaEntrada(kId, { dev, prKey, entrada }) {
  const limpa = sanearEntrada(entrada);
  if (!limpa) return '';
  return tag(kId, 'review', `${dev}|${prKey}|${limpa.at}|${limpa.sessionId}|${limpa.file}|${limpa.line}|${limpa.claim}`);
}

// Mescla o que veio do banco com o que já está em disco. Entrada que este aparelho já tem
// (mesmo id) não duplica; o resto entra marcado com o aparelho de origem, que é o que
// deixa a tela dizer "verificado no outro aparelho".
function mesclar({ locais, remotas, kId, dev, prKey }) {
  const conhecidos = new Set();
  for (const e of Array.isArray(locais) ? locais : []) {
    const id = idDaEntrada(kId, { dev, prKey, entrada: e });
    if (id) conhecidos.add(id);
    if (e && e.id) conhecidos.add(String(e.id));
  }
  const novas = [];
  let ignoradas = 0;
  for (const { id, dev: origem, entrada } of Array.isArray(remotas) ? remotas : []) {
    const limpa = sanearEntrada(entrada);
    if (!limpa || !id) { ignoradas += 1; continue; }
    if (conhecidos.has(id)) continue;
    conhecidos.add(id);
    novas.push({ ...limpa, id, dev: String(origem || ''), sessionId: `${String(origem || '')}:${limpa.sessionId}` });
  }
  return { novas: novas.slice(0, MAX_ENTRADAS), ignoradas, cortadas: Math.max(0, novas.length - MAX_ENTRADAS) };
}

// O desfecho da herança, que a operação registra (7.C7): retomou tudo, aproveitou parte ou
// recomeçou. "Parcial" é o caso do head novo com arquivo inalterado.
function desfechoDaHeranca({ herdadas, relevantes }) {
  const total = Number(herdadas) || 0;
  const uteis = Number(relevantes) || 0;
  if (!total) return 'reinicio';
  return uteis >= total ? 'integral' : 'parcial';
}

export default { LOJAS, VEREDITOS, MAX_ENTRADAS, lojaValida, sanearEntrada, idDaEntrada, mesclar, desfechoDaHeranca };
export { LOJAS, VEREDITOS, MAX_ENTRADAS, lojaValida, sanearEntrada, idDaEntrada, mesclar, desfechoDaHeranca };
