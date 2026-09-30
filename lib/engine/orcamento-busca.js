// Orçamento de busca do GitHub: não gastar o que não tem, em vez de tomar 403.
//
// MEDIDO em 30/09/2026 no aparelho do Wanderson. O limite da API de BUSCA é 30 por
// MINUTO (não é o de 5.000 por hora, que é o `core` e estava em 0/5000 nas duas contas),
// e o ciclo do check() dispara as buscas em RAJADA: uma por org monitorada, mais
// --review-requested, --reviewed-by e a autoria, por conta. Na configuração real são 14
// buscas quase simultâneas, 7 delas na mesma conta, que é justamente a que aparece em 31
// dos 38 bloqueios do farol.log.
//
// Aqui fica, por conta, QUANDO a próxima busca pode sair: janela deslizante de um minuto
// com teto abaixo do limite e um espaçamento mínimo entre buscas da mesma conta. Quem
// chama espera esse tempo e busca, em vez de disparar, falhar e prolongar o bloqueio
// (insistir consome cota, é o que diz o lib/engine/limite-gh.js).
//
// PURO: recebe o registro (um Map) e o instante, e não olha relógio nem rede. Quem
// segura o registro é o engine; quem espera é o lib/engine/gh-queries.js.

// A janela do GitHub para busca é por minuto.
const JANELA_MS = 60_000;
// 20 das 30: a folga é para o que NÃO passa por aqui no mesmo minuto (clique em
// "Verificar agora", re-checagem depois de um evento, e o gh de outras telas).
const TETO_POR_JANELA = 20;
// Rajada é o que o GitHub pune primeiro (o limite secundário nem espera o teto). Com
// 3 s entre buscas da mesma conta, as 7 de uma conta levam 21 s dentro de um ciclo de
// 180 s, o que é invisível para quem olha a tela e suficiente para não parecer rajada.
const ESPACO_MIN_MS = 3000;

function chave(user) { return String(user || '').trim().toLowerCase() || '(primária)'; }

// Os carimbos desta conta dentro da janela. A poda acontece na leitura: registro de
// conta que parou de ser usada não cresce para sempre na memória do engine.
function carimbos(registro, user, agora) {
  const k = chave(user);
  const vivos = (registro.get(k) || []).filter((t) => agora - t < JANELA_MS);
  if (vivos.length) registro.set(k, vivos); else registro.delete(k);
  return vivos;
}

function buscasNaJanela(registro, user, agora = Date.now()) {
  return carimbos(registro, user, agora).length;
}

// Quanto esperar ANTES de buscar por esta conta. 0 = pode agora.
function esperaAntesDaBusca(registro, user, agora = Date.now()) {
  const vivos = carimbos(registro, user, agora);
  if (!vivos.length) return 0;
  const desdeAUltima = agora - vivos[vivos.length - 1];
  const porEspacamento = Math.max(0, ESPACO_MIN_MS - desdeAUltima);
  // teto cheio: só libera quando a MAIS ANTIGA sair da janela, que é o instante em que
  // o GitHub volta a ter vaga nela
  const porTeto = vivos.length >= TETO_POR_JANELA ? (vivos[0] + JANELA_MS) - agora : 0;
  return Math.max(porEspacamento, porTeto);
}

// Registra que uma busca SAIU. Chamado depois da espera, nunca antes: carimbar a
// intenção faria a janela contar o que não foi gasto.
function registrarBusca(registro, user, agora = Date.now()) {
  const k = chave(user);
  const vivos = carimbos(registro, user, agora);
  vivos.push(agora);
  registro.set(k, vivos);
}

const orcamentoMod = {
  JANELA_MS, TETO_POR_JANELA, ESPACO_MIN_MS,
  buscasNaJanela, esperaAntesDaBusca, registrarBusca,
};
export default orcamentoMod;
export { JANELA_MS, TETO_POR_JANELA, ESPACO_MIN_MS, buscasNaJanela, esperaAntesDaBusca, registrarBusca };
