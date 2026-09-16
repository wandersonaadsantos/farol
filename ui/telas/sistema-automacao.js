/* Farol · UI: automação (Sistema > Automação): provedor, modelo e esforço. */

import { estado } from './estado.js';
import { $, marcarSeg } from './infra.js';

let AUTOMATION_PROVIDER = null;

function providerInicial(c) {
  const profiles = Array.isArray(c.claudeProfiles) ? c.claudeProfiles : [];
  const padrao = profiles.find(p => p.id === c.claudeProfileId);
  return padrao && padrao.kind === 'codex' ? 'codex' : 'claude';
}

function addCustomOption(select, value) {
  if (!value || !select || !select.options) return;
  if (Array.from(select.options).some(o => o.value === value)) return;
  const opt = document.createElement('option');
  opt.value = value;
  opt.textContent = `${value} (config.json)`;
  select.appendChild(opt);
}

/* Cartões de esforço: marca o que está salvo e explica o estado. Valor desconhecido
   cai no cartão do padrão, em vez de deixar nenhum marcado. */
function renderEffortBox(box, eff) {
  if (!box) return;
  const alvo = box.querySelector(`input[value="${CSS.escape(eff)}"]`) || box.querySelector('input[value=""]');
  if (alvo) alvo.checked = true;
}

function renderAutomationSettings(c) {
  if (!AUTOMATION_PROVIDER) AUTOMATION_PROVIDER = providerInicial(c);
  const codex = AUTOMATION_PROVIDER === 'codex';
  const botoes = [...document.querySelectorAll('#setAutomationProvider .seg-btn')];
  marcarSeg(botoes, b => b.dataset.provider === AUTOMATION_PROVIDER);
  $('#setReviewModel').hidden = codex;
  $('#setCodexReviewModel').hidden = !codex;
  $('#setReviewEffort').hidden = codex;
  $('#setCodexReviewEffort').hidden = !codex;

  const claudeModel = String(c.reviewModel || '');
  const codexModel = String(c.codexReviewModel || '');
  addCustomOption($('#setReviewModel'), claudeModel);
  addCustomOption($('#setCodexReviewModel'), codexModel);
  $('#setReviewModel').value = claudeModel;
  $('#setCodexReviewModel').value = codexModel;
  renderEffortBox($('#setReviewEffort'), String(c.reviewEffort || ''));
  renderEffortBox($('#setCodexReviewEffort'), String(c.codexReviewEffort || ''));

  const semEsforco = claudeModel === 'haiku' || claudeModel === 'auto';
  $('#setReviewEffort').classList.toggle('disabled', semEsforco);
  if (codex) {
    $('#reviewModelHint').textContent = 'Modelo usado pelo Codex nas revisões, pushback, autoanálise e ferramentas. O padrão acompanha a seleção do CLI e costuma ser a opção mais compatível com o teu plano.';
    $('#effortHint').textContent = 'Quanto o Codex raciocina nas sessões autônomas. O CLI aceita minimal, low, medium, high e xhigh; o último depende do modelo.';
  } else {
    $('#reviewModelHint').textContent = 'Modelo usado pelo Claude nas revisões, pushback, autoanálise e ferramentas. O padrão herda a tua assinatura; Auto (custo-benefício) escolhe Haiku ou Sonnet pelo tamanho do PR só na revisão headless; Sonnet e Haiku poupam o limite do plano.';
    let effortHint = 'Quanto o Claude pensa nas sessões autônomas. Mais esforço aumenta profundidade e consumo do limite.';
    if (claudeModel === 'haiku') {
      effortHint = 'O Haiku não aceita nível de esforço, então o Farol não passa a flag enquanto ele estiver escolhido.';
    } else if (claudeModel === 'auto') {
      effortHint = 'No modo Auto o Farol escolhe modelo e esforço pelo tamanho do PR; o nível fixo desta seção não entra.';
    }
    $('#effortHint').textContent = effortHint;
  }
}

$('#setAutomationProvider').addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  AUTOMATION_PROVIDER = btn.dataset.provider;
  renderAutomationSettings((estado() && estado().config) || {});
});

export { renderAutomationSettings };
