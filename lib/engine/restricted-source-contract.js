// Limites comuns ao leitor e à configuração de saída do Codex.
import { IS_WIN } from '../paths.js';
import { sourcePath, isSourceTemplate } from '../review-source/contract.js';
const SOURCE_PAGE_LINES = 60;
const SOURCE_PAGE_CHARS = 2048;
const SOURCE_OUTPUT_TOKENS = 32768;
const SOURCE_REPLY_BYTES = SOURCE_OUTPUT_TOKENS - SOURCE_PAGE_CHARS;
const SOURCE_RPC_ID_CHARS = 64;

function materialPath(value) {
  sourcePath(value, true);
  const parts = value.split('/');
  if (!isSourceTemplate(value)) sourcePath(value);
  if (IS_WIN && parts.some(part => /[. ]$|[<>"|?*]/.test(part)
    || /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)[ .]*(?:\.|$)/i.test(part))) {
    throw new Error('Nome de fonte ambíguo no Windows; materialização recusada.');
  }
}

export { SOURCE_PAGE_LINES, SOURCE_PAGE_CHARS, SOURCE_OUTPUT_TOKENS, SOURCE_REPLY_BYTES, SOURCE_RPC_ID_CHARS, materialPath };
