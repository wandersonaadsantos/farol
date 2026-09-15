// Pessoas e reviewers: o perfil de review por pessoa (papel e matriz por domínio), o
// rótulo e o chip de reviewer, e o editor de reviewers por org e por repo. Extraído do
// ui/pure.js na Fase 1a da reorganização; o conteúdo não mudou.
//
// Perfil de review por pessoa: molda o TOM e a POSTURA da revisão automática, nunca a
// decisão. As três tabelas (PAPEL_OPTS, DOMAIN_DEFS, DOMLEVEL_OPTS) DUPLICAM as chaves de
// lib/taxonomy.js, e a duplicação é estrutural: o servidor estático só serve UI_DIR, então
// o navegador não importa lib/. O que impede a duplicação de virar divergência é
// test/taxonomy-ui.test.js, que compara os CONJUNTOS DE CHAVES com o engine. Os rótulos
// ficam livres de propósito, mais curtos para caber no <select>.
//
// Rótulo de reviewer: `cands` é o mapa de candidatos por org; sem ele o rótulo degrada
// para o slug do time, que é o que acontecia enquanto os candidatos não carregavam.
//
// Editor de reviewers: as funções liam SETE globais, todas só para LER, então entra um ctx
// único, montado uma vez por renderização (revCtx no app.js). A extração foi de BAIXO
// PARA CIMA: primeiro as folhas (defaultFor, overrideFor, reposOfOrg, suggestDefault,
// addControl), e só então o renderOrgBlock, que compõe todas. Ficam no app.js o
// seedException, que muta Sets e persiste via API, e o renderReviewersEditor, que escreve
// no DOM.
import { diffVs, esc, repoShort, sameSet } from './comum.js';

export function defaultFor(org, ctx) { const d = ctx.defaults || {}; return d[org] || d[(org || '').toLowerCase()] || []; }

export function overrideFor(repo, ctx) { const p = ctx.projects || {}; return p[repo] || p[(repo || '').toLowerCase()] || null; }

export function reposOfOrg(org, ctx) {
  const o = String(org).toLowerCase(), set = new Set();
  const add = k => { const r = String(k || ''); if (r.split('/')[0].toLowerCase() === o) set.add(r); };
  // prKeys ja vem achatado do app.js (myPRs + panorama): aqui nao se sabe de onde
  // a chave veio, so que ela e "owner/repo#N"
  (ctx.prKeys || []).forEach(k => add(String(k).split('#')[0]));
  Object.keys(ctx.projects || {}).forEach(add);
  [...(ctx.pendentes || [])].forEach(add);
  return [...set].filter(Boolean).sort();
}

export function suggestDefault(org, ctx) {
  const lists = reposOfOrg(org, ctx).map(repo => overrideFor(repo, ctx)).filter(l => l && l.length);
  if (lists.length < 2) return [];
  const count = {}, rep = {};
  for (const list of lists) for (const rv of new Set(list)) { const k = rv.toLowerCase(); count[k] = (count[k] || 0) + 1; rep[k] = rv; }
  const th = Math.ceil(lists.length / 2);
  return Object.keys(count).filter(k => count[k] >= th).map(k => rep[k]).sort();
}

export function addControl(cls, dataAttrs, list, org, ctx) {
  const c = (ctx.cands || {})[org] || { members: [], teams: [] };
  const me = ((ctx.owner2user || {})[String(org || '').toLowerCase()] || ctx.ghUser || '').toLowerCase();
  const has = v => (list || []).some(l => l.toLowerCase() === String(v).toLowerCase());
  if (!ctx.candsLoaded) return `<select class="rev-add ${cls}" ${dataAttrs}><option value="">carregando…</option></select>`;
  if (!c.members.length && !c.teams.length) return `<input class="rev-add rev-manual ${cls}" ${dataAttrs} placeholder="+ digite um handle e Enter…" spellcheck="false">`;
  const opts = [
    ...c.members.filter(x => x.toLowerCase() !== me && !has(x)).map(x => `<option value="${esc(x)}">${esc(x)}</option>`),
    ...c.teams.filter(t => !has(t.id)).map(t => `<option value="${esc(t.id)}">${esc(t.name)} (time)</option>`)
  ].join('');
  return `<select class="rev-add ${cls}" ${dataAttrs}><option value="">+ adicionar…</option>${opts}</select>`;
}

export function renderOrgBlock(org, accent, ctx) {
  const def = defaultFor(org, ctx);
  const repos = reposOfOrg(org, ctx);
  const isExc = r => { const o = overrideFor(r, ctx); return (o && !sameSet(o, def)) || ctx.abertas.has(r) || ctx.pendentes.has(r); };
  const excRepos = repos.filter(isExc);
  const following = repos.filter(r => !excRepos.includes(r));

  // card do padrão
  let defCard;
  if (def.length) {
    const chips = def.map(rv => chipHtml(rv, 'rev-def-x', `data-org="${esc(org)}" data-rv="${esc(rv)}"`, ctx.cands)).join('');
    defCard = `<div class="rev-default">
      <div class="rev-default-top"><span class="t">Reviewers padrão</span><span class="scope">${esc(org)}</span></div>
      <div class="rev-chips">${chips}${addControl('rev-def-add', `data-org="${esc(org)}"`, def, org, ctx)}</div>
      <div class="rev-hint">Aplicado a todos os projetos de <code>${esc(org)}</code> quando você clica em "👥 Reviewers", salvo as exceções abaixo.</div>
    </div>`;
  } else {
    const sug = suggestDefault(org, ctx);
    const sugChips = sug.map(rv => `<span class="rev-chip ghost">${esc(reviewerLabel(rv, ctx.cands).label)}</span>`).join('');
    defCard = `<div class="rev-default empty">
      <div class="rev-default-top"><span class="t">Reviewers padrão</span><span class="scope">${esc(org)}</span></div>
      ${sug.length
        ? `<div class="rev-hint">Detectei ${sug.length} reviewers comuns nos seus projetos de ${esc(org)}. Vira o padrão num clique, e os projetos iguais colapsam:</div>
           <div class="rev-chips">${sugChips}</div>
           <button class="btn sm ok rev-make-default" data-org="${esc(org)}">Criar padrão com estes ${sug.length}</button>`
        : `<div class="rev-chips">${addControl('rev-def-add', `data-org="${esc(org)}"`, [], org, ctx)}</div>
           <div class="rev-hint">Escolha os reviewers padrão de <code>${esc(org)}</code>.</div>`}
    </div>`;
  }

  // exceções
  const excHtml = excRepos.map(repo => {
    const list = overrideFor(repo, ctx) || (ctx.pendentes.has(repo) ? [...def] : []);
    if (ctx.abertas.has(repo)) {
      const chips = list.map(rv => chipHtml(rv, 'rev-exc-x', `data-repo="${esc(repo)}" data-rv="${esc(rv)}"`, ctx.cands)).join('');
      return `<div class="rev-exc open" data-repo="${esc(repo)}">
        <div class="rev-exc-head"><code>${esc(repoShort(repo))}</code>
          <button class="rev-exc-reset" data-repo="${esc(repo)}" title="remover a exceção e voltar ao padrão da org">voltar ao padrão</button>
          <button class="rev-exc-toggle" data-repo="${esc(repo)}">fechar</button></div>
        <div class="rev-chips">${chips || '<span class="rev-empty">sem reviewers</span>'}${addControl('rev-exc-add', `data-repo="${esc(repo)}"`, list, repo.split('/')[0], ctx)}</div>
      </div>`;
    }
    const d = diffVs(def, list);
    const pills = '<span class="rev-pill base">padrão</span>'
      + d.added.map(x => `<span class="rev-pill add">+ ${esc(reviewerLabel(x, ctx.cands).label)}</span>`).join('')
      + d.removed.map(x => `<span class="rev-pill rem">− ${esc(reviewerLabel(x, ctx.cands).label)}</span>`).join('');
    return `<div class="rev-exc" data-repo="${esc(repo)}"><code>${esc(repoShort(repo))}</code><div class="rev-diff">${def.length ? pills : list.map(x => `<span class="rev-pill add">${esc(reviewerLabel(x, ctx.cands).label)}</span>`).join('')}</div><button class="rev-exc-toggle" data-repo="${esc(repo)}">editar</button></div>`;
  }).join('');

  // colapsado: projetos que seguem o padrão
  const open = ctx.expandidas.has(org);
  // os quatro ternarios que estavam nesta expressao (tem projeto? singular ou
  // plural? aberto ou fechado? mostra a lista?) viraram quatro nomes: era o ponto
  // com mais ternario aninhado do arquivo, e nenhum deles dizia o que decidia.
  const rotuloSegue = following.length === 1 ? 'projeto segue' : 'projetos seguem';
  const rotuloBotao = open ? 'ocultar' : 'ver';
  const miniRepos = following.map(r => `<span class="rev-repo-mini">${esc(repoShort(r))}<button class="rev-mk-exc" data-repo="${esc(r)}" title="criar exceção pra este projeto">+</button></span>`).join('');
  const listaAberta = open ? `<div class="rev-folded-list">${miniRepos}</div>` : '';
  const followHtml = !following.length ? '' : `<div class="rev-folded">
      <span><span class="count">${following.length}</span> ${rotuloSegue} o padrão</span>
      <button class="rev-fold-toggle" data-org="${esc(org)}">${rotuloBotao}</button>
    </div>${listaAberta}`;

  // criar exceção pra um projeto (só quando há padrão)
  const dl = following.map(r => `<option value="${esc(r)}"></option>`).join('');
  const newExc = def.length ? `<div class="rev-newexc">
      <input class="rev-newexc-input" list="revExcList-${esc(org)}" placeholder="owner/repo, exceção" spellcheck="false">
      <datalist id="revExcList-${esc(org)}">${dl}</datalist>
      <button class="btn sm rev-newexc-go" data-org="${esc(org)}">+ criar exceção</button>
    </div>` : '';

  return `<div class="rev-org" data-org="${esc(org)}" style="--ac:${accent}">${defCard}${excRepos.length ? `<div class="rev-sec-title">Exceções (${excRepos.length})</div>${excHtml}` : ''}${followHtml}${newExc}</div>`;
}

export const PAPEL_OPTS = [['', 'papel'], ['estagio', 'Estágio'], ['junior', 'Júnior'], ['pleno', 'Pleno'], ['senior', 'Sênior'], ['techlead', 'Tech Lead'], ['arquiteto', 'Arquiteto'], ['especialista', 'Especialista']];

export const DOMAIN_DEFS = [['backend', 'Backend'], ['frontend', 'Frontend'], ['dados', 'Dados'], ['infra', 'Infra']];

export const DOMLEVEL_OPTS = [['', 'sem info'], ['basico', 'Básico'], ['intermediario', 'Interm.'], ['avancado', 'Avançado'], ['autoridade', 'Autoridade']];

export function personOf(login, people) { return (people || {})[String(login || '').toLowerCase()] || {}; }

export function papelOf(login, people) { return personOf(login, people).papel || ''; }

export function domLevelOf(login, d, people) { return (personOf(login, people).dominios || {})[d] || ''; }

// papel (compacto): usado nos cards do PR e no cabeçalho do card do time
export function papelPicker(login, people) {
  return `<select class="papel-level" data-login="${esc(login)}" title="Papel de @${esc(login)}: molda o tom da revisão automática, nunca a decisão">
    ${PAPEL_OPTS.map(([v, t]) => `<option value="${v}"${papelOf(login, people) === v ? ' selected' : ''}>${t}</option>`).join('')}
  </select>`;
}

// matriz por domínio (só na aba Time): competência por área calibra a postura
export function domainMatrix(login, people) {
  return `<div class="dom-matrix">${DOMAIN_DEFS.map(([d, label]) => `
    <label class="dom-cell"><span class="dom-name">${label}</span>
      <select class="dom-level" data-login="${esc(login)}" data-domain="${d}" title="Competência de @${esc(login)} em ${label}">
        ${DOMLEVEL_OPTS.map(([v, t]) => `<option value="${v}"${domLevelOf(login, d, people) === v ? ' selected' : ''}>${t}</option>`).join('')}
      </select></label>`).join('')}</div>`;
}

export function reviewerLabel(rv, cands) {
  const isTeam = rv.includes('/');
  const ent = isTeam && rv.split('/').slice(1).join('/').includes(':');
  if (ent) return { label: `${rv.split('/').pop()} (enterprise, não pedível)`, cls: 'bad', ent: true };
  if (isTeam) { const org = rv.split('/')[0]; const t = (((cands || {})[org] || {}).teams || []).find(t => t.id === rv); return { label: (t ? t.name : rv.split('/').pop()) + ' (time)', cls: 'team' }; }
  return { label: rv, cls: '' };
}

export function chipHtml(rv, xClass, dataAttrs, cands) {
  const r = reviewerLabel(rv, cands);
  // os dois ternários saem do template: juntos numa linha só eles contavam como
  // ternário aninhado no gate de qualidade, e a versão com nome é mais legível
  const cls = r.cls ? ' ' + r.cls : '';
  const title = r.ent ? 'title="Time enterprise não pode ser reviewer de PR (o GitHub recusa). Remova daqui."' : '';
  return `<span class="rev-chip${cls}" ${title}>${esc(r.label)}<button class="${xClass}" ${dataAttrs} title="remover">×</button></span>`;
}
