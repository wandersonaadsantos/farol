// Ausência de chamador é uma declaração da revisão, não uma conclusão de busca textual.
// Para herdá-la, o app exige que a árvore do head continue idêntica. A árvore já vem
// da preparação das fontes: não há download de conteúdo nem sessão adicional. Um uso
// novo, alias, configuração ou arquivo removido muda a identidade, mesmo com o blob do
// arquivo revisado igual, inclusive quando a causa está no diff. Árvore parcial nunca
// comprova que nada mudou. O alvo continua coberto; somente seu alcance é reavaliado.
import { digest } from '../review-source/contract.js';

async function contextoExternoDoAlcance(source, arquivos, mapa) {
  if (source?.status !== 'complete' || !source.reader?.tree || !source.manifest?.H
    || !source.manifest.B || !Array.isArray(arquivos)) return null;
  try {
    const tree = await source.reader.tree('head');
    if (tree?.complete !== true || tree.commit !== source.manifest.H || !Array.isArray(tree.entries)) return null;
    const diff = new Set(arquivos.map((f) => f.path));
    const entradas = tree.entries.filter((e) => e.type !== 'tree');
    if (entradas.some((e) => !e.path || !e.blob || !e.mode || !e.type)) return null;
    const fontes = entradas.map((e) => [e.path, e.blob, e.mode, e.type]).sort(([a], [b]) => a.localeCompare(b));
    const { host, account, repo, repositoryId } = source.manifest.scope || {};
    const consumidores = (mapa?.head?.relations || []).filter((r) => r.origin === 'parser'
      && r.confidence === 'syntax-path' && diff.has(r.to) && !diff.has(r.from))
      .map(({ from, to, line }) => ({ from, to, line }));
    return { head: source.manifest.H, consumidores,
      digest: digest(['alcance-arvore-2', host, account, repo, repositoryId, source.manifest.B, fontes]) };
  } catch { return null; /* perde somente a herança; a sessão em curso declara o alcance */ }
}

// A cobertura do blob continua herdável. Só a declaração de ausência perde a herança,
// antes de montar o prompt, para a sessão que já vai rodar conferir o contexto atual.
function revalidarAusenciaHerdada(heranca, contexto, arquivos) {
  if (!heranca?.ativa || !heranca.alcance) return heranca;
  const diff = new Set((arquivos || []).map((f) => f.path));
  const alcance = {}, reavaliar = [];
  for (const [arquivo, registro] of Object.entries(heranca.alcance)) {
    if (!Array.isArray(registro?.entrada?.chamadores)) { reavaliar.push(arquivo); continue; }
    const chamadores = registro.entrada.chamadores;
    const fora = chamadores.some((c) => c?.arquivo && !diff.has(c.arquivo));
    const contradito = contexto?.consumidores?.some((c) => c.to === arquivo);
    if (fora || (!contradito && contexto?.digest && registro?.contextoExterno === contexto.digest)) alcance[arquivo] = registro;
    else reavaliar.push(arquivo);
  }
  return { ...heranca, alcance, alcanceReavaliar: reavaliar };
}

export { contextoExternoDoAlcance, revalidarAusenciaHerdada };
