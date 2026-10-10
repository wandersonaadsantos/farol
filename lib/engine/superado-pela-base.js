// PR meu que a base já absorveu (10/10/2026), PURO: sem engine, sem rede.
//
// Caso que motivou: uma promoção ficou aberta, em conflito, por 38 horas depois que outra
// promoção levou a mesma branch inteira para a base. O conteúdo dela já estava todo lá e
// não sobrava nada para entregar, mas "Meus PRs" não dizia nada: a mergeabilidade só era
// lida para PR com autoanálise aprovável, e merge na base não muda o head do PR.
//
// A regra é a do merge de três vias. O compare `base...head` do GitHub lista o que o head
// mudou desde o ancestral comum; para cada arquivo dessa lista, se a ponta da base já tem o
// mesmo conteúdo do head, ou já tem as linhas que o PR põe e não tem as que ele tira, o
// merge não acrescenta nada ali. Quando isso vale para todos, o PR está superado.
//
// O erro caro aqui é o falso positivo: dizer "pode fechar" para um PR que ainda entrega
// alguma coisa. Por isso a conferência por linha só vale com linha que identifica (curta
// como `}` aparece em qualquer arquivo e não prova nada), e falta de prova dá
// `inconclusivo`, nunca `superado`.

// A partir daqui o compare do GitHub corta a lista de arquivos, e sem a lista inteira não
// dá para afirmar nada sobre o resto.
const LIMITE_ARQUIVOS_DO_COMPARE = 300;
// Linha mais curta que isso (sem espaço nas pontas) não identifica nada.
const LINHA_QUE_IDENTIFICA = 8;

function linhasDoPatch(patch) {
  const adicionadas = [], removidas = [];
  for (const l of String(patch || '').split('\n')) {
    if (l.startsWith('+++') || l.startsWith('---')) continue;
    if (l.startsWith('+')) adicionadas.push(l.slice(1));
    else if (l.startsWith('-')) removidas.push(l.slice(1));
  }
  return { adicionadas, removidas };
}

const identifica = (l) => l.trim().length >= LINHA_QUE_IDENTIFICA;

// A base já tem o que este patch faz? `true`, `false`, ou `null` sem linha que prove.
function patchContidoNaBase(patch, textoDaBase) {
  const { adicionadas, removidas } = linhasDoPatch(patch);
  const naBase = new Set(String(textoDaBase).split('\n'));
  const postas = new Set(adicionadas);
  const prova = adicionadas.filter(identifica);
  // linha que o PR tira e põe de novo (só mudou de lugar) não serve para provar ausência
  const tiradas = removidas.filter(l => identifica(l) && !postas.has(l));
  if (!prova.length && !tiradas.length) return null;
  return prova.every(l => naBase.has(l)) && tiradas.every(l => !naBase.has(l));
}

// Um arquivo do compare contra a ponta da base. `base` é o que se leu dela:
// `blobs` (caminho -> sha, ausente = não existe na base) e `textos` (caminho -> conteúdo).
function arquivoNaBase(f, base) {
  const temNaBase = base.blobs.has(f.filename);
  if (f.status === 'removed') return temNaBase ? 'entrega' : 'igual';
  if (f.status === 'renamed' && f.previous_filename && base.blobs.has(f.previous_filename)) return 'entrega';
  if (!temNaBase) return 'entrega';
  if (base.blobs.get(f.filename) === f.sha) return 'igual';
  if (!f.patch || !base.textos.has(f.filename)) return 'sem-prova';
  const contido = patchContidoNaBase(f.patch, base.textos.get(f.filename));
  if (contido === null) return 'sem-prova';
  return contido ? 'contido' : 'entrega';
}

// Os arquivos cujo conteúdo na base precisa ser lido para decidir (o sha não bastou).
function arquivosParaLer(arquivos, blobs) {
  return (arquivos || [])
    .filter(f => f.status !== 'removed' && f.patch && blobs.has(f.filename) && blobs.get(f.filename) !== f.sha)
    .map(f => f.filename);
}

// `compare`: { atrasDaBase (behind_by), arquivos }. `base`: { blobs, textos }.
// Devolve { veredito: 'superado' | 'nao' | 'inconclusivo', total, iguais, contidos, pendentes }.
function superadoPelaBase(compare, base) {
  const arquivos = (compare && compare.arquivos) || [];
  const total = arquivos.length;
  const vazio = { total, iguais: 0, contidos: 0, pendentes: [] };
  // a base não andou desde o ancestral comum: nada do PR pode ter chegado lá por outro caminho
  if (!compare || !(Number(compare.atrasDaBase) > 0)) return { veredito: 'nao', ...vazio };
  if (total >= LIMITE_ARQUIVOS_DO_COMPARE) return { veredito: 'inconclusivo', ...vazio };
  let iguais = 0, contidos = 0, entrega = false;
  const pendentes = [];
  for (const f of arquivos) {
    const r = arquivoNaBase(f, base);
    if (r === 'igual') iguais++;
    else if (r === 'contido') contidos++;
    else {
      pendentes.push(f.filename);
      if (r === 'entrega') entrega = true;
    }
  }
  let veredito = 'superado';
  if (entrega) veredito = 'nao';
  else if (pendentes.length) veredito = 'inconclusivo';
  return { veredito, total, iguais, contidos, pendentes };
}

const superado = { superadoPelaBase, arquivosParaLer, patchContidoNaBase, LIMITE_ARQUIVOS_DO_COMPARE };
export default superado;
export { superadoPelaBase, arquivosParaLer, patchContidoNaBase, LIMITE_ARQUIVOS_DO_COMPARE };
