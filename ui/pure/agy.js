/* Antigravity CLI (Gemini) em Sistema > Plano e chaves (20/10/2026). PURA.

   O que a tela mostra de um perfil `agy`: a cota ao vivo por grupo de modelos, com a hora
   em que ela volta, e se a conta que entrou na pasta é a esperada; e os campos do cartão do
   perfil (o e-mail esperado). A cota vem avaliada do engine (`cadeiaPerfis.entradas[].cota`,
   lib/agy/cota.js, cotaParaTela): a conta chega mascarada e nunca há caminho de pasta. */
import { esc } from './comum.js';

function doisDigitos(n) { return String(n).padStart(2, '0'); }

function quandoVolta(ms) {
  const d = new Date(ms);
  return `${doisDigitos(d.getDate())}/${doisDigitos(d.getMonth() + 1)} ${doisDigitos(d.getHours())}:${doisDigitos(d.getMinutes())}`;
}

function grupoEmTexto(g) {
  const pct = Math.round((Number(g.restante) || 0) * 100);
  const nome = g.nome || g.grupo || 'grupo';
  if (g.esgotado) return `${nome}: esgotada, volta ${quandoVolta(g.reset)}`;
  return `${nome}: ${pct}% da semana`;
}

/**
 * A cota de um perfil `agy` em uma linha, para a ordem de uso e o cartão do perfil.
 * @param {{ ok?: boolean, erro?: string, conta?: string, contaConfere?: boolean|null, grupos?: Array<{nome:string,grupo:string,restante:number,reset:number,esgotado:boolean}> } | null} cota
 */
function cotaAgyHtml(cota) {
  if (!cota) return '<span class="set-desc agy-cota">Cota ainda não lida: o Farol lê sozinho, sem gastar nada.</span>';
  if (!cota.ok) return `<span class="set-desc agy-cota">Cota não lida: ${esc(cota.erro || 'o Antigravity não respondeu')}.</span>`;
  const grupos = (Array.isArray(cota.grupos) ? cota.grupos : []).map(grupoEmTexto).join(' · ');
  const conta = cota.conta ? ` Conta: ${esc(cota.conta)}.` : '';
  const alerta = cota.contaConfere === false
    ? ' <span class="pill err">não é a conta esperada: o Farol não roda neste perfil até o login certo</span>'
    : '';
  return `<span class="set-desc agy-cota">Cota: ${esc(grupos)}.${conta}${alerta}</span>`;
}

/** Os campos do cartão de um perfil `agy`: o e-mail esperado e a cota ao vivo. */
function camposAgyHtml(p, cota) {
  const id = esc(p && p.id);
  return `
      <div class="a-editrow">
        <input class="cp-email" data-id="${id}" value="${esc((p && p.email) || '')}" placeholder="e-mail da conta Google esperada (opcional)" spellcheck="false" autocomplete="off">
      </div>
      <div class="a-hint">Usa a cota do plano Google pelo Antigravity CLI, numa pasta só deste perfil dentro de ~/.farol. Com o e-mail preenchido, o Farol confere antes de cada sessão que a conta que entrou é essa. O modelo padrão é o Gemini Flash High, sem subagente.</div>
      <div class="a-hint">${cotaAgyHtml(cota)}</div>`;
}

export { cotaAgyHtml, camposAgyHtml };
