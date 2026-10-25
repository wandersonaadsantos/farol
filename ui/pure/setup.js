// Roteiro de configuração que mostra evidência disponível, sem autorizar operação.
import { esc } from './comum.js';
function setupSteps(state = {}) {
  const accounts = state.accounts || [], profiles = state.doctor?.claudeAuth || [];
  const authenticated = accounts.some(a => a.tokenOk && !a.muted && a.owners?.length);
  const profileReady = profiles.some(p => p.ready === true);
  const accountDetail = authenticated ? 'Conta ativa autenticada com organização configurada.' : 'Confira login, organizações e silenciamento em Contas.';
  const profileDetail = profileReady ? 'Há perfil pronto no último diagnóstico. Reverifique se o ambiente mudou.' : 'Configure o perfil e use Reverificar saúde. Configurado não significa autenticado.';
  return [
    { id: 'accounts', label: 'Conta e organizações', detail: accountDetail, checked: authenticated, goto: 'sys:accounts:#accountsManager' },
    { id: 'plans', label: 'Perfil e ambiente de IA', detail: profileDetail, checked: profileReady, goto: 'sys:plans:#claudeProfilesManager' },
    { id: 'automation', label: 'Política de automação', detail: 'Confira o comportamento de cada conta, limites e gates antes de usar. Este roteiro não ativa revisões.', checked: false, goto: 'sys:automation:#sys-automation' },
  ];
}
function setupHtml(state, selected) {
  return setupSteps(state).map(step => {
    const status = step.checked ? 'Verificado no último estado recebido. ' : 'A conferir. ';
    const rowClass = step.checked ? ' ok' : '';
    const chipClass = step.checked ? 'ok' : 'off';
    const label = step.checked ? 'Verificado' : 'A conferir';
    return `<li class="step${rowClass}"><span class="led" aria-hidden="true"></span><div>
      <div class="step-title"><button class="link-btn setup-step" type="button" data-setup-step="${step.id}" aria-pressed="${selected === step.id}">${esc(step.label)}</button><span class="chip ${chipClass}">${label}</span></div>
      <p class="step-detail">${status}${esc(step.detail)}</p></div><div class="step-act"><button class="btn sm" type="button" data-goto="${esc(step.goto)}">Abrir configuração</button></div></li>`;
  }).join('');
}
export { setupSteps, setupHtml };
