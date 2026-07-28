'use strict';
// Diagnóstico de processos: registra CADA comando que o Farol dispara, com horário
// (Brasília), pra correlacionar com um "terminal piscando". Desligado por padrão; liga
// com config.debugSpawns (o engine espelha em process.env.FAROL_DEBUG_SPAWNS). Loga só o
// comando + args (NUNCA env/token; ver [[nunca-vazar-segredo]]). Best-effort. Ver docs/QUALITY.md.
const fs = require('fs');
const path = require('path');
const { STATE_DIR } = require('./paths');

const FILE = path.join(STATE_DIR, 'spawns.log');

function stamp() {
  const d = new Date();
  // horário local de Brasília (pra bater com o relógio de quem observa o flash)
  const t = d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour12: false });
  return `${t}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function logSpawn(cmd, args) {
  if (process.env.FAROL_DEBUG_SPAWNS !== '1') return;
  try {
    const line = `${stamp()}  ${cmd} ${(args || []).join(' ')}`.replace(/\s+/g, ' ').slice(0, 600) + '\n';
    fs.appendFileSync(FILE, line);
  } catch { /* diagnóstico é best-effort, nunca derruba o spawn */ }
}

module.exports = { logSpawn, SPAWN_LOG_FILE: FILE };
