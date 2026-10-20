// Só remove diretórios privados criados por esta operação, nunca uma origem revisada.
import fs from 'node:fs';
import path from 'node:path';
import { STATE_DIR } from '../paths.js';

// Arquivo preso por outro processo no Windows (git que ainda segura o .pack, antivírus,
// indexador). Medido em 19/10/2026: o rm do material da revisão do
// Edicoes-CNBB/biblioteca-cnbb-web#109 falhou com EPERM, e o mesmo rm passou depois sem
// mudar nada. Como a limpeza roda no finally da revisão, o erro substituía o resultado
// e a revisão inteira estacionava como "falha não classificada", esperando clique.
const TRAVA_PASSAGEIRA = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY']);

// Fronteira substituível em teste, como io.run: o teste simula a trava sem depender do SO.
const remocao = { rm: (alvo, opcoes) => fs.rmSync(alvo, opcoes) };

// Material cuja remoção ficou para depois. Em memória de propósito: o processo seguinte
// passa pela varredura de restos, que cobre o que sobrou aqui.
const pendentes = new Set();

// Material criado POR ESTE PROCESSO. Revisão não sobrevive a reinício (o inflight a devolve
// à fila e ela recomeça do zero), então todo `review-*` fora deste conjunto é resto. O
// registro é feito no mesmo tique síncrono do mkdtempSync, e não pelo mtime: relógio que
// volta ou sistema de arquivos de carimbo grosso faria material vivo parecer antigo.
const criados = new Set();
// A varredura roda no finally da revisão: no máximo este tanto de restos por limpeza, para
// um acúmulo grande (18 cópias de repositório, medido) não travar o event loop de uma vez.
const RESTOS_POR_LIMPEZA = 2;
let restosVarridos = false;

function privateChild(directory, root, prefix) {
  const target = path.resolve(directory);
  if (path.dirname(target) !== path.resolve(root) || !path.basename(target).startsWith(prefix)
    || path.basename(target) === prefix) throw new Error('diretório privado fora da área permitida');
  if (fs.existsSync(target)) {
    const stat = fs.lstatSync(target);
    if (!stat.isDirectory() || stat.isSymbolicLink() || path.dirname(fs.realpathSync(target)) !== fs.realpathSync(root)) {
      throw new Error('diretório privado não corresponde à área permitida');
    }
  }
  return target;
}

function removePrivateDirectory(directory, root, prefix) {
  const target = privateChild(directory, root, prefix);
  remocao.rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

function tecnicaRoot() { return path.join(STATE_DIR, 'technical-review'); }

// O único jeito de criar material: nasce já registrado como deste processo.
function criarMaterial(root) {
  const snapshot = fs.mkdtempSync(path.join(root, 'review-'));
  criados.add(path.resolve(snapshot));
  return snapshot;
}

// Remove o material e o pedido de UMA revisão. Trava passageira não lança: anota para a
// próxima limpeza e devolve false. Qualquer outro erro (inclusive a guarda de área) lança.
function removerMaterial(target, root) {
  try {
    removePrivateDirectory(target, root, 'review-');
    remocao.rm(`${target}-request.json`, { force: true });
    pendentes.delete(target);
    criados.delete(path.resolve(target));
    return true;
  } catch (error) {
    if (!TRAVA_PASSAGEIRA.has(error && error.code)) throw error;
    pendentes.add(target);
    return false;
  }
}

function cleanup(context) {
  if (!context?.snapshot) return;
  const root = tecnicaRoot();
  const target = privateChild(context.snapshot, root, 'review-');
  for (const antigo of [...pendentes]) if (antigo !== target) removerMaterial(antigo, root);
  removerMaterial(target, root);
  if (!restosVarridos) restosVarridos = limparRestos() < RESTOS_POR_LIMPEZA;
}

// Material `review-*` que este processo não criou é resto de limpeza que não terminou. O
// `-result.json` é evidência privada que a decisão aponta, e fica. Devolve quantos restos
// achou (removidos ou presos), até o teto: abaixo do teto, não sobrou nada para depois.
function limparRestos(teto = RESTOS_POR_LIMPEZA) {
  const root = tecnicaRoot();
  let nomes;
  try { nomes = fs.readdirSync(root); } catch { return 0; }
  const resto = (nome) => !criados.has(path.resolve(root, nome));
  let achados = 0;
  for (const nome of nomes) {
    if (achados >= teto) return achados;
    if (!nome.startsWith('review-') || nome.endsWith('-result.json') || nome.endsWith('-request.json') || !resto(nome)) continue;
    if (pendentes.has(path.join(root, nome))) continue;
    achados++;
    try { removerMaterial(path.join(root, nome), root); } catch { /* área inesperada: não mexe */ }
  }
  for (const nome of nomes) {
    if (!nome.startsWith('review-') || !nome.endsWith('-request.json')) continue;
    const dono = nome.slice(0, -'-request.json'.length);
    if (!resto(dono) || fs.existsSync(path.join(root, dono))) continue;
    try { remocao.rm(path.join(root, nome), { force: true }); } catch { /* fica para a próxima */ }
  }
  return achados;
}

export { cleanup, criarMaterial, privateChild, removePrivateDirectory, limparRestos, remocao, pendentes };
