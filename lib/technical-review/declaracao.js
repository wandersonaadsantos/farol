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
// declaração, que precisam voltar sozinhos depois da correção.
const VERSAO_DA_CONFERENCIA = 2;

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
  const nomes = ausentes.slice(0, NOMEADAS).map(a => `${a.campo} "${a.dir}"${a.motivo && a.motivo !== 'ausente' ? ` (${a.motivo})` : ''}`).join(', ');
  const resto = total > NOMEADAS ? ` e mais ${total - NOMEADAS}` : '';
  return `a declaração técnica cita pasta que não existe neste commit: ${nomes}${resto}`;
}

export { CAMPOS, NOMEADAS, VERSAO_DA_CONFERENCIA, pastasAusentes, textoDasAusentes };
