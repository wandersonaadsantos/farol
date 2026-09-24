/* Renderização INERTE do diagnóstico unificado (spec 7.A3).

   Não é um renderizador de Markdown de uso geral, e não vira um: o `md()` do comum.js
   monta link e é o certo para o relatório de review, que é conteúdo do próprio Farol. Aqui
   a entrada carrega mensagem de erro de terceiro, e a promessa é outra: nada do texto vira
   tag, atributo, link, imagem ou fonte externa. Só saem h3/h4/p/ul/li/pre/code, com o
   conteúdo escapado, e nenhuma tag recebe atributo vindo do texto. */
import { esc } from './comum.js';

const CERCA = /^(`{3,})\s*[a-z]*\s*$/i;
const TITULO = /^(#{1,3})\s+(.*)$/;
const ITEM = /^\s*[-*]\s+(.*)$/;

// só `código` volta a ser marcação; o resto do texto fica como o autor escreveu, escapado
function linhaInline(s) {
  return esc(s).split(/`/).map((p, i) => (i % 2 ? `<code>${p}</code>` : p.replace(/\\([\\`*_[\]()<>!#|~+-])/g, '$1'))).join('');
}

function diagnosticoHtml(src) {
  const out = [];
  let dentro = null;
  let bloco = [];
  let lista = false;
  const fecharLista = () => { if (lista) { out.push('</ul>'); lista = false; } };
  const fecharBloco = () => { out.push(`<pre>${esc(bloco.join('\n'))}</pre>`); bloco = []; dentro = null; };
  for (const bruta of String(src === undefined || src === null ? '' : src).split(/\r?\n/)) {
    const linha = bruta.replace(/\s+$/, '');
    if (dentro) {
      if (linha.trim() === dentro) fecharBloco();
      else bloco.push(bruta);
      continue;
    }
    const abre = CERCA.exec(linha.trim());
    if (abre) { fecharLista(); dentro = abre[1]; continue; }
    const t = TITULO.exec(linha);
    if (t) {
      fecharLista();
      const nivel = Math.min(4, t[1].length + 2);
      out.push(`<h${nivel}>${linhaInline(t[2])}</h${nivel}>`);
      continue;
    }
    const li = ITEM.exec(linha);
    if (li) {
      if (!lista) { out.push('<ul>'); lista = true; }
      out.push(`<li>${linhaInline(li[1])}</li>`);
      continue;
    }
    fecharLista();
    if (linha.trim()) out.push(`<p>${linhaInline(linha)}</p>`);
  }
  fecharLista();
  // cerca sem fechamento sai como bloco mesmo assim: engolir o resto seria esconder o
  // pedaço do diagnóstico que mais interessa, que é justamente o texto cru da falha
  if (dentro) fecharBloco();
  return out.join('');
}

/* As falhas registradas na tela (A3), uma por cartão: o que é, o que fazer e o texto inerte
   daquela falha, com o botão que copia só ela. Os estados ficam separados (brief B2: falha não
   se disfarça de vazio): carregando, vazio legítimo e leitura que falhou, esta mostrando a
   última lista boa e há quanto tempo ela é. */
const CLASSE_DO_CARTAO = { permanente: 'blocked', 'espera-reset': 'urgent', transitorio: 'urgent', operacional: 'ambient' };
const CHIP_DA_GRAVIDADE = {
  permanente: '<span class="sync-chip bad">precisa de você</span>',
  'espera-reset': '<span class="sync-chip warn">passa sozinho no horário</span>',
  transitorio: '<span class="sync-chip warn">se resolve sozinho</span>',
  operacional: '<span class="sync-chip mute">sem ação</span>',
};

function quandoLegivel(at) {
  const n = Number(at) || 0;
  if (!n) return 'sem data';
  return new Date(n).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function falhaCartaoHtml(f) {
  const classe = CLASSE_DO_CARTAO[f.gravidade] || 'ambient';
  const chip = CHIP_DA_GRAVIDADE[f.gravidade] || '';
  // falha que repete enquanto a condição dura sai UMA vez, com a contagem (ver lib/engine/falhas.js)
  const vezes = Number(f.ocorrencias) > 1
    ? `<span class="falha-vezes">${Number(f.ocorrencias)}× desde ${esc(quandoLegivel(f.primeiraAt))}</span>`
    : '';
  const onde = f.ref ? `<span class="falha-ref">${esc(f.ref)}</span>` : '';
  // Nasce FECHADA, menos a que precisa de você: 19 falhas abertas enterravam justamente as
  // duas que pediam ação (Diagnóstico do aparelho do Wanderson, 23/09/2026). O resumo tem o
  // que faz escolher qual abrir: quando, o que é, sobre qual PR e se repetiu. O identificador
  // de sessão fica no corpo, porque 36 caracteres de id não ajudam nessa escolha.
  const aberta = f.precisaDeVoce ? ' open' : '';
  return `<div class="card ${classe} falha-cartao">
    <details${aberta}>
      <summary class="falha-topo"><span class="falha-quando">${esc(quandoLegivel(f.at))}</span><span class="falha-titulo">${esc(f.rotulo)}</span>${chip}${onde}${vezes}</summary>
      <p class="falha-acao"><b>O que fazer:</b> ${esc(f.acao)}</p>
      <div class="report falha-texto">${diagnosticoHtml(f.markdown)}</div>
      <div class="row-actions"><button class="btn sm" type="button" data-copiar-falha="${esc(f.id)}">Copiar esta falha</button></div>
    </details>
  </div>`;
}

function falhasSecaoHtml(dados = {}) {
  const lista = Array.isArray(dados.falhas) ? dados.falhas : [];
  if (dados.estado === 'carregando' && !lista.length) return '<p class="sys-note">Lendo as falhas registradas…</p>';
  const daLeitura = lista.length ? ` Mostrando a última leitura, de ${esc(quandoLegivel(dados.lidoEm))}.` : '';
  const aviso = dados.estado === 'erro'
    ? `<div class="banner" role="status">Não deu para ler as falhas agora.${daLeitura}</div>`
    : '';
  if (!lista.length) return aviso || '<p class="sys-note">Nenhuma falha registrada. Bom sinal.</p>';
  return `${aviso}<div class="cards">${lista.map(falhaCartaoHtml).join('')}</div>`;
}

export { diagnosticoHtml, falhasSecaoHtml };
