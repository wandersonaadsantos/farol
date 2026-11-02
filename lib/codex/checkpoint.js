import { registrarCheckpoint, CHECKPOINT_MARKER } from '../engine/checkpoint-da-sessao.js';

function checkpointCodex(engine, opts, event) {
  if (event?.type !== 'item.completed' || event.item?.type !== 'agent_message') return;
  for (const line of String(event.item.text || '').split(/\r?\n/)) {
    const match = line.trim().match(CHECKPOINT_MARKER);
    if (match) registrarCheckpoint(engine, opts, match[1]);
  }
}

export { checkpointCodex };
