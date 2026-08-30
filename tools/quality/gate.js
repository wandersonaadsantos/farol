// Gate de ratchet do enforcement mecânico do Farol. A baseline registra a
// dívida ATUAL por arquivo/regra; o gate reprova qualquer contagem que SUBA
// (arquivo novo com violação = subir de zero). Corrigiu dívida? Rode --update
// pra travar o número novo, mais baixo. A baseline NUNCA sobe à mão.
// Exit codes (mesma semântica do biud-higiene): 0 limpo, 1 regressão no repo,
// 2 o gate não conseguiu rodar.
import fs from 'node:fs';
import path from 'node:path';
import { executadoDireto } from '../../lib/paths.js';
import { scanFile } from './rules.js';
import { ignorar } from '../nao-e-fonte.js';

const RAIZ = path.join(import.meta.dirname, '..', '..');
const BASELINE = path.join(import.meta.dirname, 'baseline.json');
// Os extras sao deste gate: ele mede o codigo de producao, entao suite,
// documentacao, o template distribuido e material de instalador ficam de fora.
const IGNORAR = ignorar('test', 'docs', 'workspace-template', 'installer', 'assets');

function listar(dir, achados = []) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORAR.has(item.name)) continue;
    const p = path.join(dir, item.name);
    if (item.isDirectory()) listar(p, achados);
    else if (item.name.endsWith('.js')) achados.push(p);
  }
  return achados;
}

function scanRepo(raiz = RAIZ) {
  const resultado = {};
  for (const abs of listar(raiz)) {
    const rel = path.relative(raiz, abs).replace(/\\/g, '/');
    const contagens = scanFile(fs.readFileSync(abs, 'utf8'), rel);
    const comViolacao = Object.fromEntries(Object.entries(contagens).filter(([, v]) => v > 0));
    if (Object.keys(comViolacao).length) resultado[rel] = comViolacao;
  }
  return resultado;
}

function comparar(atual, baseline) {
  const regressoes = [];
  for (const [arq, regras] of Object.entries(atual)) {
    for (const [regra, n] of Object.entries(regras)) {
      const teto = (baseline[arq] && baseline[arq][regra]) || 0;
      if (n > teto) regressoes.push(`${arq}: ${regra} subiu de ${teto} pra ${n}`);
    }
  }
  return { regressoes };
}

function main() {
  const atual = scanRepo();
  if (process.argv.includes('--update')) {
    fs.writeFileSync(BASELINE, JSON.stringify(atual, null, 2) + '\n');
    console.log(`baseline atualizada: ${Object.keys(atual).length} arquivos com dívida registrada`);
    return 0;
  }
  if (!fs.existsSync(BASELINE)) {
    console.error('baseline.json ausente: rode node tools/quality/gate.js --update uma vez');
    return 2;
  }
  let baseline;
  try { baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8')); }
  catch { console.error('baseline.json ilegível: regenere com --update'); return 2; }
  const { regressoes } = comparar(atual, baseline);
  if (regressoes.length) {
    console.error('== regressão de qualidade (gate mecanico do Farol) ==');
    for (const r of regressoes) console.error('  ' + r);
    console.error('Corrija a violação nova; a baseline só desce.');
    return 1;
  }
  console.log('gate de qualidade: sem regressão');
  return 0;
}

if (executadoDireto(import.meta.url)) process.exit(main());
export default { scanRepo, comparar };
export { scanRepo, comparar };
