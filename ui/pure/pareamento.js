/* A tela de pareamento da API local (A4, brief B2 item 2.1). PURA: monta o HTML e traduz a
   recusa do servidor.

   Esta tela substitui a interface INTEIRA quando a API exige credencial e este navegador não
   tem nenhuma: nada do estado, do relatório, do log, do chat ou dos eventos aparece antes.
   Por isso ela não depende de nada do app (nem de snapshot, nem de aba): recebe o que
   precisa e devolve markup. */
import { esc } from './comum.js';

const RECUSAS = {
  codigo_invalido: (r) => `Código não confere. ${tentativas(r.restantes)}`,
  bloqueado: () => 'Cinco tentativas erradas. O código foi invalidado: gere outro no terminal deste aparelho.',
  sem_codigo_pendente: () => 'Não há código válido esperando. Ele pode ter passado dos 10 minutos ou já ter sido usado. Gere outro no terminal.',
  sem_resposta: () => 'Não deu para falar com o Farol deste aparelho. Confira se ele está aberto e tente de novo: o código não foi gasto.',
};

function tentativas(n) {
  const restantes = Number(n);
  if (!Number.isFinite(restantes) || restantes <= 0) return '';
  return restantes === 1 ? 'Resta 1 tentativa antes do bloqueio.' : `Restam ${restantes} tentativas antes do bloqueio.`;
}

/** O texto que a tela mostra para uma resposta de `POST /api/auth/pair` que não deu certo. */
function textoDaRecusa(resposta) {
  const r = (resposta && typeof resposta === 'object') ? resposta : { code: 'sem_resposta' };
  const monta = RECUSAS[String(r.code || '')] || RECUSAS.sem_resposta;
  return monta(r).trim();
}

// O comando é o mesmo nos dois lugares; o que muda é a barra do caminho. Mostrar as duas
// formas é o item 4 do brief: comando numa sintaxe de shell só era uma das lacunas medidas.
function comandos(ehWindows) {
  return ehWindows
    ? [['PowerShell', 'node .\\tools\\farol-parear.js'], ['Termux e bash', 'node tools/farol-parear.js']]
    : [['Termux e bash', 'node tools/farol-parear.js'], ['PowerShell', 'node .\\tools\\farol-parear.js']];
}

/**
 * @param {{ rotuloSugerido?: string, recusa?: string, aviso?: string, codigo?: string, ehWindows?: boolean }} dados
 */
function pareamentoHtml(dados = {}) {
  const recusa = dados.recusa ? `<span class="par-erro" role="alert">${esc(dados.recusa)}</span>` : '';
  const aviso = dados.aviso ? `<div class="banner" role="status">${esc(dados.aviso)}</div>` : '';
  const linhas = comandos(!!dados.ehWindows)
    .map(([onde, cmd]) => `<div class="par-cmd"><span class="par-onde">${esc(onde)}</span><code>${esc(cmd)}</code><button class="btn sm ghost" data-copiar="${esc(cmd)}" type="button">Copiar</button></div>`)
    .join('');
  return `<div class="par-wrap">
    <div class="par-marca">
      <svg viewBox="0 0 24 24" class="logo" aria-hidden="true"><path class="beam" d="M13.3 5.2 22 2.6v5.4l-8.7-1.1z"/><path class="tower" d="M10.7 7.6h2.6L15.2 20H8.8l1.9-12.4z"/><rect class="tower" x="8" y="20" width="8" height="1.7" rx=".85"/></svg>
      <h1 class="brand-name">Farol</h1>
    </div>
    ${aviso}
    <form class="card par-card" id="parForm">
      <h2 class="par-titulo">Parear este navegador</h2>
      <p class="par-desc">Este Farol exige credencial para abrir a API local. Nada do estado, dos relatórios, do log ou do chat aparece antes do pareamento. O código é gerado no terminal do próprio aparelho, vale uma vez e dura 10 minutos.</p>
      <div class="par-passo">
        <span class="set-title">1. No terminal deste aparelho, rode</span>
        ${linhas}
        <span class="par-dica">Rode dentro da pasta onde o Farol está instalado.</span>
      </div>
      <div class="par-passo">
        <span class="set-title">2. Digite o código que apareceu</span>
        <label class="par-rot" for="parCodigo">Código</label>
        <input id="parCodigo" class="par-input par-codigo" autocomplete="one-time-code" spellcheck="false" inputmode="text" value="${esc(dados.codigo || '')}">
        ${recusa}
        <label class="par-rot" for="parRotulo">Nome deste navegador</label>
        <input id="parRotulo" class="par-input" spellcheck="false" value="${esc(dados.rotuloSugerido || '')}">
        <span class="par-dica">Aparece na lista de navegadores pareados, em Sistema, para você reconhecer depois.</span>
      </div>
      <div class="par-acoes">
        <button class="btn primary" id="parEnviar" type="submit">Parear</button>
        <span class="par-dica">Nenhum cookie é criado: a credencial fica guardada só neste navegador.</span>
      </div>
    </form>
    <p class="par-rodape">Perdeu o controle de um navegador pareado? No terminal: <code>node tools/farol-parear.js --revogar-todas</code></p>
  </div>`;
}

export { pareamentoHtml, textoDaRecusa };
