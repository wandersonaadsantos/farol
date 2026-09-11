// Identidade persistente deste aparelho na sincronização entre dispositivos. O
// deviceId nasce uma vez e sobrevive a reinício e a update: é ele que diz "este
// lease é meu" e que separa os eventos de consumo de cada aparelho no banco. Mora
// em state/ (e não junto da credencial) porque não é segredo, é estado do app.
import path from 'node:path';
import { STATE_DIR } from '../paths.js';
import { SYNC } from '../constants.js';
import io from '../io.js';
import { novoId } from './keys.js';

const ARQUIVO = path.join(STATE_DIR, SYNC.DEVICE_FILE);
// o id vira segmento de caminho no banco; arquivo editado ou corrompido com um
// caractere proibido lá (/, ., #) quebraria toda escrita, então vale como ausente
const ID_RE = /^[A-Za-z0-9_-]{8,128}$/;

function devicePath() { return ARQUIVO; }

function readDevice() {
  const d = io.readJson(ARQUIVO, null);
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  if (typeof d.deviceId !== 'string' || !ID_RE.test(d.deviceId)) return null;
  return { deviceId: d.deviceId, createdAt: Number(d.createdAt) || 0 };
}

function ensureDevice() {
  const atual = readDevice();
  if (atual) return atual;
  const novo = { deviceId: novoId(), createdAt: Date.now() };
  io.ensureDir(path.dirname(ARQUIVO));
  io.writeJsonAtomic(ARQUIVO, novo);
  return novo;
}

export default { devicePath, ensureDevice, readDevice };
export { devicePath, ensureDevice, readDevice };
