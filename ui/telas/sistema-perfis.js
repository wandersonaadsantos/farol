/* Farol · UI: perfis de assinatura Claude e o orçamento de cada perfil (Sistema). O
   orçamento não é assunto à parte: ele edita campos de dentro do MESMO perfil
   (budgetDaily, budgetByWeekday, budgetDates, budgetTotal, budgetSince), então é
   profundidade do perfil, não um terceiro tema. Contas do GitHub são outro estado
   (estado().accounts, não estado().config.claudeProfiles) e outro container
   (#accountsManager, não #claudeProfilesManager): moram em telas/sistema-contas.js. O
   único ponto de contato é cp-remove, que precisa limpar a referência ao perfil removido
   nas contas que a têm; por isso a única direção de import é DESTA tela PARA aquela. */

import { claudeProfilesHtml, genId, perfilTesteHtml, perfilProblemasHtml } from '../pure.js';
import { estado, ehWin } from './estado.js';
import { $, api, toast } from './infra.js';
import { rebuildAccounts } from './contas.js';
import { renderAccountsManager } from './sistema-contas.js';

// Gerenciador de perfis de assinatura Claude (Sistema): cada perfil é {id,label,dir}
// (login por assinatura) ou {id,label,kind:'apikey',apiKey,baseUrl} (chave de API).
// Perfil padrão global + perfis salvos, cada um com o e-mail logado (badge, via doctor).

function saveClaudeProfiles(profiles, defaultId) {
  estado().config.claudeProfiles = profiles;
  const patch = { claudeProfiles: profiles };
  // defaultId opcional: usado pela migração (btnClaudeMigrate), que precisa setar o
  // perfil recém-criado como o padrão global no MESMO patch (senão o perfil migrado
  // fica sem dono, ver achado da revisão final sobre legado invisível).
  if (defaultId !== undefined) { estado().config.claudeProfileId = defaultId; patch.claudeProfileId = defaultId; }
  api('/api/settings', patch).then(r => {
    if (r?.ok) toast('ok', '✓ Configurações salvas', 2000);
    else toast('error', 'Erro ao salvar configurações');
  });
}

/* Resultado do último teste de cada perfil, por id. Fica na tela, nunca na configuração:
   testar é um ato explícito e não grava nada (A2). Some quando o bloco é redesenhado por
   outra mudança, e é isso mesmo: o teste vale para o estado daquele instante. */
const testes = new Map();

function renderTestes() {
  for (const [id, dados] of testes) {
    const alvo = document.querySelector(`.cp-teste[data-teste="${CSS.escape(id)}"]`);
    if (alvo) alvo.innerHTML = perfilTesteHtml(dados);
  }
}

export function renderClaudeProfiles() {
  const box = $('#claudeProfilesManager'); if (!box) return;
  // guarda de foco: não reconstrói enquanto você digita num campo deste bloco
  if (document.activeElement && box.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName)) return;
  box.innerHTML = perfilProblemasHtml((estado().claudePerfis || {}).problemas)
    + claudeProfilesHtml({ config: estado().config, usage: estado().usage, doctor: estado().doctor, ehWin: ehWin() });
  renderTestes();
  // efeito de DOM, não de markup: o listener do seletor mostra de volta no modo Chave de API
  const hint = $('#cpAddHint'); if (hint) hint.hidden = true;
}

/* editor de perfis de assinatura Claude: adicionar / remover / editar / migrar / padrão global */
/* ---------- cliques do editor de orçamento ----------
   Separado do handler grande de cliques do gerenciador porque são cinco botões de
   um mesmo assunto; devolve true quando tratou, pra o handler original sair cedo. */

// escreve o mesmo valor num conjunto de dias da semana (atalho "dias úteis" e "fim
// de semana"). Sem valor base preenchido não faz nada e explica: copiar `undefined`
// pros sete dias apagaria a configuração em silêncio.
function espalhaTeto(id, dows) {
  const campo = document.querySelector(`.cp-budget-daily[data-id="${CSS.escape(id)}"]`);
  const v = (campo && campo.value.trim()) || '';
  if (v === '') { toast('info', 'Preencha o teto por dia antes de copiar pros dias.', 3500); return; }
  saveClaudeProfiles(mapProfile(id, p => {
    const porDia = { ...(p.budgetByWeekday || {}) };
    for (const d of dows) porDia[d] = Number(v);
    return { ...p, budgetByWeekday: porDia };
  }));
}

function adicionaDataDeTeto(id) {
  const dia = document.querySelector(`.cp-budget-date-new[data-id="${CSS.escape(id)}"]`);
  const val = document.querySelector(`.cp-budget-date-val[data-id="${CSS.escape(id)}"]`);
  const d = (dia && dia.value) || '';
  const v = (val && val.value.trim()) || '';
  if (!d || v === '') { toast('info', 'Escolha a data e o valor do teto desse dia.', 3500); return; }
  saveClaudeProfiles(mapProfile(id, p => ({ ...p, budgetDates: { ...(p.budgetDates || {}), [d]: Number(v) } })));
}

function removeDataDeTeto(id, dia) {
  saveClaudeProfiles(mapProfile(id, p => {
    const datas = { ...(p.budgetDates || {}) };
    delete datas[dia];
    return { ...p, budgetDates: datas };
  }));
}

// vazio APAGA a chave (o dia volta ao teto base), nunca grava 0: 0 é um teto
// válido que bloquearia o dia inteiro, e seria o oposto do que "limpar" quer dizer
function salvaTetoDoDia(id, dow, valor) {
  return saveClaudeProfiles(mapProfile(id, p => {
    const porDia = { ...(p.budgetByWeekday || {}) };
    if (valor === '') delete porDia[dow]; else porDia[dow] = Number(valor);
    return { ...p, budgetByWeekday: porDia };
  }));
}

function tratouOrcamento(t) {
  const id = t.dataset && t.dataset.id;
  if (!id) return false;
  // a sugestão só PREENCHE o campo; quem salva é o change do próprio input, e é
  // por isso que ela nunca passa a bloquear sozinha (decisão de 20/08/2026)
  if (t.classList.contains('cp-usar-sugerido')) {
    const campo = document.querySelector(`.cp-budget-daily[data-id="${CSS.escape(id)}"]`);
    if (campo) { campo.value = t.dataset.valor; campo.dispatchEvent(new Event('change', { bubbles: true })); }
    return true;
  }
  if (t.classList.contains('cp-budget-uteis')) { espalhaTeto(id, ['1', '2', '3', '4', '5']); return true; }
  if (t.classList.contains('cp-budget-fds')) { espalhaTeto(id, ['0', '6']); return true; }
  if (t.classList.contains('cp-budget-limpa-dow')) {
    saveClaudeProfiles(mapProfile(id, p => ({ ...p, budgetByWeekday: {} })));
    return true;
  }
  if (t.classList.contains('cp-budget-date-add')) { adicionaDataDeTeto(id); return true; }
  if (t.classList.contains('cp-budget-date-del')) { removeDataDeTeto(id, t.dataset.dia); return true; }
  return false;
}

$('#claudeProfilesManager').addEventListener('click', (e) => {
  const t = e.target;
  if (tratouOrcamento(t)) return;
  // seletor "Login por assinatura" / "Chave de API" no form de adicionar: troca os
  // campos visíveis, sem tocar em nenhum perfil já salvo.
  const seg = t.closest('#cpAddKind .seg-btn');
  if (seg) {
    $('#cpAddKind').querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b === seg));
    const isApiKey = seg.dataset.kind === 'apikey';
    const isOpenRouter = seg.dataset.kind === 'openrouter';
    const isCodex = seg.dataset.kind === 'codex';
    const usaChave = isApiKey || isOpenRouter;
    $('#cpAddDir').hidden = usaChave || isCodex;
    $('#cpAddApiKey').hidden = !usaChave;
    $('#cpAddBaseUrl').hidden = !usaChave;
    $('#cpAddHint').hidden = !isApiKey;
    const orHint = $('#cpAddOpenRouterHint');
    if (orHint) orHint.hidden = !isOpenRouter;
    $('#cpAddCodexHint').hidden = !isCodex;
    if (isOpenRouter) {
      $('#cpAddApiKey').placeholder = 'chave OpenRouter (sk-or-...)';
      $('#cpAddBaseUrl').placeholder = 'https://openrouter.ai/api';
      $('#cpAddBaseUrl').value = $('#cpAddBaseUrl').value || 'https://openrouter.ai/api';
    } else if (isApiKey) {
      $('#cpAddApiKey').placeholder = 'chave de API';
      $('#cpAddBaseUrl').placeholder = 'URL base (opcional)';
    }
    return;
  }
  // mostrar/ocultar a chave de um perfil já salvo (não é validação nem salvamento, só
  // alterna o type do input entre password e text).
  if (t.classList.contains('cp-toggle-key')) {
    const input = e.currentTarget.querySelector(`.cp-apikey[data-id="${CSS.escape(t.dataset.id)}"]`);
    if (input) input.type = input.type === 'password' ? 'text' : 'password';
    return;
  }
  if (t.id === 'btnCpAdd') {
    const label = ($('#cpAddLabel').value || '').trim();
    const kindBtn = $('#cpAddKind .seg-btn.active');
    const isApiKey = kindBtn && kindBtn.dataset.kind === 'apikey';
    const isOpenRouter = kindBtn && kindBtn.dataset.kind === 'openrouter';
    const isCodex = kindBtn && kindBtn.dataset.kind === 'codex';
    if (isCodex) {
      if (!label) return toast('error', 'Preencha o nome do perfil.', 3000);
      const profiles = [...(estado().config.claudeProfiles || []), { id: genId(), label, kind: 'codex' }];
      $('#cpAddLabel').value = '';
      saveClaudeProfiles(profiles);
      return;
    }
    if (isApiKey || isOpenRouter) {
      const apiKey = ($('#cpAddApiKey').value || '').trim();
      const baseUrl = ($('#cpAddBaseUrl').value || '').trim();
      if (!label || !apiKey) return toast('error', 'Preencha nome e chave.', 3000);
      if (/["\r\n]/.test(apiKey.replace(/^"(.*)"$/s, '$1').trim()) || /["\r\n]/.test(baseUrl.replace(/^"(.*)"$/s, '$1').trim())) {
        return toast('error', 'Chave ou URL base com aspas ou quebra de linha no meio (não em volta) não pode ser usada.', 4500);
      }
      const kind = isOpenRouter ? 'openrouter' : 'apikey';
      const profiles = [...(estado().config.claudeProfiles || []), { id: genId(), label, kind, apiKey, baseUrl }];
      $('#cpAddLabel').value = ''; $('#cpAddApiKey').value = ''; $('#cpAddBaseUrl').value = '';
      saveClaudeProfiles(profiles);
      return;
    }
    const dir = ($('#cpAddDir').value || '').trim();
    if (!label || !dir) return toast('error', 'Preencha nome e diretório do perfil.', 3000);
    if (/["\r\n]/.test(dir.replace(/^"(.*)"$/s, '$1').trim())) {
      return toast('error', 'Esse caminho tem aspas ou quebra de linha no meio (não em volta), não pode ser usado. Confira se colou o caminho certo.', 4500);
    }
    const profiles = [...(estado().config.claudeProfiles || []), { id: genId(), label, dir }];
    $('#cpAddLabel').value = ''; $('#cpAddDir').value = '';
    saveClaudeProfiles(profiles);
    return;
  }
  if (t.classList.contains('cp-remove')) {
    const id = t.dataset.id;
    const profiles = (estado().config.claudeProfiles || []).filter(p => p.id !== id);
    // UM PATCH só (claudeProfiles + claudeProfileId). As contas não viajam: PATCHes
    // concorrentes não garantiam ordem de chegada, e o array accounts inteiro chegando por
    // último restaurava a referência órfã (achado de auditoria adversarial). Desde
    // 25/09/2026 quem limpa a conta órfã é o servidor, na mesma gravação dos perfis.
    const patch = { claudeProfiles: profiles };
    estado().config.claudeProfiles = profiles;
    if (estado().config.claudeProfileId === id) {
      estado().config.claudeProfileId = '';
      patch.claudeProfileId = '';
    }
    // a conta que apontava para o perfil apagado volta ao padrão: o SERVIDOR limpa, sobre a
    // config atual (lib/engine/contas-config.js); aqui só o reflexo imediato na tela
    const accounts = (estado().accounts || []);
    if (accounts.some(a => a.claudeProfileId === id)) {
      estado().accounts = accounts.map(a => a.claudeProfileId === id ? { ...a, claudeProfileId: undefined } : a);
      rebuildAccounts();
    }
    renderClaudeProfiles(); renderAccountsManager();
    api('/api/settings', patch);
    return;
  }
  // A2: testar é explícito, roda o Claude Code naquele perfil e não altera nada
  if (t.classList.contains('cp-testar')) {
    const id = t.dataset.id || '';
    testes.set(id, { estado: 'testando' });
    renderTestes();
    api('/api/claude/profile-test', { profileId: id }).then((r) => {
      if (r && r.ok) testes.set(id, { estado: 'pronto', perfil: r.perfil, em: Date.now() });
      else testes.set(id, { estado: 'erro', code: (r && r.code) || '', motivo: (r && r.motivo) || 'não deu para testar este perfil agora' });
      renderTestes();
    });
    return;
  }
  if (t.classList.contains('cp-login')) {
    const id = t.dataset.id || '';
    api('/api/claude-login', { profileId: id });
    toast('ok', 'Abrindo sessão de terminal pra login. Rode /login lá, se pedir, e pode fechar quando terminar.', 4500);
    return;
  }
  // adoção do legado (A2): quem grava é o engine, e só com confirmação literal. A tela
  // não monta o perfil por fora, senão seriam duas regras de "o que é o perfil legado".
  if (t.id === 'btnClaudeMigrate') {
    const label = ($('#claudeMigrateLabel').value || '').trim() || 'Perfil atual';
    api('/api/claude/profile-adopt', { confirmar: true, label }).then((r) => {
      if (r && r.escreveu) {
        toast('ok', 'Perfil criado e escolhido como padrão do Farol.', 3500);
        return;
      }
      toast('error', (r && r.code === 'ja-tem-perfis') ? 'Já existem perfis salvos.' : 'Não deu para criar o perfil agora.', 4000);
    });
    return;
  }
});
// aplica uma transformação num perfil e devolve a lista inteira, que é o que o
// PATCH /api/settings espera (claudeProfiles é substituído por completo). Existe
// pra os handlers de orçamento não repetirem o mesmo .map cinco vezes.
function mapProfile(id, fn) {
  return (estado().config.claudeProfiles || []).map(p => (p.id === id ? fn(p) : p));
}

$('#claudeProfilesManager').addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'claudeProfileDefault') {
    estado().config.claudeProfileId = t.value;
    const patch = api('/api/settings', { claudeProfileId: t.value });
    // tira o foco do select: renderClaudeProfiles() tem uma guarda que pula o re-render
    // enquanto INPUT/SELECT do gerenciador estiver focado (pra não atrapalhar quem está
    // digitando), e trocar de opção não tira o foco sozinho. Sem o blur, o botão "Abrir
    // sessão de login" ficava com o data-id do perfil ANTERIOR até o próximo re-render
    // manual (achado de bug real). O blur libera o próximo re-render legítimo (o push de
    // 'settings' via SSE que já acontece depois de qualquer PATCH em /api/settings).
    t.blur();
    return patch;
  }
  // teto por dia da semana: mesmo caminho dos outros campos, só que o valor mora
  // num mapa em vez de num campo solto. Vazio APAGA a chave (o dia volta ao teto
  // base), nunca grava 0, porque 0 é um teto válido que bloquearia o dia inteiro.
  if (t.classList.contains('cp-budget-dow')) return salvaTetoDoDia(t.dataset.id, t.dataset.dow, t.value.trim());
  const camposEditaveis = ['cp-label', 'cp-dir', 'cp-apikey', 'cp-baseurl', 'cp-budget-daily', 'cp-budget-total', 'cp-budget-since'];
  if (camposEditaveis.some(cls => t.classList.contains(cls))) {
    const id = t.dataset.id;
    if ((t.classList.contains('cp-dir') || t.classList.contains('cp-apikey') || t.classList.contains('cp-baseurl'))
        && /["\r\n]/.test(t.value.replace(/^"(.*)"$/s, '$1').trim())) {
      toast('error', 'Esse valor tem aspas ou quebra de linha no meio, não pode ser usado.', 4500);
      return;
    }
    const profiles = (estado().config.claudeProfiles || []).map(p => {
      if (p.id !== id) return p;
      const next = { ...p };
      if (t.classList.contains('cp-label')) next.label = t.value.trim() || p.label;
      if (t.classList.contains('cp-dir')) next.dir = t.value.trim();
      if (t.classList.contains('cp-apikey')) next.apiKey = t.value.trim();
      if (t.classList.contains('cp-baseurl')) next.baseUrl = t.value.trim();
      if (t.classList.contains('cp-budget-daily')) {
        const v = t.value.trim();
        if (v === '') delete next.budgetDaily; else next.budgetDaily = Number(v);
      }
      if (t.classList.contains('cp-budget-total')) {
        const v = t.value.trim();
        if (v === '') delete next.budgetTotal; else next.budgetTotal = Number(v);
      }
      if (t.classList.contains('cp-budget-since')) {
        const v = t.value.trim();
        if (v === '') delete next.budgetSince; else next.budgetSince = v;
      }
      return next;
    });
    saveClaudeProfiles(profiles);
  }
});
