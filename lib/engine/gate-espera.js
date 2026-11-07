// O estado do PR que o gate lê do envelope, e não do texto: CI obrigatório e dependência.
//
// PURO: só lê o envelope da revisão, que o runHeadlessReview completa antes do gate
// (`checksObrigatorios`, a mesma leitura do gate de lançamento em checks-exigidos.js) ou
// que a própria sessão preenche (`dependenciasAbertas`).
//
// DESDE 30/09/2026 SÃO DOIS DESTINOS DIFERENTES (pedido do dono: a configuração de aprovar
// sozinho tem de cumprir o que promete, sem desculpa para passar por um approve humano):
//   - CI obrigatório é ESPERA AUTOMÁTICA, nunca mesa. `motivoDeEspera` devolve
//     `ci_vermelho` (check em FAILURE no head) ou `ci_em_andamento` (rodando ou nem
//     começou), o resultado fica guardado dizendo "esperando o CI" e lib/engine/espera-ci.js
//     relê os checks a cada ciclo e posta sozinho quando fecham verdes no MESMO head.
//     Com "CI obrigatório antes da aprovação" ligado, aprovar por cima de CI vermelho é
//     proibido em qualquer política (desligado, ver abaixo, o CI não decide): nasceu em
//     biud-frontend#896 (02/09/2026), aprovação com o `audit` vermelho e merge por bypass
//     três minutos depois. Com a pipe em andamento também não sai (biud-frontend#1187,
//     27/09/2026, APPROVE com o próprio relatório pedindo espera). O que mudou é quem age
//     depois: de 27 a 30/09/2026 o card ia para a mesa e pedia o seu clique.
//   - Dependência em aberto (`dependenciasAbertas`: PR, deploy ou aplicação que a sessão
//     conferiu estar em aberto, caso engine-ai#266 com infra-k8s#189) é RESSALVA: vira
//     ponto de atenção em lib/engine/ressalvas.js e a política de ressalvas da conta decide.
// Falta de dado não inventa espera: campo ausente ou lista vazia deixam passar.
//
// A ESPERA DO CI É UMA ESCOLHA (`config.aguardarCiParaAprovar`, "CI obrigatório antes da
// aprovação" em Sistema > Automação, padrão DESLIGADO). Foi opt-in de 02/10 a 17/10/2026,
// obrigatória de 17/10 a 06/11/2026 e voltou a ser opt-in em 06/11/2026, pedido do dono: "isso
// aqui tem que ter como desativar no Farol, acredito que isso é a maior falha, e deve vir por
// default como desabilitado". Desligada, o estado do CI obrigatório não segura, não adia e não
// barra a decisão: sem espera, sem lacuna de CI, sem REQUEST_CHANGES só pelo CI, e o estado da
// pipe vira nota registrada no app (`avisoDoCi`), que nunca vai para o PR. O merge continua
// barrado pelo GitHub quando o check é obrigatório no ruleset. Ligada, vale tudo o que está
// descrito acima.
const TETO_DE_DEPENDENCIAS = 10;
const TETO_DO_ITEM = 200;

function checksNoEstado(result, estados) {
  const lista = result && result.checksObrigatorios;
  if (!Array.isArray(lista)) return [];
  return lista
    .filter((c) => c && estados.includes(String(c.estado || '')))
    .map((c) => String(c.nome || '').trim())
    .filter(Boolean);
}

// Checks obrigatórios em FAILURE no head (a regra de biud-frontend#896). Reexportada pelo
// decision.js para a fachada do server.js.
function checksVermelhos(result) {
  return checksNoEstado(result, ['vermelho']);
}

function dependenciasAbertas(result) {
  const lista = result && result.dependenciasAbertas;
  if (!Array.isArray(lista)) return [];
  return lista
    .filter((d) => typeof d === 'string')
    .map((d) => d.trim().slice(0, TETO_DO_ITEM))
    .filter(Boolean)
    .slice(0, TETO_DE_DEPENDENCIAS);
}

function checksPendentes(result) {
  return checksNoEstado(result, ['rodando', 'ausente']);
}

// A chave da espera, lida em TODA via que decide ou posta (revisão automática, publicação,
// espera já armada, retirada do pedido, tela). Só o booleano verdadeiro liga (o saneador de
// lib/settings.js garante o mesmo no arquivo), então config ausente ou torta cai no padrão,
// que é não esperar.
function aguardaCiParaAprovar(config) {
  return !!(config && config.aguardarCiParaAprovar === true);
}

// Só CI. Vermelho é o mais forte: com um check reprovando, os que ainda rodam não mudam nada.
function motivoDeEspera(result) {
  if (checksVermelhos(result).length) return 'ci_vermelho';
  if (checksPendentes(result).length) return 'ci_em_andamento';
  return null;
}

const TEXTO = {
  ci_vermelho: (r) => `check obrigatório vermelho no head (${checksVermelhos(r).join(', ')}): a aprovação está esperando o CI e sai sozinha quando ele ficar verde neste commit; com CI reprovando ela nunca sai`,
  ci_em_andamento: (r) => `check obrigatório ainda sem resultado no head (${checksPendentes(r).join(', ')}): a aprovação está esperando o CI e sai sozinha quando a pipe fechar verde neste commit`,
};

// O texto do motivo, para o card. Motivo que não é de espera devolve ''.
function textoDaEspera(motivo, result) {
  return Object.hasOwn(TEXTO, String(motivo)) ? TEXTO[motivo](result || {}) : '';
}

// O estado do CI para o card que vai para a mesa por OUTRO motivo (a política da conta manda
// esperar você): quem vai clicar em Aprovar precisa saber que a pipe não está verde.
// Devolve a lista de motivos ({ text, kind }) pronta para entrar em reasons: vazia com CI verde.
function avisoDoCi(result) {
  const vermelhos = checksVermelhos(result);
  if (vermelhos.length) return [{ text: `check obrigatório vermelho no head (${vermelhos.join(', ')})`, kind: 'gate' }];
  const pendentes = checksPendentes(result);
  return pendentes.length ? [{ text: `check obrigatório ainda sem resultado no head (${pendentes.join(', ')})`, kind: 'gate' }] : [];
}

// O aviso no card de uma APROVAÇÃO que saiu (06/11/2026), nunca no PR. Dois casos em que o
// GitHub pode não segurar o que o Farol aprovou:
//   - o ruleset da branch de destino não exige check nenhum (`semCheckObrigatorio`, lido por
//     anexarChecksObrigatorios): o merge não é barrado nem com o CI vermelho;
//   - "CI obrigatório antes da aprovação" desligado e o check obrigatório vermelho ou sem
//     resultado no head: a aprovação saiu assim, e o GitHub segura o merge até ele passar.
// Com a chave ligada o segundo caso não existe (a aprovação espera o CI), e a lista vem vazia.
// O endpoint de rules não vê a proteção clássica da branch, por isso o primeiro texto condiciona;
// exigência que não deu para ler (null) não gera aviso, para o card não afirmar o que não sabe.
const TETO_DE_CHECKS_NO_AVISO = 10;
function avisoDaAprovacao(result) {
  const r = result || {};
  const avisos = [];
  if (r.semCheckObrigatorio === true) {
    const todos = Array.isArray(r.checksForaDoRuleset) ? r.checksForaDoRuleset : [];
    const fora = todos.slice(0, TETO_DE_CHECKS_NO_AVISO).map((c) => `${String(c.nome).slice(0, 60)} ${c.estado === 'vermelho' ? 'vermelho' : 'sem resultado'}`);
    if (todos.length > fora.length) fora.push(`mais ${todos.length - fora.length}`);
    avisos.push({ kind: 'gate', text: `aprovado sem check de CI obrigatório no ruleset da branch de destino: se a branch também não tiver proteção clássica, o GitHub não barra o merge${fora.length ? `, e o CI não está verde no head (${fora.join(', ')})` : ''}` });
  }
  const vermelhos = checksVermelhos(r);
  const pendentes = checksPendentes(r);
  if (vermelhos.length) avisos.push({ kind: 'gate', text: `aprovado com check obrigatório vermelho no head (${vermelhos.join(', ')}): o ruleset segura o merge até ele passar, salvo bypass` });
  else if (pendentes.length) avisos.push({ kind: 'gate', text: `aprovado com check obrigatório ainda sem resultado no head (${pendentes.join(', ')}): o ruleset segura o merge até ele passar, salvo bypass` });
  return avisos;
}

export default { aguardaCiParaAprovar, motivoDeEspera, textoDaEspera, avisoDoCi, avisoDaAprovacao, dependenciasAbertas, checksVermelhos };
export { aguardaCiParaAprovar, motivoDeEspera, textoDaEspera, avisoDoCi, avisoDaAprovacao, dependenciasAbertas, checksVermelhos };
