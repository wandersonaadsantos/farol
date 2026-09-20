// Sistema > Aparelhos: a política de UM aparelho, aberta pelo admin.
//
// PURO: recebe o aparelho, a leitura da política vigente no banco (rota
// /api/sync/policy-read, lib/engine/sync-politicas.js) e a recusa da última publicação, e
// devolve HTML ou o corpo da rota.
//
// ABRIR COM O QUE ESTÁ VALENDO, NÃO COM O MÍNIMO. Publicar substitui a política inteira;
// um formulário que abrisse com valores mínimos apagaria em silêncio o que o admin publicou
// antes, inclusive o que a tela nem edita (as contas elegíveis). Por isso a leitura vem
// primeiro, o que a tela não edita é preservado no corpo, e o campo sobre o qual a política
// não opina abre como "vale o do aparelho", nunca como o valor mais restritivo.
//
// O QUE ESTA TELA NÃO SABE: se o aparelho de destino aceitou. O aceite (consentimento,
// assinatura, geração, frescor) acontece lá, e o resultado não volta para o admin. A tela
// diz isso em vez de mostrar um "aceita" que ninguém mediu.
import { esc } from './comum.js';

// Os tipos de operação da política (a allowlist é do engine, em lib/sync/politica.js; aqui
// mora só o rótulo de cada um). Tipo que o engine não conhece é descartado lá, e por isso
// nunca é oferecido aqui.
const APARELHOS_TIPOS = [
  ['review', 'revisão'],
  ['self', 'autoanálise'],
  ['pushback', 'contestação'],
  ['chat', 'conversa'],
  ['tool', 'ferramenta'],
];

// O teto de paralelismo é 1 a 4, o mesmo clamp de lib/sync/politica.js. Escrever 5 aqui
// faria a tela prometer um valor que o engine reduz em silêncio.
const APARELHOS_TETOS = [1, 2, 3, 4];

function chip(classe, texto) {
  return `<span class="sync-chip ${classe}">${esc(texto)}</span>`;
}

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

// A política só serve de base quando o engine provou o conteúdo (`valida`).
function politicaLida(leitura) {
  const l = leitura || {};
  return l.estado === 'ok' && l.existe === true && l.valida === true && objeto(l.politica) ? l.politica : null;
}

const SITUACAO = {
  carregando: () => ({ selo: chip('mute', 'lendo'), aviso: 'lendo a política vigente no banco…' }),
  falha: (l) => ({ selo: chip('bad', 'falha na leitura'), aviso: `Não deu para ler a política atual: ${l.motivo || 'o servidor não respondeu'}. Publicar substitui a política inteira pelo que está abaixo.` }),
  vazia: () => ({ selo: chip('mute', 'sem política'), aviso: 'Ainda não há nenhuma política publicada para este aparelho: ele vale pela própria configuração.' }),
  invalida: () => ({ selo: chip('bad', 'não se prova'), aviso: 'A política que está no banco não se prova como do admin vigente (outra geração ou assinatura que não confere), então não é mostrada. Publicar substitui a política inteira.' }),
  valida: (l) => ({ selo: chip('ok', `publicada, versão ${Number(l.versao) || 0}`), aviso: '' }),
};

function situacaoDa(leitura) {
  const l = leitura || { estado: 'carregando' };
  if (l.estado === 'falha') return SITUACAO.falha(l);
  if (l.estado !== 'ok') return SITUACAO.carregando();
  if (l.existe !== true) return SITUACAO.vazia();
  return l.valida === true ? SITUACAO.valida(l) : SITUACAO.invalida();
}

function opcoesDoTeto(teto) {
  const naoDefinido = `<option value=""${teto === undefined ? ' selected' : ''}>não definir (vale o do aparelho)</option>`;
  return naoDefinido + APARELHOS_TETOS.map((n) => `<option value="${n}"${teto === n ? ' selected' : ''}>${n} sessão(ões)</option>`).join('');
}

// Sem opinião remota sobre os tipos, todos abrem marcados: é o que o aparelho já permite.
function caixasDosTipos(tipos) {
  const lista = Array.isArray(tipos) ? tipos : null;
  return APARELHOS_TIPOS.map(([id, rotulo]) => {
    const marcado = !lista || lista.includes(id) ? ' checked' : '';
    return `<label class="apar-tipo"><input type="checkbox" class="apar-tipo-check" value="${esc(id)}"${marcado}> ${esc(rotulo)}</label>`;
  }).join('');
}

function notaDasContas(pol) {
  const contas = pol && Array.isArray(pol.contasElegiveis) ? pol.contasElegiveis.length : 0;
  if (!contas) return '';
  return `<span class="sync-dica">A política também restringe as contas elegíveis (${contas}); esta tela não edita essa lista, e publicar a mantém como está.</span>`;
}

// QUATRO coisas diferentes, e o texto antigo juntava todas numa frase só: o CONSENTIMENTO
// local do destino, o RECEBIMENTO do nó, a APLICAÇÃO lá e o RESULTADO de volta.
//
// Quando o destino é ESTE aparelho, a frase "esse aceite acontece no aparelho de destino e
// não volta para esta tela" ficava falsa: o consentimento está três cartões abaixo, no
// interruptor "Aceitar políticas e comandos do admin", e a tela tem a resposta enquanto
// afirma não ter. Com o consentimento DESLIGADO, o certo não é "não volta para esta
// tela": é "este aparelho vai ignorar".
//
// O interruptor prova o CONSENTIMENTO, e só ele: não diz que a política chegou, nem que
// foi aplicada. Por isso o caso local também não promete resultado.
function textoDoAceite(euMesmo, aceitaAdmin) {
  if (euMesmo !== true) {
    return 'O aparelho de destino só aplica se ele aceitar admin, se a assinatura for da geração vigente e se o admin tiver batimento recente. Esse aceite acontece no aparelho de destino e não volta para esta tela.';
  }
  if (aceitaAdmin === false) {
    return 'O destino é ESTE aparelho, e o interruptor "Aceitar políticas e comandos do admin" está desligado aqui: publicar agora não muda nada, porque este aparelho vai ignorar. Ligue o interruptor antes, ou publique sabendo disso.';
  }
  if (aceitaAdmin === true) {
    return 'O destino é ESTE aparelho, e o consentimento está ligado aqui. Falta ainda a assinatura da geração vigente e o batimento recente do admin: o aceite acontece no próximo giro, e o selo desta tela mostra a política vigente no banco, não o que já foi aplicado.';
  }
  return 'O destino é ESTE aparelho. O consentimento local não chegou a esta tela agora, então não dá para dizer se a política seria aplicada aqui: confira o interruptor "Aceitar políticas e comandos do admin".';
}

export function aparelhoPoliticaHtml(aparelho, opcoes) {
  if (!aparelho || !aparelho.deviceId) return '';
  const o = opcoes || {};
  const pol = politicaLida(o.leitura) || {};
  const sit = situacaoDa(o.leitura);
  const nome = String(aparelho.name || aparelho.deviceId);
  const recusa = o.recusa ? `<p class="apar-recusa">${esc(o.recusa)}</p>` : '';
  const aviso = sit.aviso ? `<span class="sync-dica">${esc(sit.aviso)}</span>` : '';
  const pausado = pol.pausado === true ? ' checked' : '';
  const titulo = aparelho.euMesmo === true ? `Política deste aparelho (${esc(nome)})` : `Política do ${esc(nome)}`;
  return `<div class="card apar-corpo">
    <div class="apar-titulo"><span class="sync-titulo">${titulo}</span>${sit.selo}<span class="sync-espaco"></span><button class="btn sm ghost" id="aparFecharPolitica">Fechar</button></div>
    <span class="set-desc">A política só RESTRINGE: nada do que chega pelo banco amplia o que o aparelho já permite. ${esc(textoDoAceite(aparelho.euMesmo, o.aceitaAdmin))}</span>
    ${aviso}
    <div class="apar-grade">
      <label class="apar-campo"><span>Pausado</span><span class="set-ctl"><input type="checkbox" id="aparPolPausado"${pausado}><span class="switch"></span></span></label>
      <label class="apar-campo" for="aparPolTeto"><span>Teto de paralelismo</span><select id="aparPolTeto" class="sync-input">${opcoesDoTeto(pol.tetoParalelismo)}</select></label>
      <div class="apar-campo"><span>Tipos permitidos</span><div class="apar-tipos">${caixasDosTipos(pol.tiposDeOperacao)}</div></div>
    </div>
    ${notaDasContas(pol)}
    ${recusa}
    <div class="row-actions"><button class="btn sm primary" id="aparPublicarPolitica">Publicar política</button></div>
  </div>`;
}

// O corpo da publicação: o que o formulário edita, por cima do que a política vigente já
// tinha e a tela não edita. Teto "não definido" (null) sai do corpo: a política não opina,
// e o aparelho vale pelo próprio número.
export function aparelhoPoliticaParaPublicar(leitura, doFormulario) {
  const base = politicaLida(leitura);
  const f = doFormulario || {};
  const corpo = {};
  if (base && Array.isArray(base.contasElegiveis)) corpo.contasElegiveis = base.contasElegiveis;
  const saida = { pausado: f.pausado === true };
  if (Number.isInteger(f.tetoParalelismo)) saida.tetoParalelismo = f.tetoParalelismo;
  saida.tiposDeOperacao = Array.isArray(f.tiposDeOperacao) ? f.tiposDeOperacao : [];
  return { ...saida, ...corpo };
}
