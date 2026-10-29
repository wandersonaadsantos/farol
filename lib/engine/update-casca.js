// O update do motor sob a casca nativa (Farol nativo, 28/10/2026): a casca (SwiftUI no
// macOS, WinUI 3 no Windows) sobe `node server.js` como sidecar a partir do próprio bundle,
// que é só leitura e assinado. Trocar no lugar, como o modo servidor faz, quebraria a
// assinatura (ou nem teria permissão), então o pacote leve vai para
// `~/.farol/engine/<versão>`, de onde o bootstrap da casca (casca-bootstrap.js) o escolhe
// na próxima subida.
//
// A pasta final só aparece inteira: a cópia vai para `<versão>.tmp` e um rename a põe no
// lugar; qualquer falha apaga a `.tmp` e não deixa `<versão>`. Depois o motor marca a
// próxima versão no `state/casca.json`, avisa a casca pelo evento `casca-saida` e sai de
// propósito com o código 75, que a casca lê como "religue". Quem religa é a casca, nunca o
// motor.
import fs from 'node:fs';
import path from 'node:path';
import { APP_ROOT, APP_VERSION, ENGINE_DIR, versaoDaCasca } from '../paths.js';
import { CASCA, TEMPOS } from '../constants.js';
import { parseJson } from '../io.js';
import { nodeVersionSatisfies } from '../node-runtime.js';
import { trocarArquivos } from './update-servidor.js';
import { marcarProximaVersao } from './casca-arquivo.js';

// O mesmo formato que o bootstrap aceita como pasta de versão: fora dele a pasta nunca
// seria escolhida, e uma versão com barra ou `..` escreveria fora de ENGINE_DIR.
const VERSAO = /^\d+\.\d+\.\d+$/;

function recusa(engine, texto) {
  engine.emit('toast', { kind: 'error', text: texto });
  return { ok: false, error: texto };
}

// O pacote só serve se o bootstrap vai escolhê-lo: `engines.farolShell` (a mesma faixa
// `>=X.Y.Z <N` que o casca-bootstrap.js confere) tem de aceitar a casca que roda. Instalar um
// pacote que o bootstrap ignora faria o update reaparecer a cada checagem, em laço. Devolve o
// motivo da recusa, ou '' quando o pacote serve. Só lê o manifesto: nada é gravado.
function motivoDeIncompatibilidade(origem) {
  let manifesto = null;
  try { manifesto = parseJson(fs.readFileSync(path.join(origem, 'package.json'), 'utf8'), null); } catch { manifesto = null; }
  const faixa = manifesto && manifesto.engines && manifesto.engines.farolShell;
  if (typeof faixa !== 'string' || !faixa) return 'o pacote não declara engines.farolShell, então a casca nunca o escolheria.';
  const casca = versaoDaCasca();
  if (!nodeVersionSatisfies(casca, faixa)) return `o pacote pede a casca ${faixa}, e esta casca é a ${casca || 'de versão desconhecida'}. Atualize o app do Farol.`;
  return '';
}

// Copia o pacote leve para `<pastaEngine>/<versão>.tmp` (pela mesma lista e as mesmas
// conferências da troca do modo servidor) e só então a renomeia para `<versão>`. Sobra de
// tentativa anterior, da `.tmp` ou da pasta final, é apagada antes: a versão em questão é
// mais nova que a que roda, então nada dela está em uso.
function instalarVersao(origem, pastaEngine, versao) {
  const final = path.join(pastaEngine, versao);
  const tmp = `${final}.tmp`;
  fs.mkdirSync(pastaEngine, { recursive: true });
  fs.rmSync(tmp, { recursive: true, force: true });
  try {
    fs.mkdirSync(tmp);
    trocarArquivos(origem, tmp);
    fs.rmSync(final, { recursive: true, force: true });
    fs.renameSync(tmp, final);
  } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
}

// `deps.raiz`, `deps.pastaEngine`, `deps.exit` e `deps.setTimeout` são costuras de teste.
// `deps.marcarReaberturaSilenciosa` vem do update.js, que é quem chama: importar de lá
// criaria um ciclo entre os dois módulos.
function aplicarNaCasca(engine, deps = {}) {
  const raiz = deps.raiz || APP_ROOT;
  const pastaEngine = deps.pastaEngine || ENGINE_DIR;
  const sair = deps.exit || process.exit;
  const agendar = deps.setTimeout || setTimeout;
  const versao = String(engine.update.sourceVersion || '');
  // checkout de desenvolvimento: o update automático não substitui o git pull
  if (fs.existsSync(path.join(raiz, '.git'))) {
    return recusa(engine, `O Farol roda de um repositório git (${raiz}): atualize com git pull. O update automático não sobrescreve código de desenvolvimento.`);
  }
  if (!VERSAO.test(versao)) return recusa(engine, `Falha ao aplicar a atualização: versão inválida (${versao}).`);
  // a pasta final de quem já roda pode ser a pasta de onde este motor foi carregado
  if (versao === APP_VERSION) return recusa(engine, `Falha ao aplicar a atualização: a ${versao} já é a versão em uso.`);
  const incompativel = motivoDeIncompatibilidade(engine.update.source);
  if (incompativel) return recusa(engine, `Falha ao aplicar a atualização: ${incompativel}`);
  try { instalarVersao(engine.update.source, pastaEngine, versao); }
  catch (err) { return recusa(engine, `Falha ao aplicar a atualização: ${err.message}`); }
  marcarProximaVersao(versao);
  if (typeof deps.marcarReaberturaSilenciosa === 'function') deps.marcarReaberturaSilenciosa(versao);
  engine.emit('casca-saida', { motivo: 'update', proximaVersao: versao });
  engine.emit('toast', { kind: 'info', text: `Atualizado para a ${versao}: o Farol reinicia sozinho em instantes.` });
  // sai depois de a resposta, o toast e o casca-saida terem tempo de sair
  agendar(() => sair(CASCA.CODIGO_SAIDA_DE_PROPOSITO), TEMPOS.SAIDA_DEPOIS_DO_UPDATE_MS);
  return { ok: true, from: APP_VERSION, to: versao };
}

export default { aplicarNaCasca };
export { aplicarNaCasca };
