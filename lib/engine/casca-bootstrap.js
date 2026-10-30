// Bootstrap de versão do motor sidecar (28/10/2026, desenho 4.5 do Farol nativo). A casca
// nativa sempre executa o motor SEMEADO no próprio bundle (somente leitura, assinado). Os
// motores atualizados moram em ~/.farol/engine/<X.Y.Z>/; antes de construir o engine ou
// tocar estado, o semeado escolhe a maior versão instalada que é mais nova que ele e cujo
// `engines.farolShell` aceita a versão da casca, e se reexecuta a partir dela. O filho leva
// FAROL_BOOTSTRAP_FEITO=1 e não escolhe de novo. Node não tem execve: o pai fica vivo só
// para repassar sinal e devolver o código de saída do filho, e o filho vigia o pid do pai
// (FAROL_PAI_PID) para não ficar órfão segurando a porta quando o pai morre sem repassar
// nada (SIGKILL, ou o TerminateProcess da casca no Windows).
//
// `escolherMotor` é pura sobre o disco (a pasta vem por parâmetro) e nunca lança. Falta de
// prova (manifesto ilegível, sem farolShell, casca sem versão) é ficar na semeada.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseJson } from '../io.js';
import { cmpVersion } from './update.js';
import { VERSAO, faixaDaCasca, cascaAceita } from './casca-manifesto.js';
import { gravarLinhaDeLog } from '../log-arquivo.js';
import { logStamp, semControle } from '../format.js';
import { TEMPOS } from '../constants.js';
import { vigiarStdin } from './casca-stdin.js';
import {
  APP_ROOT, APP_VERSION, ENGINE_DIR, LOG_FILE, modoCasca, versaoDaCasca, bootstrapFeito, ambienteDoBootstrap, pidDoPai,
} from '../paths.js';

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
  const faixa = faixaDaCasca(manifesto);
  if (!faixa) return 'sem-farolShell';
  if (!cascaAceita(versaoCasca, faixa)) return 'casca-incompativel';
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

// Sobra de update interrompido (update-casca.js copia para `<versão>.tmp` e renomeia): quando
// o bootstrap roda, o motor que a criou já saiu, então ela é lixo por definição.
const SOBRA_DE_UPDATE = /^\d+\.\d+\.\d+\.tmp$/;
function sobrasDeUpdate(pastaEngine) {
  let itens;
  try { itens = fs.readdirSync(pastaEngine, { withFileTypes: true }); } catch { return []; }
  return itens.filter(i => i.isDirectory() && SOBRA_DE_UPDATE.test(i.name)).map(i => i.name);
}

// Apaga as pastas de versão abaixo de TODAS as de `manter` (a escolhida e a semeada) e toda
// sobra `X.Y.Z.tmp`. Só filhos diretos de `pastaEngine` com esses nomes exatos; o resto nunca
// é tocado. Devolve os nomes removidos. Falha ao apagar não impede o boot: sobra para a
// próxima poda.
function podarMotores({ pastaEngine, manter }) {
  const abaixo = (pastasDeVersao(pastaEngine) || []).filter(nome => manter.every(v => cmpVersion(nome, v) < 0));
  const removidas = [];
  for (const nome of [...abaixo, ...sobrasDeUpdate(pastaEngine)]) {
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
  const repassar = (sinal) => { try { filho.kill(sinal); } catch { /* filho já saiu */ } };
  for (const sinal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sinal, () => repassar(sinal));
  // O pai e o filho herdam o mesmo pipe da casca, e os dois veem o EOF quando ela morre; o
  // pai repassa como SIGTERM e sai com o código do filho, como no sinal de verdade.
  if (modoCasca()) vigiarStdin({ aoFechar: () => repassar('SIGTERM') });
  filho.on('error', (err) => { console.error(`[farol] não consegui subir o motor de ${raiz}: ${err.message}`); process.exit(1); });
  filho.on('exit', (codigo) => process.exit(typeof codigo === 'number' ? codigo : 1));
}

// O pai existe? `kill(pid, 0)` não manda sinal, só pergunta. ESRCH é "não existe"; EPERM é
// "existe, mas não é meu", que conta como vivo.
function paiVivo(pid) {
  try { process.kill(pid, 0); return true; } catch (err) { return err.code !== 'ESRCH'; }
}

// Vigia do pai do motor reexecutado: a cada `intervaloMs` confere se `pid` existe e, quando
// some, chama `aoMorrer` uma vez só e para. O timer é unref: a vigia nunca segura o processo.
// `agora` confere também na hora. Devolve a função que para a vigia.
function vigiarPai({ pid, intervaloMs = TEMPOS.VIGIA_DO_PAI_MS, aoMorrer, agora = false }) {
  let timer = null;
  const parar = () => { if (timer) clearInterval(timer); timer = null; };
  const conferir = () => { if (paiVivo(pid)) return false; parar(); aoMorrer(); return true; };
  if (agora && conferir()) return parar;
  timer = setInterval(conferir, intervaloMs);
  timer.unref();
  return parar;
}

// Pai morto: o mesmo caminho de saída do SIGTERM (registrarSaidaOrdenada no server.js, que
// apaga o casca.json). Emitir o evento, e não mandar o sinal, porque no Windows o kill em si
// mesmo encerra sem rodar os ouvintes. Antes do listen não há ouvinte, e sair basta.
function sairComoNoSigterm() {
  if (process.listenerCount('SIGTERM')) process.emit('SIGTERM', 'SIGTERM');
  else process.exit(0);
}

// O WARN vai ao farol.log, que é a fonte do Diagnóstico. Na primeira subida o STATE_DIR pode
// não existir ainda: aí a linha cai no stderr, para não se perder.
function avisarNoLog(texto) {
  try {
    gravarLinhaDeLog(LOG_FILE, `[${logStamp()}] [WARN] ${semControle(texto)}\n`, TEMPOS.LOG_ROTACAO_BYTES);
  } catch {
    console.error(`[farol] WARN ${texto}`);
  }
}

// O motor que vai escutar sai pelo caminho do SIGTERM quando o stdin da casca chega ao fim.
function vigiarFimDoStdin() {
  vigiarStdin({ aoFechar: sairComoNoSigterm });
}

// A chamada do server.js. Devolve true quando reexecutou (quem chama NÃO sobe o engine). No
// filho já reexecutado, liga a vigia do pai. Todo motor que fica (devolve false em modo
// casca) liga a vigia do fim do stdin; quem reexecuta a liga no `reexecutar`.
function bootstrapDaCasca({
  env, semeada = APP_VERSION, raizSemeada = APP_ROOT, pastaEngine = ENGINE_DIR, reexec = reexecutar,
  avisar = avisarNoLog, vigiar = vigiarPai, vigiarFim = vigiarFimDoStdin,
} = {}) {
  if (!modoCasca(env)) return false;
  if (bootstrapFeito(env)) {
    const pid = pidDoPai(env);
    if (pid) vigiar({ pid, aoMorrer: sairComoNoSigterm });
    vigiarFim();
    return false;
  }
  const r = escolherMotor({ semeada, raizSemeada, pastaEngine, versaoCasca: versaoDaCasca(env) });
  for (const i of r.ignoradas) {
    if (i.motivo === 'manifesto-invalido') avisar(`motor instalado ignorado, manifesto inválido: ${i.pasta}`);
  }
  if (r.raiz === raizSemeada) {
    vigiarFim();
    return false;
  }
  podarMotores({ pastaEngine, manter: [r.versao, semeada] });
  reexec(r.raiz);
  return true;
}

export default { escolherMotor, podarMotores, reexecutar, vigiarPai, sairComoNoSigterm, bootstrapDaCasca };
export { escolherMotor, podarMotores, reexecutar, vigiarPai, sairComoNoSigterm, bootstrapDaCasca };
