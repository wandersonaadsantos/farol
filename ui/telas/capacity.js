import { $, api } from './infra.js';
import { esc } from '../pure/comum.js';
import { quotaProfile, resourceReport, quotaHistory } from '../pure/capacity.js';
let model = null, busy = false;
function message(value) { $('#capacityMessage').textContent = value; }
async function request(action, extra = {}) {
  const result = await api('/api/capacity', { action, ...extra });
  if (!result?.ok) { message(result?.error || 'Diagnóstico indisponível.'); return null; }
  return result;
}
function render(value) {
  model = value;
  const select = $('#capacityProfile'), previous = select.value;
  select.innerHTML = value.profiles.map(p => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join('');
  if (previous && value.profiles.some(p => p.id === previous)) select.value = previous;
  $('#capacityQuotas').innerHTML = value.profiles.map(quotaProfile).join('') || '<p>Nenhum perfil configurado.</p>';
  $('#capacityHistory').innerHTML = quotaHistory(value.history);
  selectProfile();
  message('Cota desconhecida não é saldo disponível. Observar não bloqueia; reservar bloqueia novos trabalhos sem fonte válida.');
}
function selectProfile() {
  const profile = model?.profiles.find(p => p.id === $('#capacityProfile').value);
  $('#capacityMode').value = profile?.policy?.mode || 'off';
  $('#capacityMax').value = profile?.policy?.maxUsedPercent ?? 70;
}
async function load() { const result = await request('view'); if (result) render(result); }
async function mutate(action, extra) {
  if (busy) return; busy = true;
  $('#capacitySave').disabled = true;
  try { const result = await request(action, extra); if (result) render(result); }
  finally { busy = false; $('#capacitySave').disabled = false; }
}
function initCapacity() {
  $('#capacityLoad').onclick = load;
  $('#capacityProfile').onchange = selectProfile;
  $('#capacitySave').onclick = () => mutate('configure', { expected: model?.version, profileId: $('#capacityProfile').value,
    mode: $('#capacityMode').value, maxUsedPercent: Number($('#capacityMax').value) });
  $('#capacityQuotas').onclick = event => {
    const button = event.target.closest('[data-capacity-refresh]'); if (button) mutate('refresh', { profileId: button.dataset.capacityRefresh });
  };
  $('#capacityMeasure').onclick = async () => {
    const result = await request('resources');
    if (result) { $('#capacityResources').innerHTML = resourceReport(result.resources); message('Primeira amostra sem CPU por intervalo. Para atualizar, meça novamente após pelo menos cinco segundos.'); }
  };
}
export { initCapacity };
