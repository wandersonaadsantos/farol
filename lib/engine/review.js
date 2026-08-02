'use strict';
// Concern do pipeline de revisão headless (Onda 2, colaborador): lançar review (terminal
// ou headless), a fila com 1 revisão por conta em paralelo (escalonador), o worker que roda
// cada uma com retry de erro transitório, a montagem do prompt (perfil do autor + formato
// humano) e a revisão em si com o gate de auto-aprovar/reprovar. Funções recebem o engine
// como ctx; a Engine mantém fachadas finas. Gate intacto (CLAUDE.md, invariante 4). Ver docs/QUALITY.md.
const fs = require('fs');
const path = require('path');
const { WORKSPACE, TEMPLATE_DIR } = require('../paths');
const fanoutMod = require('./fanout');
const {
  PAPEL_LEVELS, PAPEL_LABEL, PAPEL_TONE,
  DOMAINS, DOMAIN_LEVELS, DOMAIN_LABEL, DOMAIN_LEVEL_LABEL, DOMAIN_POSTURE,
  PUSHBACK_LABEL,
} = require('../taxonomy');

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
  // lançar (manual ou auto) tira o PR do "estacionamento": ele volta a ser elegível
  for (const it of prontos) { engine.markSeen(it.key); engine.autoReviewParked.delete(it.key); }
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

// --- revisao autonoma (headless): 1 revisão por conta em paralelo ----------
// (contas diferentes rodam juntas; dentro da mesma conta segue serial)
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

// conta que "ocupa" o slot da revisão (uma por conta de cada vez)
function headlessAcct(engine, pr) { return String(engine.accountForPr(pr) || '').toLowerCase() || '(sem conta)'; }

// escalonador: dispara quantas revisões der, uma por conta que estiver livre.
// Síncrono (não await): cada revisão roda em paralelo e reprograma no fim.
function processHeadless(engine) {
  for (; ;) {
    const idx = engine.headlessQueue.findIndex(pr => !engine.headlessBusyAccounts.has(engine.headlessAcct(pr)));
    if (idx < 0) break; // fila vazia ou todas as contas pendentes já ocupadas
    const pr = engine.headlessQueue.splice(idx, 1)[0];
    const acct = engine.headlessAcct(pr);
    engine.headlessBusyAccounts.add(acct);
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
      engine.headlessBusyAccounts.delete(acct);
      engine.writeInflight();
      engine.pushState();
      engine.processHeadless();
    }
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
    // plano Claude (reseta), ou o binário do claude quebrado/indisponível.
    const limitErr = /hit your (session|usage|weekly) limit|session limit|usage limit/i.test(msg);
    const netErr = /ECONNRESET|ENOTFOUND|ETIMEDOUT|Connection closed|Unable to connect|fetch failed|network/i.test(msg);
    const toolErr = /não é reconhecido|not recognized|No such file|ENOENT|command not found|saiu com c[óo]digo \d/i.test(msg);
    // token da conta sumiu no meio (flake do keyring do gh): volta sozinho, não estaciona
    const authErr = /sem token no gh/i.test(msg);
    const transient = limitErr || netErr || toolErr || authErr;
    if (err.cancelled) {
      // cancelado por você: estaciona pra não relançar sozinho (você reabre quando quiser)
      engine.autoReviewParked.add(pr.key);
      engine.emit('toast', { kind: 'info', text: `Revisão de ${pr.key} cancelada. O PR voltou pra sua fila.` });
    } else if (transient) {
      // limite do plano se resolve no reset; rede/binário costumam voltar rápido.
      // Retoma sozinho no próximo ciclo bem-sucedido, até um teto (aí estaciona).
      const cap = limitErr ? 12 : 3;
      const tries = engine.retryAfterNet.get(pr.key) || 0;
      engine.log('WARN', `revisao ${pr.key} (transitório, tenta de novo): ${msg}`);
      if (tries < cap) {
        engine.retryAfterNet.set(pr.key, tries + 1);
        engine.emit('toast', { kind: 'error', text: limitErr
          ? `Limite do teu plano Claude atingido. Retomo ${pr.key} sozinho quando resetar; ele está na sua fila.`
          : `Revisão de ${pr.key} caiu por algo transitório; tento de novo no próximo ciclo. Está na sua fila.` });
      } else {
        engine.retryAfterNet.delete(pr.key);
        engine.autoReviewParked.add(pr.key);
        engine.log('ERROR', `revisao autonoma ${pr.key}: ${msg}`);
        engine.emit('toast', { kind: 'error', text: `Revisão de ${pr.key} falhou várias vezes; parei de tentar sozinho. O PR está na sua fila.` });
      }
    } else {
      // falha não-transitória de verdade: estaciona pra não relançar em loop
      engine.autoReviewParked.add(pr.key);
      engine.log('ERROR', `revisao autonoma ${pr.key}: ${msg}`);
      engine.emit('toast', { kind: 'error', text: `Revisão de ${pr.key} falhou: ${msg}` });
    }
  } finally {
    engine.headlessBusyAccounts.delete(acct);
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
    `- **Sem cara de bot:** NADA de caixas de alerta (\`> [!NOTE]\`/\`> [!WARNING]\`), nem "Placar", nem checklist de critérios com \`- [x]\`, nem os prefixos de Conventional Comments no texto ("🟡 suggestion (non-blocking):", "🔴 issue (blocking):" e afins). NUNCA cite automação, "Farol", "auto-aprovei/não auto-aprovei" nem "revisão automática": o autor não pode perceber que veio de um bot.\n` +
    `- **Use TODO o perfil do autor acima** (papel, competência por domínio, histórico de pushback) pra personalizar tom, profundidade e deferência, e adapte o FORMATO à senioridade:\n` +
    `  - Estágio/Júnior: prosa acolhedora de mentor. Abra reconhecendo o que ficou bom de verdade (específico, com o porquê), explique cada ajuste ensinando ("o que segura o merge é..."), enquadre como "quase lá", feche natural.\n` +
    `  - Pleno/Sênior/Tech Lead/Arquiteto: enxuto e direto, de par pra par. Vá aos pontos técnicos sem preâmbulo nem elogio de consolo, assumindo contexto compartilhado.\n` +
    `  - Especialista: no domínio dele, defira e foque na nuance; fora, trate como par.\n` +
    `  - Sem perfil marcado: tom neutro, direto e cordial.\n` +
    `- **Tom do Wanderson:** direto e claro, sem gíria nem subtexto, **sem travessão** (use vírgula, parênteses ou dois pontos). Elogio só quando sincero e específico (nunca de consolo). Português brasileiro.\n` +
    `- **Substância intacta:** blockers e ressalvas entram no texto de forma natural (o que é, por que importa, o que muda), com \`arquivo:linha\` quando ajudar. Muda só COMO você escreve, nunca a decisão nem o rigor. Comentários inline também sem os prefixos de label: escreva como observação humana.\n` +
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
  for (const f of candidates) {
    try {
      return fs.readFileSync(f, 'utf8').replaceAll('{{URL}}', url)
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
    const res = await engine.runClaudeStream(engine.headlessPromptFor(pr.url, pr.author, lotes, metrics), {
      id,
      account: engine.accountForPr(pr),
      onModel: (m) => engine.setSessionModel(id, m),
      onEvent: (e) => engine.pushActivity(id, e.kind, e.text)
    });
    const result = engine.parseHeadlessResult(res.text);
    result.sessionId = res.sessionId || null;

    // gate do app: aprova sozinho quando aprovável (revisão pedida a mim; clique
    // no panorama nunca auto-posta). Com autoApproveAll (default) qualquer aprovável
    // passa, com os pontos de atenção anexados ao APPROVE; sem, só o gate estrito.
    const autoDec = engine.shouldAutoApprove(pr, result);
    const canAuto = autoDec.ok === true;
    const canReject = engine.shouldAutoReject(pr, result);
    if (pr.requested === false && (result.verdict === 'approve' || result.verdict === 'request_changes')) {
      result.reasons = ['revisão iniciada por você (não era seu review pedido): nada é postado sem sua decisão',
        ...(result.reasons || [])];
    }
    // lacuna de cobertura: é a diferença entre "está limpo" e "não olhei", e explica
    // por que um PR grande sem achado nenhum caiu na sua mesa em vez de auto-aprovar.
    // (cada bloco abaixo faz unshift, então a ordem final das reasons é: contestação,
    // cobertura, clique; o último a prepender lidera)
    const semCobertura = engine.coverageGap(result);
    if (semCobertura.length) {
      const amostra = semCobertura.slice(0, 3).join(', ');
      result.reasons = [`a revisão não cobriu o diff inteiro (${semCobertura.length} pendência(s): ${amostra}${semCobertura.length > 3 ? ', ...' : ''}), então não posto sozinho`,
        ...(result.reasons || [])];
    }
    // contestação a review de terceiro lidera as reasons: é o que você precisa
    // conferir antes de deixar sair, porque é afirmação pública contra outro revisor
    const contested = engine.contestations(result);
    if (contested.length) {
      const label = contested.length === 1 ? 'discordância' : 'discordâncias';
      result.reasons = [`${contested.length} ${label} de outro review no PR, confira a redação antes de postar (detalhe no relatório)`,
        ...(result.reasons || [])];
    }

    if (canAuto) {
      // dedup: se eu ja aprovei este PR (review manual ou via chat), nao
      // posta um segundo APPROVE (aconteceu no biud-frontend#635)
      const states = await engine.myReviewStates(pr);
      if (states && states.includes('APPROVED')) {
        engine.recordDecision(pr, result, { status: 'already_reviewed', action: 'approve' });
        engine.emit('toast', { kind: 'info', text: `${pr.key}: você já tinha aprovado no GitHub; não postei de novo.` });
        return;
      }
      // o corpo do APPROVE vai LIMPO, do jeito que o review escreveu (tem que
      // parecer humano, teu). As ressalvas ficam guardadas no app (campo attention,
      // visível em Revisões recentes), não coladas no PR com carimbo de automação.
      const points = engine.attentionPoints(result);
      const post = await engine.postReview(pr, result.payloads.approve);
      if (post.ok) {
        // a memória recebe o item gravado (pr da fila), não o envelope cru: o
        // result.pr/memory.author da sessão não escolhem repo nem dossiê (M6)
        const item = engine.recordDecision(pr, result, { status: 'auto_approved', action: 'approve', attention: points });
        engine.writeMemory(item, 'APPROVE');
        // points viaja no evento pro alerta distinguir os desfechos (sem ressalvas x com ressalvas)
        engine.emit('auto-approved', { pr, result, points });
        engine.emit('toast', {
          kind: 'ok', text: points.length
            ? `⚠️ ${pr.key} aprovado com ${points.length} ressalva(s): ${points[0]}`
            : `✅ ${pr.key} aprovado sem ressalvas.`
        });
        return;
      }
      result.reasons = [...(result.reasons || []), `falha ao postar o APPROVE: ${post.error}`];
    }

    // reprova sozinho (opt-in por conta): posta REQUEST_CHANGES com os bloqueios
    // que a revisão levantou. Mesmo gate do approve (review pedido a mim; clique
    // nunca posta) e dedup (não re-pede mudanças se eu já pedi).
    if (canReject) {
      const states = await engine.myReviewStates(pr);
      if (states && states.includes('CHANGES_REQUESTED')) {
        engine.recordDecision(pr, result, { status: 'already_reviewed', action: 'request_changes' });
        engine.emit('toast', { kind: 'info', text: `${pr.key}: você já tinha pedido mudanças no GitHub; não postei de novo.` });
        return;
      }
      const rc = { ...result.payloads.request_changes, body: engine.rejectBodyWithMark(result.payloads.request_changes.body) };
      const post = await engine.postReview(pr, rc);
      if (post.ok) {
        // mesma regra do approve: memória atribuída pelo item, nunca pelo envelope (M6)
        const item = engine.recordDecision(pr, result, { status: 'auto_rejected', action: 'request_changes' });
        engine.writeMemory(item, 'REQUEST_CHANGES');
        engine.emit('auto-rejected', { pr, result });
        engine.emit('toast', { kind: 'ok', text: `🔴 ${pr.key} reprovado (mudanças pedidas): ${(result.reasons || [])[0] || 'ver relatório'}` });
        return;
      }
      result.reasons = [...(result.reasons || []), `falha ao postar o REQUEST_CHANGES: ${post.error}`];
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
      result.reasons = [why, ...(result.reasons || [])];
    }
    const item = engine.recordDecision(pr, result, { status: 'pending' });
    engine.emit('needs-decision', { pr, item });
    // o alerta lidera com o MOTIVO (transparência), não com uma contagem
    const extra = (result.reasons || []).length > 1 ? ` (+${result.reasons.length - 1})` : '';
    engine.emit('toast', { kind: 'info', text: `🟡 ${pr.key} precisa da sua atenção: ${(result.reasons || [])[0] || 'ver relatório'}${extra}` });
  } finally {
    engine.activeReviews.delete(id);
    engine.activity.delete(id);
    engine.writeInflight();
    engine.pushState();
  }
}

module.exports = {
  prFromUrl, launchReview, enqueueHeadless, headlessAcct, processHeadless, runOneHeadless,
  personProfileBlock, reviewFormatBlock, thirdPartyReviewBlock, headlessPromptFor, runHeadlessReview,
};
