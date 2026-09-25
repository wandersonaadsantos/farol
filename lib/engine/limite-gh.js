// Limite de requisicoes do GitHub: parar de buscar ate renovar (23/09/2026).
//
// O limite e por TOKEN, ou seja por conta do Farol, e as buscas do check() sao o que
// mais consome: uma por org monitorada mais --review-requested e --reviewed-by, por
// conta, a cada ciclo de polling. Quando a conta estoura, cada tentativa nova falha E
// consome cota, entao insistir prolonga o bloqueio. Medido no aparelho do Wanderson:
// 297 falhas de busca num unico dia, todas da mesma conta, todas a mesma frase.
//
// Aqui fica, POR CONTA, ate quando as buscas dela estao paradas. Memoria de processo,
// de proposito, e a diferenca para o limite-plano.js (que grava em disco) e o custo do
// engano: reabrir o Farol ali disparava a fila inteira de sessoes pagas; aqui reabrir
// custa uma busca que falha e reentra na espera. Guardar arquivo para isso seria
// estado duravel a mais sem nada a proteger.
//
// Quem diz o que e limite continua sendo lib/log-taxonomy.js (invariante 3): este
// modulo nao tem regex de erro nenhuma.
import io from '../io.js';
import { TEMPOS } from '../constants.js';
import { classify } from '../log-taxonomy.js';

const SEM_CONTA = '(primária)';

function chave(user) { return String(user || '').trim().toLowerCase() || SEM_CONTA; }

function registro(engine) {
  if (!(engine.limitesDeBuscaGh instanceof Map)) engine.limitesDeBuscaGh = new Map();
  return engine.limitesDeBuscaGh;
}

// O texto que o gh cospe e limite do GitHub? A pergunta vai para a taxonomia, que e a
// fonte unica: falha nova se cadastra la e passa a valer aqui junto.
function ehLimite(stderr) {
  return classify(String(stderr || '')).id === 'rate-limit-github';
}

// PURA. Reset conhecido e no futuro manda; sem ele, a espera padrao. Prazo no passado
// nao serve de prazo (relogio local atrasado devolveria "ja passou" para sempre).
function esperaAte(resetMs, agora = Date.now(), padrao = TEMPOS.LIMITE_GH_ESPERA_SEM_HORA_MS) {
  const r = Number(resetMs);
  if (Number.isFinite(r) && r > agora) return r;
  return agora + padrao;
}

// Ate quando as buscas desta conta estao paradas (0 = livre). Vencido sai na hora, e e
// por isso que nao existe um "liberar no sucesso": enquanto o prazo vale nenhuma busca
// roda pra provar que a cota voltou, e quando ele vence o registro some aqui. Liberar
// seria codigo que nunca tem o que apagar.
function limiteAte(engine, user, agora = Date.now()) {
  const reg = registro(engine);
  const k = chave(user);
  const ate = Number(reg.get(k) || 0);
  if (!ate) return 0;
  if (ate <= agora) { reg.delete(k); return 0; }
  return ate;
}

function emEspera(engine, user, agora = Date.now()) {
  return limiteAte(engine, user, agora) > 0;
}

// O que o proprio GitHub diz da cota GraphQL, a que as buscas usam. O endpoint
// rate_limit e documentado como nao contando contra o limite, entao perguntar nao piora
// a condicao; e a busca ja falhou, entao nao ha o que atrasar. Falha ou resposta sem
// numero devolve null, e a espera padrao assume.
async function cotaDoGh(engine, user) {
  const r = await io.run('gh', ['api', 'rate_limit', '--jq',
    '.resources.graphql | "\\(.remaining) \\(.reset)"'], { env: engine.ghEnv(user) });
  if (!r.ok) return null;
  const [restante, seg] = String(r.stdout || '').trim().split(/\s+/).map(Number);
  if (!Number.isFinite(restante) || !Number.isFinite(seg) || seg <= 0) return null;
  return { restante, resetMs: seg * 1000 };
}

// PURA. O prazo da espera pelo que a cota diz (25/09/2026). A hora do reset so vale
// quando a cota ACABOU: com saldo, a recusa foi o limite de rajada (o "secondary rate
// limit", que passa em cerca de um minuto) e o fim da janela de uma hora nao tem relacao
// nenhuma com ela. Medido no aparelho do Wanderson: uma conta parada das 14:40 as 15:25
// com 8 de 5000 usados, porque o prazo era sempre o reset da janela.
function prazoPelaCota(cota, agora = Date.now()) {
  if (!cota) return esperaAte(0, agora);
  if (cota.restante > 0) return agora + TEMPOS.LIMITE_GH_ESPERA_RAJADA_MS;
  return esperaAte(cota.resetMs, agora);
}

function hora(ts) {
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// A primeira linha do que o gh disse, curta. Sem ela o log nao separa rajada de cota
// esgotada, e foi por isso que o caso de 25/09 so se explicou consultando a API na mao.
function motivoDoGh(stderr) {
  const linha = String(stderr || '').split(/\r?\n/).map(l => l.trim()).find(Boolean) || '';
  return linha.length > 200 ? `${linha.slice(0, 200)}...` : linha;
}

// Entra na espera e loga UMA linha. So e chamada quando a conta NAO estava em espera
// (quem ja esta nem chega a rodar o gh), entao a linha sai uma vez por janela e nao
// uma por tentativa, que era o que entupia o log.
async function entrarEmEspera(engine, user, agora = Date.now(), stderr = '') {
  const ate = prazoPelaCota(await cotaDoGh(engine, user), agora);
  registro(engine).set(chave(user), ate);
  const motivo = motivoDoGh(stderr);
  engine.log('WARN', `limite de requisições do GitHub em @${user || engine.primaryUser() || ''}: `
    + `as buscas desta conta param até ${hora(ate)} (insistir só prolonga o bloqueio)`
    + (motivo ? `. O gh disse: ${motivo}` : ''));
  return ate;
}

// Boca unica das buscas: a falha e limite? Entao entra na espera (e devolve true, para
// o chamador nao logar a falha de novo). Qualquer outra falha segue o caminho de sempre.
async function tratarFalhaDeBusca(engine, user, stderr, agora = Date.now()) {
  if (!ehLimite(stderr)) return false;
  await entrarEmEspera(engine, user, agora, stderr);
  return true;
}

export default { ehLimite, esperaAte, prazoPelaCota, limiteAte, emEspera, cotaDoGh, entrarEmEspera, tratarFalhaDeBusca };
export { ehLimite, esperaAte, prazoPelaCota, limiteAte, emEspera, cotaDoGh, entrarEmEspera, tratarFalhaDeBusca };
