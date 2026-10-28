// Bootstrap de versão do motor sidecar (28/10/2026, desenho 4.5 do Farol nativo). A casca
// nativa sempre executa o motor SEMEADO no próprio bundle (somente leitura, assinado). Os
// motores atualizados moram em ~/.farol/engine/<X.Y.Z>/; antes de construir o engine ou
// tocar estado, o semeado escolhe a maior versão instalada que é mais nova que ele e cujo
// `engines.farolShell` aceita a versão da casca, e se reexecuta a partir dela. O filho leva
// FAROL_BOOTSTRAP_FEITO=1 e não escolhe de novo. Node não tem execve: o pai fica vivo só
// para repassar sinal e devolver o código de saída do filho.
//
// `escolherMotor` é pura sobre o disco (a pasta vem por parâmetro) e nunca lança. Falta de
// prova (manifesto ilegível, sem farolShell, casca sem versão) é ficar na semeada.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseJson } from '../io.js';
import { cmpVersion } from './update.js';
import { nodeVersionSatisfies } from '../node-runtime.js';
import { APP_ROOT, APP_VERSION, ENGINE_DIR, modoCasca, versaoDaCasca, bootstrapFeito, ambienteDoBootstrap } from '../paths.js';

const VERSAO = /^\d+\.\d+\.\d+$/;

function pastasDeVersao(pastaEngine) {
  let itens;
  try { itens = fs.readdirSync(pastaEngine, { withFileTypes: true }); } catch { return null; }
  return itens.filter(i => i.isDirectory() && VERSAO.test(i.name)).map(i => i.name);
}

// Lê o manifesto de uma pasta instalada. A versão declarada tem de ser a do nome da pasta, e
// o server.js tem de existir: pasta pela metade (download interrompido) é manifesto inválido.
function lerManifesto(raiz, nome) {
  let texto;
  try { texto = fs.readFileSync(path.join(raiz, 'package.json'), 'utf8'); } catch { return null; }
  const m = parseJson(texto, null);
  if (!m || typeof m !== 'object' || Array.isArray(m) || m.version !== nome) return null;
  if (!fs.existsSync(path.join(raiz, 'server.js'))) return null;
  return m;
}

// A versão vem do nome da pasta (conferido contra o manifesto), então a pasta antiga é
// descartada antes de ler o manifesto: pasta velha quebrada não vira aviso, vira poda.
function motivoDaPasta(raiz, nome, semeada, versaoCasca) {
  if (cmpVersion(nome, semeada) <= 0) return 'abaixo-da-semeada';
  const manifesto = lerManifesto(raiz, nome);
  if (!manifesto) return 'manifesto-invalido';
  const faixa = manifesto.engines && manifesto.engines.farolShell;
  if (typeof faixa !== 'string' || !faixa) return 'sem-farolShell';
  if (!nodeVersionSatisfies(versaoCasca, faixa)) return 'casca-incompativel';
  return '';
}

function escolherMotor({ semeada, raizSemeada, pastaEngine, versaoCasca }) {
  const nomes = pastasDeVersao(pastaEngine);
  const ficar = (motivo, ignoradas) => ({ raiz: raizSemeada, versao: semeada, motivo, ignoradas });
  if (nomes === null) return ficar('sem-pasta', []);
  if (!nomes.length) return ficar('semeada', []);
  const ignoradas = [];
  let melhor = null;
  for (const nome of nomes) {
    const raiz = path.join(pastaEngine, nome);
    const motivo = motivoDaPasta(raiz, nome, semeada, versaoCasca);
    if (motivo) ignoradas.push({ pasta: raiz, motivo });
    else if (!melhor || cmpVersion(nome, melhor.versao) > 0) melhor = { raiz, versao: nome };
  }
  return melhor ? { ...melhor, motivo: 'instalada', ignoradas } : ficar('nenhuma-compativel', ignoradas);
}

// Apaga as pastas de versão abaixo de TODAS as de `manter` (a escolhida e a semeada). Só
// filhos diretos de `pastaEngine` com nome X.Y.Z; o resto nunca é tocado. Devolve os nomes
// removidos. Falha ao apagar não impede o boot: sobra para a próxima poda.
function podarMotores({ pastaEngine, manter }) {
  const nomes = pastasDeVersao(pastaEngine) || [];
  const removidas = [];
  for (const nome of nomes) {
    if (!manter.every(v => cmpVersion(nome, v) < 0)) continue;
    try {
      fs.rmSync(path.join(pastaEngine, nome), { recursive: true, force: true });
      removidas.push(nome);
    } catch { /* fica para a próxima poda; o motor escolhido não depende disto */ }
  }
  return removidas;
}

// Sobe o server.js da raiz escolhida com o mesmo Node, os mesmos argumentos e o ambiente
// atual marcado, e encerra este processo com o código do filho (morte por sinal vira 1).
function reexecutar(raiz) {
  const filho = spawn(process.execPath, [path.join(raiz, 'server.js'), ...process.argv.slice(2)], {
    stdio: 'inherit', env: ambienteDoBootstrap(),
  });
  for (const sinal of ['SIGTERM', 'SIGINT']) process.on(sinal, () => { try { filho.kill(sinal); } catch { /* filho já saiu */ } });
  filho.on('error', (err) => { console.error(`[farol] não consegui subir o motor de ${raiz}: ${err.message}`); process.exit(1); });
  filho.on('exit', (codigo) => process.exit(typeof codigo === 'number' ? codigo : 1));
}

// A chamada do server.js. Devolve true quando reexecutou (quem chama NÃO sobe o engine).
function bootstrapDaCasca({
  env, semeada = APP_VERSION, raizSemeada = APP_ROOT, pastaEngine = ENGINE_DIR, reexec = reexecutar,
  avisar = (m) => console.error(m),
} = {}) {
  if (!modoCasca(env) || bootstrapFeito(env)) return false;
  const r = escolherMotor({ semeada, raizSemeada, pastaEngine, versaoCasca: versaoDaCasca(env) });
  for (const i of r.ignoradas) {
    if (i.motivo === 'manifesto-invalido') avisar(`[farol] WARN motor instalado ignorado, manifesto inválido: ${i.pasta}`);
  }
  if (r.raiz === raizSemeada) return false;
  podarMotores({ pastaEngine, manter: [r.versao, semeada] });
  reexec(r.raiz);
  return true;
}

export default { escolherMotor, podarMotores, reexecutar, bootstrapDaCasca };
export { escolherMotor, podarMotores, reexecutar, bootstrapDaCasca };
