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

module.exports = { checkpointPath, appendCheckpointEntry };
