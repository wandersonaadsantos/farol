// O aparelho executor visto do admin (controle do celular, 28/09/2026). PURA.
// Desenho: docs/superpowers/specs/2026-09-28-controle-do-celular-anexos/HANDOFF-claude-design.md.
//
// Painel (vivo, pausado, IA, versão, consentimento, contas, falhas), a faixa que troca de
// aparelho, o resumo "Seus aparelhos" de Pra mim, as contas editáveis à distância, a
// confirmação antes de ligar uma opção automática e os comandos enviados a ele.
//
// O retorno de cada comando vem do registro local de emissão mais o recibo do alvo
// (`reciboEstado`, ui/pure/compartilhado.js): sucesso só existe com o recibo.
import { esc, fmtClock, fmtWhenDay, plural } from './comum.js';
import { personMention, prRefMention } from './mencoes.js';
import { reciboEstado } from './compartilhado.js';
import { contagemDaFila } from './aparelhos-fila.js';
import { POLITICA_DA_CONTA_TEXTOS } from './contas.js';

// "vivo": algum sinal nos últimos 12 minutos (29/09/2026). A presença (`lastSeenAt`) é
// carimbada no MÁXIMO a cada 5 min (SYNC.PRESENCE_TICK_MS), então a janela antiga de 3 min
// dava "sem sinal" com o aparelho vivo e bloqueava os comandos à toa. Doze minutos cobrem
// dois carimbos perdidos e ficam abaixo dos 15 min de validade do comando.
export const VIVO_MS = 720000;
// a primeira versão que publica a fila e aceita os comandos do controle do celular
export const VERSAO_DO_CONTROLE = '2.65.0';

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function lista(v) {
  return Array.isArray(v) ? v : [];
}


function partesDaVersao(v) {
  return String(v || '').split('.').map((n) => Number.parseInt(n, 10) || 0);
}

export function versaoAntiga(versao, minima = VERSAO_DO_CONTROLE) {
  if (!versao) return true;
  const a = partesDaVersao(versao);
  const b = partesDaVersao(minima);
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) < (b[i] || 0);
  }
  return false;
}

function haQuanto(ms) {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${Math.max(1, min)} min`;
  return `${Math.round(min / 60)} h`;
}

// SÓ APARECE QUEM ACEITOU O CONTROLE, E ACEITOU EXPLICITAMENTE (decisão do dono, 29/09/2026).
// Aparelho de terceiro no mesmo conjunto não é da conta do admin controlar: sem o
// "Aceitar políticas e comandos do admin" ligado nele e publicado no painel, ele não entra
// na aba Aparelhos, nem na faixa, nem no resumo, nem no aviso de decisão pendente.
// Consentimento desconhecido (painel ainda não publicado, versão antiga) também fica de fora.
export function aparelhosQueAceitam(sync) {
  const s = sync || {};
  return new Set(lista(s.paineis && s.paineis.aparelhos).filter((p) => p && p.aceitarAdmin === true).map((p) => p.deviceId));
}

// Os executores que aceitaram o controle: aparelho que não é este, não está aposentado e
// publicou o consentimento no painel. A lista vem do snapshot (`sync.devices`).
// O sinal mais recente do aparelho: presença, painel publicado ou andamento ao vivo dele
// (`aoVivo`: { deviceId: instante da leitura que trouxe operação dele }). Qualquer um prova
// que ele está respondendo; olhar só a presença era o que fazia o vivo parecer sumido.
function ultimoSinal(d, p, aoVivo) {
  return Math.max(Number(d.lastSeenAt || p.vistoEm) || 0, Number(p.publicadoEm) || 0, Number(aoVivo && aoVivo[d.deviceId]) || 0);
}

export function executoresDoConjunto(sync, { aoVivo = {} } = {}) {
  const s = sync || {};
  const paineis = new Map(lista(s.paineis && s.paineis.aparelhos).map((p) => [p.deviceId, p]));
  const aceitam = aparelhosQueAceitam(s);
  return lista(s.devices)
    .filter((d) => d && d.deviceId && d.deviceId !== s.deviceId && !d.euMesmo && !(Number(d.retiredAt) > 0) && aceitam.has(d.deviceId))
    .map((d) => {
      const p = paineis.get(d.deviceId) || {};
      return {
        deviceId: d.deviceId, nome: String(d.name || p.nome || 'Aparelho sem nome'), platform: String(d.platform || ''),
        versao: String(d.farolVersion || p.versao || ''), vistoEm: ultimoSinal(d, p, aoVivo),
        abriu: p.abriu === true, pausado: p.pausado === true, paralelismo: Number(p.paralelismo) || 1,
        ocupadas: Number(p.ocupadas) || 0, iaPronta: p.iaPronta === true, aceitarAdmin: true,
        contas: lista(p.contas), falhas: lista(p.falhas), publicadoEm: Number(p.publicadoEm) || 0,
      };
    });
}

// vivo, pausado, sem-sinal ou antigo, nessa ordem de gravidade para a tela
export function situacaoDoAparelho(ap, agora = Date.now()) {
  if (versaoAntiga(ap.versao)) return 'antigo';
  if (!ap.vistoEm || agora - ap.vistoEm > VIVO_MS) return 'sem-sinal';
  if (ap.pausado) return 'pausado';
  return 'vivo';
}

// Por que as ações remotas estão desligadas neste aparelho; vazio quando podem sair. `novos`
// são os comandos do controle do celular (fila e contas), que a versão antiga não entende;
// decidir, cancelar e transferir existem desde antes e não dependem da versão.
export function motivoSemAcao(ap, { podeComandar = false, motivoSemComando = '', agora = Date.now(), novos = true } = {}) {
  const sit = situacaoDoAparelho(ap, agora);
  if (novos && sit === 'antigo') return 'Atualize o Farol no aparelho para mandar estes comandos.';
  if (!podeComandar) return motivoSemComando || 'Só o aparelho admin, com sinal fresco, manda comandos.';
  if (sit === 'sem-sinal') return `Sem sinal há ${haQuanto(agora - ap.vistoEm)}: o comando venceria antes de chegar.`;
  return '';
}

const PILL = {
  vivo: ['ok', 'vivo'], pausado: ['warn', 'pausado pelo admin'], antigo: ['warn', 'versão antiga'],
};

function pillHtml(ap, agora) {
  const sit = situacaoDoAparelho(ap, agora);
  if (sit === 'sem-sinal') return `<span class="pill err">${ap.vistoEm ? `sem sinal há ${esc(haQuanto(agora - ap.vistoEm))}` : 'sem sinal'}</span>`;
  const [classe, rotulo] = PILL[sit];
  return `<span class="pill ${classe}">${esc(rotulo)}</span>`;
}

function vistoTxt(ap, agora) {
  if (!ap.vistoEm) return 'nunca visto';
  const ms = agora - ap.vistoEm;
  if (ms > VIVO_MS) return `visto às ${fmtClock(ap.vistoEm)}, há ${haQuanto(ms)}`;
  return `visto há ${Math.max(1, Math.round(ms / 1000))} s`;
}

function linhaDoAparelho(ap, agora) {
  const partes = [ap.platform, ap.versao ? `Farol ${ap.versao}` : ''].filter(Boolean);
  return [...partes, vistoTxt(ap, agora)].join(' · ');
}

function fato(rot, valor, sub, classe = '') {
  return `<div class="apar-fato"><span class="rot">${esc(rot)}</span><b${classe ? ` class="${classe}"` : ''}>${esc(valor)}</b><small>${esc(sub)}</small></div>`;
}


function fatosHtml(ap, agora) {
  const sit = situacaoDoAparelho(ap, agora);
  if (sit === 'antigo') {
    return `${fato('Versão', `Farol ${ap.versao || 'antigo'}`, `precisa da ${VERSAO_DO_CONTROLE} ou mais nova`, 'warn')}${fato('Comandos do admin', 'Indisponíveis', 'esta versão não recebe os comandos novos')}${fato('Fila', 'Não publicada', 'aparece depois de atualizar')}`;
  }
  let agoraTxt = fato('Agora', ap.ocupadas ? `Revisando ${ap.ocupadas} de ${ap.paralelismo}` : 'Parado', `teto total do aparelho: ${ap.paralelismo}`);
  if (ap.pausado) agoraTxt = fato('Agora', 'Pausado pelo admin', 'termina o que começou e não começa nada sozinho: revisão, pushback e co-assinatura esperam', 'warn');
  if (sit === 'sem-sinal') agoraTxt = fato('Agora', 'Sem sinal', ap.vistoEm ? `às ${fmtClock(ap.vistoEm)} revisava ${ap.ocupadas} de ${ap.paralelismo}` : 'nunca publicou o estado');
  const ia = ap.iaPronta ? fato('IA', 'Pronta', 'Claude Code instalado e logado', 'ok') : fato('IA', 'Não está pronta', 'instale e faça login no Claude Code no aparelho', 'bad');
  const cmd = fato('Comandos do admin', 'Aceita', 'ligado no próprio aparelho', 'ok');
  return `${agoraTxt}${ia}${cmd}${fato('Versão', `Farol ${ap.versao}`, 'em dia')}`;
}

const FALHA = {
  'limite-plano': 'limite do plano', autenticacao: 'credencial expirada', 'skip-permissions-root': 'rodando como root',
};

function falhasHtml(ap, prKeyDaTag) {
  if (!ap.falhas.length) return '<div>Nenhuma registrada.</div>';
  return ap.falhas.map((f) => {
    const key = prKeyDaTag ? prKeyDaTag(f.prTag) : '';
    const onde = key ? ` em ${prRefMention(key, 'pr-ref-mention')}` : '';
    return `<div><span class="sync-chip bad">${esc(FALHA[f.classe] || f.classe.replace(/-/g, ' '))}</span> ${esc(fmtWhenDay(f.at))}${onde}</div>`;
  }).join('');
}

// conta cujo nome nenhuma linha trouxe aparece pela tag curta, sem link: não é um login
function nomeDaContaHtml(c) {
  if (c.nomeConhecido === false) return `<code>${esc(c.nome)}</code>`;
  return personMention(c.nome, 'xs');
}

function chipDoToken(c) {
  return c.temToken ? '<span class="sync-chip ok">token válido</span>' : '<span class="sync-chip bad">sem token</span>';
}

function contasDoPainelHtml(ap) {
  if (!ap.contas.length) return '<div class="md-fraco">nenhuma publicada</div>';
  return ap.contas.map((c) => `<div>${nomeDaContaHtml(c)} ${chipDoToken(c)}</div>`).join('');
}

function opcaoDoTeto(n, atual) {
  const sel = n === atual ? ' selected' : '';
  return `<option value="${n}"${sel}>${n}</option>`;
}

// O seletor é o "Teto total do aparelho" da política (o mesmo nome de Sistema > Aparelhos).
// O que o aparelho publica é o total que ESTÁ valendo: o menor entre o teto dele e o do
// admin, ou a soma dos limites por conta quando ninguém definiu teto. Só dá para marcar uma
// opção quando esse total é um dos valores que o admin pode definir; fora disso o seletor
// abre em "não definir", que é também o jeito de tirar o teto do admin (30/09/2026).
function controlesHtml(ap, desligado) {
  const dis = desligado ? ` aria-disabled="true" title="${esc(desligado)}"` : '';
  const rotulo = ap.pausado ? 'Retomar' : 'Pausar';
  const definivel = [1, 2, 3, 4].includes(ap.paralelismo);
  const semTeto = `<option value=""${definivel ? '' : ' selected'}>não definir (vale o teto total do próprio aparelho)</option>`;
  const opcoes = semTeto + [1, 2, 3, 4].map((n) => opcaoDoTeto(n, ap.paralelismo)).join('');
  return `<div class="row-actions">
      <label class="apar-teto">Teto total do aparelho <select class="ap-teto" data-dev="${esc(ap.deviceId)}"${dis}>${opcoes}</select></label>
      <button class="btn ap-pausa" data-dev="${esc(ap.deviceId)}" data-pausar="${String(!ap.pausado)}"${dis}>${rotulo}</button>
    </div>`;
}

// `ctx`: { agora, desligado, prKeyDaTag(tag)->key }
export function painelDoAparelhoHtml(ap, ctx) {
  const c = ctx || {};
  const agora = c.agora || Date.now();
  const sit = situacaoDoAparelho(ap, agora);
  const controles = sit === 'antigo' ? '' : controlesHtml(ap, c.desligado);
  return `<section class="card apar-painel" aria-label="Painel do aparelho">
    <div class="apar-topo">
      <div>
        <div class="apar-nome"><h2>${esc(ap.nome)}</h2>${pillHtml(ap, agora)}</div>
        <div class="apar-linha">${esc(linhaDoAparelho(ap, agora))}</div>
      </div>${controles}
    </div>
    <div class="apar-fatos">${fatosHtml(ap, agora)}</div>
    <div class="apar-extra">
      <div><span class="rot">Contas do GitHub nele</span>${contasDoPainelHtml(ap)}</div>
      <div><span class="rot">Falhas recentes</span>${falhasHtml(ap, c.prKeyDaTag)}</div>
    </div>
  </section>`;
}

// O aviso que explica POR QUE as ações estão desligadas, quando há um motivo que a pessoa
// pode resolver (consentimento) ou precisa saber (sem sinal).
export function avisoDoAparelhoHtml(ap, { agora = Date.now() } = {}) {
  const sit = situacaoDoAparelho(ap, agora);
  if (sit === 'antigo') return '';
  if (sit === 'sem-sinal') {
    const visto = ap.vistoEm ? `O aparelho foi visto pela última vez às ${fmtClock(ap.vistoEm)}. ` : '';
    return `<div class="apar-aviso bad" role="status"><b>Sem sinal${ap.vistoEm ? ` há ${esc(haQuanto(agora - ap.vistoEm))}` : ''}</b><p>${esc(visto)}A fila abaixo é a última que ele publicou e pode ter mudado desde então. As ações voltam quando ele der sinal.</p></div>`;
  }
  return '';
}

function itemDaFaixa(ap, selecionado, contagens, agora) {
  const ativo = ap.deviceId === selecionado;
  const n = (contagens && contagens[ap.deviceId] && contagens[ap.deviceId].pedem) || 0;
  const pedem = n ? plural(n, 'pede você', 'pedem você') : 'nada pede você';
  const classe = ativo ? 'apar-troca-item active' : 'apar-troca-item';
  return `<button role="tab" aria-selected="${String(ativo)}" class="${classe}" data-dev="${esc(ap.deviceId)}"><span class="apar-dot ${situacaoDoAparelho(ap, agora)}"></span><span><b>${esc(ap.nome)}</b><small>${esc(ap.platform || 'aparelho')} · ${pedem}</small></span></button>`;
}

// A faixa que troca de aparelho: só com dois ou mais executores.
export function faixaDeAparelhosHtml(executores, selecionado, contagens, agora = Date.now()) {
  const lista0 = lista(executores);
  if (lista0.length < 2) return '';
  return `<div class="apar-troca" role="tablist" aria-label="Aparelhos">${lista0.map((ap) => itemDaFaixa(ap, selecionado, contagens, agora)).join('')}</div>`;
}

// Pra mim > Seus aparelhos: uma linha por executor, e some sem executor.
export function seusAparelhosHtml(executores, itensPorAparelho, agora = Date.now()) {
  const lista0 = lista(executores);
  if (!lista0.length) return '';
  const linhas = lista0.map((ap) => {
    const cont = contagemDaFila((itensPorAparelho || {})[ap.deviceId]);
    const sit = situacaoDoAparelho(ap, agora);
    const estado = { vivo: 'vivo', pausado: 'pausado', antigo: 'versão antiga', 'sem-sinal': 'sem sinal' }[sit];
    const resumo = [`revisando ${ap.ocupadas} de ${ap.paralelismo}`, `${cont.fila} na fila`, `${cont.parados} ${cont.parados === 1 ? 'parado' : 'parados'}`].join(' · ');
    const chip = cont.pedem ? `<span class="sync-chip warn">${plural(cont.pedem, 'pede você', 'pedem você')}</span>` : '';
    return `<div class="card md-seu-aparelho"><div class="info"><div><b>${esc(ap.nome)}</b> <span class="md-fraco">${esc([ap.platform, estado].filter(Boolean).join(' · '))}</span></div><div class="md-sub">${esc(resumo)}</div></div>${chip}<button class="btn sm ap-abrir" data-dev="${esc(ap.deviceId)}">Abrir o aparelho</button></div>`;
  }).join('');
  return `<div class="section-head"><h2>Seus aparelhos</h2><span class="section-sub">atualiza a cada 10 s</span></div>
    <p class="section-desc">O que cada executor está fazendo e o que espera por você. Decidir, mexer na fila e configurar ficam na página de cada um.</p>
    <div class="cards">${linhas}</div>`;
}

/* ---------- contas à distância ---------- */

// Os quatro campos da política são os MESMOS do cartão de Sistema > Contas, com as mesmas
// palavras (POLITICA_DA_CONTA_TEXTOS, ui/pure/contas.js). Até 30/09/2026 esta tela tinha
// rótulos próprios ("Com blocker", "aprova e destaca as ressalvas") para o mesmo campo.
const T = POLITICA_DA_CONTA_TEXTOS;
const SIM_NAO = [[true, 'Sim'], [false, 'Não']];
// no seletor de dois botões cabe só o começo da opção; o texto inteiro vai na dica
const curta = ([v, texto]) => [v, texto.split(' (')[0], texto];
const CAMPOS_CONTA = [
  { campo: 'autoReview', rotulo: T.autoReview.rotulo, tipo: 'seg', opcoes: T.autoReview.opcoes.map(curta) },
  { campo: 'muted', rotulo: 'Silenciada', tipo: 'seg', opcoes: SIM_NAO },
  { campo: 'onClean', rotulo: T.onClean.rotulo, opcoes: T.onClean.opcoes, auto: 'approve', aviso: 'o aparelho posta a aprovação sozinho no GitHub' },
  { campo: 'onCaveats', rotulo: T.onCaveats.rotulo, opcoes: T.onCaveats.opcoes, auto: 'approve', aviso: 'o aparelho posta a aprovação sozinho no GitHub' },
  { campo: 'onReject', rotulo: T.onReject.rotulo, opcoes: T.onReject.opcoes, auto: 'request_changes', aviso: 'o aparelho posta pedir mudanças sozinho no GitHub' },
];

// Liga uma opção que faz o aparelho POSTAR sozinho: esta pede confirmação antes do comando.
export function ligaAutomatico(campo, valor) {
  const def = CAMPOS_CONTA.find((c) => c.campo === campo);
  return !!(def && def.auto && def.auto === valor);
}

function campoHtml(def, conta, ctx) {
  const pol = objeto(conta.politica) ? conta.politica : {};
  const atual = pol[def.campo];
  const dis = ctx.desligado ? ` aria-disabled="true" title="${esc(ctx.desligado)}"` : '';
  const dados = `data-dev="${esc(ctx.dev)}" data-acct="${esc(conta.acctTag)}" data-campo="${def.campo}" data-conta="${esc(conta.nome)}"`;
  const retorno = ctx.retornoConta ? ctx.retornoConta(conta.acctTag, def.campo) : '';
  let controle;
  if (def.tipo === 'seg') {
    const dica = (t) => (t && !ctx.desligado ? ` title="${esc(t)}"` : '');
    controle = `<div class="seg" role="radiogroup" aria-label="${esc(def.rotulo)}">${def.opcoes.map(([v, r, t]) => `<button role="radio" aria-checked="${String(atual === v)}" class="ap-conta${atual === v ? ' active' : ''}" ${dados} data-valor="${String(v)}"${dis}${dica(t)}>${esc(r)}</button>`).join('')}</div>`;
  } else if (def.campo === 'onCaveats' && pol.onClean === 'wait') {
    // a mesma regra do cartão de Contas: com o sem ressalvas esperando, não há o que escolher
    controle = `<select class="ap-conta-sel" aria-label="${esc(def.rotulo)}" ${dados} disabled><option value="wait" selected>${esc(T.onCaveats.presoAoLimpo)}</option></select>`;
  } else {
    controle = `<select class="ap-conta-sel" aria-label="${esc(def.rotulo)}" ${dados}${dis}>${def.opcoes.map(([v, r]) => `<option value="${v}"${atual === v ? ' selected' : ''}>${esc(r)}</option>`).join('')}</select>`;
  }
  const aviso = def.aviso && atual === def.auto ? `<div class="conta-aviso">${esc(def.aviso)}</div>` : '';
  return `<div class="conta-campo"><div><div>${esc(def.rotulo)}</div>${aviso}</div>${controle}${retorno}</div>`;
}

// `ctx`: { dev, desligado, publicadoEm, retornoConta(acctTag, campo)->html }
export function contasDoAparelhoHtml(ap, ctx) {
  const c = { ...(ctx || {}), dev: ap.deviceId };
  const contas = lista(ap.contas).filter((x) => objeto(x.politica));
  if (!contas.length) return '';
  const cards = contas.map((conta) => `<div class="card conta-remota">
    <div class="conta-remota-head">${nomeDaContaHtml(conta)}</div>
    ${CAMPOS_CONTA.map((def) => campoHtml(def, conta, c)).join('')}
  </div>`).join('');
  return `<div class="section-head"><h2>Contas neste aparelho</h2><span class="section-sub">${ap.publicadoEm ? `publicado às ${esc(fmtClock(ap.publicadoEm))}` : ''}</span></div>
    <p class="section-desc">O valor marcado é o que o aparelho publicou. Trocar aqui manda um comando, e ele aplica no próximo ciclo, em até 10 s.</p>${cards}`;
}

// Texto da confirmação antes de ligar uma opção que posta sozinha (HANDOFF, "Confirmação").
export function confirmacaoAutomatica(aparelho, conta, campo) {
  const alvo = `@${conta}`;
  const textos = {
    onClean: [`Deixar o ${aparelho} aprovar sozinho?`, `Quando a revisão de um PR pedido a ${alvo} terminar sem ressalvas, o ${aparelho} vai postar a aprovação no GitHub sozinho, sem passar por você.`, 'Ligar a aprovação automática'],
    onCaveats: [`Deixar o ${aparelho} aprovar com ressalvas sozinho?`, `Quando a revisão de um PR pedido a ${alvo} terminar com ressalvas, o ${aparelho} vai postar a aprovação no GitHub com o texto da revisão, sem passar por você. As ressalvas ficam no app, não no PR.`, 'Ligar a aprovação com ressalvas'],
    onReject: [`Deixar o ${aparelho} reprovar sozinho?`, `Quando a revisão de um PR pedido a ${alvo} encontrar bloqueios, o ${aparelho} vai postar pedir mudanças no GitHub sozinho, sem passar por você.`, 'Ligar a reprovação automática'],
  };
  const [titulo, texto, confirmar] = textos[campo] || textos.onClean;
  return {
    titulo, confirmar, cancelar: 'Manter esperando você',
    corpo: `<p>${esc(texto)}</p><ul><li>Vale a partir da próxima revisão. As que já pedem decisão continuam esperando você.</li><li>${esc(`A revisão sai no GitHub com o nome de ${alvo}.`)}</li><li>Para desligar, volte aqui e escolha a opção que espera você.</li></ul>`,
  };
}

/* ---------- comandos enviados a um aparelho ---------- */

const ROTULO_CMD = {
  revisar: 'Revisar agora', ignorar: 'Ignorar', restaurar: 'Restaurar', ocultar: 'Ocultar', mostrar: 'Mostrar',
  decidir: 'Decidir', cancelar: 'Cancelar', transferir: 'Transferir', iniciar: 'Começar', repetir: 'Repetir', tomar: 'Tomar',
};
// o comando enviado se descreve com o rótulo e a opção que a pessoa viu ao escolher
function rotuloDoComando(cmd) {
  if (cmd.tipo !== 'config-conta') return ROTULO_CMD[cmd.tipo] || cmd.tipo;
  const def = CAMPOS_CONTA.find((c) => c.campo === cmd.campo);
  if (!def) return `Conta: ${String(cmd.valor)}`;
  const opcao = def.opcoes.find(([v]) => v === cmd.valor);
  return `${def.rotulo}: ${opcao ? opcao[1].toLowerCase() : String(cmd.valor)}`;
}

// O estado do comando mais recente que casa `filtro`, como chip mais frase; vazio sem comando.
export function retornoDoComando(comandos, recibos, filtro, { agora = Date.now() } = {}) {
  const cmd = lista(comandos).find(filtro);
  if (!cmd) return { html: '', pendente: false };
  const r = reciboEstado(cmd, (recibos || {})[cmd.cmdId], agora);
  const frase = r.estado === 'enviado'
    ? `${rotuloDoComando(cmd)}, enviado às ${fmtClock(cmd.at)}. O aparelho aplica no próximo ciclo, em até 10 s.`
    : `${rotuloDoComando(cmd)}: ${r.detalhe}.`;
  return {
    pendente: r.estado === 'enviado',
    html: `<div class="cmd-retorno" role="status"><span class="sync-chip ${r.classe}">${r.estado === 'enviado' ? '<i class="cmd-dot"></i>' : ''}${esc(r.rotulo)}</span><span>${esc(frase)}</span></div>`,
  };
}

export function comandosDoAparelhoHtml(comandos, recibos, dev, { agora = Date.now() } = {}) {
  const deste = lista(comandos).filter((c) => c && c.alvo === dev);
  if (!deste.length) return '';
  const linhas = deste.map((cmd) => {
    const r = reciboEstado(cmd, (recibos || {})[cmd.cmdId], agora);
    const pr = cmd.prKey ? ` ${prRefMention(cmd.prKey, 'pr-ref-mention')}` : '';
    return `<div class="cmd-linha"><span class="cmd-hora">${esc(fmtClock(cmd.at))}</span><span><b>${esc(rotuloDoComando(cmd))}</b>${pr}</span><span><span class="sync-chip ${r.classe}">${esc(r.rotulo)}</span> ${esc(r.detalhe)}</span></div>`;
  }).join('');
  return `<div class="section-head"><h2>Comandos enviados</h2><span class="section-sub">desta sessão · o resultado é o recibo do aparelho</span></div><div class="card cmd-lista">${linhas}</div>`;
}

export function nenhumExecutorHtml() {
  return '<div class="fila-vazia"><b>Nenhum aparelho aceitou o controle deste computador</b><p>Aqui aparecem só os aparelhos que ligaram, neles mesmos, a chave abaixo. Aparelho de outra pessoa no mesmo conjunto não aparece.</p><p><code>Sistema &gt; Aparelhos &gt; Aceitar políticas e comandos do admin</code> No seu celular, é só ligar uma vez; ele aparece aqui no próximo ciclo.</p></div>';
}
