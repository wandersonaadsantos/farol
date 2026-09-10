// Cota de CONTA dentro do perfil Claude (Politica 2 da spec
// 2026-09-10-justica-de-fila-entre-orgs).
//
// Mora num modulo proprio e nao no usage.js por dois motivos. O tecnico: usage.js ja
// estava no teto de 400 linhas uteis do gate de qualidade, e empurrar a cota pra
// dentro dele fazia o arquivo estourar. O de desenho, que e o que importa: usage.js
// MEDE gasto, e a cota DECIDE quem espera. Sao responsabilidades diferentes, e mistura-
// las e o comeco de um arquivo que faz tudo (a licao da Onda 2, docs/QUALITY.md).
//
// PURO: sem estado, sem IO, sem relogio proprio (o dia entra por parametro, como no
// applyUsage). O que ele precisa do usage.js entra por import de funcao pura.
import { dailyCapFor, localDay } from './usage.js';

/* --- Politica 2 da spec 2026-09-10-justica-de-fila-entre-orgs: cota de CONTA dentro
   do perfil ------------------------------------------------------------------------

   O teto de orcamento sempre foi do PERFIL Claude. Duas contas GitHub apontando pro
   mesmo claudeProfileId dividem um teto unico, e a de alto volume queimava a cota do
   dia sozinha: a outra era barrada no gate de enfileiramento (server.js) sem nunca ter
   tido uma revisao, e o toast falava do PERFIL, entao nem dava pra ver quem consumiu.

   A cota da a cada conta uma fatia do teto do dia. Mas ela SO MORDE QUANDO HA DISPUTA,
   e essa clausula e o coracao do desenho: sem outra conta esperando na fila, quem
   chegou e atendido ate o teto duro do perfil, exatamente como antes. E o que mantem a
   politica work-conserving (nenhum dolar do teto fica sem gastar guardando a vez de
   quem nao chegou) e e a regra do Wanderson escrita como codigo: com fila, divide; sem
   fila, o que chegar e atendido.

   O teto DURO do perfil continua valendo por cima e e avaliado antes (profileBudgetStatus):
   perfil estourado barra todo mundo, como sempre. A cota so acrescenta um segundo motivo
   de bloqueio, mais cedo e mais seletivo. Nada aqui fura o teto. */

// Gasto de UMA conta dentro de UM perfil num dia. Sai de usageSessions.sessions, que ja
// carrega account/profileId/day/costUsd desde sempre: a Politica 2 nao precisou de
// nenhuma mudanca de schema de usage. PURA (recebe o dia pronto, como applyUsage).
function accountSpendInProfile(sessions, profileId, account, day) {
  const acc = String(account || '').toLowerCase();
  let total = 0;
  for (const x of (Array.isArray(sessions) ? sessions : [])) {
    if (!x || x.day !== day) continue;
    if (String(x.profileId || '') !== String(profileId || '')) continue;
    if (String(x.account || '').toLowerCase() !== acc) continue;
    total += Number(x.costUsd) || 0;
  }
  return total;
}

// Peso da conta no rateio. Torto (0, negativo, lixo) vira 1: um peso invalido vindo de
// config.json editado a mao nao pode zerar a cota de alguem e barrar essa conta pra
// sempre, que e falha silenciosa do pior tipo (a automacao para e nada explica).
function pesoDaConta(c) {
  const n = Number(c && c.weight);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/* Veredito da cota pra UMA conta. PURA: recebe o perfil, as sessoes, a lista de contas
   ativas daquele perfil ({ user, weight, waiting }), quem esta perguntando, a projecao
   do custo tipico e o dia.

   `waiting` e "esta conta tem PR esperando na fila AGORA", resolvido por quem chama a
   partir da fila viva. E ele que faz a cota morder so quando ha disputa de verdade.

   Devolve tambem `quota`, `spent` e `cedendoPara`, porque o gate antigo so sabia dizer
   "orcamento estourado": com duas contas no mesmo perfil, essa frase escondia qual
   delas consumiu e quem estava esperando. O toast e o log agora nomeiam os dois lados. */
function quotaStatusFor(profile, sessions, contas, account, tipico = 0, day = localDay()) {
  const vazio = { blocked: false, quota: null, spent: 0, cedendoPara: [] };
  if (!profile) return vazio;
  // mesma razao do profileBudgetStatus: o plano do Codex nao informa custo por sessao,
  // entao teto (e cota) em US$ ali seria falsa precisao.
  if (profile.kind === 'codex') return vazio;
  const cap = dailyCapFor(profile, day);
  if (cap == null) return vazio; // sem teto do dia nao ha o que ratear
  const lista = (Array.isArray(contas) ? contas : []).filter(c => c && c.user);
  const eu = lista.find(c => String(c.user).toLowerCase() === String(account || '').toLowerCase());
  if (!eu) return vazio; // conta que nao usa este perfil nao tem cota aqui
  const somaPesos = lista.reduce((t, c) => t + pesoDaConta(c), 0);
  if (!(somaPesos > 0)) return vazio;
  const projecao = Number(tipico) > 0 ? Number(tipico) : 0;
  const cotaDe = (c) => cap * (pesoDaConta(c) / somaPesos);
  const gastoDe = (c) => accountSpendInProfile(sessions, profile.id, c.user, day);
  const quota = cotaDe(eu);
  const spent = gastoDe(eu);
  if (spent + projecao < quota) return { blocked: false, quota, spent, cedendoPara: [] };
  // estourei a minha cota. So cedo a vez se alguem ESPERA e ainda cabe na cota DELE:
  // ceder pra quem tambem estourou nao devolve a vez a ninguem, so deixa o teto do
  // perfil sem gastar, que e exatamente o que a regra do Wanderson proibe.
  const cedendoPara = lista
    .filter(c => c !== eu && c.waiting && (gastoDe(c) + projecao) < cotaDe(c))
    .map(c => String(c.user));
  return { blocked: cedendoPara.length > 0, quota, spent, cedendoPara };
}

export default { accountSpendInProfile, quotaStatusFor, pesoDaConta };
export { accountSpendInProfile, quotaStatusFor, pesoDaConta };
