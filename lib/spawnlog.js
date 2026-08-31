// Diagnóstico de processos: registra CADA comando que o Farol dispara, com horário
// (Brasília), pra correlacionar com um "terminal piscando". Desligado por padrão; liga
// com config.debugSpawns (o engine espelha em process.env.FAROL_DEBUG_SPAWNS). Loga só o
// comando + args (NUNCA env/token; ver [[nunca-vazar-segredo]]). Best-effort. Ver docs/QUALITY.md.
import fs from 'node:fs';
import path from 'node:path';
import { STATE_DIR } from './paths.js';
import { TEMPOS } from './constants.js';
import env from './env.js';

const FILE = path.join(STATE_DIR, 'spawns.log');

// Rotação, igual à do farol.log (server.js): passou do teto, o atual vira `.1` e um
// novo começa. Sem isto o arquivo só crescia: medido em 30/08/2026, 60 MB e subindo,
// num diagnóstico que só fala do passado recente. Best-effort como o resto do módulo:
// se a rotação falhar (arquivo em uso por outro processo, disco cheio), o append segue
// e no máximo o arquivo passa do teto. Diagnóstico nunca derruba o spawn.
function rotacionaSePreciso() {
  try {
    if (fs.statSync(FILE).size <= TEMPOS.SPAWN_LOG_ROTACAO_BYTES) return;
    fs.renameSync(FILE, FILE + '.1');
  } catch { /* arquivo ainda não existe, ou rename recusado: segue gravando */ }
}

function stamp() {
  const d = new Date();
  // horário local de Brasília (pra bater com o relógio de quem observa o flash)
  const t = d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour12: false });
  return `${t}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function logSpawn(cmd, args) {
  if (!env.debugSpawns()) return;
  try {
    const line = `${stamp()}  ${cmd} ${(args || []).join(' ')}`.replace(/\s+/g, ' ').slice(0, 600) + '\n';
    rotacionaSePreciso();
    fs.appendFileSync(FILE, line);
  } catch { /* diagnóstico é best-effort, nunca derruba o spawn */ }
}

export default { logSpawn, SPAWN_LOG_FILE: FILE };
export { logSpawn };
export const SPAWN_LOG_FILE = FILE;
