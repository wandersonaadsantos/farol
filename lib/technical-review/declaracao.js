// Pastas que a declaração técnica cita e o commit analisado não tem (27/10/2026). A ferramenta
// recusa a declaração inteira na primeira pasta ausente, e o worker engolia o motivo: um PR do
// biud-frontend apagou duas das 1206 pastas de teste declaradas, e toda avaliação daquele
// repositório passou a terminar "a ferramenta não concluiu", com novas tentativas e ressalva
// genérica. Conferida aqui, antes da ferramenta e com as mesmas exigências dela (texto não
// vazio, dentro da raiz, diretório, caixa exata), a falha é de configuração e tem nome.
import fs from 'node:fs/promises';
import path from 'node:path';

// Os campos de diretório do contrato da ferramenta (consumer/declaration CAMPOS_DE_DIRETORIO).
const CAMPOS = ['testDirs', 'e2eDirs', 'sourceDirs', 'componentDirs'];
// Quantas pastas o texto nomeia e o registro guarda; o resto vira contagem.
const NOMEADAS = 5;
// Versão desta conferência, gravada na falha. A recuperação só fica pausada pela falha da
// versão atual: a 2.78.9 acusava `null` como lista inválida e pausou PRs sem defeito na
// declaração, que precisam voltar sozinhos depois da correção. A 3 (07/11/2026) poda a pasta
// ausente em vez de travar, e os PRs pausados pela 2 voltam a ser avaliados.
const VERSAO_DA_CONFERENCIA = 3;

// Lista de cada pasta lida uma vez por conferência: a caixa exata exige ler o pai de cada trecho.
function leitor() {
  const listas = new Map();
  return async (dir) => {
    if (!listas.has(dir)) {
      listas.set(dir, fs.readdir(dir, { withFileTypes: true }).then(
        entries => new Map(entries.map(e => [e.name, e.isDirectory()])),
        error => { if (['ENOENT', 'ENOTDIR'].includes(error.code)) return null; throw error; }));
    }
    return listas.get(dir);
  };
}

// Por que a entrada não serve, ou '' quando é uma pasta do commit com a caixa exata.
async function motivo(raiz, bruto, listar) {
  if (typeof bruto !== 'string' || !bruto.trim()) return 'entrada inválida';
  const alvo = path.resolve(raiz, bruto.trim());
  if (alvo === raiz) return '';
  if (!alvo.startsWith(raiz + path.sep)) return 'fora da raiz';
  let atual = raiz;
  for (const parte of path.relative(raiz, alvo).split(path.sep)) {
    const lista = await listar(atual);
    if (!lista || !lista.has(parte)) {
      const outraCaixa = lista && [...lista.keys()].some(n => n.toLowerCase() === parte.toLowerCase());
      return outraCaixa ? 'outra caixa' : 'ausente';
    }
    if (!lista.get(parte)) return 'não é pasta';
    atual = path.join(atual, parte);
  }
  return '';
}

async function pastasAusentes(declaration, root) {
  const raiz = path.resolve(root), listar = leitor(), ausentes = [];
  for (const campo of CAMPOS) {
    const dirs = declaration?.[campo];
    // `null` é resposta válida para a ferramenta: o repositório não tem aquele material
    // (consumer/declaration diretoriosDoMaterial, situação "ausente"). Só lista vazia é recusada.
    if (dirs === undefined || dirs === null) continue;
    if (!Array.isArray(dirs) || !dirs.length) { ausentes.push({ campo, dir: '', motivo: 'lista inválida' }); continue; }
    for (const dir of dirs) {
      const por = await motivo(raiz, dir, listar);
      if (por) ausentes.push({ campo, dir: typeof dir === 'string' ? dir.trim().slice(0, 200) : '', motivo: por });
    }
  }
  return ausentes;
}

// Texto montado só do que o Farol conferiu (campo, pasta relativa, motivo), nunca de mensagem de erro.
function textoDasAusentes(ausentes, total = ausentes.length) {
  const nomes = ausentes.slice(0, NOMEADAS).map(rotuloDaPasta).join(', ');
  const resto = total > NOMEADAS ? ` e mais ${total - NOMEADAS}` : '';
  return `a declaração técnica cita pasta que não existe neste commit: ${nomes}${resto}`;
}

// A cópia avaliada sem as pastas ausentes (07/11/2026). Uma declaração só por repositório não serve
// às duas linhas quando a development apaga pasta que a production ainda tem: travar o repositório
// inteiro por isso parou 21 PRs do biud-frontend. Campo que ficaria sem pasta nenhuma (ou que já
// veio com lista inválida) não tem o que avaliar, e volta em `vazios` para seguir travando.
function podarDeclaracao(declaration, ausentes) {
  const fora = new Set(ausentes.map(a => `${a.campo}\u0000${a.dir}`));
  const podada = { ...declaration }, vazios = [];
  for (const campo of CAMPOS) {
    const dirs = declaration?.[campo];
    if (!Array.isArray(dirs)) continue;
    const ficam = dirs.filter(d => !(typeof d === 'string' && fora.has(`${campo}\u0000${d.trim().slice(0, 200)}`)));
    // lista inválida e entrada que não é texto não têm forma de ser podadas: seguem travando com nome
    const semPoda = ausentes.some(a => a.campo === campo && ['lista inválida', 'entrada inválida'].includes(a.motivo));
    if (!ficam.length || semPoda) vazios.push(campo);
    podada[campo] = ficam;
  }
  return { declaration: podada, vazios };
}

// Os motivos que a conferência grava; só eles vão ao card, e "ausente" é o caso sem parêntese.
// Fonte única do rótulo da pasta: a falha (verdict.js, textoDaDeclaracao) e a ressalva usam esta.
const MOTIVOS = new Set(['ausente', 'outra caixa', 'fora da raiz', 'não é pasta', 'entrada inválida', 'lista inválida']);
function rotuloDaPasta(a) {
  const motivo = MOTIVOS.has(a.motivo) && a.motivo !== 'ausente' ? ` (${a.motivo})` : '';
  return `${a.campo} "${a.dir.slice(0, 200)}"${motivo}`;
}

// A ressalva do card, montada só das pastas conferidas, nunca do texto de erro gravado.
function pontoDaDeclaracaoPodada(report) {
  const poda = report?.declaracaoPodada;
  const lista = Array.isArray(poda?.missingDirs) ? poda.missingDirs : [];
  const pastas = lista.filter(a => a && typeof a.campo === 'string' && typeof a.dir === 'string').slice(0, NOMEADAS).map(rotuloDaPasta);
  if (!pastas.length) return '';
  const total = Number(poda.missingCount) || pastas.length;
  let resto = '';
  if (total > pastas.length) resto = ` e mais ${total - pastas.length}`;
  return `A declaração técnica cita pasta que não existe neste commit (${pastas.join(', ')}${resto}); elas ficaram de fora da avaliação técnica, e o resto da declaração foi avaliado.`;
}

export { CAMPOS, NOMEADAS, VERSAO_DA_CONFERENCIA, pastasAusentes, textoDasAusentes, podarDeclaracao, pontoDaDeclaracaoPodada, rotuloDaPasta };
