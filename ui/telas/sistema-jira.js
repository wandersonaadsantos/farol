/* Farol · UI: sites do Jira e credencial (Sistema > Conexões).

   Espelha o gerenciador de perfis do Claude (telas/sistema-perfis.js): estado().jiraSites
   (a lista MASCARADA que o snapshot manda, com hasCredential) é a fonte de leitura E de
   edição; salvar manda ela de volta em PATCH /api/settings, e o servidor descarta o campo
   hasCredential ao sanear (parseJiraSites só lê os campos que conhece). O id nasce aqui
   com genId(), nunca digitado: mantém o formato que a allowlist do servidor exige e
   evita a tela oferecer um campo de id livre. A credencial (e-mail e token) NUNCA entra em
   estado: os dois campos são lidos direto do DOM na hora do clique e a chamada zera o
   formulário depois. */

import { esc, jiraBaseUrlProblema, jiraPrefixosProblema, genId, settingsIgnoradasTexto } from '../pure.js';
import { estado } from './estado.js';
import { $, api, toast } from './infra.js';

const jiraLista = (v) => String(v || '').split(',').map(x => x.trim()).filter(Boolean);
/* Recusa ANTES de mandar: o servidor não corrige nem devolve erro por campo (ver
   jiraBaseUrlProblema em pure.js). Na edição in loco o campo recusado volta ao
   valor salvo, senão a tela mostraria um texto que o site já não tem. */
function jiraEdicaoProblema(t) {
  if (t.classList.contains('js-baseurl')) return jiraBaseUrlProblema(t.value);
  if (t.classList.contains('js-projectkeys')) return jiraPrefixosProblema(jiraLista(t.value));
  return '';
}
function jiraCampoSalvo(site, t) {
  if (t.classList.contains('js-baseurl')) return site.baseUrl;
  return (site.projectKeys || []).join(', ');
}
function saveJiraSites(sites) {
  estado().jiraSites = sites;
  renderJiraSites();
  api('/api/settings', { jiraSites: sites }).then(r => {
    const recusa = settingsIgnoradasTexto(r);
    if (recusa) {
      toast('error', recusa, 6000);
      return;
    }
    toast('ok', '✓ Configurações salvas', 2000);
  });
}
function jiraSelo(s) {
  if (s.hasCredential) {
    return '<span class="jira-chip"><svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5 6.5 11.5 12.5 5"/></svg>credencial cadastrada</span>';
  }
  return '<span class="jira-chip falta"><svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M8 4.5v4.2M8 11.2v.5"/></svg>falta a credencial</span>';
}

/* O mapeamento org do GitHub -> site do Jira e o coracao do recurso e estava implicito
   em dois campos de texto. Aqui ele vira uma frase legivel no topo do cartao. Org ou
   URL faltando aparece como lacuna marcada, nunca como frase pela metade. */
function jiraMapaHtml(s) {
  const orgs = (s.owners || []).filter(Boolean);
  const esquerda = orgs.length ? `<code>${esc(orgs.join(', '))}</code>` : '<span class="vago">sem org</span>';
  const host = String(s.baseUrl || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const direita = host ? `<code>${esc(host)}</code>` : '<span class="vago">sem URL</span>';
  return `<span class="jira-mapa">${esquerda} <span class="seta">&rarr;</span> ${direita}</span>`;
}

function jiraCredHtml(s) {
  const cabecalho = `<div class="jira-cred-topo">
      <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3.5" y="7" width="9" height="6" rx="1.5"/><path d="M5.8 7V5.4a2.2 2.2 0 0 1 4.4 0V7"/></svg>
      <span class="jira-cred-titulo">Credencial</span>
      <span class="jira-cred-onde">${s.hasCredential ? 'jira-credentials.json' : 'token criado em id.atlassian.com'}</span>
    </div>`;
  if (s.hasCredential) {
    return `<div class="jira-cred">${cabecalho}
      <div class="jira-cred-guardada">
        <span>Guardada fora do <code>config.json</code>, com permissão restrita. O token não volta a aparecer.</span>
        <span class="espaco"></span>
        <button class="btn sm danger-ghost js-cred-remove" data-id="${esc(s.id)}">Remover credencial</button>
      </div>
    </div>`;
  }
  return `<div class="jira-cred">${cabecalho}
    <div class="jira-cred-corpo">
      <span class="jira-campo">
        <label for="jcEmail-${esc(s.id)}">E-mail da conta Atlassian</label>
        <input id="jcEmail-${esc(s.id)}" class="js-cred-email" data-id="${esc(s.id)}" placeholder="voce@empresa.com" spellcheck="false" autocomplete="off">
      </span>
      <span class="jira-campo">
        <label for="jcToken-${esc(s.id)}">Token de API</label>
        <input id="jcToken-${esc(s.id)}" class="js-cred-token" type="password" data-id="${esc(s.id)}" placeholder="token de API" spellcheck="false" autocomplete="off">
      </span>
      <button class="btn sm js-cred-save" data-id="${esc(s.id)}">Cadastrar credencial</button>
    </div>
    <p class="jira-cred-nota">O token nunca passa por linha de comando: o arquivo de configuração do MCP carrega só o id do site, e quem lê o segredo do disco é o servidor do Farol.</p>
  </div>`;
}

function jiraSiteCardHtml(s) {
  return `<div class="card jira-site${s.hasCredential ? '' : ' sem-cred'}" data-site="${esc(s.id)}">
    <div class="jira-topo">
      <input class="jira-nome js-label" data-id="${esc(s.id)}" value="${esc(s.label)}" placeholder="rótulo" spellcheck="false" aria-label="Rótulo do site">
      ${jiraMapaHtml(s)}
      <span class="jira-espaco"></span>
      ${jiraSelo(s)}
    </div>
    <div class="jira-corpo">
      <span class="jira-campo">
        <label for="jsUrl-${esc(s.id)}">URL do Jira</label>
        <input id="jsUrl-${esc(s.id)}" class="js-baseurl" data-id="${esc(s.id)}" value="${esc(s.baseUrl)}" placeholder="https://empresa.atlassian.net" spellcheck="false">
      </span>
      <span class="jira-campo">
        <label for="jsOwners-${esc(s.id)}">Orgs do GitHub</label>
        <input id="jsOwners-${esc(s.id)}" class="js-owners" data-id="${esc(s.id)}" value="${esc((s.owners || []).join(', '))}" placeholder="org1, org2" spellcheck="false">
        <span class="dica">quem é dona do PR decide o site</span>
      </span>
      <span class="jira-campo">
        <label for="jsKeys-${esc(s.id)}">Prefixos de projeto</label>
        <input id="jsKeys-${esc(s.id)}" class="js-projectkeys" data-id="${esc(s.id)}" value="${esc((s.projectKeys || []).join(', '))}" placeholder="ABC, XYZ" spellcheck="false">
        <span class="dica">é por onde a chave do card é reconhecida</span>
      </span>
    </div>
    ${jiraCredHtml(s)}
    <div class="jira-rodape">
      <button class="btn sm js-site-test" data-id="${esc(s.id)}">
        <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 8a5.5 5.5 0 1 1-1.9-4.2"/><path d="M13.7 2.5v3.2h-3.2"/></svg>
        Testar leitura
      </button>
      <span class="jira-teste" data-teste="${esc(s.id)}"></span>
      <span class="espaco"></span>
      <button class="btn sm danger-ghost js-site-remove" data-id="${esc(s.id)}">Remover site</button>
    </div>
  </div>`;
}

function jiraSiteAddFormHtml() {
  return `<div class="card jira-add">
    <div class="jira-add-titulo">Adicionar site</div>
    <div class="jira-add-grade">
      <span class="jira-campo">
        <label for="jsAddLabel">Rótulo</label>
        <input id="jsAddLabel" placeholder="Jira Acme" spellcheck="false">
      </span>
      <span class="jira-campo">
        <label for="jsAddBaseUrl">URL do Jira</label>
        <input id="jsAddBaseUrl" placeholder="https://acme.atlassian.net" spellcheck="false">
      </span>
      <span class="jira-campo">
        <label for="jsAddOwners">Orgs do GitHub</label>
        <input id="jsAddOwners" placeholder="acme, acme-labs" spellcheck="false">
      </span>
      <span class="jira-campo">
        <label for="jsAddProjectKeys">Prefixos de projeto</label>
        <input id="jsAddProjectKeys" placeholder="ACME, OPS" spellcheck="false">
      </span>
      <button class="btn js-site-add" id="btnJiraSiteAdd">Adicionar</button>
    </div>
    <p class="jira-add-hint">Rótulo, URL e ao menos um prefixo são obrigatórios. A credencial se cadastra depois, dentro do card do site já salvo.</p>
  </div>`;
}

export function renderJiraSites() {
  const box = $('#jiraSitesManager'); if (!box) return;
  if (document.activeElement && box.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName)) return;
  const sites = estado().jiraSites || [];
  const rows = sites.map(jiraSiteCardHtml).join('');
  box.innerHTML = rows + jiraSiteAddFormHtml();
}
$('#jiraSitesManager').addEventListener('click', (e) => {
  const t = e.target;
  if (t.id === 'btnJiraSiteAdd') {
    const label = ($('#jsAddLabel').value || '').trim();
    const baseUrl = ($('#jsAddBaseUrl').value || '').trim();
    const owners = jiraLista($('#jsAddOwners').value);
    const projectKeys = jiraLista($('#jsAddProjectKeys').value);
    if (!label || !baseUrl) return toast('error', 'Preencha rótulo e URL base.', 3000);
    const problema = jiraBaseUrlProblema(baseUrl) || jiraPrefixosProblema(projectKeys);
    if (problema) return toast('error', problema, 6000);
    const site = { id: genId(), label, baseUrl, owners, projectKeys };
    $('#jsAddLabel').value = ''; $('#jsAddBaseUrl').value = ''; $('#jsAddOwners').value = ''; $('#jsAddProjectKeys').value = '';
    saveJiraSites([...(estado().jiraSites || []), site]);
    return;
  }
  if (t.classList.contains('js-site-remove')) {
    // a credencial mora FORA do config.json: tirar o site da lista sem isto
    // deixaria e-mail e token órfãos no arquivo de credenciais pra sempre
    const id = t.dataset.id;
    api('/api/jira/credential/remove', { siteId: id }).then(() => {
      saveJiraSites((estado().jiraSites || []).filter(s => s.id !== id));
    });
    return;
  }
  if (t.classList.contains('js-cred-save')) {
    const card = t.closest('.jira-site');
    const email = (card.querySelector('.js-cred-email').value || '').trim();
    const token = (card.querySelector('.js-cred-token').value || '').trim();
    if (!email || !token) return toast('error', 'Preencha e-mail e token.', 3000);
    api('/api/jira/credential', { siteId: t.dataset.id, email, token }).then(r => {
      card.querySelector('.js-cred-email').value = ''; card.querySelector('.js-cred-token').value = '';
      if (r && r.ok) toast('ok', 'Credencial salva.', 2500);
      else toast('error', 'Não deu pra salvar a credencial.');
    });
    return;
  }
  if (t.classList.contains('js-cred-remove')) {
    api('/api/jira/credential/remove', { siteId: t.dataset.id }).then(r => {
      if (r && r.ok) toast('ok', 'Credencial removida.', 2500);
      else toast('error', 'Não deu pra remover a credencial.');
    });
    return;
  }
  // Testar leitura: prova o site AGORA, sem esperar o próximo PR. O resultado fica na
  // linha ao lado do botão (e não só num toast que some), porque é estado do site.
  const btnTeste = t.closest('.js-site-test');
  if (btnTeste) {
    const id = btnTeste.dataset.id;
    const linha = $(`.jira-teste[data-teste="${id}"]`);
    btnTeste.disabled = true;
    if (linha) { linha.className = 'jira-teste'; linha.textContent = 'testando...'; }
    api('/api/jira/test', { siteId: id }).then(r => {
      btnTeste.disabled = false;
      if (!linha) return;
      if (!r) { linha.className = 'jira-teste ruim'; linha.textContent = 'o Farol não respondeu ao teste'; return; }
      if (r.ok) {
        linha.className = 'jira-teste ok';
        linha.textContent = r.quem ? `respondeu como ${r.quem}` : 'o Jira respondeu, credencial válida';
        return;
      }
      linha.className = 'jira-teste ruim';
      linha.textContent = r.motivo || 'o teste falhou';
    });
    return;
  }
});
$('#jiraSitesManager').addEventListener('change', (e) => {
  const t = e.target;
  const campos = ['js-label', 'js-baseurl', 'js-owners', 'js-projectkeys'];
  if (!campos.some(cls => t.classList.contains(cls))) return;
  const id = t.dataset.id;
  const atual = (estado().jiraSites || []).find(s => s.id === id);
  const problema = jiraEdicaoProblema(t);
  if (problema) {
    toast('error', problema, 6000);
    t.value = atual ? jiraCampoSalvo(atual, t) : '';
    return;
  }
  const sites = (estado().jiraSites || []).map(s => {
    if (s.id !== id) return s;
    const next = { ...s };
    if (t.classList.contains('js-label')) next.label = t.value.trim() || s.label;
    if (t.classList.contains('js-baseurl')) next.baseUrl = t.value.trim();
    if (t.classList.contains('js-owners')) next.owners = jiraLista(t.value);
    if (t.classList.contains('js-projectkeys')) next.projectKeys = jiraLista(t.value);
    return next;
  });
  saveJiraSites(sites);
});
