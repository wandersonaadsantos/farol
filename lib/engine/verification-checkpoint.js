'use strict';
// Checkpoint de verificação: memória persistida e incremental do que a revisão headless
// já confirmou sobre afirmações factuais (arquivo:linha) checadas contra o código real.
// Append-only de propósito: uma nova passada que discorda da anterior gera uma entrada
// NOVA, nunca sobrescreve, e a divergência vira ponto de atenção (ver decision.js
// checkpointGap). A sessão NUNCA escreve este arquivo diretamente (proibido pela regra 2
// de workspace-template/prompts/pr-review-auto.md); só o engine grava, ao interceptar o
// marcador FAROL_CHECKPOINT: no tool_use da sessão (ver lib/engine/session.js).
// Ver docs/superpowers/specs/2026-08-05-checkpoint-verificacao-design.md.
const path = require('path');
const { STATE_DIR } = require('../paths');
const { ensureDir, readJson, writeJsonAtomic } = require('../io');

function checkpointPath(prKey) {
  return path.join(STATE_DIR, 'verification', `${encodeURIComponent(prKey)}.json`);
}

function appendCheckpointEntry(filePath, prKey, prUrl, entry) {
  ensureDir(path.dirname(filePath));
  const existing = readJson(filePath, null) || { prKey, prUrl, entries: [] };
  if (!Array.isArray(existing.entries)) existing.entries = [];
  existing.entries.push(entry);
  writeJsonAtomic(filePath, existing);
}

function readCheckpoint(filePath) {
  let corrupted = false;
  const data = readJson(filePath, null, () => { corrupted = true; });
  if (corrupted) return { ok: false, reason: 'checkpoint corrompido' };
  if (!data) return { ok: true, entries: [] };
  if (!Array.isArray(data.entries)) return { ok: false, reason: 'formato inválido: campo entries ausente' };
  return { ok: true, entries: data.entries };
}

function summarizeCheckpoint(entries) {
  entries = entries || [];
  const groups = new Map();
  for (const e of entries) {
    const key = `${e.file}|${e.line}|${e.claim}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  const conflicts = [];
  for (const grupo of groups.values()) {
    const veredictos = new Set(grupo.map(e => e.verdict));
    if (veredictos.size > 1) conflicts.push({ entries: grupo });
  }
  return {
    total: entries.length,
    confirmedCount: entries.filter(e => e.verdict === 'confirmado').length,
    conflicts,
  };
}

module.exports = { checkpointPath, appendCheckpointEntry, readCheckpoint, summarizeCheckpoint };
