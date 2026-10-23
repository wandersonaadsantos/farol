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
  const disable = entry.enabled ? `<button type="button" class="btn sm" data-specialist-disable="${esc(entry.id)}">Desativar</button>` : '';
  return `<article class="field"><h4>${esc(SPECIALIST_LABELS[entry.kind])} · ${esc(entry.title)}</h4>
    <p><b>${esc(STATUS_LABELS[status?.status] || 'Não verificado')}</b> ${esc(status?.reason || '')}</p>
    <p>${esc(entry.text)}</p><p>Curado em ${esc(new Date(entry.curatedAt).toLocaleString('pt-BR'))}. Origem: ${esc(entry.origin.type)}${originKey}.</p>
    ${entry.sources.map(s => `<details><summary>${sourceLink(scope, s)}</summary><pre>${esc(s.excerpt)}</pre></details>`).join('')}
    <p><button type="button" class="btn sm" data-specialist-edit="${esc(entry.id)}">Reconstruir / revisar</button>
    ${disable}</p></article>`;
}
function specialistPreview(scope, draft) {
  return `<h4>Confira antes de confirmar a curadoria</h4><p>${esc(draft.title)}: ${esc(draft.text)}</p>
    ${draft.sources.map(s => `<p>${sourceLink(scope, s)}</p><pre>${esc(s.excerpt)}</pre>`).join('')}
    <p>Esta confirmação aceita a conclusão acima para este escopo. Mudanças nas fontes exigem nova revisão.</p>`;
}
function sourceLines(text) {
  return String(text || '').split('\n').filter(l => l.trim()).map(line => {
    const match = /^(.*):(\d+)-(\d+)$/.exec(line.trim());
    if (!match) throw new Error('Use uma evidência por linha: caminho:início-fim.');
    return { path: match[1], start: Number(match[2]), end: Number(match[3]) };
  });
}
export { SPECIALIST_LABELS, specialistEntry, specialistPreview, sourceLines };
