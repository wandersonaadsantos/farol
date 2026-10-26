import { $, get } from './infra.js';
import { esc } from '../pure/comum.js';
import { USAGE_KIND_LABEL } from '../pure/consumo.js';
import { activityBodyHtml, activityHistoryHtml, activityRulesHtml, activityTimelineHtml } from '../pure/consumo-atividade.js';

const REFRESH_MS = 30000;
const SEARCH_MS = 250;
const DEFAULT_FILTERS = { account: 'all', repo: 'all', provider: 'all', model: 'all', kind: 'all', page: 0, search: '', focus: 'all' };
const filters = { ...DEFAULT_FILTERS };
let current = null, lastKey = '', loadedAt = 0, generation = 0, searchTimer;
let metric = 'sessions';
let context = { window: 30, scope: 'local' };

function day(at) { return new Date(at).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); }

function parameters() {
  const end = day(Date.now());
  const start = day(Date.now() - (context.window - 1) * 86400000);
  const query = { ...filters, ...context, start, end };
  if ($('#activityCustom').open) { query.start = $('#activityStart').value; query.end = $('#activityEnd').value; }
  return new URLSearchParams(query);
}

function optionsHtml(values, label, selected) {
  return `<option value="all">${label}</option>${(values || []).map(value => `<option value="${esc(value)}" ${selected === value ? 'selected' : ''}>${esc(USAGE_KIND_LABEL[value] || value)}</option>`).join('')}`;
}

function shell() {
  return `<div class="activity-filters"><label>Repositório<select id="activityRepo" data-activity-filter="repo" aria-label="Repositório"></select></label><label>Provedor<select data-activity-filter="provider" aria-label="Provedor"></select></label><label>Modelo principal<select data-activity-filter="model" aria-label="Modelo principal"></select></label><label>Tipo<select data-activity-filter="kind" aria-label="Tipo"></select></label><button data-activity-clear>Limpar filtros</button></div><details id="activityCustom" class="disc"><summary>Datas personalizadas</summary><div class="activity-dates"><label>Início<input id="activityStart" type="date"></label><label>Fim<input id="activityEnd" type="date"></label></div></details><details class="disc activity-rules">${activityRulesHtml()}</details><div id="activityBody" aria-live="polite"></div><div class="card usage-chart-card" id="activityHistoryPanel" tabindex="-1"><div class="usage-chart-head"><h3>Histórico de operações</h3><input type="search" id="activitySearch" aria-label="Buscar no histórico" placeholder="Buscar referência, tipo ou modelo"></div><div id="activityFocus" class="usage-caption"></div><div id="activityHistory"></div></div>`;
}

function init() {
  const root = $('#usageActivity');
  if (!root || root.dataset.ready) return;
  root.dataset.ready = 'true'; root.innerHTML = shell();
  $('.activity-filters').insertAdjacentHTML('afterbegin', '<label>Conta<select data-activity-filter="account" aria-label="Conta"></select></label>');
  $('#activityStart').value = day(Date.now() - 29 * 86400000);
  $('#activityEnd').value = day(Date.now());
  root.addEventListener('change', event => {
    const field = event.target.dataset.activityFilter;
    if (field) filters[field] = event.target.value;
    filters.page = 0; filters.focus = 'all'; refresh(true);
  });
  $('#activityCustom').addEventListener('toggle', () => { filters.page = 0; refresh(true); });
  $('#activitySearch').addEventListener('input', event => {
    filters.search = event.target.value; filters.page = 0;
    clearTimeout(searchTimer); searchTimer = setTimeout(() => refresh(true), SEARCH_MS);
  });
  root.addEventListener('click', onClick);
}

function onClick(event) {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.hasAttribute('data-activity-clear')) {
    Object.assign(filters, DEFAULT_FILTERS);
    $('#activitySearch').value = '';
    refresh(true);
  }
  if (button.dataset.activityPage != null) { filters.page = Number(button.dataset.activityPage); refresh(true); }
  if (button.dataset.activityFocus) {
    filters.focus = button.dataset.activityFocus; filters.page = 0;
    $('#activityHistoryPanel').focus({ preventScroll: true });
    $('#activityHistoryPanel').scrollIntoView({ block: 'start' }); refresh(true);
  }
  if (button.dataset.activityMetric && current?.ok) { metric = button.dataset.activityMetric; paintTimeline(); }
}

function paintTimeline() {
  if (!current?.ok || !$('#activityTimeline')) return;
  $('#activityTimeline').innerHTML = activityTimelineHtml(current, metric);
  for (const button of document.querySelectorAll('[data-activity-metric]')) {
    const active = button.dataset.activityMetric === metric;
    button.classList.add('seg-btn'); button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}

function paint(report) {
  const expanded = new Set([...document.querySelectorAll('[data-activity-key][open]')].map(el => el.dataset.activityKey));
  current = report;
  $('#activityBody').innerHTML = activityBodyHtml(report);
  paintTimeline();
  $('#activityHistory').innerHTML = report?.ok ? activityHistoryHtml(report) : '';
  for (const el of document.querySelectorAll('[data-activity-key]')) el.open = expanded.has(el.dataset.activityKey);
  const focusLabels = { review: 'Reviews concluídas', self: 'Autoanálises concluídas', pr: 'PRs únicos revisados' };
  $('#activityFocus').textContent = filters.focus === 'all' ? 'Todas as operações do recorte · tentativas agrupadas' : `Detalhes do indicador: ${focusLabels[filters.focus]} · limpar filtros para voltar`;
  if (!report?.ok) return;
  const labels = { account: 'Todas as contas', repo: 'Todos os repositórios', provider: 'Todos os provedores', model: 'Todos os modelos', kind: 'Todos os tipos' };
  for (const [key, label] of Object.entries(labels)) {
    const select = document.querySelector(`[data-activity-filter="${key}"]`);
    select.innerHTML = optionsHtml(report.options[key], label, filters[key]);
  }
}

async function refresh(force = false) {
  init();
  if (!$('#activityBody')) return;
  const params = parameters(), key = params.toString();
  if (!force && key === lastKey && Date.now() - loadedAt < REFRESH_MS) return;
  const revision = ++generation;
  lastKey = key; loadedAt = Date.now();
  if (!current) $('#activityBody').innerHTML = '<p class="vago">Carregando o diário de consumo…</p>';
  const report = await get(`/api/usage?${params}`);
  if (revision !== generation) return;
  paint(report);
}

export function renderActivity(next) {
  const scopeChanged = context.scope !== next.scope;
  const changed = context.window !== next.window || context.scope !== next.scope;
  context = next;
  init();
  if (scopeChanged) {
    Object.assign(filters, DEFAULT_FILTERS);
    $('#activitySearch').value = '';
  }
  if (changed && $('#activityCustom').open) $('#activityCustom').open = false;
  if (changed) filters.page = 0;
  return refresh();
}
