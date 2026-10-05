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

// O que o proprio GitHub diz da cota de BUSCA. O endpoint rate_limit e documentado como
// nao contando contra o limite, entao perguntar nao piora a condicao; e a busca ja
// falhou, entao nao ha o que atrasar. Falha ou resposta sem numero devolve null, e a
// espera padrao assume.
//
// `search`, e nao `graphql` (30/09/2026): o balde estava errado. Medido nas duas contas
// do Wanderson no mesmo instante: a pessoal tinha 7 de 30 gastos em `search` (janela de
// UM MINUTO) e 4 de 5000 em `graphql`. Perguntar ao balde errado devolvia saldo sobrando
// sempre, e com saldo o prazo cai no ramo da rajada; a janela que de fato estourou nunca
// era consultada.
//
// AS TRES COTAS (05/10/2026). Em 05/10 a conta foi recusada com "API rate limit exceeded for
// user ID", que e a mensagem do limite PRIMARIO, e o prazo saiu de dois minutos (ramo da
// rajada) porque so a cota de busca era consultada e ela tinha saldo. O limite primario e por
// usuario, somando tudo o que usa a conta (o Farol, as sessoes, outras ferramentas), e pode
// acabar na cota geral (core) ou na do GraphQL (que o `gh pr view` usa). Agora as tres sao
// lidas, e a espera e o reset da que de fato acabou; sem nenhuma esgotada, foi rajada.
const BALDES = ['core', 'search', 'graphql'];
const JQ_COTAS = '.resources | to_entries[] | select(.key == "core" or .key == "search" or .key == "graphql")'
  + ' | "\\(.key) \\(.value.remaining) \\(.value.reset)"';
async function cotaDoGh(engine, user) {
  const r = await io.run('gh', ['api', 'rate_limit', '--jq', JQ_COTAS], { env: engine.ghEnv(user) });
  if (!r.ok) return null;
  const baldes = String(r.stdout || '').trim().split(/\r?\n/).map((l) => l.trim().split(/\s+/))
    .map(([nome, restante, seg]) => ({ nome, restante: Number(restante), resetMs: Number(seg) * 1000 }))
    .filter((b) => BALDES.includes(b.nome) && Number.isFinite(b.restante) && b.resetMs > 0);
  return baldes.length ? { baldes } : null;
}

function esgotados(cota) {
  return ((cota && cota.baldes) || []).filter((b) => b.restante <= 0);
}

// O que a linha do log diz sobre a cota: qual acabou, ou que nenhuma acabou (rajada).
function descricaoDaCota(cota) {
  if (!cota) return 'cota ilegível';
  const fora = esgotados(cota).map((b) => b.nome);
  return fora.length ? `cota esgotada: ${fora.join(', ')}` : 'nenhuma cota esgotada, limite de rajada';
}

// PURA. O prazo da espera pelo que a cota diz (25/09/2026). A hora do reset so vale
// quando a cota ACABOU: com saldo, a recusa foi o limite de rajada (o "secondary rate
// limit", que passa em cerca de um minuto) e o fim da janela de uma hora nao tem relacao
// nenhuma com ela. Medido no aparelho do Wanderson: uma conta parada das 14:40 as 15:25
// com 8 de 5000 usados, porque o prazo era sempre o reset da janela.
function prazoPelaCota(cota, agora = Date.now()) {
  if (!cota) return esperaAte(0, agora);
  const fora = esgotados(cota);
  if (!fora.length) return agora + TEMPOS.LIMITE_GH_ESPERA_RAJADA_MS;
  return esperaAte(Math.max(...fora.map((b) => b.resetMs)), agora);
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
  const cota = await cotaDoGh(engine, user);
  const ate = prazoPelaCota(cota, agora);
  registro(engine).set(chave(user), ate);
  const motivo = motivoDoGh(stderr);
  engine.log('WARN', `limite de requisições do GitHub em @${user || engine.primaryUser() || ''}: `
    + `as buscas desta conta param até ${hora(ate)} (${descricaoDaCota(cota)}; insistir só prolonga o bloqueio)`
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

// O que a TELA precisa saber: quais contas estao com as buscas paradas e ate quando.
// Sem isto o bloqueio so existia no farol.log, e o painel seguia exibindo panorama velho
// calado, que e o mesmo defeito que o aviso de queda de conexao corrigiu.
function buscasPausadas(engine, agora = Date.now()) {
  const fora = [];
  for (const user of registro(engine).keys()) {
    const ate = limiteAte(engine, user === SEM_CONTA ? '' : user, agora);
    if (ate) fora.push({ conta: user, ate });
  }
  return fora.sort((a, b) => a.ate - b.ate);
}

export default { ehLimite, esperaAte, prazoPelaCota, descricaoDaCota, limiteAte, emEspera, cotaDoGh, entrarEmEspera, tratarFalhaDeBusca, buscasPausadas };
export { ehLimite, esperaAte, prazoPelaCota, descricaoDaCota, limiteAte, emEspera, cotaDoGh, entrarEmEspera, tratarFalhaDeBusca, buscasPausadas };
