// Somente tempos e tamanhos. Nunca guarda conteúdo, caminhos pessoais ou credenciais.
import path from 'node:path';
const names = new Set(['decisions.json', 'usage.json', 'usage-sessions.json', 'inflight.json', 'self-analyses.json']);
const recent = [];
function recordWrite(file, data) {
  const name = path.basename(file);
  if (!names.has(name)) return;
  recent.push({ file: name, at: Date.now(), ...data });
  if (recent.length > 64) recent.splice(0, recent.length - 64);
}
function persistenceMetrics() { return { window: 'últimas 64 gravações observadas neste processo', writes: recent.map(item => ({ ...item })) }; }
export { recordWrite, persistenceMetrics };
