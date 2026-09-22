// Limite do plano do Claude vale para a ASSINATURA, não para o PR (relato de 21/09/2026).
//
// O retry já fazia cada PR esperar o reset depois de bater no limite (retryAfterNet com
// notBefore). Mas o limite é da cota da conta do Claude, e a espera ficava guardada por PR:
// com 12 PRs na fila, o primeiro descobria o limite e os outros onze batiam nele um por um,
// cada um abrindo sessão, pondo a label <conta>:revisando no PR e tirando segundos depois.
// E a espera era memória: reiniciar o Farol a apagava e a fila inteira saía de novo.
//
// Aqui fica, por assinatura, até quando ela está no limite, em disco. A chave é a mesma
// identidade que a sessão usa (resolveClaudeAuth): duas contas do GitHub apontando para o
// mesmo perfil do Claude dividem a mesma cota, e portanto o mesmo limite.
import { readJson, writeJsonAtomic } from '../io.js';
import { LIMITE_PLANO_FILE } from '../paths.js';

function chaveDaAssinatura(auth) {
  const a = auth || {};
  if (a.kind === 'dir') return `dir:${String(a.dir || '').toLowerCase()}`;
  return `${a.kind || 'desconhecido'}:${a.id || ''}`;
}

function chaveDaConta(engine, conta) {
  return chaveDaAssinatura(engine.resolveClaudeAuth(conta));
}

// Engine sem o registro (ou sem como saber a assinatura) não tem limite conhecido: é o
// mesmo tratamento que o código vizinho dá aos gates opcionais (`typeof engine.grupoSegura`).
function temRegistro(engine) {
  return !!engine && engine.limitesDePlano instanceof Map && typeof engine.resolveClaudeAuth === 'function';
}

function salvar(engine) {
  try { writeJsonAtomic(LIMITE_PLANO_FILE, Object.fromEntries(engine.limitesDePlano)); }
  catch (err) { engine.log('ERROR', `salvar limite-plano.json: ${err.message}`); }
}

// Boot: o que já venceu é descartado na leitura, então um Farol que reabre depois do reset
// não carrega trava velha, e um que reabre ANTES dele não dispara a fila inteira de novo.
function carregarLimites(engine, agora = Date.now()) {
  const bruto = readJson(LIMITE_PLANO_FILE, {});
  const vivos = Object.entries(bruto && typeof bruto === 'object' ? bruto : {})
    .filter(([, v]) => v && Number(v.ate) > agora)
    .map(([k, v]) => [k, { ate: Number(v.ate), em: Number(v.em) || 0 }]);
  engine.limitesDePlano = new Map(vivos);
}

// Só com hora de reset conhecida: sem ela não dá para saber até quando travar, e travar
// sem prazo seria parar a automação da assinatura por um palpite.
function registrarLimite(engine, conta, ate, agora = Date.now()) {
  if (!temRegistro(engine) || !(Number(ate) > agora)) return;
  const chave = chaveDaConta(engine, conta);
  const atual = engine.limitesDePlano.get(chave);
  if (atual && atual.ate >= ate) return;
  engine.limitesDePlano.set(chave, { ate: Number(ate), em: agora });
  salvar(engine);
}

// Até quando a assinatura desta conta está no limite (0 = livre). Vencido sai na hora.
function limiteAte(engine, conta, agora = Date.now()) {
  if (!temRegistro(engine)) return 0;
  const chave = chaveDaConta(engine, conta);
  const v = engine.limitesDePlano.get(chave);
  if (!v) return 0;
  if (v.ate > agora) return v.ate;
  engine.limitesDePlano.delete(chave);
  salvar(engine);
  return 0;
}

// Uma sessão que funcionou prova que a cota voltou (reset antecipado, uso extra comprado).
function liberarLimite(engine, conta) {
  if (temRegistro(engine) && engine.limitesDePlano.delete(chaveDaConta(engine, conta))) salvar(engine);
}

export { chaveDaAssinatura, carregarLimites, registrarLimite, limiteAte, liberarLimite };
