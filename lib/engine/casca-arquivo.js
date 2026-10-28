// O arquivo de descoberta do motor sidecar (state/casca.json). A casca nativa (macOS ou
// Windows) sobe `node server.js` e espera este arquivo aparecer: ele só é gravado depois
// de o socket escutar, com a porta EFETIVA, o pid, a versão e um código de pareamento de
// uso único da classe `casca`, que a casca troca por sessão em POST /api/auth/pair.
// Modo 0600 a cada gravação, pelo mesmo caminho dos arquivos da A4 (gravarRestrito), porque
// o código é credencial enquanto não for usado. Leitura nunca lança: conteúdo corrompido
// ou ausente é `null`, e a casca trata isso como "o motor ainda não subiu".
import fs from 'node:fs';
import { parseJson } from '../io.js';
import { CASCA_FILE, APP_VERSION } from '../paths.js';
import { gravarRestrito } from '../local-auth/arquivo.js';
import { criarCodigo } from '../local-auth/pareamento.js';

function gravarCasca({ porta, pid, versao, codigoPareamento, iniciadoEm, proximaVersao = null }) {
  gravarRestrito(CASCA_FILE, { porta, pid, versao, codigoPareamento, iniciadoEm, proximaVersao });
}

function lerCasca() {
  let texto;
  try { texto = fs.readFileSync(CASCA_FILE, 'utf8'); } catch { return null; }
  const dados = parseJson(texto, null);
  return dados && typeof dados === 'object' && !Array.isArray(dados) ? dados : null;
}

function apagarCasca() {
  try { fs.rmSync(CASCA_FILE, { force: true }); } catch { /* encerrando: a casca confere o pid de qualquer jeito */ }
}

// `engine` fica na assinatura pelo contrato dos colaboradores de lib/engine/ (e para a
// falha sair no log do motor); a porta é a do socket, nunca a da config.
function publicarCasca(engine, porta) {
  try {
    const agora = Date.now();
    const { codigo } = criarCodigo(agora, { classe: 'casca' });
    gravarCasca({ porta, pid: process.pid, versao: APP_VERSION, codigoPareamento: codigo, iniciadoEm: agora });
  } catch (e) {
    if (engine && typeof engine.log === 'function') engine.log('WARN', `casca: não gravei ${CASCA_FILE}: ${e.message}`);
  }
}

// O update avisa a casca de que a próxima subida é outra versão, sem mexer no resto.
function marcarProximaVersao(versao) {
  const atual = lerCasca();
  if (!atual) return;
  gravarCasca({ ...atual, proximaVersao: versao });
}

export default { gravarCasca, lerCasca, apagarCasca, publicarCasca, marcarProximaVersao };
export { gravarCasca, lerCasca, apagarCasca, publicarCasca, marcarProximaVersao };
