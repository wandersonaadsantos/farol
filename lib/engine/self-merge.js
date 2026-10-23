import io from '../io.js';
import { isPermanentBranch } from '../format.js';
import { TEMPOS } from '../constants.js';

export async function executarMerge(engine, { url, key, repo, acc, me, env, analysis, mode }, handle) {
  // estado FRESCO do PR (nunca decidir por dado velho da tela)
  const info = await io.run('gh', ['pr', 'view', url, '--json',
    'state,isDraft,mergeable,author,headRefOid,headRefName,baseRefName,title'], { env });
  if (!info.ok) {
    const msg = (info.stderr || info.stdout || 'erro').trim().slice(0, 200);
    return { ok: false, error: `não consegui ler o PR: ${msg}` };
  }
  const pr = io.parseJson(info.stdout || '{}');
  if (!pr) return { ok: false, error: 'resposta do gh inválida' };

  // gate 3: autor sou eu; PR aberto, ready, sem conflito
  const author = ((pr.author && pr.author.login) || '').toLowerCase();
  if (author && author !== me) {
    return { ok: false, error: `você não é o autor deste PR (autor: ${author}); o Farol só mergeia os seus.` };
  }
  if (pr.state && pr.state !== 'OPEN') return { ok: false, error: `o PR não está aberto (estado: ${pr.state}).` };
  if (pr.isDraft) return { ok: false, error: 'o PR está como rascunho; marque como ready antes de mergear.' };
  if (pr.mergeable === 'CONFLICTING') return { ok: false, error: 'o PR tem conflito com a branch de destino; resolva antes de mergear.' };

  // G3: o selo "aprovável" fala de UM estado do PR. Se entrou commit depois da
  // análise, o selo não vale pro que vai ser mergeado (mesma doutrina do dedup
  // por round). Análise antiga sem sha registrado não bloqueia (sem base de
  // comparação), igual ao enrichMyPRBranches.
  if (analysis.headSha && pr.headRefOid && analysis.headSha !== pr.headRefOid) {
    return { ok: false, error: 'o PR recebeu commit depois da sua análise; re-analise antes de mergear.' };
  }

  // 1) garantir que estou atribuido; se nao estiver, atribui
  const asg = await io.run('gh', ['pr', 'edit', url, '--add-assignee', acc], { env });
  if (!asg.ok) engine.log('WARN', `não consegui me atribuir em ${key}: ${asg.stderr.trim().slice(0, 200)}`);

  // 2) merge commit (coerente com o fluxo, sem squash/rebase); deleta a branch
  //    de origem SO se for descartavel (nunca develop/release/main/...).
  const canDelete = !isPermanentBranch(pr.headRefName);
  const args = ['pr', 'merge', url, '--merge'];
  if (mode === 'auto') args.push('--auto');
  if (mode === 'admin') args.push('--admin');
  if (canDelete) args.push('--delete-branch');
  if (handle && !handle.validoPor(TEMPOS.POSTAGEM_MARGEM_POSSE_MS)) return { ok: false, error: 'merge recusado: posse entre aparelhos perdida' };
  const mg = await io.run('gh', args, { env });
  if (!mg.ok) {
    const raw = (mg.stderr || mg.stdout || 'erro desconhecido').trim().slice(0, 300);
    // Condicoes CONHECIDAS e ja tratadas pelo UI: nao sao bug do Farol, ficam WARN
    // pra nao poluir o log de ERROR com ruido nao-acionavel.
    //  - policyBlock: a protecao da branch exige requisitos (merge NORMAL) → UI oferece auto/admin.
    //  - autoUnavailable: pediu --auto mas o repo nao tem "Allow auto-merge" ligado;
    //    re-tentar nao adianta, a saida e Merge (admin) ou ligar a opcao no repo.
    const policyBlock = mode === 'normal' && /base branch policy|not mergeable|protected|--auto|--admin/i.test(raw);
    const autoUnavailable = mode === 'auto' && /auto[ -]?merge is not allowed|enablePullRequestAutoMerge/i.test(raw);
    //  - ruleBlock: o repo usa REPOSITORY RULESET (nao protecao classica) exigindo
    //    revisao/checks; o --admin NAO fura ruleset sem bypass. Retentar nao adianta,
    //    a saida e uma aprovacao (ou bypass no ruleset). Condicao conhecida = WARN.
    const ruleBlock = /repository rule violations|approving review is required|required status check|changes must be made through a pull request/i.test(raw);
    engine.log(policyBlock || autoUnavailable || ruleBlock ? 'WARN' : 'ERROR', `merge de ${key} (${mode}) falhou: ${raw}`);
    if (autoUnavailable) {
      const nice = `Auto-merge não está habilitado em ${repo}. Ligue "Allow auto-merge" nas settings do repo, ou use "Merge (admin)" se você for admin.`;
      engine.emit('toast', { kind: 'error', text: `${key}: ${nice}` });
      return { ok: false, blocked: 'autoUnavailable', error: nice };
    }
    if (ruleBlock) {
      // marca o repo: o UI para de oferecer o Merge (admin), que nao resolve aqui
      engine.adminBlockedRepos = Object.fromEntries([...Object.entries(engine.adminBlockedRepos || {}), [repo, true]]);
      const nice = `Merge admin não fura o ruleset de ${repo} sem bypass. Precisa de uma aprovação (ou um bypass no ruleset).`;
      engine.emit('toast', { kind: 'error', text: `${key}: ${nice}` });
      return { ok: false, blocked: 'rule', error: nice };
    }
    if (!policyBlock) engine.emit('toast', { kind: 'error', text: `Merge de ${key} falhou: ${raw}` });
    return { ok: false, blocked: policyBlock ? 'policy' : undefined, error: raw };
  }

  const head = pr.headRefName || '?', base = pr.baseRefName || '?';
  const asgNote = asg.ok ? '' : ' (não consegui te atribuir, confira no GitHub).';

  // auto-merge: o PR NAO foi mergeado ainda (o GitHub mergeia quando os
  // requisitos passarem). Nao limpa nada; o proximo polling remove quando fechar.
  if (mode === 'auto') {
    engine.emit('toast', { kind: 'ok', text: `⏳ Auto-merge ativado em ${key}. O GitHub mergeia sozinho quando os requisitos passarem.${asgNote}` });
    return { ok: true, auto: true };
  }

  // normal/admin: mergeou agora. Limpa: o PR foi fechado, sai de Meus PRs e da autoanalise.
  engine.myPRs = engine.myPRs.filter(p => p.key !== key);
  if (engine.selfAnalyses[key]) { delete engine.selfAnalyses[key]; engine.saveSelfAnalyses(); }
  engine.pushState();

  const branchNote = canDelete ? ` Branch ${head} deletada.` : ` Branch ${head} preservada (é do fluxo).`;
  const adminNote = mode === 'admin' ? ' (via admin, proteção bypassada)' : '';
  engine.emit('toast', { kind: 'ok', text: `✅ ${key} mergeado${adminNote} (${head}→${base}).${branchNote}${asgNote}` });
  return { ok: true, head, base, deletedBranch: canDelete, admin: mode === 'admin' };
}
