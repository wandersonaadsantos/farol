// O que o diagnóstico do ambiente (doctor, server.js) sabe do Antigravity CLI: a versão
// instalada e, por perfil `agy`, se há login e a última cota lida. Nunca lista a pasta do
// perfil nem abre o arquivo do token: o login é só "o arquivo existe".
import os from 'node:os';
import { TEMPOS } from '../constants.js';
import { temLogin } from './home.js';
import { comandoManual } from './login.js';
import { cotaParaTela } from './cota.js';
import { rodar } from './processo.js';

// `agy --version` responde só o número (medido: `1.4.3`). Ausente ou quebrado = null.
async function versao() {
  const r = await rodar(['--version'], { env: undefined, cwd: os.tmpdir(), limiteMs: TEMPOS.AGY_USAGE_LIMITE_MS });
  if (r.code !== 0) return null;
  return String(r.stdout || '').trim().split(/\r?\n/)[0] || null;
}

function perfis(engine) {
  return (engine?.config?.claudeProfiles || []).filter((p) => p?.kind === 'agy').map((p) => ({
    id: p.id, label: String(p.label || ''), login: temLogin(p.id), cota: cotaParaTela(engine, p),
  }));
}

export default { versao, perfis, temLogin, comandoManual };
export { versao, perfis, temLogin, comandoManual };
