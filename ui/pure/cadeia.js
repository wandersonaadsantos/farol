/* Cadeia de perfis em Sistema > Plano e chaves (20/10/2026). PURA.

   A ordem em que as assinaturas pagam a revisão: o primeiro perfil ligado e disponível é o
   que roda, e o que chega ao limite do plano fica de fora até o reset (lib/engine/
   cadeia-perfis.js). A tela recebe a cadeia já avaliada pelo engine (`cadeiaPerfis` do
   snapshot): o estado de cada perfil é dele, e aqui só se diz em palavras.

   Subir, descer, ligar e desligar devolvem a lista inteira `[{ id, ativo }]`, que é o
   valor do campo `cadeiaPerfis` da configuração. A ordem É o conteúdo, então não existe
   edição parcial que faça sentido. */
import { esc } from './comum.js';
import { personMention } from './mencoes.js';

const ESTADOS = Object.freeze({
  'em-uso': { rotulo: 'Em uso', classe: 'ok' },
  pronto: { rotulo: 'Pronto, na espera', classe: '' },
  limite: { rotulo: 'No limite', classe: 'warn' },
  'sem-login': { rotulo: 'Sem login', classe: 'err' },
  problema: { rotulo: 'Com problema', classe: 'err' },
  desligado: { rotulo: 'Desligado', classe: '' },
});

const DICA_DO_ESTADO = Object.freeze({
  'sem-login': 'A cadeia pula este perfil enquanto houver outro pronto. Use Abrir sessão de login no cartão dele, abaixo.',
  problema: 'Falta o que este perfil precisa para rodar (a pasta ou a chave). Complete no cartão dele, abaixo.',
});

function doisDigitos(n) { return String(n).padStart(2, '0'); }

// "21:00", ou "22/10 21:00" quando o reset não é hoje
function quando(ms, agora) {
  const d = new Date(ms);
  const hoje = new Date(agora);
  const hora = `${doisDigitos(d.getHours())}:${doisDigitos(d.getMinutes())}`;
  if (d.toDateString() === hoje.toDateString()) return hora;
  return `${doisDigitos(d.getDate())}/${doisDigitos(d.getMonth() + 1)} ${hora}`;
}

/** O estado de um perfil da cadeia em palavras. */
function estadoDaCadeiaTexto(entrada, agora = Date.now()) {
  const e = entrada ?? {};
  const base = ESTADOS[e.estado] || ESTADOS.pronto;
  if (e.estado !== 'limite' || !(e.ate > 0)) return base.rotulo;
  return `No limite até ${quando(e.ate, agora)}${e.estimado ? ' (estimado)' : ''}`;
}

function listaDaCadeia(entradas) {
  return (Array.isArray(entradas) ? entradas : []).map(e => ({ id: String(e.id), ativo: e.ativo === true }));
}

/** Move um perfil `delta` posições (negativo sobe). Fora dos limites, a lista volta igual. */
function moverNaCadeia(entradas, id, delta) {
  const lista = listaDaCadeia(entradas);
  const de = lista.findIndex(e => e.id === id);
  const para = de + Number(delta || 0);
  if (de < 0 || para < 0 || para >= lista.length || para === de) return lista;
  const [item] = lista.splice(de, 1);
  lista.splice(para, 0, item);
  return lista;
}

/** Liga ou desliga um perfil na cadeia, sem mexer na ordem. */
function alternarNaCadeia(entradas, id) {
  return listaDaCadeia(entradas).map(e => (e.id === id ? { ...e, ativo: !e.ativo } : e));
}

function resumoDaCadeia(cadeia, agora) {
  const ligados = (cadeia.entradas || []).filter(e => e.ativo);
  if (!ligados.length) return 'Nenhum perfil ligado: as revisões usam o login padrão desta máquina, como antes da cadeia.';
  if (cadeia.todosNoLimite) {
    const primeiro = ligados.slice().sort((a, b) => a.ate - b.ate)[0];
    return `Todos os perfis ligados estão no limite. As revisões esperam o primeiro reset (${esc(primeiro.label)}, ${esc(estadoDaCadeiaTexto(primeiro, agora).replace(/^No limite /, ''))}) sem estacionar nenhum PR.`;
  }
  const emUso = ligados.find(e => e.estado === 'em-uso');
  return emUso ? `Agora as revisões usam <b>${esc(emUso.label)}</b>.` : 'Nenhum perfil ligado está pronto agora.';
}

function linhaDaCadeia(e, i, total, agora) {
  const est = ESTADOS[e.estado] || ESTADOS.pronto;
  const dica = DICA_DO_ESTADO[e.estado] ? `<span class="set-desc">${esc(DICA_DO_ESTADO[e.estado])}</span>` : '';
  const id = esc(e.id);
  const desligado = e.ativo ? '' : ' cad-off';
  const sobe = i === 0 ? ' disabled' : '';
  const desce = i === total - 1 ? ' disabled' : '';
  const ligado = e.ativo ? ' checked' : '';
  const titulo = e.ativo ? 'Desligar: a cadeia deixa de usar este perfil' : 'Ligar: a cadeia passa a usar este perfil na posição dele';
  return `<li class="cad-item${desligado}" data-cadeia-id="${id}">
    <span class="cad-pos" aria-hidden="true">${i + 1}</span>
    <span class="cad-txt">
      <span class="set-title">${esc(e.label || 'Perfil sem nome')} <span class="cad-prov">${esc(e.provedorRotulo || '')}</span></span>
      <span class="pill ${est.classe} cad-estado">${esc(estadoDaCadeiaTexto(e, agora))}</span>
      ${dica}
    </span>
    <span class="cad-ctl">
      <button type="button" class="btn icon sm ghost cad-subir" data-id="${id}" title="Subir na prioridade" aria-label="Subir ${esc(e.label)} na prioridade"${sobe}>↑</button>
      <button type="button" class="btn icon sm ghost cad-descer" data-id="${id}" title="Descer na prioridade" aria-label="Descer ${esc(e.label)} na prioridade"${desce}>↓</button>
      <label class="cad-liga" title="${titulo}">
        <input type="checkbox" class="cad-ativo" data-id="${id}"${ligado} aria-label="Usar ${esc(e.label)} na cadeia"><span class="switch"></span>
      </label>
    </span>
  </li>`;
}

/**
 * O cartão da cadeia.
 * @param {{ entradas?: Array<{id:string,label:string,provedorRotulo:string,ativo:boolean,estado:string,ate:number,estimado:boolean}>, todosNoLimite?: boolean, contasComPerfilProprio?: Array<{user:string,perfil:string}> }} cadeia
 */
function cadeiaHtml(cadeia, agora = Date.now()) {
  const c = cadeia ?? {};
  const entradas = Array.isArray(c.entradas) ? c.entradas : [];
  if (!entradas.length) {
    return `<div class="card cad-card"><div class="set-title">Ordem de uso</div>
      <p class="set-desc">Adicione um perfil abaixo. Com dois ou mais, você escolhe qual paga as revisões primeiro e quais entram quando ele chega ao limite do plano.</p></div>`;
  }
  const proprias = (Array.isArray(c.contasComPerfilProprio) ? c.contasComPerfilProprio : []);
  const nota = proprias.length
    ? `<p class="set-desc cad-nota">Conta com perfil próprio (Sistema → Contas) usa só ele e fica fora da cadeia: ${proprias.map(p => personMention(p.user)).join(', ')}.</p>`
    : '';
  return `<div class="card cad-card">
    <div class="set-title">Ordem de uso</div>
    <p class="set-desc">O primeiro perfil ligado paga as revisões. Quando ele chega ao limite do plano, o Farol guarda a hora em que o limite volta e segue para o próximo; passado o reset, o primeiro volta a ser usado sozinho. Perfil novo entra desligado.</p>
    <p class="set-desc cad-resumo" aria-live="polite">${resumoDaCadeia(c, agora)}</p>
    <ol class="cad-lista">${entradas.map((e, i) => linhaDaCadeia(e, i, entradas.length, agora)).join('')}</ol>
    ${nota}
  </div>`;
}

export { estadoDaCadeiaTexto, moverNaCadeia, alternarNaCadeia, cadeiaHtml };
