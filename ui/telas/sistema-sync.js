/* Farol · UI: Sistema > Sincronização entre dispositivos.

   O HTML todo sai de funções puras (ui/pure.js, testadas em test/ui-pure-sync.test.js);
   aqui fica só o que toca o DOM e a rede. O padrão é o do Jira (telas/sistema-jira.js): um
   container que a seção inteira reescreve, com delegação de evento no container, porque os
   elementos nascem e morrem a cada render e um listener por botão vazaria.

   A senha é lida do DOM no instante do clique, numa const local, e some com o re-render:
   ela nunca entra no estado nem em nada que o snapshot carregue. */

import { esc, syncSecaoHtml, syncCfgComGeral, settingsIgnoradasTexto } from '../pure.js';
import { estado } from './estado.js';
import { $, api, toast, confirmModal } from './infra.js';

function syncCfgAtual() {
  return (estado() && estado().config && estado().config.sync) || {};
}

/* Salva o objeto INTEIRO de sync. Mandar só o campo alterado faria o engine receber uma
   config parcial e apagar o resto, que é o oposto do que a tela mostra. */
function saveSync(sync, aoSalvar) {
  if (!estado()) return;
  estado().config = { ...estado().config, sync };
  renderSync();
  api('/api/settings', { sync }).then(r => {
    const recusa = settingsIgnoradasTexto(r);
    if (recusa) {
      toast('error', recusa, 6000);
      return;
    }
    // o servidor devolve a config JÁ saneada: é ela que diz o que de fato ficou gravado
    if (typeof aoSalvar === 'function' && r && r.sync) { aoSalvar(r); return; }
    toast('ok', '✓ Configurações salvas', 2000);
  });
}

/* O que foi digitado no login do Firebase, entre uma repintura e a próxima. Vive só em
   memória da tela: nada daqui vai pro engine sem clique, e nada vai pro disco nunca. É
   zerado no sucesso do login e ao sair do aparelho, porque aí a senha já não serve pra
   nada. Ver syncContaHtml (ui/pure.js) pro porquê de a senha sobreviver à recusa. */
function syncRascunhoVazio() { return { email: '', senha: '', senhaVisivel: false }; }

let syncRascunho = syncRascunhoVazio();

function syncRascunhoDoDom() {
  const email = $('#syncEmail');
  const senha = $('#syncSenha');
  if (email) syncRascunho.email = email.value || '';
  if (senha) syncRascunho.senha = senha.value || '';
  return syncRascunho;
}

export function renderSync() {
  const box = $('#syncManager');
  if (!box) return;
  // Mesma guarda do renderJiraSites: o estado chega por push a cada ciclo, e repintar
  // por baixo de quem digita apaga e-mail, senha ou URL no meio da frase. Checkbox fica
  // FORA da guarda de propósito: o interruptor precisa repintar a seção no mesmo clique.
  const foco = document.activeElement;
  if (foco && box.contains(foco) && /INPUT|SELECT/.test(foco.tagName) && foco.type !== 'checkbox') return;
  // o rascunho sai do DOM ANTES de reescrevê-lo: a guarda de foco acima não cobre quem
  // clicou em Entrar (o foco está no botão), e era por ali que o e-mail se perdia
  syncRascunhoDoDom();
  box.innerHTML = syncSecaoHtml((estado() && estado().sync) || {}, syncCfgAtual(), syncRascunho);
}

// Os três interruptores. A regra da chave geral mora em syncCfgComGeral (ui/pure.js),
// que é pura e testada: o comentário aqui já prometeu o arrasto das sub-chaves antes de
// o código fazê-lo, e promessa em prosa não se verifica sozinha.
function syncToggle(id, valor) {
  const c = syncCfgAtual();
  if (id === 'setSyncEnabled') {
    saveSync(syncCfgComGeral(c, valor));
    return;
  }
  const chave = id === 'setSyncCoordination' ? 'coordination' : 'consolidation';
  saveSync({ ...c, [chave]: { ...(c[chave] || {}), enabled: valor } });
}

// A URL do banco passa por allowlist de host no servidor (lib/sync/config.js), e valor
// recusado faz o saneador MANTER o anterior. Sem este aviso, o campo simplesmente
// voltava ao valor velho depois do salvamento: da tela, é indistinguível de "não salvou"
// ou de bug. Quem valida continua sendo o servidor, que é a fonte única; aqui só se
// compara o que foi pedido com o que ficou.
function syncCampoSalvar(id, valor) {
  const c = syncCfgAtual();
  const campo = { syncApiKey: 'apiKey', syncDatabaseUrl: 'databaseUrl', syncDeviceName: 'deviceName' }[id];
  if (!campo || String(c[campo] || '') === valor) return;
  saveSync({ ...c, [campo]: valor }, (r) => {
    const ficou = String(((r || {}).sync || {})[campo] || '');
    if (ficou === String(valor)) return;
    if (campo === 'databaseUrl') toast('error', 'Endereço do banco recusado: use a URL do Realtime Database do seu projeto (…firebaseio.com ou …firebasedatabase.app). O valor anterior foi mantido.', 8000);
    else toast('error', 'Valor recusado pelo servidor; o anterior foi mantido.', 6000);
  });
}

async function syncFazerLogin() {
  const email = ($('#syncEmail') || {}).value || '';
  const senha = ($('#syncSenha') || {}).value || '';
  if (!email.trim() || !senha) { toast('error', 'Informe o e-mail e a senha do Firebase.', 4000); return; }
  const r = await api('/api/sync/login', { email: email.trim(), password: senha });
  // Só o SUCESSO limpa. Na recusa o que foi digitado fica: quase sempre falta uma caixa
  // marcada no console do Firebase, e obrigar a redigitar e-mail e senha a cada tentativa
  // punia quem está justamente corrigindo a configuração do outro lado.
  if (r && r.ok) {
    syncRascunho = syncRascunhoVazio();
    toast('ok', '✓ Conectado ao Firebase', 3000);
  } else {
    syncRascunho.email = email;
    syncRascunho.senha = senha;
    toast('error', `Não deu pra entrar: ${(r && r.motivo) || 'o servidor não respondeu'}`, 7000);
  }
  renderSync();
}

/* O olho da senha. O `aria-pressed` do botão é o estado; o rascunho só o espelha pra
   sobreviver à repintura, e o input volta a ficar oculto sozinho quando o login dá certo. */
function syncAlternarSenha() {
  syncRascunhoDoDom();
  syncRascunho.senhaVisivel = !syncRascunho.senhaVisivel;
  renderSync();
  const campo = $('#syncSenha');
  if (campo) { campo.focus(); campo.setSelectionRange(campo.value.length, campo.value.length); }
}

async function syncTestar() {
  const out = $('#syncTestOut');
  if (out) out.textContent = 'testando…';
  const r = await api('/api/sync/test', {});
  if (!out) return;
  if (r && r.ok) {
    out.className = 'sync-teste ok';
    out.textContent = `respondeu agora, ${r.devices} aparelho(s) neste banco`;
    return;
  }
  out.className = 'sync-teste ruim';
  out.textContent = (r && r.motivo) || 'não respondeu';
}

async function syncSair() {
  await api('/api/sync/logout', {});
  // sair zera o rascunho: a senha da conta anterior não fica esperando na tela
  syncRascunho = syncRascunhoVazio();
  toast('info', 'Este aparelho saiu do Firebase. Nada local foi apagado.', 4000);
  renderSync();
}

/* "Refazer neste aparelho" APAGA a prova de que uma análise foi feita, então ele
   confirma sempre, nomeando o aparelho e o custo. O engine ainda recusa por conta
   própria se o recibo tiver deixado de ser órfão entre a tela e o clique. */
async function syncRefazer(key) {
  const r = ((estado() && estado().sync && estado().sync.recibosVistos) || {})[key] || {};
  const onde = esc(r.deviceName || 'outro aparelho');
  const ok = await confirmModal({
    title: 'Refazer este commit neste aparelho?',
    confirmLabel: 'Refazer neste aparelho',
    body: `<p><code>${esc(key)}</code> já foi analisado no <b>${onde}</b> neste commit, e o resultado só existe lá.</p>
      <p>Refazer aqui abre uma sessão nova e consome tokens. Se o ${onde} voltar, ele confere antes de postar e não publica por cima.</p>`,
  });
  if (!ok) return;
  const resp = await api('/api/sync/redo', { key });
  if (resp && resp.ok) toast('ok', `✓ ${key} relançado neste aparelho`, 4000);
  else toast('error', `Não deu pra refazer: ${(resp && resp.motivo) || 'o servidor não respondeu'}`, 7000);
  renderSync();
}

$('#syncManager').addEventListener('click', (e) => {
  const redo = e.target.closest('.sync-redo');
  if (redo) { syncRefazer(redo.dataset.key); return; }
  const b = e.target.closest('button');
  if (!b) return;
  if (b.id === 'syncLogin') syncFazerLogin();
  else if (b.id === 'syncSenhaOlho') syncAlternarSenha();
  else if (b.id === 'syncLogout') syncSair();
  else if (b.id === 'syncTest') syncTestar();
});

$('#syncManager').addEventListener('change', (e) => {
  const t = e.target;
  if (t.type === 'checkbox' && t.id.startsWith('setSync')) { syncToggle(t.id, t.checked); return; }
  if (t.id && t.id.startsWith('sync')) syncCampoSalvar(t.id, String(t.value || '').trim());
});
