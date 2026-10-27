// Pastas que a declaração técnica cita e o commit analisado não tem (27/10/2026). A ferramenta
// recusa a declaração inteira na primeira pasta ausente, e o worker engolia o motivo: um PR do
// biud-frontend apagou duas das 1206 pastas de teste declaradas, e toda avaliação daquele
// repositório passou a terminar "a ferramenta não concluiu", com novas tentativas e ressalva
// genérica. Conferida aqui, antes da ferramenta, a falha é de configuração e tem nome.
import fs from 'node:fs/promises';
import path from 'node:path';

// Os campos de diretório do contrato da ferramenta (consumer/declaration CAMPOS_DE_DIRETORIO).
const CAMPOS = ['testDirs', 'e2eDirs', 'sourceDirs', 'componentDirs'];
// Quantas pastas o texto nomeia; o resto vira contagem.
const NOMEADAS = 5;

async function ehDiretorio(alvo) {
  try { return (await fs.stat(alvo)).isDirectory(); }
  catch (error) { if (['ENOENT', 'ENOTDIR'].includes(error.code)) return false; throw error; }
}

async function pastasAusentes(declaration, root) {
  const ausentes = [];
  for (const campo of CAMPOS) {
    const dirs = declaration?.[campo];
    if (!Array.isArray(dirs)) continue;
    for (const dir of dirs) {
      if (typeof dir === 'string' && !await ehDiretorio(path.join(root, dir))) ausentes.push({ campo, dir });
    }
  }
  return ausentes;
}

function textoDasAusentes(ausentes) {
  const nomes = ausentes.slice(0, NOMEADAS).map(a => `${a.campo} "${a.dir}"`).join(', ');
  const resto = ausentes.length > NOMEADAS ? ` e mais ${ausentes.length - NOMEADAS}` : '';
  return `a declaração técnica cita pasta que não existe neste commit: ${nomes}${resto}`;
}

export { CAMPOS, pastasAusentes, textoDasAusentes };
