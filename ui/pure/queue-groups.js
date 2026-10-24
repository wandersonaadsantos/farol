// Agrupa só a apresentação: ordem e elegibilidade da revisão continuam no engine.
import { esc } from './comum.js';
function queueGroups(items, mode) {
  const groups = new Map();
  for (const item of items) {
    const label = mode === 'repo' ? item.repo || 'Repositório não informado' : item.account || 'Conta não informada';
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(item);
  }
  return [...groups].map(([label, rows]) => ({ key: `${mode}:${label}`, label, rows }));
}
function groupedQueue(items, mode, closed = new Set()) {
  if (!['account', 'repo'].includes(mode)) return items.map(item => item.html).join('');
  return queueGroups(items, mode).map(g => `<details class="queue-group review-tools rgroup" data-queue-group="${esc(g.key)}"${closed.has(g.key) ? '' : ' open'}><summary class="rgroup-head"><span class="chev" aria-hidden="true"></span><span>${esc(g.label)}</span><span class="count ambient">${g.rows.length} PR(s)</span></summary><div class="cards">${g.rows.map(item => item.html).join('')}</div></details>`).join('');
}
export { queueGroups, groupedQueue };
