// A curadoria vive no cliente; o servidor reconfere escopo, fontes e versão em cada efeito.
import { $, api } from './infra.js';
import { esc } from '../pure/comum.js';
import { estado } from './estado.js';
import { specialistEntry, specialistPreview, sourceLines } from '../pure/specialists.js';

let model = null, previewId = null, replaceId, originKey, generation = 0;
const scope = () => ({ account: $('#specialistAccount').value, repo: $('#specialistRepo').value.trim(), branch: $('#specialistBranch').value.trim() });
function message(text) { $('#specialistMessage').textContent = text; }
function clearPreview() { previewId = null; $('#specialistPreview').innerHTML = ''; $('#specialistConfirm').disabled = true; }

async function request(action, extra = {}) {
  const epoch = generation;
  const result = await api('/api/specialists', { action, scope: scope(), ...extra });
  if (epoch !== generation) return null;
  if (!result?.ok) { message(result?.error || 'Não foi possível concluir a operação.'); return null; }
  return result;
}

function renderView(result) {
  model = result;
  const current = result.current;
  $('#specialistCurrent').textContent = current ? `Versão ${current.revision} · ${current.id.slice(0, 8)} · ${result.checkedHead?.slice(0, 7) || 'sem verificação atual'}` : 'Nenhum contexto curado neste escopo.';
  $('#specialistEntries').innerHTML = (current?.entries || []).map(e => specialistEntry(result.scope, e, result.statuses.find(s => s.id === e.id))).join('');
  $('#specialistVersions').innerHTML = result.versions.map(v => `<option value="${esc(v.id)}">Versão ${v.revision} · ${v.count} conclusões</option>`).join('');
  $('#specialistProposals').innerHTML = result.proposals.map((p, i) => `<p>${esc(p.key)}: ${esc(p.text)} <button type="button" class="btn sm" data-specialist-proposal="${i}">Preparar proposta</button></p>`).join('');
  message(result.verificationError || 'Contexto carregado. Conferência de fontes não comprova que uma conclusão continua correta.');
}
async function load() { clearPreview(); const result = await request('view'); if (result) renderView(result); }

function fill(entry) {
  clearPreview();
  replaceId = entry?.id; originKey = entry?.origin?.key;
  $('#specialistKind').value = entry?.kind || 'architecture';
  $('#specialistTitle').value = entry?.title || '';
  $('#specialistText').value = entry?.text || '';
  $('#specialistSources').value = (entry?.sources || []).map(s => `${s.path}:${s.start}-${s.end}`).join('\n');
  $('#specialistOrigin').textContent = originKey ? `Origem proposta: ${originKey}. A lição só passa a valer após sua curadoria com fontes.` : 'Origem: curadoria manual.';
}

async function preview() {
  clearPreview();
  let sources;
  try { sources = sourceLines($('#specialistSources').value); }
  catch (error) { message(error.message); return; }
  const entry = { kind: $('#specialistKind').value, title: $('#specialistTitle').value, text: $('#specialistText').value, sources };
  const result = await request('preview', { entry, replaceId, originKey });
  if (!result) return;
  previewId = result.previewId;
  $('#specialistPreview').innerHTML = specialistPreview(scope(), result.draft);
  $('#specialistConfirm').disabled = false;
  message('Prévia pronta. Confira a conclusão e os trechos antes de confirmar.');
}

async function mutate(action, fields) {
  const result = await request(action, { expected: model?.current?.id || null, confirmed: true, ...fields });
  if (!result) return;
  await load(); fill(null);
}
function itemAction(event) {
  const button = event.target.closest('button'); if (!button || !model) return;
  const edit = button.dataset.specialistEdit;
  if (edit) { fill(model.current.entries.find(e => e.id === edit)); return; }
  const disable = button.dataset.specialistDisable;
  if (disable) { mutate('toggle', { id: disable, enabled: false }); return; }
  const index = button.dataset.specialistProposal;
  if (index !== undefined) {
    const proposal = model.proposals[Number(index)];
    fill({ kind: 'lesson', title: 'Lição do repositório', text: proposal.text, origin: { key: proposal.key } });
  }
}

function renderSpecialistAccounts() {
  const select = $('#specialistAccount'); if (!select) return;
  const previous = select.value;
  const options = (estado()?.accounts || []).filter(a => a.user).map(a => `<option value="${esc(a.user)}">${esc(a.user)}</option>`).join('');
  if (select.innerHTML !== options) { select.innerHTML = options; if (previous) select.value = previous; }
}

function initSpecialists() {
  const root = $('#specialistManager');
  root.addEventListener('input', event => {
    generation++; clearPreview();
    if (['specialistAccount', 'specialistRepo', 'specialistBranch'].includes(event.target.id)) {
      model = null; replaceId = undefined; originKey = undefined;
      fill(null);
      $('#specialistEntries').innerHTML = ''; $('#specialistProposals').innerHTML = ''; $('#specialistVersions').innerHTML = '';
      $('#specialistCurrent').textContent = 'Carregue o escopo escolhido.';
    }
  });
  root.addEventListener('click', itemAction);
  $('#specialistLoad').onclick = load;
  $('#specialistNew').onclick = () => { generation++; fill(null); };
  $('#specialistBuild').onclick = preview;
  $('#specialistConfirm').onclick = () => mutate('curate', { previewId });
  $('#specialistRestore').onclick = () => mutate('restore', { version: $('#specialistVersions').value });
}
export { initSpecialists, renderSpecialistAccounts };
