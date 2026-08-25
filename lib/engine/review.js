// Concern do pipeline de revisão headless (Onda 2, colaborador): lançar review (terminal
// ou headless), a fila com 1 revisão por conta em paralelo (escalonador), o worker que roda
// cada uma com retry de erro transitório, a montagem do prompt (perfil do autor + formato
// humano) e a revisão em si com o gate de auto-aprovar/reprovar. Funções recebem o engine
// como ctx; a Engine mantém fachadas finas. Gate intacto (CLAUDE.md, invariante 4). Ver docs/QUALITY.md.
import fs from 'node:fs';
import path from 'node:path';
import { WORKSPACE, TEMPLATE_DIR, STATE_DIR } from '../paths.js';
import io, { writeJsonAtomic } from '../io.js';
import fanoutMod from './fanout.js';
import * as jiraMod from './jira.js';
import { JIRA_CODES, motivoDe } from '../jira/errors.js';
import { classify, resetAtFrom } from '../log-taxonomy.js';
// reasons/attention viajam como { text, kind } desde a v2.48.0: o unwrap tem UM
// endereço (lib/format.js), senão cada consumidor reinventa e um deles esquece
import { reasonText, staleHeadText } from '../format.js';
import { checkpointPath, readCheckpoint, relevantEntries, summarizeCheckpoint, resumeBlock } from './verification-checkpoint.js';
import {
  blobMapFrom, sameEffectiveDiff, splitByProof, reconcileInheritedCoverage,
  fileProofBlock, saveFileProof, readFileProof,
} from './file-proof.js';
import {
  PAPEL_LEVELS, PAPEL_LABEL, PAPEL_TONE,
  DOMAINS, DOMAIN_LEVELS, DOMAIN_LABEL, DOMAIN_LEVEL_LABEL, DOMAIN_POSTURE,
  PUSHBACK_LABEL,
} from '../taxonomy.js';

// Motivo cru do envelope da sessão vira { text, kind }. String solta é 'content':
// quem escreveu foi a revisão, apontando algo sobre o código. Objeto que já veio
// etiquetado passa direto.
function asReason(r) {
  if (r && typeof r === 'object' && typeof r.text === 'string') return r;
  return { text: String(r), kind: 'content' };
}

// Motivo de GATE: o app segurou por regra (cobertura, contestação, política,
// clique), não porque a revisão achou algo. Construtor curto porque os pontos que
// prependam vivem dentro de if aninhado, e o literal ali dentro empurrava a
// profundidade acima do teto do gate de qualidade.
const gateReason = (text) => ({ text, kind: 'gate' });
// Motivo de INFRA: a postagem em si falhou (rede, gateway fora do ar).
const infraReason = (text) => ({ text, kind: 'infra' });

// Marcador de retry da postagem. Só nasce quando a falha é claramente transitória
// (mesma tabela de log-taxonomy.js, invariante 3); null pra todo o resto, porque
// insistir em falha permanente não resolve e ainda esconde de você o problema que
// exige ação humana. Função e não literal no ponto de uso: ali dentro já são dois
// if aninhados, e o objeto estourava a profundidade do gate de qualidade.
function postRetryFor(event, erro) {
  return classify(erro).kind === 'transitorio' ? { event, attempts: 0 } : null;
}

function prFromUrl(engine, url) {
  const m = String(url).match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
  if (!m) return null;
  return { key: `${m[1]}#${m[2]}`, url, title: '', author: '', repo: m[1], number: parseInt(m[2], 10) };
}

async function launchReview(engine, urls, mode = 'auto', origem = 'auto') {
  if (!urls || !urls.length) return { ok: false, error: 'sem PRs para revisar' };
  if (!engine.token) await engine.refreshTokens();
  // requested = o PR pediu a MINHA revisão (fila). Revisão iniciada por clique
  // no panorama (ou por URL avulsa) nunca posta nada sozinha: sempre passa
  // pela seção "Precisa de você". Cada item carrega a conta dona (accountForPr
  // deduz pela org quando veio de URL avulsa) pro token certo em todo o fluxo.
  const items = urls.map(u => {
    const q = engine.queue.find(p => p.url === u);
    if (q) return { ...q, account: engine.accountForPr(q), requested: true };
    const pano = engine.panorama.find(p => p.url === u);
    if (pano) return { ...pano, account: engine.accountForPr(pano), requested: !!pano.mine };
    const pr = engine.prFromUrl(u);
    return pr ? { ...pr, account: engine.accountForPr(pr), requested: false } : null;
  }).filter(Boolean);
  // gate por conta (A1 nos consumidores): item de conta SEM token não abre sessão
  // nenhuma (a sessão rodaria gh e Claude com identidade errada). Ele NÃO é marcado
  // como visto: fica na fila esperando o token voltar. Os demais seguem normalmente.
  const semToken = items.filter(it => !engine.tokenFor(it.account));
  if (semToken.length) {
    const contas = [...new Set(semToken.map(it => it.account || '(nenhuma)'))].join(', ');
    engine.emit('toast', { kind: 'error', text: `Conta ${contas} não autenticada no gh. Rode: gh auth login (${semToken.length} PR(s) fora desta revisão).` });
  }
  const prontos = items.filter(it => engine.tokenFor(it.account));
  if (!prontos.length) return { ok: false, error: 'gh sem token' };
  // lançar (manual ou auto) tira o PR do "estacionamento": ele volta a ser elegível.
  // A gravação fica FORA do laço (M2): dentro dele um lote de N PRs reescrevia o
  // arquivo inteiro N vezes, e as N-1 primeiras gravações são estado intermediário
  // que ninguém lê. Uma gravação só, e só se algo saiu mesmo do estacionamento.
  let saiuDoEstacionamento = false;
  // clique explícito também DESFAZ a saída de cena: você decidiu revisar sabendo
  // que outra pessoa está lá, e a partir daí o app volta a agir neste PR.
  const porClique = origem === 'clique';
  let voltouDeCena = false;
  for (const it of prontos) {
    engine.markSeen(it.key);
    if (engine.autoReviewParked.delete(it.key)) saiuDoEstacionamento = true;
    if (porClique) {
      it.manual = true;
      if (engine.skipComentado && engine.skipComentado[it.key]) { delete engine.skipComentado[it.key]; voltouDeCena = true; }
    }
  }
  if (saiuDoEstacionamento) engine.saveAutoReviewParked();
  if (voltouDeCena) engine.saveSkipComentado();
  engine.queue = engine.queue.filter(p => !prontos.some(it => it.url === p.url));
  engine.pushState();

  if (mode === 'terminal') {
    const keys = prontos.map(p => p.key);
    const label = keys.length === 1 ? `Revisão de ${keys[0]}` : `Revisão de ${keys.length} PRs`;
    // a sessao no terminal usa 1 token; pega a conta do 1o PR (lotes costumam
    // ser da mesma conta). Mistura de contas num mesmo terminal recai na 1a.
    engine.spawnConsole(`/pr-review ${prontos.map(p => p.url).join(' ')}`, label, keys, engine.accountForPr(prontos[0]));
    engine.emit('toast', { kind: 'ok', text: `${label} aberta no terminal do Claude.` });
    return { ok: true, mode };
  }

  for (const pr of prontos) engine.enqueueHeadless(pr);
  engine.emit('toast', {
    kind: 'info',
    text: prontos.length === 1
      ? `Revisando ${prontos[0].key} internamente. Te aviso do resultado.`
      : `Revisando ${prontos.length} PRs internamente (em paralelo por conta, serial dentro da conta).`
  });
  return { ok: true, mode };
}

// --- revisao autonoma (headless): contas em paralelo; dentro da mesma conta,
// até config.parallelReviews simultâneas (default 1 = serial, ver parallelLimit) ---
function enqueueHeadless(engine, pr) {
  /* A promessa "não vou duplicar a revisão" é honrada AQUI, e não em quem chama.
     Foi o tropeço do #68 (20/08/2026): a trava nasceu só no `toReview`, e os
     outros dois caminhos automáticos entravam por baixo dela. Medido: o Farol
     comentou às 19:55:52 e a label dele subiu às 19:57:45, com a label do colega
     AINDA no ar, ou seja, por um caminho que nem olhava a label.

     Este é o ponto por onde TODA revisão headless passa (launchReview e
     launchReReviews), então é aqui que a garantia tem que morar. Gate em chamador
     é gate que o próximo caminho esquece, e o CLAUDE.md já avisava isso sobre o
     reReviewTargets ("as MESMAS travas do toReview: quem mexer lá, mexe aqui").

     Clique explícito (`pr.manual`) NUNCA é barrado: quem mandou revisar foi você,
     sabendo que outra pessoa está lá. Ele inclusive DESFAZ a saída de cena, no
     mesmo espírito do estacionamento (lançar tira de lá). */
  if (engine.skipComentado && engine.skipComentado[pr.key] && !pr.manual) return;
  // não duplica: se já há uma revisão headless deste PR na fila ou rodando, ignora
  // (ex.: clicar Revisar no panorama num PR que o check() já pôs em auto-revisão,
  // ou dois cliques rápidos). O caminho de autoanálise tem o seu próprio dedup.
  const busy = engine.headlessQueue.some(p => p.kind !== 'self' && p.key === pr.key) ||
    [...engine.activeReviews.values()].some(s => s.mode === 'auto' && (s.keys || []).includes(pr.key));
  if (busy) return;
  engine.headlessQueue.push(pr);
  engine.writeInflight();
  engine.processHeadless();
  engine.pushState();
}

// "21:00" pro toast do limite de plano. Hora local da máquina, o mesmo fuso em que
// resetAtFrom interpreta a mensagem (ver a nota de FUSO em lib/log-taxonomy.js).
function horaCurta(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// conta que "ocupa" o slot da revisão (uma por conta de cada vez)
function headlessAcct(engine, pr) { return String(engine.accountForPr(pr) || '').toLowerCase() || '(sem conta)'; }

// Teto de revisões SIMULTÂNEAS da mesma conta (config.parallelReviews, opt-in do
// Wanderson em 15/08/2026). Clampado AQUI, no consumidor, além do updateSettings:
// defesa em profundidade no padrão do buildModelFlags, porque config torta vinda de
// config.json editado à mão não pode virar teto 0 (fila travada) nem NaN (loop).
function parallelLimit(engine) {
  const n = parseInt((engine.config || {}).parallelReviews, 10);
  return Number.isFinite(n) ? Math.min(4, Math.max(1, n)) : 1;
}

// devolve o slot da conta ao escalonador. Zera LIMPO (delete, não set 0): o
// isBusy do update.js pergunta headlessBusyAccounts.size, e uma conta ociosa
// registrada com contagem 0 seguraria o auto-update pra sempre.
function freeHeadlessSlot(engine, acct) {
  const n = (engine.headlessBusyAccounts.get(acct) || 0) - 1;
  if (n > 0) engine.headlessBusyAccounts.set(acct, n);
  else engine.headlessBusyAccounts.delete(acct);
}

// escalonador: dispara quantas revisões der, até parallelLimit por conta (default 1,
// o comportamento de sempre: série dentro da conta, contas diferentes em paralelo).
// Síncrono (não await): cada revisão roda em paralelo e reprograma no fim.
function processHeadless(engine) {
  for (; ;) {
    const limite = parallelLimit(engine);
    const idx = engine.headlessQueue.findIndex(pr => (engine.headlessBusyAccounts.get(engine.headlessAcct(pr)) || 0) < limite);
    if (idx < 0) break; // fila vazia ou todas as contas pendentes já no teto
    const pr = engine.headlessQueue.splice(idx, 1)[0];
    const acct = engine.headlessAcct(pr);
    engine.headlessBusyAccounts.set(acct, (engine.headlessBusyAccounts.get(acct) || 0) + 1);
    engine.runOneHeadless(pr, acct);
  }
}

async function runOneHeadless(engine, pr, acct) {
  // autoanalise: caminho separado, NUNCA posta nem gerencia a fila de revisor.
  // Erro so vira toast (o autor reroda quando quiser); nada volta pra fila.
  if (pr.kind === 'self') {
    try {
      await engine.runSelfAnalysis(pr);
    } catch (err) {
      if (err.cancelled) {
        engine.emit('toast', { kind: 'info', text: `Autoanálise de ${pr.key} cancelada.` });
      } else {
        engine.log('ERROR', `autoanalise ${pr.key}: ${err.message}`);
        engine.emit('toast', { kind: 'error', text: `Autoanálise de ${pr.key} falhou: ${err.message}` });
      }
    } finally {
      engine.freeHeadlessSlot(acct);
      engine.writeInflight();
      engine.pushState();
      engine.processHeadless();
    }
    return;
  }

  // PR pode ter sido mergeado enquanto esperava a vez na fila (conta ocupada com
  // outra revisão, fan-out grande, etc.): revisar e postar review num PR já
  // mergeado é ruído puro. null (sem prova, rede/token) NUNCA cancela, só MERGED
  // de verdade pula a revisão (mesma regra do reconcilePending em decision.js).
  let jaMergeado = false;
  try { jaMergeado = (await engine.prState(pr)) === 'MERGED'; }
  catch (err) { engine.log('WARN', `estado de ${pr.key} antes da revisão: ${err.message}`); }
  if (jaMergeado) {
    engine.emit('toast', { kind: 'info', text: `${pr.key} já foi mergeado; cancelei a revisão antes de começar.` });
    engine.freeHeadlessSlot(acct);
    engine.writeInflight();
    engine.pushState();
    engine.processHeadless();
    return;
  }

  // G16: o gate de orçamento rodou no ENFILEIRAMENTO; num lote grande o teto
  // pode estourar entre a fila e a vez deste PR. Re-checa na boca da sessão:
  // estaciona (não descarta) e o relançamento manual continua valendo. Espelha
  // os outros 3 pontos de estacionamento deste arquivo (revisão da Task 3.3):
  // unsee + queue.push ANTES de estacionar (o card não pode sumir da fila
  // visível pra sempre, `seen` continuaria marcado) e retryAfterNet.delete
  // ANTES do autoReviewParked.add (entrada órfã de retry desfaz o
  // estacionamento no ciclo seguinte quando o orçamento libera, exatamente o
  // incidente de 04/08/2026 descrito mais abaixo).
  const perfilEstourado = engine.budgetBlockedFor(engine.accountForPr(pr));
  if (perfilEstourado) {
    engine.unsee(pr.key);
    if (!engine.queue.some(p => p.key === pr.key)) engine.queue.push(pr);
    engine.retryAfterNet.delete(pr.key);
    engine.autoReviewParked.add(pr.key);
    engine.saveAutoReviewParked();
    // M3: aviso ÚNICO por janela de bloqueio, no mesmo Set que o gate de
    // enfileiramento usa (server.js, toReview) e que o topo do check() reconcilia
    // quando o perfil destrava. Sem isso, um lote de N PRs barrados pelo MESMO
    // estouro empilhava N toasts idênticos no mesmo segundo; o que a pessoa precisa
    // saber (o perfil travou, os PRs esperam) cabe numa frase só, e os cards
    // voltando pra fila contam o resto.
    if (!engine.budgetWarned.has(perfilEstourado.id)) {
      engine.budgetWarned.add(perfilEstourado.id);
      engine.emit('toast', { kind: 'info', text: `O orçamento do perfil "${perfilEstourado.label}" estourou; as revisões desta leva aguardam você.` });
    }
    engine.freeHeadlessSlot(acct);
    engine.writeInflight();
    engine.pushState();
    engine.processHeadless();
    return;
  }

  try {
    await engine.runHeadlessReview(pr);
    engine.retryAfterNet.delete(pr.key);
  } catch (err) {
    engine.unsee(pr.key);
    // volta VISÍVEL pra fila na hora (não só no próximo ciclo)
    if (!engine.queue.some(p => p.key === pr.key)) engine.queue.push(pr);
    const msg = err.message || '';
    // TRANSITÓRIO (se resolve sozinho, não estaciona): queda de rede, limite do
    // plano Claude (espera o reset), o binário do claude quebrado/indisponível, ou
    // o token da conta sumindo no meio (flake do keyring do gh).
    // A classificação NÃO mora mais aqui: quatro regexes inline decidiam isto de um
    // lado enquanto o painel de Diagnóstico lia o mesmo texto do outro sem entender
    // nada. Hoje os dois leem a mesma tabela (lib/log-taxonomy.js) e aqui só se
    // pergunta o que FAZER com a falha. Falha desconhecida cai em 'permanente' de
    // propósito: sem saber o que houve, relançar sozinho vira loop queimando token.
    const classe = classify(msg);
    const limitErr = classe.kind === 'espera-reset';
    const transient = limitErr || classe.kind === 'transitorio';
    if (err.cancelled) {
      // cancelado por você: estaciona pra não relançar sozinho (você reabre quando quiser).
      // O delete do retry é pelo mesmo motivo do ramo não-transitório lá embaixo (leia o
      // comentário do incidente de 04/08/2026): cancelar um PR que estava em retry e
      // deixar a entrada viva faz o próprio check() desfazer o cancelamento no ciclo seguinte.
      engine.retryAfterNet.delete(pr.key);
      engine.autoReviewParked.add(pr.key);
      engine.saveAutoReviewParked();
      engine.emit('toast', { kind: 'info', text: `Revisão de ${pr.key} cancelada. O PR voltou pra sua fila.` });
    } else if (transient) {
      // limite do plano se resolve no reset; rede/binário costumam voltar rápido.
      // Retoma sozinho no próximo ciclo bem-sucedido, até um teto (aí estaciona).
      const cap = limitErr ? 12 : 3;
      const guardado = engine.retryAfterNet.get(pr.key);
      const tries = (guardado && guardado.tries) || 0;
      engine.log('WARN', `revisao ${pr.key} (transitório, tenta de novo): ${msg}`);
      if (tries < cap) {
        // Limite de plano tem HORA pra voltar, e ela vem escrita na própria mensagem
        // ("resets 9pm"). Antes disso o PR era tratado como flake qualquer e tentava
        // de novo a cada ciclo: em 07/08/2026 foram 70 linhas de log em 8 PRs pra UMA
        // condição de hora conhecida. Agora a entrada carrega o instante do reset e o
        // retryTargets pula quem ainda não chegou lá. notBefore null (mensagem sem
        // hora, ou falha que não é de limite) = comportamento de sempre.
        const reset = limitErr ? resetAtFrom(msg) : null;
        // guarda o PR junto das tentativas: o relançamento não pode depender de o
        // PR seguir na fila mine (clique no panorama sai da queue no rebuild do check)
        engine.retryAfterNet.set(pr.key, { tries: tries + 1, pr, notBefore: reset ? reset.getTime() : null });
        engine.emit('toast', { kind: 'error', text: limitErr
          ? `Limite do teu plano Claude atingido. Retomo ${pr.key} sozinho ${reset ? `depois das ${horaCurta(reset)}` : 'quando resetar'}; ele está na sua fila.`
          : `Revisão de ${pr.key} caiu por algo transitório; tento de novo no próximo ciclo. Está na sua fila.` });
      } else {
        engine.retryAfterNet.delete(pr.key);
        engine.autoReviewParked.add(pr.key);
        engine.saveAutoReviewParked();
        engine.log('ERROR', `revisao autonoma ${pr.key}: ${msg}`);
        engine.emit('toast', { kind: 'error', text: `Revisão de ${pr.key} falhou várias vezes; parei de tentar sozinho. O PR está na sua fila.` });
      }
    } else {
      // Falha não-transitória de verdade: estaciona pra não relançar em loop.
      // O delete do retry é OBRIGATÓRIO, não zelo: sem ele o estacionamento é
      // mentira. O check() só olha retryAfterNet.size pra decidir se repesca, e o
      // launchReview faz autoReviewParked.delete em tudo que lança, ou seja, a
      // entrada órfã de retry desfaz o estacionamento no ciclo seguinte. Foi
      // exatamente o incidente de 04/08/2026 com biudtech/biud-frontend#702: caiu
      // por algo transitório às 16:07 (entrou no retry), a falha virou permanente
      // (a org desligou o acesso por assinatura) e o PR ficou em loop SEM TETO,
      // 25 linhas ERROR idênticas entre 15:52 e 19:28, até alguém mexer no app.
      engine.retryAfterNet.delete(pr.key);
      engine.autoReviewParked.add(pr.key);
      engine.saveAutoReviewParked();
      engine.log('ERROR', `revisao autonoma ${pr.key}: ${msg}`);
      engine.emit('toast', { kind: 'error', text: `Revisão de ${pr.key} falhou: ${msg}` });
    }
  } finally {
    engine.freeHeadlessSlot(acct);
    engine.writeInflight();
    engine.pushState();
    engine.processHeadless();
  }
}

// bloco injetado no prompt de revisão: ajusta TOM + POSTURA, nunca a decisão.
// Papel dá o tom-base; a matriz por domínio calibra a postura por área do PR;
// o histórico de pushback calibra humildade/assertividade com aquela pessoa.
function personProfileBlock(engine, login) {
  const p = engine.personProfile(login);
  const papel = PAPEL_LEVELS.includes(p.papel) ? p.papel : '';
  const doms = (p.dominios && typeof p.dominios === 'object') ? p.dominios : {};
  const domEntries = DOMAINS.filter(d => DOMAIN_LEVELS.includes(doms[d]));
  const pushbacks = engine.pushbacksFor(login).slice(0, 5);
  if (!papel && !domEntries.length && !pushbacks.length) return ''; // sem perfil nem histórico = tom neutro
  let block = `\n\n## Perfil do autor\n`;
  if (papel) block += `Papel de @${login}: **${PAPEL_LABEL[papel]}** (${PAPEL_TONE[papel]})\n`;
  if (domEntries.length) {
    block += `Competência por domínio (cruze com a área que o PR mexe):\n`;
    for (const d of domEntries) block += `- ${DOMAIN_LABEL[d]} (nível **${DOMAIN_LEVEL_LABEL[doms[d]]}**): ${DOMAIN_POSTURE[doms[d]]}\n`;
  }
  if (pushbacks.length) {
    block += `\nHistórico de pushback com @${login} (revisões suas que ele contestou):\n`;
    for (const pb of pushbacks) block += `- ${pb.key}: ${PUSHBACK_LABEL[pb.outcome] || pb.outcome}${pb.note ? ` (${pb.note})` : ''}\n`;
    block += `Calibre a humildade e a assertividade por isso: onde ele já mostrou que estava certo, seja mais cuidadoso antes de afirmar algo parecido; onde você estava certo, mantenha a posição com clareza.\n`;
  }
  block += `\nAjuste APENAS o TOM e a POSTURA (o quanto explica, o quanto defere, como levanta os pontos) nos corpos dos payloads e nos comentários inline. ` +
    `NÃO mude a decisão técnica: verdict, decision, cardMet, findings e o gate seguem valendo só pelos fatos do código. O perfil muda COMO você escreve, nunca SE aprova ou reprova.\n`;
  return block;
}

// Como escrever o corpo POSTADO no PR: humano, personalizado, objetivo e
// profissional, adaptado à senioridade do autor (usa o Perfil do autor acima).
// PREVALECE sobre o formato do CLAUDE.md. Injetado SEMPRE, pra o review nunca
// sair com cara de bot (era a queixa: carimbos e template robótico).
function reviewFormatBlock(engine) {
  return `\n\n## Como escrever o corpo do review postado no PR (PREVALECE sobre o formato do CLAUDE.md)\n` +
    `Escreva como o Wanderson escreveria: uma pessoa sênior revisando o PR de um colega, não uma ferramenta. Personalizado, objetivo e profissional.\n` +
    `- **Separe os campos:** \`reportMarkdown\` e \`reasons\` são diagnóstico INTERNO e podem explicar gate/processo. \`reviewMarkdown\`, os três \`payloads.*.body\` e todo \`comments[].body\` são REVIEW para o autor. Nunca copie "Ação", gate, política, cobertura, memória, prompt, agentes ou justificativa de postagem do relatório interno pros campos de review.\n` +
    `- **Sem cara de bot:** NADA de caixas de alerta (\`> [!NOTE]\`/\`> [!WARNING]\`), nem "Placar", nem checklist de critérios com \`- [x]\`, nem os prefixos de Conventional Comments no texto ("🟡 suggestion (non-blocking):", "🔴 issue (blocking):" e afins). NUNCA use automação, Farol, Claude, IA, modelo, bot, agente/subagente, prompt, memória interna, política/gate, \`auto_approve\`, "auto-aprovei/não auto-aprovei", "revisão automática" ou "ficou só no app" como origem, ator ou justificativa do review. Quando forem o próprio assunto técnico do PR, esses termos podem aparecer normalmente. O review fala apenas de código, impacto e ação do autor.\n` +
    `- **Use TODO o perfil do autor acima** (papel, competência por domínio, histórico de pushback) pra personalizar tom, profundidade e deferência, e adapte o FORMATO à senioridade:\n` +
    `  - Estágio/Júnior: prosa acolhedora de mentor. Abra reconhecendo o que ficou bom de verdade (específico, com o porquê), explique cada ajuste ensinando ("o que segura o merge é..."), enquadre como "quase lá", feche natural.\n` +
    `  - Pleno/Sênior/Tech Lead/Arquiteto: enxuto e direto, de par pra par. Vá aos pontos técnicos sem preâmbulo nem elogio de consolo, assumindo contexto compartilhado.\n` +
    `  - Especialista: no domínio dele, defira e foque na nuance; fora, trate como par.\n` +
    `  - Sem perfil marcado: tom neutro, direto e cordial.\n` +
    `- **Tom do Wanderson:** direto e claro, sem gíria nem subtexto, **sem travessão** (use vírgula, parênteses ou dois pontos). Elogio só quando sincero e específico (nunca de consolo). Português brasileiro.\n` +
    `- **Substância intacta:** blockers e ressalvas entram no texto de forma natural (o que é, por que importa, o que muda), com \`arquivo:linha\` quando ajudar. Muda só COMO você escreve, nunca a decisão nem o rigor. Comentários inline também sem os prefixos de label: escreva como observação humana. \`reviewMarkdown\` é essa mesma revisão humanizada para a tela, nunca o relatório operacional.\n` +
    `- **Aprovando COM ressalva, a ressalva vai no corpo do PR** (decisão do Wanderson em 29/07/2026): aprovar não é deixar passar em silêncio, e o autor tem direito de saber o que você notou. Escreva como um revisor sênior mencionaria de passagem (o ponto, por que importa, e que não segura o merge), sem checklist e sem seção de "ressalvas". **Filtro do que entra:** ressalva TÉCNICA sobre o código entra (validação que falta, dependência de endpoint inexistente, teste que não cobre o caso). Ressalva OPERACIONAL do nosso fluxo NÃO entra e fica só em \`reasons\`: card que não deu pra confirmar por falha de acesso ao Jira, review que não era pedido a você, discordância com outro review, política de conta, cobertura incompleta da leitura. Isso é assunto interno, não recado pro autor, e citar vazaria a automação.\n`;
}

// Como lidar com reviews de TERCEIROS no mesmo PR (Acrity, SonarQube, Snyk, colegas).
// Regra do Wanderson (29/07/2026): revisão independente primeiro; contestar SÓ com
// certeza comprovada, senão fica calado. O silêncio é o default: não contestar não
// custa nada, contestar errado queima a credibilidade da contestação legítima, e
// pior, do review inteiro. Qualquer contestação vai pro `contested` e força
// needs_decision (nunca sai pro PR sem o Wanderson ver).
function thirdPartyReviewBlock() {
  return `\n\n## Reviews de terceiros no mesmo PR (Acrity, Sonar, Snyk, colegas)\n` +
    `Um PR pode já ter review de outra ferramenta ou pessoa. Trate assim, nesta ordem:\n` +
    `1. **Sua revisão é INDEPENDENTE e vem primeiro.** Forme seu veredito a partir do código, do diff e do card, ANTES de ler o que os outros apontaram. Não ancore: achado de terceiro não vira seu achado sem você confirmar no código, e aprovação de terceiro não relaxa seu gate.\n` +
    `2. **Se o achado do outro é REAL e você não tinha visto, ADOTE.** Confirme no código, incorpore com a severidade que você mesmo daria e siga sua própria regra de blocker. Esse é o principal ganho de ler o review alheio: pegar o que passou por você. Não minimize por orgulho.\n` +
    `3. **Discordar é a exceção, e cada tipo tem um rótulo e uma barra própria.** Nunca use "falso positivo" como rótulo genérico de discordância:\n` +
    `   - **falso_positivo** (o FATO está errado): só quando TODAS valem: (a) é afirmação factual sobre o código, não preferência, convenção ou escopo; (b) você ABRIU o arquivo no ponto citado e conferiu; (c) você tem \`arquivo:linha\` que REFUTA a afirmação; (d) não existe leitura razoável em que a afirmação seja verdadeira (outro caminho, outro arquivo, outra versão do diff). Faltando qualquer uma, NÃO é falso positivo.\n` +
    `   - **fora_de_escopo** (o fato procede, o endereço não): só quando o PR, a spec ou o card DOCUMENTAM o adiamento. Cite o texto que documenta. Sem documento explícito, não discuta escopo.\n` +
    `   - **pre_existente** (o fato procede, não veio deste PR): só com o diff como prova (arquivo não tocado pelo PR). Diga como confirmou.\n` +
    `   - **criterio_nao_vigente** (a convenção citada não é praticada no repo): só com CONTAGEM medida por você no repo (ex.: "98 stories para 1084 componentes"). Sem o número, fique calado.\n` +
    `4. **Na dúvida, FIQUE CALADO sobre o apontamento do outro e entregue a sua análise.** Silêncio não é erro. Se você não consegue provar em uma linha, não escreva. Prefira ❓ question ("isso é intencional?") a afirmar que o outro errou.\n` +
    `5. **NUNCA conteste:** severidade/tom que é preferência ("eu classificaria diferente"), decisão de produto que não é sua, funcionamento interno da outra ferramenta (você não sabe como ela decide), nem nada só pra economizar trabalho. Se o apontamento é real e barato de resolver, o certo é resolver, não contestar.\n` +
    `6. **Conceda antes de discordar.** Se dos 4 apontamentos 3 procedem, diga isso primeiro, com clareza. Contestação que não concede nada lê como fuga.\n` +
    `7. **Registro:** cada discordância vira um item em \`contested\` (schema abaixo) e uma linha no \`reportMarkdown\`. Item em \`contested\` obriga \`decision = "needs_decision"\`: contestação pública passa pelo Wanderson, sempre. No corpo dos payloads, escreva a contestação como uma PESSOA revisando (o ponto, a prova, o que muda), sem citar automação, sem nomear ferramenta como adversária e sem ironia.\n`;
}

function headlessPromptFor(engine, url, author, lotes, metrics) {
  const candidates = [
    path.join(WORKSPACE, 'prompts', 'pr-review-auto.md'),
    path.join(TEMPLATE_DIR, 'prompts', 'pr-review-auto.md')
  ];
  const pr = prFromUrl(engine, url);
  const checkpointFile = pr ? checkpointPath(pr.key) : '(indisponível)';
  for (const f of candidates) {
    try {
      return fs.readFileSync(f, 'utf8').replaceAll('{{URL}}', url)
        .replaceAll('{{CHECKPOINT_PATH}}', checkpointFile)
        + engine.personProfileBlock(author) + engine.reviewFormatBlock() + thirdPartyReviewBlock()
        + (lotes ? fanoutMod.fanOutBlock(lotes, metrics) : '');
    } catch { }
  }
  throw new Error('template prompts/pr-review-auto.md não encontrado');
}

// métrica do que precisa ser LIDO nesta sessão: no round incremental, arquivo
// inalterado já tem prova herdada e não conta pro limiar do fan-out nem entra
// nos lotes. PURA (recebe metrics e a herança), extraída pra ter teste direto.
function metricsIncrementais(metrics, heranca) {
  if (!heranca || !heranca.ativa || !metrics || !Array.isArray(metrics.files)) return metrics;
  const mudados = new Set(heranca.changed);
  const files = metrics.files.filter(f => mudados.has(f.path));
  return { lines: files.reduce((s, f) => s + f.lines, 0), changedFiles: files.length, files };
}

// PR grande: mede e monta os lotes (determinístico, sem IA). Falha na medição
// degrada pro fluxo de sempre, que é sempre seguro. Extraída do runHeadlessReview
// pra achatar o fluxo (contrato: profundidade máxima 3).
async function medirEFatiar(engine, pr, heranca, id) {
  try {
    const metrics = await fanoutMod.prMetrics(engine, pr);
    const metricsLeitura = metricsIncrementais(metrics, heranca);
    if (!fanoutMod.shouldFanOut(metricsLeitura)) return { lotes: null, metricsLeitura };
    const planejados = fanoutMod.planLotes(metricsLeitura.files);
    if (planejados.length < 2) return { lotes: null, metricsLeitura };
    engine.pushActivity(id, 'info', `PR grande (${metricsLeitura.changedFiles} arquivos, ~${metricsLeitura.lines} linhas a ler): revisando em ${planejados.length} lotes com subagentes.`);
    return { lotes: planejados, metricsLeitura };
  } catch (err) {
    engine.log('ERROR', `fan-out ${pr.key}: medição falhou, seguindo em passe único — ${err.message}`);
    return { lotes: null, metricsLeitura: null };
  }
}

// roda a sessão de revisão, retomando a do round anterior quando o chamador
// passou um sid válido (config.reReviewResume): a mesma heurística de degradação
// do chat.js decide se o erro é do resume em si (sessão expirada/limpa recomeça
// do zero) ou falha real (sobe pro retry de sempre). Cancelamento sempre sobe.
async function rodarSessao(engine, promptFinal, streamOpts, sid) {
  if (!sid) return engine.runClaudeStream(promptFinal, streamOpts);
  engine.pushActivity(streamOpts.id, 'info', 'Retomando a sessão da revisão anterior (round incremental).');
  try {
    // SOMA, nunca substitui: o spread copia extraArgs e a atribuição jogaria fora
    // os argumentos do MCP montados pelo chamador, deixando a sessão retomada sem
    // ferramenta de Jira e sem erro nenhum aparecer.
    const argsRetomada = [...(streamOpts.extraArgs || []), '--resume', sid];
    return await engine.runClaudeStream(promptFinal, { ...streamOpts, extraArgs: argsRetomada });
  } catch (err) {
    if (err.cancelled || !/resume|no conversation|session id|session_id/i.test(err.message || '')) throw err;
    engine.pushActivity(streamOpts.id, 'info', 'Sessão anterior indisponível pra retomada; recomeçando do zero.');
    return engine.runClaudeStream(promptFinal, streamOpts);
  }
}

// prova por arquivo desta sessão: o retrato do diff (blobs) + o que ficou COBERTO
// neste head (lido agora ou herdado, já reconciliado pelo chamador). É o que
// permite o próximo round herdar leitura e o launchReReviews pular push trivial.
// Envelope sem coverage não prova leitura nenhuma (mesma régua do coverageGap):
// a prova sai com reviewed vazio e só serve pro pulo de push trivial.
// Best-effort: falha aqui nunca derruba a revisão.
function salvarProvaDaSessao(pr, headSha, arquivos, result) {
  if (!headSha || !Array.isArray(arquivos) || !arquivos.length) return;
  const cov = result.coverage;
  const cobertos = (cov && Array.isArray(cov.reviewed)) ? [...new Set(cov.reviewed.map(String))] : [];
  try {
    saveFileProof(pr.key, { head: headSha, at: Date.now(), sessionId: result.sessionId || null, files: arquivos, reviewed: cobertos });
  } catch { /* melhor perder a prova que a revisão */ }
}

/* ---------- label de revisão em andamento (pedido do Thiago, 18/08/2026) ----------
   Quando a revisão headless começa, o PR ganha a label "<conta>:revisando" (ex.:
   thiagocarvalho-dev:revisando) pro time ver no GitHub que o review está acontecendo,
   e a perde quando a sessão termina (sucesso, falha ou cancelamento, via finally).
   Se a label não existe no repo, o Farol CRIA (pedido do Thiago, 19/08/2026; até
   então a falha do `--add-label` era o próprio "se existir" e a label nunca nascia
   sozinha): a adição que falha dispara um `gh label create` e UMA nova tentativa de
   adição. A criação usa cor fixa e descrição neutra, sem citar o Farol (o autor do
   PR não pode saber que é automação, mesma regra do corpo do review). Best-effort
   dos dois lados: nada aqui toca a revisão em si. Só a remoção que falha DEPOIS de
   uma adição bem-sucedida vira WARN, porque label presa no PR é visível pro time. */
function inProgressLabelFor(user) {
  const u = String(user || '').trim();
  return u ? `${u}:revisando` : '';
}

const IN_PROGRESS_LABEL_COLOR = 'FBCA04';
const IN_PROGRESS_LABEL_DESC = 'revisão em andamento';

// repo dono do PR pro `gh label create --repo`: o objeto do panorama carrega
// `repo` (owner/repo); o fallback extrai da key ("owner/repo#N"). Formato
// inválido devolve '' e a criação não acontece (melhor não criar que criar
// no lugar errado).
function repoDoPr(pr) {
  const repo = String((pr && pr.repo) || '').trim() || String((pr && pr.key) || '').split('#')[0].trim();
  return /^[^\s/]+\/[^\s/]+$/.test(repo) ? repo : '';
}

// devolve a label aplicada ('' quando não aplicou), pra remoção só acontecer
// depois de uma adição comprovada (remover o que não entrou é chamada gh à toa).
// `run` é injetável só pra teste (o default é o io.run de sempre).
async function addInProgressLabel(engine, pr, run = io.run) {
  const acc = engine.accountForPr(pr);
  const label = inProgressLabelFor(acc);
  if (!label || !pr.url || !engine.tokenFor(acc)) return '';
  try {
    const env = engine.ghEnv(acc);
    const adiciona = () => run('gh', ['pr', 'edit', pr.url, '--add-label', label], { env });
    let r = await adiciona();
    if (r.ok) return label;
    // a causa mais comum da falha é a label não existir no repo: cria e tenta
    // de novo UMA vez. Falha por outra causa (rede, permissão) derruba também
    // a criação ou a retentativa, e o resultado segue best-effort ('').
    const repo = repoDoPr(pr);
    if (!repo) return '';
    const c = await run('gh', ['label', 'create', label, '--repo', repo,
      '--color', IN_PROGRESS_LABEL_COLOR, '--description', IN_PROGRESS_LABEL_DESC], { env });
    if (!c.ok) return '';
    r = await adiciona();
    return r.ok ? label : '';
  } catch { return ''; }
}

async function removeInProgressLabel(engine, pr, label) {
  if (!label) return;
  try {
    const acc = engine.accountForPr(pr);
    const r = await io.run('gh', ['pr', 'edit', pr.url, '--remove-label', label], { env: engine.ghEnv(acc) });
    if (!r.ok) engine.log('WARN', `label ${label} não saiu de ${pr.key}: ${String(r.stderr || '').trim().slice(0, 200)}`);
  } catch (err) {
    engine.log('WARN', `label ${label} não saiu de ${pr.key}: ${err.message}`);
  }
}

/* ---------- tempo por etapa da revisão (instrumentação) ----------
   Motivado por 17/08/2026 (#775, "por que demorou 10 minutos?"): o feed de
   atividade tem timestamp por linha mas morre com a sessão, então a pergunta
   ficava sem resposta. O resumo é calculado do feed ANTES do finally apagar e
   persiste na decisão. Heurística determinística e honesta: o intervalo entre
   uma linha e a anterior é atribuído à etapa da linha que o ENCERRA (o gap é o
   trabalho que produziu a linha), e a fatia final (última linha até o fim) é a
   redação do envelope. É aproximação de traço, não cronômetro. */
const STAGE_ORDER = ['preparo', 'leitura', 'card', 'verificacao', 'raciocinio', 'fechamento'];
// `fechamento`, e não `redação`: a última fatia NÃO é medida de nenhuma linha, é o
// silêncio entre a última atividade do feed e o fim da sessão (ver stageSummaryFrom).
// Costuma ser o modelo compondo o envelope, mas o rótulo antigo prometia uma medição
// que não existe. Decisões gravadas antes disto guardam o próprio label, então o
// histórico continua mostrando "redação" sem migração.
const STAGE_LABEL = {
  preparo: 'preparo', leitura: 'leitura', card: 'card',
  verificacao: 'verificação', raciocinio: 'raciocínio', fechamento: 'fechamento',
};

function stageOfLine(it) {
  // linha já estampada (item.s do feed) é a fonte: classificar duas vezes abriria
  // espaço pra esteira ao vivo e o resumo final divergirem sobre a mesma linha
  if (it && it.s && STAGE_LABEL[it.s]) return it.s;
  const t = String((it && it.text) || '');
  if (t.includes('FAROL_CHECKPOINT')) return 'verificacao';
  if (it && it.a) return /^claim-verifier/i.test(String(it.a)) ? 'verificacao' : 'leitura';
  // `card` só a partir de FERRAMENTA. Casando o texto de qualquer linha, prosa que
  // apenas MENCIONA o Jira ("o card não cobre esse caso") virava consulta ao card, e
  // todo o raciocínio até ali era creditado à etapa errada. Medido: as três frases de
  // exemplo do teste caíam em `card`, sendo que duas eram raciocínio puro.
  if (it && it.k === 'tool' && /atlassian|jira/i.test(t)) return 'card';
  if (it && it.k === 'text') return 'raciocinio';
  if (it && it.k === 'tool') return 'leitura';
  return 'preparo';
}

// PURA: { totalMs, stages: [{id, label, ms}] } na ordem canônica, só etapas > 0.
function stageSummaryFrom(items, startedAt, endedAt) {
  const linhas = (items || []).filter(i => i && i.t);
  if (!linhas.length || !startedAt || !endedAt) return null;
  const ms = {};
  let prev = startedAt;
  for (const it of linhas) {
    const etapa = stageOfLine(it);
    ms[etapa] = (ms[etapa] || 0) + Math.max(0, it.t - prev);
    prev = it.t;
  }
  ms.fechamento = (ms.fechamento || 0) + Math.max(0, endedAt - prev);
  return {
    totalMs: Math.max(0, endedAt - startedAt),
    stages: STAGE_ORDER.filter(s => ms[s] > 0).map(s => ({ id: s, label: STAGE_LABEL[s], ms: ms[s] })),
  };
}

// Modo rápido (config.reviewFast, opt-in): corta o tempo da revisão SEM afrouxar
// gate nenhum. A troca honesta: menos experimento empírico = mais needs_decision
// quando a prova exigiria tempo; o que o modo nunca faz é afirmar sem prova.
function fastModeBlock() {
  return `\n\n## MODO RÁPIDO (ativado pelo dono do app)\n` +
    `Otimize o TEMPO desta revisão. O que muda:\n` +
    `1. **Leitura orientada a diff**: leia o diff completo de TODOS os arquivos; abra o arquivo inteiro só quando o trecho não se explica sozinho (função cortada, contrato definido em outro ponto). O envelope coverage continua completo e honesto.\n` +
    `2. **Verificação empírica só do que sustenta a decisão**: experimento (simulação, consulta gh extra) apenas para afirmação que muda verdict/decision (blocker, ou a prova de que o card foi atendido). O resto vira observação de leitura, sem experimento. Os subagentes claim-verifier em paralelo continuam valendo para o que for verificado.\n` +
    `3. **Verificação que exigiria experimento LONGO** (simular pipeline de CI, comparar históricos extensos): NÃO execute; registre em reasons como não-verificado e prefira needs_decision. Rápido significa devolver a decisão pro humano mais cedo, nunca afirmar sem prova.\n` +
    `4. **Pule o histórico do autor** (state/authors): tom neutro nesta revisão.\n` +
    `O que NÃO muda: o schema do envelope, a cobertura completa, os gates de decisão e o formato humano do texto postado.\n`;
}

async function runHeadlessReview(engine, pr) {
  const id = `a${++engine.sessionSeq}`;
  engine.activeReviews.set(id, {
    id, keys: [pr.key], label: `Revisão automática de ${pr.key}`, mode: 'auto',
    startedAt: Date.now(), cancellable: true,
    pr: { key: pr.key, url: pr.url, title: pr.title || '', author: pr.author || '' }
  });
  engine.activity.set(id, []);
  // SHA do head no INÍCIO da sessão: carimbado em cada entrada de checkpoint gravada
  // por esta revisão (session.js), pra a Task 13 poder invalidar entradas de um head
  // antigo quando o PR ganha commit novo, e usado pelo dedup de postagem lá embaixo pra
  // saber se o review que eu já tenho no PR é desta rodada ou da anterior (#742).
  // Falha aqui (exceção ou string vazia, que é o que o `run` devolve quando o gh não
  // responde) cai no `knownHead` que veio com o relançamento automático (G8), logo abaixo.
  // Sem nenhum dos dois, degrada pra headSha vazio (nunca filtra, nunca bloqueia por causa
  // de uma falha de rede), mesmo padrão do fan-out.
  try {
    engine.activeReviews.get(id).headSha = await engine.headSha(pr);
  } catch { /* sem SHA do fetch: tenta o knownHead do enfileiramento abaixo */ }
  if (!(engine.activeReviews.get(id) || {}).headSha && pr.knownHead) {
    engine.activeReviews.get(id).headSha = pr.knownHead; // G8: fallback do relançamento
  }
  const headShaAtual = (engine.activeReviews.get(id) || {}).headSha || '';
  engine.writeInflight();
  engine.pushState();
  // sinaliza no PR que o review começou (label "<conta>:revisando", só se ela
  // existir no repo). Declarada FORA do try pra remoção no finally; atribuída
  // DENTRO pra falha inesperada nunca vazar a sessão registrada acima.
  let labelEmAndamento = '';
  try {
    labelEmAndamento = await addInProgressLabel(engine, pr);
    // prova por arquivo: o diff efetivo atual (blob SHA por arquivo) e a prova da
    // última leitura completa. Qualquer falha aqui degrada pra revisão cheia de
    // sempre, que é sempre segura (falta de dado nunca vira herança).
    let arquivosAtuais = null;
    try { arquivosAtuais = await engine.fetchPrFiles(pr); }
    catch (err) { engine.log('WARN', `prova por arquivo ${pr.key}: medição falhou, revisão cheia: ${err.message}`); }
    const blobsAtuais = blobMapFrom(arquivosAtuais);
    // o mapa viaja no registro da sessão pro session.js carimbar blobSha em cada
    // entrada de checkpoint (writeInflight só serializa s.pr, então não incha nada)
    if (blobsAtuais && engine.activeReviews.get(id)) engine.activeReviews.get(id).fileBlobs = blobsAtuais;
    const provaAnterior = readFileProof(pr.key);
    // herança só entre heads DIFERENTES: no mesmo head quem retoma é o checkpoint
    // (retry de falha); herdar tudo num relançamento manual do mesmo head faria a
    // sessão não ler nada e "confirmar" a si mesma.
    const heranca = (provaAnterior && provaAnterior.head && headShaAtual && provaAnterior.head !== headShaAtual)
      ? splitByProof(arquivosAtuais, provaAnterior)
      : { ativa: false, unchanged: [], changed: [] };

    const { lotes, metricsLeitura } = await medirEFatiar(engine, pr, heranca, id);
    let promptFinal = engine.headlessPromptFor(pr.url, pr.author, lotes, metricsLeitura);
    const cardRes = await jiraMod.cardForPr(engine, pr);
    // recurso desligado é o app de antes, não falha: não loga, não etiqueta e não
    // derruba o cardMet.
    const jiraLigado = cardRes.code !== JIRA_CODES.DESLIGADO;
    promptFinal += jiraMod.cardBlock(cardRes);
    if (cardRes.ok) {
      engine.pushActivity(id, 'info', `Card ${cardRes.card.key} lido pelo Farol${cardRes.fromCache ? ' (cache)' : ''}: ${cardRes.card.criteria.length} critério(s) de aceite.`);
    } else if (jiraLigado && cardRes.code !== JIRA_CODES.SEM_CHAVE && cardRes.code !== JIRA_CODES.SITE_NAO_CONFIGURADO) {
      // PR sem chave e org sem site são rotina. O resto é falha de verdade e vai
      // pro farol.log, senão credencial recusada fica igual a "este PR não tem
      // card" na tela e no Diagnóstico.
      engine.log('WARN', `card do Jira ${pr.key} (${cardRes.code}): ${motivoDe(cardRes.code)}`);
      engine.pushActivity(id, 'warn', `Card não lido (${motivoDe(cardRes.code)}); a revisão segue com o card não verificável.`);
    }
    if (heranca.ativa) {
      promptFinal += fileProofBlock(heranca, provaAnterior.head);
      engine.pushActivity(id, 'info', `Revisão incremental: ${heranca.unchanged.length} arquivo(s) inalterados herdam a leitura anterior; lendo ${heranca.changed.length} alterado(s).`);
    }
    if ((engine.config || {}).reviewFast) {
      promptFinal += fastModeBlock();
      engine.pushActivity(id, 'info', 'Modo rápido ativado: leitura orientada a diff e verificação empírica só do que decide.');
    }
    const cpAntesDeComecar = readCheckpoint(checkpointPath(pr.key));
    if (cpAntesDeComecar.ok) {
      const relevantesAntes = relevantEntries(cpAntesDeComecar.entries, headShaAtual, blobsAtuais);
      if (relevantesAntes.length) promptFinal += resumeBlock(relevantesAntes.length, checkpointPath(pr.key));
    }
    const streamOpts = {
      id,
      account: engine.accountForPr(pr),
      ref: pr.key,
      // modo rápido derruba o esforço de raciocínio na linha de comando (a parte
      // do tempo que o prompt não alcança); só a REVISÃO passa esta flag, chat,
      // autoanálise, pushback e ferramentas seguem no esforço configurado
      fast: !!(engine.config || {}).reviewFast,
      extraArgs: jiraMod.mcpArgsFor(engine, cardRes.site),
      onModel: (m) => engine.setSessionModel(id, m),
      // a etapa é estampada AQUI, na entrada do feed: a esteira ao vivo da UI e o
      // resumo final (stageSummaryFrom) leem a mesma estampa, nunca reclassificam
      onEvent: (e) => engine.pushActivity(id, e.kind, e.text, e.agent,
        stageOfLine({ k: e.kind, text: e.text, a: e.agent }))
    };
    // retomada da sessão do round anterior (opt-in, config.reReviewResume): o modelo
    // já leu o PR no round 1, então continuar a MESMA conversa poupa a releitura.
    // O sid passa pela mesma allowlist de formato do chat (é o único jeito de entrar
    // numa linha de shell) e falha de retomada degrada pra sessão nova, nunca pra erro.
    const sid = ((engine.config || {}).reReviewResume && pr.resumeSid && RESUME_SID_RE.test(String(pr.resumeSid)))
      ? String(pr.resumeSid) : '';
    const res = await rodarSessao(engine, promptFinal, streamOpts, sid);
    const result = engine.parseHeadlessResult(res.text);
    result.sessionId = res.sessionId || null;
    // tempo por etapa: calculado AGORA, porque o finally apaga o feed junto com a
    // sessão e este é o último momento em que o traço existe
    result.stages = stageSummaryFrom(
      engine.activity.get(id),
      (engine.activeReviews.get(id) || {}).startedAt,
      Date.now()
    );
    // G12: o head que ESTA sessão leu viaja com o resultado, pra recordDecision carimbar
    // no item e a reconciliação saber de qual estado do PR a decisão fala. Vazio quando
    // desconhecido (rede), mesmo compromisso do resto: falta de dado nunca inventa prova.
    result.headSha = headShaAtual;
    // o card passou a ser lido pelo FAROL, então "card atendido" deixa de ser
    // afirmação do modelo quando não houve card nenhum pra atender. Sem site
    // cadastrado o Farol não pode regredir o auto-approve de quem não usa o
    // recurso, por isso a trava só vale com o Jira ligado.
    if (!cardRes.ok && jiraLigado) result.cardMet = false;
    if (cardRes.ok) result.card = cardRes.card.key;

    // checkpoint de verificação: nesta função ele é lido em dois pontos, cada um com
    // seu propósito (a leitura antes da sessão, acima, decide se injeta o resumeBlock
    // de retomada no prompt; esta aqui, depois da sessão terminar, monta o resumo final
    // em result.verificationCheckpoint). Nunca lido dentro de decision.js (que continua
    // puro). Ver a seção "Checkpoint de verificação" do CLAUDE.md.
    const cpLido = readCheckpoint(checkpointPath(pr.key));
    result.verificationCheckpoint = cpLido.ok
      ? summarizeCheckpoint(cpLido.entries, headShaAtual, blobsAtuais)
      : { malformed: true, reason: cpLido.reason };

    // cobertura herdada: arquivo INALTERADO que a última sessão leu conta como coberto
    // neste head, com a origem separada em coverage.inherited (leitura desta sessão e
    // prova herdada nunca se confundem). Roda ANTES do coverageGap, que segue puro.
    if (heranca.ativa && result.coverage && typeof result.coverage === 'object') {
      result.coverage = reconcileInheritedCoverage(result.coverage, heranca.unchanged);
      const herdados = (result.coverage.inherited || []).length;
      if (herdados) engine.pushActivity(id, 'info', `${herdados} arquivo(s) cobertos pela prova da leitura anterior (blob idêntico).`);
    }

    salvarProvaDaSessao(pr, headShaAtual, arquivosAtuais, result);

    // gate do app: aprova sozinho quando aprovável (revisão pedida a mim; clique
    // no panorama nunca auto-posta). Os diagnósticos operacionais permanecem no
    // estado interno e nunca são anexados ao corpo público.
    // reasons vira uma lista de { text, kind } aqui, uma vez só: o que a sessão
    // devolveu no envelope (kind 'content', é a IA apontando algo) fica intacto
    // como texto, só ganha a etiqueta. Todo prepend/append DAQUI PRA BAIXO empurra
    // objeto, nunca string solta, senão a tela não consegue mais distinguir "a IA
    // achou isso" de "o app travou por regra" de "falhou a postagem em si" (ver
    // reviewBoxHtml/resolvedRow em ui/pure.js).
    result.reasons = (result.reasons || []).map(asReason);
    // gate, não infra: 'infra' neste repo quer dizer que a POSTAGEM falhou (a tela
    // mostra "falha técnica ao postar" e o decision.js descarta esses motivos
    // quando o retry do post resolve, o que faria o motivo do Jira sumir da
    // história). Card não lido é regra do app segurando a decisão.
    if (!cardRes.ok && jiraLigado && cardRes.code !== JIRA_CODES.SEM_CHAVE) {
      result.reasons = [gateReason(`card não lido no Jira (${cardRes.code}): ${motivoDe(cardRes.code)}`), ...(result.reasons || [])];
    }
    const autoDec = engine.shouldAutoApprove(pr, result);
    let canAuto = autoDec.ok === true;
    let canReject = engine.shouldAutoReject(pr, result);
    if (pr.requested === false && (result.verdict === 'approve' || result.verdict === 'request_changes')) {
      result.reasons = [gateReason('revisão iniciada por você (não era seu review pedido): nada é postado sem sua decisão'),
        ...(result.reasons || [])];
    }
    // lacuna de cobertura: é a diferença entre "está limpo" e "não olhei", e explica
    // por que um PR grande sem achado nenhum caiu na sua mesa em vez de auto-aprovar.
    // (cada bloco abaixo faz unshift, então a ordem final das reasons é: contestação,
    // cobertura, clique; o último a prepender lidera)
    const semCobertura = engine.coverageGap(result);
    if (semCobertura.length) {
      const amostra = semCobertura.slice(0, 3).join(', ');
      result.reasons = [gateReason(`a revisão não cobriu o diff inteiro (${semCobertura.length} pendência(s): ${amostra}${semCobertura.length > 3 ? ', ...' : ''}), então não posto sozinho`),
        ...(result.reasons || [])];
    }
    // checkpoint malformado ou com divergência entre passadas: mesma régua da cobertura
    const gapCheckpoint = engine.checkpointGap(result);
    if (gapCheckpoint.length) {
      result.reasons = [gateReason(`verificação de afirmações com problema (${gapCheckpoint.join('; ')}), então não posto sozinho`),
        ...(result.reasons || [])];
    }
    // contestação a review de terceiro lidera as reasons QUANDO foi ela que segurou a
    // postagem: é o que você precisa conferir antes de deixar sair, porque é afirmação
    // pública contra outro revisor. Se você liberou esse cenário (Sistema > Automação),
    // não entra nada aqui: `attentionPoints` já publica a discordância com rótulo e
    // prova, e prepender de novo daria linha dobrada na tela dizendo "antes de postar"
    // num PR que já foi postado.
    const contested = engine.contestations(result);
    if (contested.length && autoDec.motivo === 'contestacao') {
      const label = contested.length === 1 ? 'discordância' : 'discordâncias';
      result.reasons = [gateReason(`${contested.length} ${label} de outro review no PR, confira a redação antes de postar (detalhe no relatório)`),
        ...(result.reasons || [])];
    }

    // O head pode ter andado ENQUANTO a sessão lia o PR (caso medido: biud-esg#224,
    // 21/08/2026, o autor empurrou b8722a3 dois minutos antes do POST). Postar assim é
    // escolher entre duas coisas erradas: com a âncora do G1 o GitHub recusa (422 opaco,
    // e o clique na fila repete a recusa pra sempre), e sem a âncora o review sai
    // carimbado num código que ninguém leu, convencendo o staleForReview de que o head
    // novo já foi revisado (o buraco do #742). Então não posta: o achado vira pendência
    // com o motivo em português e quem fecha o PR é o round seguinte, sobre o head certo.
    // Head desconhecido ('' por rede/token) degrada pro comportamento antigo, a mesma
    // regra do dedup por round: falta de dado nunca é lida como "head novo".
    if (canAuto || canReject) {
      let headAgora = '';
      try { headAgora = await engine.headSha(pr); } catch { /* sem sha não inventa rodada nova */ }
      if (headAgora && headShaAtual && headAgora !== headShaAtual) {
        result.reasons = [gateReason(`${staleHeadText(headShaAtual, headAgora)}, então não posto: este texto fala do código anterior`),
          ...(result.reasons || [])];
        canAuto = false;
        canReject = false;
      }
    }

    if (canAuto) {
      // dedup: se eu ja aprovei ESTE HEAD (review manual ou via chat), nao posta um
      // segundo APPROVE (aconteceu no biud-frontend#635). Aprovação minha de um head
      // ANTERIOR não conta: o autor empurrou código novo desde então (#742).
      const states = await engine.myReviewStates(pr, headShaAtual);
      if (states && states.includes('APPROVED')) {
        engine.recordDecision(pr, result, { status: 'already_reviewed', action: 'approve' });
        engine.emit('toast', { kind: 'info', text: `${pr.key}: você já tinha aprovado no GitHub; não postei de novo.` });
        return;
      }
      // o corpo do APPROVE vai LIMPO, do jeito que o review escreveu (tem que
      // parecer humano, teu). As ressalvas ficam guardadas no app (campo attention,
      // visível em Revisões recentes), não coladas no PR com carimbo de automação.
      const points = engine.attentionPoints(result);
      // G1: ancora o review no head que ESTA sessão leu (headShaAtual vem do
      // início da revisão); vazio = omite e o comportamento antigo vale
      const post = await engine.postReview(pr, { ...result.payloads.approve, commit_id: headShaAtual });
      if (post.ok) {
        // a memória recebe o item gravado (pr da fila), não o envelope cru: o
        // result.pr/memory.author da sessão não escolhem repo nem dossiê (M6)
        const item = engine.recordDecision(pr, result, { status: 'auto_approved', action: 'approve', attention: points });
        const publicItem = engine.decisionForUi(item);
        const publicPoints = publicItem.attention || [];
        engine.writeMemory(item, 'APPROVE');
        // points viaja no evento pro alerta distinguir os desfechos (sem ressalvas x com ressalvas)
        engine.emit('auto-approved', { pr, result: publicItem, points: publicPoints });
        engine.emit('toast', {
          kind: 'ok', text: publicPoints.length
            ? `⚠️ ${pr.key} aprovado com ${publicPoints.length} ressalva(s): ${reasonText(publicPoints[0])}`
            : `✅ ${pr.key} aprovado sem ressalvas.`
        });
        return;
      }
      result.reasons = [...(result.reasons || []), infraReason(`falha ao postar o APPROVE: ${post.error}`)];
      // falha claramente transitória (rede, gateway do GitHub fora do ar):
      // marca pro retryFailedPosts tentar de novo sozinho nos próximos ciclos,
      // reusando o payload já pronto, sem reabrir sessão. Mesma tabela de
      // classificação que decide o retry da sessão inteira (log-taxonomy.js,
      // invariante 3 do CLAUDE.md: uma fonte só pro que é transitório).
      result.postRetry = postRetryFor('approve', post.error);
    }

    // reprova sozinho (opt-in por conta): posta REQUEST_CHANGES com os bloqueios
    // que a revisão levantou. Mesmo gate do approve (review pedido a mim; clique
    // nunca posta) e dedup (não re-pede mudanças se eu já pedi PARA ESTE HEAD).
    // Este era o caminho do #742: o autor corrigia, o 2º round achava outro buraco e
    // o pedido de mudanças do round anterior fazia o achado novo morrer aqui dentro.
    if (canReject) {
      const states = await engine.myReviewStates(pr, headShaAtual);
      if (states && states.includes('CHANGES_REQUESTED')) {
        engine.recordDecision(pr, result, { status: 'already_reviewed', action: 'request_changes' });
        engine.emit('toast', { kind: 'info', text: `${pr.key}: você já tinha pedido mudanças no GitHub; não postei de novo.` });
        return;
      }
      const rc = { ...result.payloads.request_changes, body: engine.rejectBodyWithMark(result.payloads.request_changes.body), commit_id: headShaAtual };
      const post = await engine.postReview(pr, rc);
      if (post.ok) {
        // mesma regra do approve: memória atribuída pelo item, nunca pelo envelope (M6)
        const item = engine.recordDecision(pr, result, { status: 'auto_rejected', action: 'request_changes' });
        const publicItem = engine.decisionForUi(item);
        engine.writeMemory(item, 'REQUEST_CHANGES');
        engine.emit('auto-rejected', { pr, result: publicItem });
        engine.emit('toast', { kind: 'ok', text: `🔴 ${pr.key} reprovado (mudanças pedidas): ${reasonText((publicItem.reasons || [])[0]) || 'ver relatório'}` });
        return;
      }
      result.reasons = [...(result.reasons || []), infraReason(`falha ao postar o REQUEST_CHANGES: ${post.error}`)];
      result.postRetry = postRetryFor('request_changes', post.error);
    }
    // transparência: o gate disse POR QUE não auto-postou (autoDec.motivo). Só
    // quando o motivo é a POLÍTICA da conta a recusa é atribuída à política;
    // contestação e cobertura já prependam a própria explicação nos blocos acima
    // (era o M7: o bloco antigo culpava a política em recusa de contestação/cobertura).
    if (autoDec.motivo === 'politica') {
      const acc = engine.accountForPr(pr);
      const label = engine.scopeLabel(acc) || acc || 'esta conta';
      const clean = engine.attentionPoints(result).length === 0 && result.decision === 'auto_approve';
      const why = clean
        ? `aprovável sem ressalvas, mas a política da conta ${label} manda aguardar sua aprovação (ajuste em Sistema > Contas)`
        : `aprovável com ressalvas, e a política da conta ${label} é aguardar você (mude pra "aprova e destaca as ressalvas" em Sistema > Contas se quiser que aprove sozinho)`;
      result.reasons = [gateReason(why), ...(result.reasons || [])];
    }
    const item = engine.recordDecision(pr, result, { status: 'pending' });
    const publicItem = engine.decisionForUi(item);
    engine.emit('needs-decision', { pr, item: publicItem });
    // o alerta lidera com o MOTIVO (transparência), não com uma contagem
    const extra = (publicItem.reasons || []).length > 1 ? ` (+${publicItem.reasons.length - 1})` : '';
    engine.emit('toast', { kind: 'info', text: `🟡 ${pr.key} precisa da sua atenção: ${reasonText((publicItem.reasons || [])[0]) || 'ver relatório'}${extra}` });
  } finally {
    await removeInProgressLabel(engine, pr, labelEmAndamento);
    engine.activeReviews.delete(id);
    engine.activity.delete(id);
    engine.writeInflight();
    engine.pushState();
  }
}

// Quem volta do retry pós-transitório neste ciclo (o check() chama quando a checagem
// funcionou, ou seja, a rede voltou). SÍNCRONA e sem IO, mesmo motivo do pushbackTargets:
// testável sem rede. A promessa do toast ("retomo sozinho") NÃO depende da política
// autoReview da conta nem de o PR estar na fila: revisão por clique no panorama e conta
// com autoReview desligado também são retomadas. Ficam de fora: conta silenciada, conta
// sem token no gh (guarda da Onda 1: sem token não abre sessão, o PR espera o token
// voltar), PR recém-chegado (o toReview do ciclo cuida dele), o que já está na fila
// headless/rodando, e conta cujo perfil de chave de API está com o orçamento
// estourado (mesmo gate do toReview, via budgetBlockedFor: é exatamente o caminho
// automático que causou o incidente de 04/08/2026, retry sem noção de gasto), e o PR
// cujo `notBefore` ainda está no futuro (limite de plano com hora de reset conhecida:
// tentar antes da hora é gasto certo com falha certa). O "agora" entra por parâmetro
// pra o teste ser determinístico; em produção é sempre o default.
function retryTargets(engine, freshKeys, inflightKeys, agora = Date.now()) {
  return [...engine.retryAfterNet.values()]
    .filter(v => !(v && v.notBefore && v.notBefore > agora))
    .map(v => v && v.pr)
    .filter(pr => pr &&
      !freshKeys.has(pr.key) &&
      !inflightKeys.has(pr.key) &&
      !engine.isMuted(engine.accountForPr(pr)) &&
      engine.tokenFor(engine.accountForPr(pr)) &&
      // saí de cena neste PR: o retry não pode ressuscitar o que eu prometi não
      // revisar (o enqueueHeadless barraria de qualquer jeito; aqui é pra não
      // ficar repescando em silêncio a cada ciclo)
      !(engine.skipComentado || {})[pr.key] &&
      !engine.budgetBlockedFor(engine.accountForPr(pr)));
}

// --- re-revisão automática pós-push (round 2 sem clique, v2.41.0) -----------
// O caso medido que motivou (biud-frontend#756, 15/08/2026): CHANGES_REQUESTED às
// 00:51, autor corrigiu às 00:57, e a correção ficou parada até alguém pedir a
// re-análise à mão. O Farol era rápido pra abrir o round e passivo pra fechar.
// Aqui: PR do panorama onde o MEU último review foi pedido de mudanças e o head
// mudou (staleInfo, preenchido pelo refreshStaleStates no mesmo ciclo) volta pra
// fila headless sozinho. SÍNCRONA e sem IO, mesmo motivo do retryTargets: é o gate
// que decide gastar sessão Claude, então tem que ser testável sem rede.
// Teto de rodadas AUTOMATICAS por PR por dia. E protecao de orcamento dentro do
// modo autonomo (mesma familia do teto por perfil), nunca reducao de autonomia:
// estourou, o motivo diz isso e o botao Re-revisar continua valendo.
const MAX_RODADAS_AUTO_DIA = 3;

// Dia local (Brasilia na pratica) em YYYY-MM-DD, pro teto diario da ancora.
function diaLocal(agora = Date.now()) {
  return new Date(agora).toLocaleDateString('sv-SE');
}

// A ancora reReviewLaunched guardou so o head (string) ate esta versao; agora e
// { head, dia, rodadas }. Leitura sempre passa por aqui: string legada preserva
// o head (o dedup por round continua valendo) e nunca infla o teto do dia.
function normalizeAncora(v) {
  if (typeof v === 'string') return { head: v, dia: '', rodadas: 1 };
  if (v && typeof v === 'object' && typeof v.head === 'string') {
    return { head: v.head, dia: String(v.dia || ''), rodadas: Number(v.rodadas) || 0 };
  }
  return { head: '', dia: '', rodadas: 0 };
}

function proximaAncora(ancoraAtual, head, agora = Date.now()) {
  const hoje = diaLocal(agora);
  const a = normalizeAncora(ancoraAtual);
  return { head, dia: hoje, rodadas: a.dia === hoje ? a.rodadas + 1 : 1 };
}

function reReviewTargets(engine, inflightKeys) {
  return (engine.panorama || []).filter(pr => {
    const info = (engine.staleInfo || {})[pr.key];
    // só relança com PROVA completa: commit novo, head conhecido e último review
    // meu = CHANGES_REQUESTED. Aprovação stale não fecha round nenhum (o botão
    // Re-revisar continua cobrindo esse caso, por clique).
    if (!info || !info.stale || !info.head) return false;
    if (info.lastState !== 'CHANGES_REQUESTED') return false;
    // G10: draft é trabalho sabidamente em andamento; re-revisar a cada push de
    // WIP queima sessão e, com onReject ligado, posta um review por push (cadência
    // que denuncia a automação). O chip manual continua cobrindo draft.
    if (pr.isDraft) return false;
    // âncora por head: cada estado do PR relança NO MÁXIMO uma vez. Falha da
    // revisão relançada cai nos fluxos de sempre (retry/estacionamento); só um
    // head mais novo reabre este gate.
    if ((engine.reReviewLaunched || {})[pr.key] === info.head) return false;
    // pendência na mesa = o round anterior ainda espera decisão humana; empilhar
    // um segundo card do mesmo PR confunde mais do que ajuda
    if (((engine.decisions || {}).pending || []).some(d => d.key === pr.key)) return false;
    // daqui pra baixo, as MESMAS travas do toReview do check(): quem mexer lá,
    // mexe aqui (conta silenciada, automação desligada, sem token, já em
    // andamento, estacionado, em retry, orçamento estourado)
    const acct = engine.accountForPr(pr);
    if (engine.isMuted(acct)) return false;
    if (!engine.autoReviewFor(acct)) return false;
    if (!engine.tokenFor(acct)) return false;
    if (inflightKeys.has(pr.key)) return false;
    if (engine.autoReviewParked.has(pr.key)) return false;
    if (engine.retryAfterNet.has(pr.key)) return false;
    if (engine.budgetBlockedFor(acct)) return false;
    // outra pessoa já revisando: o round 2 automático não fura o pulo. O comentário
    // já saiu pelo gate do toReview (uma vez por PR), então aqui é só não gastar.
    if (engine.outrosRevisando(pr).length) return false;
    // e nem o round 2 automático fura uma saída de cena já registrada
    if ((engine.skipComentado || {})[pr.key]) return false;
    return true;
  });
}

function saveReReviewLaunched(engine) {
  try { writeJsonAtomic(path.join(STATE_DIR, 'rereview-launched.json'), engine.reReviewLaunched); }
  catch { /* best-effort: perder a âncora só re-revisa um head já revisado; o dedup por head impede repostagem */ }
}

// G15: estacionamento pós-falha persistido (era Set em memória pura; cada
// reinício, inclusive o do próprio auto-update, relançava sessões fadadas
// à mesma falha conhecida). Mesmo padrão do saveReReviewLaunched/savePushbackScanned.
function saveAutoReviewParked(engine) {
  try { writeJsonAtomic(path.join(STATE_DIR, 'auto-review-parked.json'), [...engine.autoReviewParked]); }
  catch { /* best-effort: perder o arquivo só re-relança uma vez no boot */ }
}

// formato de session id do CLI que pode entrar numa linha de shell: a MESMA
// allowlist do --resume do chat (chat.js); sid fora do formato degrada pra
// sessão nova em silêncio, nunca entra na linha.
const RESUME_SID_RE = /^[0-9a-zA-Z-]{8,64}$/;

// sid da sessão da última decisão registrada deste PR (round anterior), pra
// retomada opt-in do round 2. Busca direto nas decisões CRUAS (pending primeiro,
// depois histórico, ambos do mais novo pro mais velho), nunca via decisionByKey:
// a projeção da UI é allowlist e não carrega sessionId.
function lastReviewSessionId(engine, key) {
  const d = (((engine.decisions || {}).pending) || []).find(x => x.key === key && x.sessionId)
    || (((engine.decisions || {}).resolved) || []).find(x => x.key === key && x.sessionId);
  return (d && d.sessionId) || '';
}

// chamada pelo check() logo depois do refreshStaleStates (que preenche staleInfo).
// A âncora é gravada ANTES de enfileirar: se a revisão falhar, quem cuida é o
// retry/estacionamento de sempre, nunca um relançamento em loop por este caminho.
// Async desde a prova por arquivo: cada alvo pode custar UMA chamada gh (pulls/files)
// pra detectar push trivial, e só quando existe prova salva do round anterior.
async function launchReReviews(engine) {
  const inflight = new Set([
    ...engine.headlessQueue.map(p => p.key),
    ...[...engine.activeReviews.values()].flatMap(s => s.keys || [])
  ]);
  const alvos = reReviewTargets(engine, inflight);
  // poda âncora de PR que saiu do panorama (fechou/mergeou): o arquivo não cresce
  // pra sempre. Numa busca parcialmente falha a âncora podada pode voltar a
  // relançar um head já visto, o que custa UMA sessão e zero postagem duplicada
  // (dedup por head no gate de postagem); aceito, mesmo compromisso do
  // reconcileHiddenPRs.
  const abertos = new Set((engine.panorama || []).map(p => p.key));
  let mudou = false;
  for (const k of Object.keys(engine.reReviewLaunched || {})) {
    if (!abertos.has(k)) { delete engine.reReviewLaunched[k]; mudou = true; }
  }
  for (const pr of alvos) { engine.reReviewLaunched[pr.key] = (engine.staleInfo[pr.key] || {}).head; mudou = true; }
  if (mudou) engine.saveReReviewLaunched();
  if (!alvos.length) return;
  // push trivial (rebase limpo, merge da base que não toca o diff): se o diff
  // efetivo está byte a byte igual ao que a última sessão leu (mesmos caminhos,
  // mesmos blobs, pulls/files contra a prova salva), rodar o round 2 é custo certo
  // pra chegar na mesma conclusão. A âncora já foi gravada acima, então o pulo vale
  // até o próximo push DE VERDADE. Sem prova salva ou com a medição falhando,
  // relança como sempre: na dúvida, gastar uma sessão é melhor que calar um round.
  const relancar = [];
  for (const pr of alvos) {
    let trivial = false;
    const prova = readFileProof(pr.key);
    if (prova) {
      try { trivial = sameEffectiveDiff(await engine.fetchPrFiles(pr), prova.files); }
      catch { /* medição falhou: relança, que é o caminho seguro */ }
    }
    if (trivial) {
      engine.emit('toast', { kind: 'info', text: `${pr.key}: o push não mudou o diff efetivo (rebase ou merge da base); a revisão anterior segue valendo.` });
    } else {
      relancar.push(pr);
    }
  }
  if (!relancar.length) return;
  engine.emit('toast', {
    kind: 'info',
    text: relancar.length === 1
      ? `↻ ${relancar[0].key} recebeu commit novo depois do seu pedido de mudanças: revisando de novo.`
      : `↻ ${relancar.length} PRs receberam commit novo depois dos seus pedidos de mudanças: revisando de novo.`
  });
  // requested: true = round 2 é CONTINUAÇÃO de um review meu, não clique avulso.
  // A postagem continua atrás do shouldAutoApprove/shouldAutoReject (política da
  // conta, card, contestação, cobertura) e do dedup por head, como qualquer revisão.
  for (const pr of relancar) engine.enqueueHeadless({
    ...pr, account: engine.accountForPr(pr), requested: true,
    // G8: o gate SÓ arma com head conhecido (info.head); carregá-lo evita que um
    // flake de gh no início da sessão degrade o dedup pro comportamento antigo e
    // mate o round 2 como already_reviewed com a âncora já queimada
    knownHead: (engine.staleInfo[pr.key] || {}).head || '',
    // sid do round anterior: com config.reReviewResume ligado, o round 2 retoma a
    // conversa em vez de recomeçar (opt-in; a allowlist de formato é aplicada no
    // consumo, em runHeadlessReview)
    resumeSid: lastReviewSessionId(engine, pr.key),
  });
}

const reviewMod = {
  prFromUrl, launchReview, enqueueHeadless, headlessAcct, processHeadless, runOneHeadless, retryTargets,
  parallelLimit, freeHeadlessSlot, reReviewTargets, launchReReviews, saveReReviewLaunched, saveAutoReviewParked,
  personProfileBlock, reviewFormatBlock, thirdPartyReviewBlock, headlessPromptFor, runHeadlessReview,
  lastReviewSessionId, stageSummaryFrom, stageOfLine, fastModeBlock, rodarSessao,
  inProgressLabelFor, addInProgressLabel, removeInProgressLabel, repoDoPr,
  MAX_RODADAS_AUTO_DIA, diaLocal, normalizeAncora, proximaAncora,
};
export default reviewMod;
export {
  prFromUrl, launchReview, enqueueHeadless, headlessAcct, processHeadless, runOneHeadless, retryTargets,
  parallelLimit, freeHeadlessSlot, reReviewTargets, launchReReviews, saveReReviewLaunched, saveAutoReviewParked,
  personProfileBlock, reviewFormatBlock, thirdPartyReviewBlock, headlessPromptFor, runHeadlessReview,
  lastReviewSessionId, stageSummaryFrom, stageOfLine, fastModeBlock, rodarSessao,
  inProgressLabelFor, addInProgressLabel, removeInProgressLabel, repoDoPr,
  MAX_RODADAS_AUTO_DIA, diaLocal, normalizeAncora, proximaAncora,
};

