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
    .map(([k, v]) => [k, { ate: Number(v.ate), em: Number(v.em) || 0, estimado: v.estimado === true }]);
  engine.limitesDePlano = new Map(vivos);
}

// Com hora de reset citada, trava até ela. Sem hora (20/10/2026, cadeia de perfis), quem chama
// passa um prazo ESTIMADO (`opcoes.estimado`, TEMPOS.LIMITE_PLANO_SEM_HORA_MS): antes a
// assinatura não era registrada, e cada PR descobria o limite sozinho a cada ciclo. Com a
// cadeia isso viraria a fila inteira batendo no mesmo perfil em vez de seguir para o próximo.
// O prazo estimado aparece como estimado na tela, e uma sessão que dá certo o libera.
// `opcoes.auth` é a assinatura que a sessão USOU: com a cadeia, a conta pode já resolver para
// outro perfil quando a falha chega, e registrar pela conta travaria o perfil errado.
function registrarLimite(engine, conta, ate, agora = Date.now(), opcoes = {}) {
  if (!temRegistro(engine) || !(Number(ate) > agora)) return;
  const chave = opcoes.auth ? chaveDaAssinatura(opcoes.auth) : chaveDaConta(engine, conta);
  const atual = engine.limitesDePlano.get(chave);
  if (atual && atual.ate >= ate) return;
  engine.limitesDePlano.set(chave, { ate: Number(ate), em: agora, estimado: opcoes.estimado === true });
  salvar(engine);
}

// O registro de UMA assinatura, sem passar pela conta: é o que a cadeia consulta para
// escolher o perfil (passar pela conta seria perguntar à cadeia, que pergunta aqui).
// Vencido sai na hora. null = livre.
function registroDaAssinatura(engine, auth, agora = Date.now()) {
  if (!engine || !(engine.limitesDePlano instanceof Map)) return null;
  const chave = chaveDaAssinatura(auth);
  const v = engine.limitesDePlano.get(chave);
  if (!v) return null;
  if (v.ate > agora) return { ate: v.ate, estimado: v.estimado === true };
  engine.limitesDePlano.delete(chave);
  salvar(engine);
  return null;
}

// Até quando a assinatura desta conta está no limite (0 = livre). Vencido sai na hora.
// Com a cadeia, a conta resolve para o primeiro perfil livre, então isto só é diferente de
// zero quando TODOS os perfis dela estão no limite: o valor é o primeiro reset.
function limiteAte(engine, conta, agora = Date.now()) {
  if (!temRegistro(engine)) return 0;
  const r = registroDaAssinatura(engine, engine.resolveClaudeAuth(conta), agora);
  return r ? r.ate : 0;
}

// Uma sessão que funcionou prova que a cota voltou (reset antecipado, uso extra comprado).
function liberarLimite(engine, conta) {
  if (temRegistro(engine) && engine.limitesDePlano.delete(chaveDaConta(engine, conta))) salvar(engine);
}

export { chaveDaAssinatura, carregarLimites, registrarLimite, registroDaAssinatura, limiteAte, liberarLimite };
