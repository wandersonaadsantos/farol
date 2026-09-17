/* O cartão da chave do conjunto (C1, brief B2 item 2.4). PURA.

   A chave cifra tudo o que é compartilhado e só abre com a senha da conta de sincronização.
   Os estados vêm do engine (`estadoDaChave`): desligada (sem compartilhamento, o cartão não
   aparece), pronta, bloqueada (pede a senha) e perdida (o chaveiro sumiu do banco depois de já
   ter sido visto aqui; a saída é gerar uma chave nova, e o Farol nunca faz isso sozinho).
   Cada estado oferece só a ação que cabe nele: botão que não serve para nada naquele estado
   é pior que botão nenhum. */
import { esc } from './comum.js';

const SELO = {
  pronta: '<span class="sync-chip ok">pronta</span>',
  bloqueada: '<span class="sync-chip bad">bloqueada</span>',
  perdida: '<span class="sync-chip bad">perdida</span>',
};

const CLASSE = { pronta: '', bloqueada: 'bad', perdida: 'bad' };

function recusaHtml(recusa) {
  const motivo = recusa && recusa.motivo ? String(recusa.motivo) : '';
  return motivo ? `<p class="sync-conta-nota sync-conta-nota-ruim" role="alert">${esc(motivo)}</p>` : '';
}

function senhaHtml(rotulo) {
  return `<div class="sync-campo">
      <label for="syncChaveSenha">${esc(rotulo)}</label>
      <input id="syncChaveSenha" type="password" class="sync-input" autocomplete="current-password" spellcheck="false">
    </div>`;
}

const CORPOS = {
  pronta: () => '<p class="sync-conta-nota">Aberta neste aparelho. O conteúdo compartilhado sobe e desce cifrado com ela.</p>',
  bloqueada: (recusa) => `<p class="sync-conta-nota">O conteúdo compartilhado é cifrado com uma chave que só abre com a senha da conta de sincronização. Digite a senha para abrir a chave neste aparelho; ela não fica guardada.</p>
    <div class="sync-conta-corpo">
      ${senhaHtml('Senha da sincronização')}
      <button class="btn sm primary" id="syncUnlock" type="button">Desbloquear</button>
    </div>
    ${recusaHtml(recusa)}
    <p class="sync-conta-nota">Redefinir a senha pelo e-mail do Firebase não abre a chave antiga. Se a senha se perdeu, a chave fica perdida para este banco, e a saída passa a ser gerar uma nova.</p>`,
  perdida: (recusa) => `<p class="sync-conta-nota">A chave do conjunto sumiu do banco depois de já ter sido vista neste aparelho. O Farol não recria sozinho: gerar uma chave nova abre uma época nova para o que vier daqui em diante, e o que foi cifrado com a antiga continua ilegível.</p>
    <div class="sync-conta-corpo">
      ${senhaHtml('Senha da sincronização')}
      <button class="btn sm danger-ghost" id="syncNewEpoch" type="button">Gerar chave nova…</button>
    </div>
    ${recusaHtml(recusa)}`,
};

/** @param {object} sync o `estado().sync`; @param {{motivo?: string}} [recusa] a última recusa */
function syncChaveHtml(sync, recusa) {
  const estado = String((sync && sync.chave) || '');
  const corpo = CORPOS[estado];
  if (!corpo) return '';
  return `<div class="card sync-card ${CLASSE[estado]}">
    <div class="sync-topo"><span class="sync-titulo">Chave do conjunto</span><span class="sync-espaco"></span>${SELO[estado]}</div>
    ${corpo(recusa)}
  </div>`;
}

export { syncChaveHtml };
