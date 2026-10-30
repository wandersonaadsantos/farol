// O baseline da primeira checagem (30/10/2026): quando o Farol começou a vigiar e quantos
// PRs que já pediam a revisão ficaram de fora da fila. PURO, sem engine: a UI usa o `at`
// para dizer, no vazio da fila, quantos PRs ficaram para trás.
// Formato novo: JSON `{ at, marcados }`. O arquivo antigo guardava só a data em ISO, e
// segue legível (marcados fica null).
import fs from 'node:fs';
import io, { writeJsonAtomic } from '../io.js';

// Devolve o que gravou, para quem guarda em memória.
function gravarBaseline(arquivo, { at, marcados }) {
  writeJsonAtomic(arquivo, { at, marcados });
  return { at, marcados };
}

// Nunca lança: arquivo ausente ou ilegível é null.
function lerBaseline(arquivo) {
  let texto;
  try { texto = fs.readFileSync(arquivo, 'utf8').trim(); } catch { return null; }
  const json = texto.startsWith('{') ? io.parseJson(texto, null) : null;
  if (json && Number.isFinite(json.at)) {
    return { at: json.at, marcados: Number.isFinite(json.marcados) ? json.marcados : null };
  }
  const legado = Date.parse(texto);
  return Number.isFinite(legado) ? { at: legado, marcados: null } : null;
}

// O aviso da primeira checagem, com singular e plural.
function textoDoAviso(n) {
  const quem = n === 1 ? 'PR que já pedia' : 'PRs que já pediam';
  const ficou = n === 1 ? 'ficou' : 'ficaram';
  return `Primeira checagem: ${n} ${quem} sua revisão ${ficou} fora da fila, para não disparar revisões de estoque. Veja no Panorama.`;
}

export default { gravarBaseline, lerBaseline, textoDoAviso };
export { gravarBaseline, lerBaseline, textoDoAviso };
