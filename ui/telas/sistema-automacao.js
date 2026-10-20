/* Farol · UI: automação (Sistema > Automação): provedor, modelo e esforço. */

import { opcoesDeModeloHtml, selecaoAceitaEsforco } from '../pure.js';
import { estado } from './estado.js';
import { $, marcarSeg } from './infra.js';

let AUTOMATION_PROVIDER = null;

function providerInicial(c) {
  const profiles = Array.isArray(c.claudeProfiles) ? c.claudeProfiles : [];
  const padrao = profiles.find(p => p.id === c.claudeProfileId);
  const kind = padrao && padrao.kind;
  return kind === 'codex' || kind === 'agy' ? kind : 'claude';
}

// Redesenha as opções só quando o catálogo muda: o snapshot chega a cada poucos segundos,
// e recriar o <select> a cada push fecharia a lista aberta na mão de quem está escolhendo.
function preencherSeletor(select, lista) {
  if (!select) return;
  const html = opcoesDeModeloHtml(lista);
  if (select.dataset.catalogo === html) return;
  select.innerHTML = html;
  select.dataset.catalogo = html;
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
  const agy = AUTOMATION_PROVIDER === 'agy';
  const botoes = [...document.querySelectorAll('#setAutomationProvider .seg-btn')];
  marcarSeg(botoes, b => b.dataset.provider === AUTOMATION_PROVIDER);
  $('#setReviewModel').hidden = codex || agy;
  $('#setCodexReviewModel').hidden = !codex;
  $('#setAgyReviewModel').hidden = !agy;
  $('#setReviewEffort').hidden = codex || agy;
  $('#setCodexReviewEffort').hidden = !codex;
  $('#setAgyReviewEffort').hidden = !agy;
  renderAgy(c);

  const claudeModel = String(c.reviewModel || '');
  const codexModel = String(c.codexReviewModel || '');
  // as seleções vêm do catálogo do engine (lib/modelos.js), não de uma lista fixa no HTML
  const modelos = estado().modelos || {};
  preencherSeletor($('#setReviewModel'), modelos.claude);
  preencherSeletor($('#setCodexReviewModel'), modelos.codex);
  addCustomOption($('#setReviewModel'), claudeModel);
  addCustomOption($('#setCodexReviewModel'), codexModel);
  $('#setReviewModel').value = claudeModel;
  $('#setCodexReviewModel').value = codexModel;
  renderEffortBox($('#setReviewEffort'), String(c.reviewEffort || ''));
  renderEffortBox($('#setCodexReviewEffort'), String(c.codexReviewEffort || ''));

  // quem aceita esforço é o catálogo que diz, a mesma resposta que o engine usa na flag
  const selecao = (modelos.claude || []).find(s => s.valor === claudeModel) || null;
  const semEsforco = !selecaoAceitaEsforco(modelos.claude, claudeModel);
  $('#setReviewEffort').classList.toggle('disabled', semEsforco);
  if (agy) {
    $('#reviewModelHint').textContent = 'Modelo usado pelo Antigravity nas revisões. O recomendado é o Gemini Flash High: na medição, foi o único que repetiu o veredito certo, sem o subagente. Claude e GPT pela cota do Google usam outro balde e custam bem mais por revisão.';
    $('#effortHint').textContent = 'No Gemini o nível de raciocínio já está no nome do modelo, e o Farol não passa a flag. O esforço daqui só vale para Claude e GPT.';
  } else if (codex) {
    $('#reviewModelHint').textContent = 'Modelo usado pelo Codex nas revisões, pushback, autoanálise e ferramentas. O padrão acompanha a seleção do CLI e costuma ser a opção mais compatível com o teu plano.';
    $('#effortHint').textContent = 'Quanto o Codex raciocina nas sessões autônomas. O CLI aceita minimal, low, medium, high e xhigh; o último depende do modelo.';
  } else {
    // sem nome de modelo escrito aqui: cada opção já diz o que é, e o Auto diz quais usa
    $('#reviewModelHint').textContent = 'Modelo usado pelo Claude nas revisões, pushback, autoanálise e ferramentas. O padrão herda a tua assinatura; o Auto revisa todo PR com o Opus e só sobe o raciocínio para xhigh em repositório crítico, caminho sensível ou PR muito grande, só na revisão headless. Cada opção aponta sempre para a versão mais nova daquela família que o teu Claude Code conhece.';
    let effortHint = 'Quanto o Claude pensa nas sessões autônomas. Mais esforço aumenta profundidade e consumo do limite.';
    if (selecao && selecao.auto) {
      effortHint = 'No modo Auto a revisão usa o Opus no raciocínio padrão dele e sobe para xhigh quando o contexto do PR pede; o nível fixo desta seção e o modo rápido não entram.';
    } else if (semEsforco) {
      effortHint = `O ${(selecao && selecao.nome) || 'modelo escolhido'} não aceita nível de esforço, então o Farol não passa a flag enquanto ele estiver escolhido.`;
    }
    $('#effortHint').textContent = effortHint;
  }
}

// O par do Antigravity (lib/modelos.js, catálogo `agy`): vazio na config roda no padrão medido.
function renderAgy(c) {
  const modelo = String(c.agyReviewModel || '');
  preencherSeletor($('#setAgyReviewModel'), (estado().modelos || {}).agy);
  addCustomOption($('#setAgyReviewModel'), modelo);
  $('#setAgyReviewModel').value = modelo;
  renderEffortBox($('#setAgyReviewEffort'), String(c.agyReviewEffort || ''));
}

$('#setAutomationProvider').addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  AUTOMATION_PROVIDER = btn.dataset.provider;
  renderAutomationSettings((estado() && estado().config) || {});
});

export { renderAutomationSettings };
