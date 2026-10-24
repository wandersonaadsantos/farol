import { esc } from './comum.js';
const SPECIALIST_LABELS = { architecture: 'Arquitetura', contract: 'Contrato', convention: 'Convenção', critical: 'Ponto crítico', lesson: 'Lição' };
const STATUS_LABELS = { ready: 'Fontes conferidas', stale: 'Vencido', unavailable: 'Não verificável', disabled: 'Desativado' };
function sourceLink(scope, source) {
  const file = source.path.split('/').map(encodeURIComponent).join('/');
  const href = `https://github.com/${scope.repo}/blob/${source.commit}/${file}#L${source.start}-L${source.end}`;
  return `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(source.path)}:${source.start}–${source.end} · ${esc(source.commit.slice(0, 7))}</a>`;
}
function specialistEntry(scope, entry, status) {
  const originKey = entry.origin.key ? ` · ${esc(entry.origin.key)}` : '';
  const disable = entry.enabled ? `<button type="button" class="btn sm ghost" data-specialist-disable="${esc(entry.id)}">Desativar</button>` : '';
  const state = { ready: 'ok', stale: 'warn', unavailable: 'bad', disabled: 'off' }[status?.status] || 'off';
  return `<article class="irow${entry.enabled ? '' : ' is-off'}"><div class="irow-main"><div class="irow-head"><span class="chip">${esc(SPECIALIST_LABELS[entry.kind])}</span><h4>${esc(entry.title)}</h4><span class="chip ${state}">${esc(STATUS_LABELS[status?.status] || 'Não verificado')}</span></div>
    <p class="irow-sub">${esc(status?.reason || '')}</p><p class="irow-sub">${esc(entry.text)}</p></div>
    <div class="irow-acts"><button type="button" class="btn sm ghost" data-specialist-edit="${esc(entry.id)}">Reconstruir / revisar</button>${disable}</div>
    <details class="disc"><summary>Fontes <span class="count ambient">${entry.sources.length}</span></summary><div class="disc-body"><p>Curado em ${esc(new Date(entry.curatedAt).toLocaleString('pt-BR'))}. Origem: ${esc(entry.origin.type)}${originKey}.</p><div class="src-preview">
    ${entry.sources.map(s => `<div class="src-snip"><div class="src-snip-head">${sourceLink(scope, s)}</div><pre>${esc(s.excerpt)}</pre></div>`).join('')}</div></div></details></article>`;
}
function specialistPreview(scope, draft) {
  return `<h4 class="set-subtitle">Confira antes de confirmar a curadoria</h4><p class="set-desc">${esc(draft.title)}: ${esc(draft.text)}</p>
    ${draft.sources.map(s => `<div class="src-snip"><div class="src-snip-head">${sourceLink(scope, s)}</div><pre>${esc(s.excerpt)}</pre></div>`).join('')}
    <p class="set-desc">Esta confirmação aceita a conclusão acima para este escopo. Mudanças nas fontes exigem nova revisão.</p>`;
}
function sourceLines(text) {
  return String(text || '').split('\n').filter(l => l.trim()).map(line => {
    const match = /^(.*):(\d+)-(\d+)$/.exec(line.trim());
    if (!match) throw new Error('Use uma evidência por linha: caminho:início-fim.');
    return { path: match[1], start: Number(match[2]), end: Number(match[3]) };
  });
}
export { SPECIALIST_LABELS, specialistEntry, specialistPreview, sourceLines };
