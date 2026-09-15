// Leitura e gravação dos arquivos da autenticação local (A4). Mesmo contrato de
// lib/jira/credentials.js: TODA gravação restringe o modo de novo, porque o
// writeJsonAtomic entrega ao arquivo final o modo default do .tmp. Continua sendo
// writeJsonAtomic e não rename cru, pelo fallback de EPERM do antivírus no Windows.
import fs from 'node:fs';
import path from 'node:path';
import io from '../io.js';

function lerLista(arquivo) {
  const dados = io.readJson(arquivo, []);
  return Array.isArray(dados) ? dados : [];
}

// chmod não existe em NTFS: no Windows a proteção real é a ACL do perfil do usuário.
function restringir(alvo, modo) {
  try { fs.chmodSync(alvo, modo); } catch { /* sem suporte a modo neste sistema de arquivos */ }
}

function gravarRestrito(arquivo, lista) {
  const dir = path.dirname(arquivo);
  io.ensureDir(dir);
  restringir(dir, 0o700);
  io.writeJsonAtomic(arquivo, lista);
  restringir(arquivo, 0o600);
}

export default { lerLista, gravarRestrito };
export { lerLista, gravarRestrito };
