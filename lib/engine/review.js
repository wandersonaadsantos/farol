// Concern do pipeline de revisão headless (Onda 2, colaborador): lançar review (terminal
// ou headless), a fila com 1 revisão por conta em paralelo (escalonador), o worker que roda
// cada uma com retry de erro transitório, a montagem do prompt (perfil do autor + formato
// humano) e a revisão em si com o gate de auto-aprovar/reprovar. Funções recebem o engine
// como ctx; a Engine mantém fachadas finas. Gate intacto (CLAUDE.md, invariante 4). Ver docs/QUALITY.md.
import fs from 'node:fs';
import path from 'node:path';
import { WORKSPACE, TEMPLATE_DIR, STATE_DIR } from '../paths.js';
import { writeJsonAtomic } from '../io.js';
import fanoutMod from './fanout.js';
import { classify, resetAtFrom } from '../log-taxonomy.js';
import { checkpointPath, readCheckpoint, summarizeCheckpoint, resumeBlock } from './verification-checkpoint.js';
import {
  PAPEL_LEVELS, PAPEL_LABEL, PAPEL_TONE,
  DOMAINS, DOMAIN_LEVELS, DOMAIN_LABEL, DOMAIN_LEVEL_LABEL, DOMAIN_POSTURE,
  PUSHBACK_LABEL,
} from '../taxonomy.js';

// reasons/attention viajam como { text, kind } desde a v2.48.0 (ver o comentário
// grande em runHeadlessReview); os poucos lugares que só querem o texto pra um
// toast usam isto em vez de reimplementar o unwrap.
function reasonText(r) {
  return (r && typeof r === 'object') ? (r.text || '') : (r || '');
}

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

async function launchReview(engine, urls, mode = 'auto') {
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
  for (const it of prontos) {
    engine.markSeen(it.key);
    if (engine.autoReviewParked.delete(it.key)) saiuDoEstacionamento = true;
  }
  if (saiuDoEstacionamento) engine.saveAutoReviewParked();
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

async function runHeadlessReview(engine, pr) {
  const id = `a${++engine.sessionSeq}`;
  engine.activeReviews.set(id, {
    id, keys: [pr.key], label: `Revisão automática de ${pr.key}`, mode: 'auto',
    startedAt: Date.now(), cancellable: true,
    pr: { key: pr.key, url: pr.url, title: pr.title || '' }
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
  try {
    // PR grande: mede e monta os lotes (determinístico, sem IA). Falha na medição
    // degrada pro fluxo de sempre, que é sempre seguro.
    let lotes = null, metrics = null;
    try {
      metrics = await fanoutMod.prMetrics(engine, pr);
      if (fanoutMod.shouldFanOut(metrics)) {
        const planejados = fanoutMod.planLotes(metrics.files);
        if (planejados.length >= 2) {
          lotes = planejados;
          engine.pushActivity(id, 'info', `PR grande (${metrics.changedFiles} arquivos, ~${metrics.lines} linhas): revisando em ${lotes.length} lotes com subagentes.`);
        }
      }
    } catch (err) {
      engine.log('ERROR', `fan-out ${pr.key}: medição falhou, seguindo em passe único — ${err.message}`);
    }
    let promptFinal = engine.headlessPromptFor(pr.url, pr.author, lotes, metrics);
    const cpAntesDeComecar = readCheckpoint(checkpointPath(pr.key));
    if (cpAntesDeComecar.ok) {
      const relevantesAntes = headShaAtual
        ? cpAntesDeComecar.entries.filter(e => !e.headSha || e.headSha === headShaAtual)
        : cpAntesDeComecar.entries;
      if (relevantesAntes.length) promptFinal += resumeBlock(relevantesAntes.length, checkpointPath(pr.key));
    }
    const res = await engine.runClaudeStream(promptFinal, {
      id,
      account: engine.accountForPr(pr),
      ref: pr.key,
      onModel: (m) => engine.setSessionModel(id, m),
      onEvent: (e) => engine.pushActivity(id, e.kind, e.text)
    });
    const result = engine.parseHeadlessResult(res.text);
    result.sessionId = res.sessionId || null;
    // G12: o head que ESTA sessão leu viaja com o resultado, pra recordDecision carimbar
    // no item e a reconciliação saber de qual estado do PR a decisão fala. Vazio quando
    // desconhecido (rede), mesmo compromisso do resto: falta de dado nunca inventa prova.
    result.headSha = headShaAtual;

    // checkpoint de verificação: nesta função ele é lido em dois pontos, cada um com
    // seu propósito (a leitura antes da sessão, acima, decide se injeta o resumeBlock
    // de retomada no prompt; esta aqui, depois da sessão terminar, monta o resumo final
    // em result.verificationCheckpoint). Nunca lido dentro de decision.js (que continua
    // puro). Ver a seção "Checkpoint de verificação" do CLAUDE.md.
    const cpLido = readCheckpoint(checkpointPath(pr.key));
    result.verificationCheckpoint = cpLido.ok
      ? summarizeCheckpoint(cpLido.entries, headShaAtual)
      : { malformed: true, reason: cpLido.reason };

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
    const autoDec = engine.shouldAutoApprove(pr, result);
    const canAuto = autoDec.ok === true;
    const canReject = engine.shouldAutoReject(pr, result);
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

// chamada pelo check() logo depois do refreshStaleStates (que preenche staleInfo).
// A âncora é gravada ANTES de enfileirar: se a revisão falhar, quem cuida é o
// retry/estacionamento de sempre, nunca um relançamento em loop por este caminho.
function launchReReviews(engine) {
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
  engine.emit('toast', {
    kind: 'info',
    text: alvos.length === 1
      ? `↻ ${alvos[0].key} recebeu commit novo depois do seu pedido de mudanças: revisando de novo.`
      : `↻ ${alvos.length} PRs receberam commit novo depois dos seus pedidos de mudanças: revisando de novo.`
  });
  // requested: true = round 2 é CONTINUAÇÃO de um review meu, não clique avulso.
  // A postagem continua atrás do shouldAutoApprove/shouldAutoReject (política da
  // conta, card, contestação, cobertura) e do dedup por head, como qualquer revisão.
  for (const pr of alvos) engine.enqueueHeadless({
    ...pr, account: engine.accountForPr(pr), requested: true,
    // G8: o gate SÓ arma com head conhecido (info.head); carregá-lo evita que um
    // flake de gh no início da sessão degrade o dedup pro comportamento antigo e
    // mate o round 2 como already_reviewed com a âncora já queimada
    knownHead: (engine.staleInfo[pr.key] || {}).head || ''
  });
}

const reviewMod = {
  prFromUrl, launchReview, enqueueHeadless, headlessAcct, processHeadless, runOneHeadless, retryTargets,
  parallelLimit, freeHeadlessSlot, reReviewTargets, launchReReviews, saveReReviewLaunched, saveAutoReviewParked,
  personProfileBlock, reviewFormatBlock, thirdPartyReviewBlock, headlessPromptFor, runHeadlessReview,
};
export default reviewMod;
export {
  prFromUrl, launchReview, enqueueHeadless, headlessAcct, processHeadless, runOneHeadless, retryTargets,
  parallelLimit, freeHeadlessSlot, reReviewTargets, launchReReviews, saveReReviewLaunched, saveAutoReviewParked,
  personProfileBlock, reviewFormatBlock, thirdPartyReviewBlock, headlessPromptFor, runHeadlessReview,
};

