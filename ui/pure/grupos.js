// Sistema > Grupos de consumo: um grupo soma o gasto dos perfis vinculados em todos os
// aparelhos e pode ter um teto (C2b, C4b).
//
// Tudo aqui é PURO: recebe a projeção `STATE.sync.gruposDeConsumo` (resumoParaTela, em
// lib/engine/sync-consumo-grupo.js), os perfis da config e devolve HTML ou o corpo de rota.
//
// CONFIGURAR NÃO É ATIVAR, e a tela carrega essa diferença inteira. O engine só barra com
// um grupo marcado ativo E com a lista de requisitos vazia NESTE aparelho (gruposAtivos);
// um grupo marcado ativo com requisito faltando é descartado lá, e aqui ele aparece como
// "sem efeito neste aparelho", nunca como protegido. Pelo mesmo motivo, soma ainda não
// calculada (`custoUsd: null`) não vira "US$ 0,00": zero seria uma medição que não houve.
//
// O motivo de "não verificável", a hora da soma, o teto atingido e a projeção das reservas
// chegam prontos da projeção (o teto atingido é o MESMO veredito do gate). O que ela NÃO
// entrega, e por isso a tela não mostra: o gasto de cada perfil somado entre aparelhos,
// porque o rollup publicado por aparelho é por grupo, não por perfil (ver a evidência
// tela-aparelhos-grupos.md, seção 7).
import { esc, fmtMoney, fmtClock } from './comum.js';

// O tipo do vínculo vem do `kind` do perfil. O perfil de pasta não carrega `kind` de
// propósito (lib/parse.js) e é assinatura; kind desconhecido NÃO vira tipo, porque o
// engine só mede os tipos que conhece e tipo inventado prometeria medição inexistente.
const TIPO_POR_KIND = { apikey: 'api', openrouter: 'openrouter', codex: 'codex' };

export function grupoTipoDoPerfil(perfil) {
  const kind = perfil && perfil.kind;
  if (!kind || kind === 'dir') return 'assinatura';
  return Object.hasOwn(TIPO_POR_KIND, kind) ? TIPO_POR_KIND[kind] : '';
}

const PERIODOS = [['dia', 'diário'], ['semana', 'semanal'], ['mes', 'mensal']];

function rotuloDoPeriodo(p) {
  const achado = PERIODOS.find(([id]) => id === p);
  return achado ? achado[1] : 'período não definido';
}

// As frases do que falta para ativar. O código desconhecido sai como está: esconder um
// requisito que a tela não conhece deixaria a lista parecer mais curta do que é.
const REQUISITOS = {
  compartilhamento: 'ligar o compartilhamento cifrado',
  'sem-grupo': 'o grupo precisa de identidade',
  'sem-teto': 'definir um teto',
  'medicao-pendente': 'medir o atraso real do consumo entre dois aparelhos',
};

function chip(classe, texto) {
  return `<span class="sync-chip ${classe}">${esc(texto)}</span>`;
}

function requisitosHtml(lista) {
  if (!lista.length) return '';
  const itens = lista.map((r) => `<li>${esc(Object.hasOwn(REQUISITOS, r) ? REQUISITOS[r] : r)}</li>`).join('');
  return `<div class="grupo-falta"><span class="grupo-rotulo">Para o teto valer aqui falta</span><ul>${itens}</ul></div>`;
}

// Os motivos do "não verificável", com o nome do aparelho que o engine apontou. Código
// desconhecido sai como está, com o aparelho entre parênteses.
const MOTIVOS = {
  'sem-dados': (quem) => `o ${quem} não enviou dados do período`,
  invalido: (quem) => `os dados do ${quem} vieram fora da forma`,
  lacuna: (quem) => `falta um trecho do consumo do ${quem}`,
  'reserva-vencida': (quem) => `uma reserva do ${quem} venceu sem o consumo chegar`,
  'retrato-velho': () => 'a soma deste aparelho está velha',
  'periodo-desconhecido': () => 'o período do grupo não é conhecido',
};

function nomeDoAparelho(devices, id) {
  const achado = (Array.isArray(devices) ? devices : []).find((d) => d && String(d.deviceId || '') === String(id || ''));
  return achado && achado.name ? String(achado.name) : String(id || 'aparelho');
}

function frasesDosMotivos(motivos, devices) {
  return motivos.map((m) => {
    const quem = nomeDoAparelho(devices, m.dev);
    return Object.hasOwn(MOTIVOS, m.motivo) ? MOTIVOS[m.motivo](quem) : `${m.motivo} (${m.dev || 'este aparelho'})`;
  });
}

function naoVerificavel(g, o) {
  const motivos = Array.isArray(g.motivos) ? g.motivos : [];
  const frases = frasesDosMotivos(motivos, o.devices);
  const porque = frases.length ? `: ${frases.join('; ')}` : ' agora';
  const texto = `O Farol não consegue somar o gasto do grupo com segurança${porque}. Enquanto isso, as revisões dos perfis deste grupo esperam, inclusive as de clique, sem estacionar. Voltam sozinhas quando a soma fechar.`;
  const extra = motivos.some((m) => m.dev) ? '<div class="row-actions"><span class="btn sm ghost" data-goto="sys:devices" role="button" tabindex="0">Ver aparelhos</span></div>' : '';
  return { borda: 'bad', selos: [chip('ok', 'ativo'), chip('bad', 'não verificável')], texto, extra };
}

function verificado(g) {
  const hora = Number(g.calculadoEm) > 0 ? chip('ok', `soma fechada às ${fmtClock(g.calculadoEm)}`) : '';
  if (g.tetoAtingido === true) {
    return { borda: 'bad', selos: [chip('ok', 'ativo'), chip('bad', 'teto atingido'), hora], texto: 'O teto é macio: sessões já em andamento terminam, e a projeção das reservas pode passar um pouco do limite. Nenhuma sessão nova abre por estes perfis até o período virar ou o teto mudar.' };
  }
  return { borda: '', selos: [chip('ok', 'ativo'), chip('ok', 'verificado'), hora], texto: 'O teto vale nos perfis controlados deste grupo, em todos os aparelhos que aceitam admin.' };
}

// A visão do cartão: selos, borda e a frase que diz o que o grupo faz AGORA. Uma derivação
// só, para selo, borda e texto nunca divergirem.
function visaoAtiva(g, faltam, o) {
  if (faltam) {
    return { borda: 'warn', selos: [chip('warn', 'marcado ativo, sem efeito neste aparelho')], texto: 'O admin marcou o teto como ativo, mas este aparelho não tem tudo o que o teto precisa. Enquanto faltar, nada é barrado por ele aqui: quem segura sessão é o orçamento de cada perfil.' };
  }
  if (g.verificavel === true) return verificado(g);
  if (g.verificavel === false) return naoVerificavel(g, o);
  return { borda: 'warn', selos: [chip('ok', 'ativo'), chip('mute', 'soma ainda não calculada')], texto: 'A soma do grupo ainda não foi calculada neste aparelho. Até ela fechar, o gasto não é afirmado.' };
}

function visaoDoGrupo(g, o) {
  const faltam = Array.isArray(g.requisitos) && g.requisitos.length > 0;
  if (g.estado === 'ativo') return visaoAtiva(g, faltam, o);
  if (g.estado === 'configurado') return { borda: 'off', selos: [chip('warn', 'teto configurado, ainda não ativo')], texto: 'O teto está guardado e não segura nenhuma sessão. Enquanto não estiver ativo, quem segura sessão é o orçamento de cada perfil.' };
  if (g.estado === 'sem-teto') return { borda: 'off', selos: [chip('mute', 'sem teto')], texto: 'Grupo sem teto: só soma, nada segura.' };
  return { borda: 'off', selos: [chip('mute', 'não identificado')], texto: 'Grupo sem identidade estável: não soma nem segura nada.' };
}

function gastoHtml(g) {
  const teto = typeof g.tetoUsd === 'number' ? ` de ${esc(fmtMoney(g.tetoUsd))}` : '';
  if (typeof g.custoUsd !== 'number') return `<span class="grupo-gasto grupo-vago">gasto ainda não calculado${teto}</span>`;
  const estimado = g.parcialmenteEstimado ? ` ${chip('mute', 'parcialmente estimado')}` : '';
  return `<span class="grupo-gasto">${esc(fmtMoney(g.custoUsd))}${teto}${estimado}</span>`;
}

// A projeção das reservas abertas é separada do gasto: ela é o que o gate soma por
// precaução, e não dinheiro que saiu.
function projecaoHtml(g) {
  if (!(typeof g.projecaoUsd === 'number' && g.projecaoUsd > 0)) return '';
  return `<span class="sync-dica">Projeção com as reservas abertas: ${esc(fmtMoney(g.projecaoUsd))} (projeção, não gasto).</span>`;
}

function rotuloDoPerfil(id, perfis) {
  const achado = (Array.isArray(perfis) ? perfis : []).find((p) => p && p.id === id);
  return achado && achado.label ? String(achado.label) : String(id);
}

function perfisDoGrupoHtml(g, perfis) {
  const controlados = Array.isArray(g.controlados) ? g.controlados : [];
  const nao = Array.isArray(g.naoControlados) ? g.naoControlados : [];
  const linhas = controlados.length
    ? controlados.map((id) => `<li>${esc(rotuloDoPerfil(id, perfis))}</li>`).join('')
    : '<li class="grupo-vago">nenhum perfil controlado vinculado</li>';
  const naoHtml = nao.length
    ? `<span class="grupo-rotulo">Não controlados</span><ul>${nao.map((id) => `<li>${esc(rotuloDoPerfil(id, perfis))} <span class="grupo-vago">o provedor não informa custo, e o perfil não entra na soma nem no teto</span></li>`).join('')}</ul>`
    : '';
  return `<div class="grupo-perfis"><span class="grupo-rotulo">Perfis controlados</span><ul>${linhas}</ul>${naoHtml}</div>`;
}

function acoesDoGrupo(g, souAdmin) {
  if (!souAdmin || !g.id) return '';
  const id = esc(g.id);
  const botoes = [`<button class="btn sm ghost" data-grupo-editar="${id}">Editar</button>`];
  const faltam = Array.isArray(g.requisitos) && g.requisitos.length > 0;
  if (g.ativo) botoes.push(`<button class="btn sm ghost" data-grupo-desativar="${id}">Desativar teto</button>`);
  else if (!faltam && g.estado === 'configurado') botoes.push(`<button class="btn sm primary" data-grupo-ativar="${id}">Ativar teto</button>`);
  return `<div class="row-actions">${botoes.join('')}</div>`;
}

export function grupoCartaoHtml(grupo, opcoes) {
  const g = grupo || {};
  const o = opcoes || {};
  const v = visaoDoGrupo(g, o);
  const periodo = g.periodo ? rotuloDoPeriodo(g.periodo) : 'período não definido';
  return `<div class="card sync-card ${v.borda} grupo-cartao">
    <div class="sync-topo"><span class="sync-titulo">${esc(g.nome || 'grupo sem nome')}</span>${v.selos.join('')}<span class="sync-espaco"></span><span class="sync-fraco">${esc(periodo)}</span></div>
    <div class="apar-corpo">
      <span class="set-desc">${esc(v.texto)}</span>
      ${v.extra || ''}
      <div class="grupo-linha"><span class="grupo-rotulo">Gasto no período</span>${gastoHtml(g)}</div>
      ${projecaoHtml(g)}
      ${requisitosHtml(Array.isArray(g.requisitos) ? g.requisitos : [])}
      ${perfisDoGrupoHtml(g, o.perfis)}
      ${acoesDoGrupo(g, o.souAdmin === true)}
    </div>
  </div>`;
}

/* ---------- perfis e vínculo ---------- */

// O vínculo é LOCAL e chega no snapshot (`vinculosDePerfis`), inclusive o de um grupo que
// ainda não chegou a este aparelho: esse perfil segue vinculado, e a tela diz isso em vez
// de oferecer um vínculo novo por cima.
// A outra fonte, a lista de perfis do próprio grupo, sai do MESMO arquivo de vínculos no
// engine (resumoDoGrupo), então as duas nunca se contradizem.
function vinculoDoPerfil(perfilId, grupos, vinculos) {
  const v = vinculos && Object.hasOwn(vinculos, perfilId) ? vinculos[perfilId] : null;
  if (v) return { grupo: grupos.find((g) => g.id === v.grupo) || null };
  const membro = grupos.find((g) => [...(g.controlados || []), ...(g.naoControlados || [])].includes(perfilId));
  return membro ? { grupo: membro } : null;
}

function seletorDeGrupo(perfilId, grupos) {
  const opcoes = grupos.map((g) => `<option value="${esc(g.id)}">${esc(g.nome || g.id)}</option>`).join('');
  return `<select class="sync-input grupo-vinc-sel" data-perfil="${esc(perfilId)}" aria-label="Grupo para vincular">${opcoes}</select>`;
}

function linhaDoPerfil(p, grupos, vinculos) {
  const id = String(p.id || '');
  const tipo = grupoTipoDoPerfil(p);
  const atual = vinculoDoPerfil(id, grupos, vinculos);
  const rotulo = `<span class="sync-nome">${esc(p.label || id)} <span class="sync-fraco">${esc(tipo || 'tipo desconhecido')}</span></span>`;
  const desvincular = `<button class="btn sm ghost" data-grupo-desvincular="${esc(id)}">Desvincular</button>`;
  if (atual && atual.grupo) return `<div class="grupo-perfil">${rotulo}<span>${chip('info', `no ${atual.grupo.nome || atual.grupo.id}`)}</span>${desvincular}</div>`;
  if (atual) return `<div class="grupo-perfil">${rotulo}<span>${chip('warn', 'vinculado a um grupo que não chegou a este aparelho')}</span>${desvincular}</div>`;
  const vincular = tipo && grupos.length
    ? `<span class="grupo-vinc">${seletorDeGrupo(id, grupos)}<button class="btn sm" data-grupo-vincular="${esc(id)}">Vincular</button></span>`
    : '';
  return `<div class="grupo-perfil">${rotulo}<span>${chip('mute', 'sem grupo')}</span>${vincular}</div>`;
}

// Sem perfil salvo, o Farol roda na assinatura da máquina, que não tem id estável: ela não
// entra em grupo, e com teto de grupo ativo o engine a trata como não identificada.
function semPerfilHtml() {
  return `<div class="grupo-perfil"><span class="sync-nome">Assinatura em uso</span><span>${chip('mute', 'não identificado')}</span><span class="btn sm ghost" data-goto="sys:plans" role="button" tabindex="0">Abrir Plano e chaves</span></div>
    <p class="apar-nota">Nenhum perfil salvo em Plano e chaves: a assinatura em uso fica sem id estável e não entra em grupo nenhum. Com um teto de grupo ativo, o que depende dele espera. Crie ou adote um perfil para poder vincular.</p>`;
}

export function gruposPerfisHtml(perfis, grupos, vinculos) {
  const lista = Array.isArray(perfis) ? perfis.filter((p) => p && p.id) : [];
  const comId = (Array.isArray(grupos) ? grupos : []).filter((g) => g && g.id);
  const vazio = comId.length ? '' : '<p class="sync-vago sync-vazio">Nenhum grupo com identidade chegou a este aparelho, então não há onde vincular.</p>';
  const mapa = vinculos && typeof vinculos === 'object' ? vinculos : {};
  const corpo = lista.length ? lista.map((p) => linhaDoPerfil(p, comId, mapa)).join('') : semPerfilHtml();
  return `<div class="sync-sub-head">Perfis e vínculo</div>
  <div class="card sync-lista">${corpo}${vazio}
    <p class="apar-nota">Vincular é local e explícito: não mexe no banco, não transfere credencial e não autoriza nada novo. O gasto já registrado fica no grupo em que foi feito.</p>
  </div>`;
}

/* ---------- formulário e corpo da rota ---------- */

// O id do grupo é SORTEADO (lib/sync/grupo.js), nunca derivado de nome ou credencial. A
// entropia vem da tela (crypto.getRandomValues); aqui só vira o formato que o engine aceita.
export function grupoNovoId(bytes) {
  const lista = Array.from(bytes || []);
  if (lista.length < 16) return '';
  return lista.slice(0, 16).map((b) => (Number(b) & 255).toString(16).padStart(2, '0')).join('');
}

function tetoDoTexto(v) {
  const t = String(v === undefined || v === null ? '' : v).trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// Teto vazio ou inválido é OMITIDO, nunca zero: zero é "teto de nada", mais restritivo do
// que o dono pediu (mesma regra de tetoDe, em lib/sync/grupo.js).
export function grupoCorpoDaRota(form) {
  const f = form || {};
  const corpo = { id: String(f.id || ''), nome: String(f.nome || '').trim(), periodo: String(f.periodo || '') };
  const teto = tetoDoTexto(f.teto);
  if (teto !== null) corpo.tetoUsd = teto;
  if (typeof f.ativo === 'boolean') corpo.ativo = f.ativo;
  return corpo;
}

// Publicar é substituir o nó inteiro: ativar ou desativar precisa reenviar nome, período e
// teto, senão o grupo voltaria sem eles.
export function grupoCorpoDoGrupo(grupo, ativo) {
  const g = grupo || {};
  const corpo = { id: String(g.id || ''), nome: String(g.nome || ''), periodo: String(g.periodo || '') };
  if (typeof g.tetoUsd === 'number') corpo.tetoUsd = g.tetoUsd;
  corpo.ativo = ativo === true;
  return corpo;
}

export function grupoFormHtml(grupo) {
  const g = grupo || {};
  const titulo = g.id ? `Editar ${g.nome || 'grupo'}` : 'Novo grupo';
  const opcoes = PERIODOS.map(([id, rotulo]) => `<option value="${id}"${g.periodo === id ? ' selected' : ''}>${esc(rotulo)}</option>`).join('');
  const teto = typeof g.tetoUsd === 'number' ? String(g.tetoUsd) : '';
  return `<div class="card apar-corpo grupo-form" data-grupo-id="${esc(g.id || '')}">
    <span class="sync-titulo">${esc(titulo)}</span>
    <div class="apar-grade">
      <span class="sync-campo"><label for="grupoNome">Nome</label><input id="grupoNome" class="sync-input" type="text" value="${esc(g.nome || '')}" maxlength="80" spellcheck="false" autocomplete="off"></span>
      <span class="sync-campo"><label for="grupoPeriodo">Período</label><select id="grupoPeriodo" class="sync-input">${opcoes}</select></span>
      <span class="sync-campo"><label for="grupoTeto">Teto em US$ (vazio: sem teto)</label><input id="grupoTeto" class="sync-input" type="text" inputmode="decimal" value="${esc(teto)}" autocomplete="off"></span>
    </div>
    <span class="sync-dica">Salvar não ativa o teto. Ativar é um passo à parte, só possível quando nada faltar.</span>
    <div class="row-actions"><button class="btn sm primary" id="grupoSalvar">Salvar grupo</button><button class="btn sm ghost" id="grupoCancelar">Cancelar</button></div>
  </div>`;
}

/* ---------- a seção inteira ---------- */

function desligadaHtml() {
  return `<div class="card apar-corpo">
    <span class="set-title">A sincronização entre dispositivos está desligada</span>
    <span class="set-desc">Grupos de consumo somam o gasto de vários aparelhos e só existem com a sincronização ligada.</span>
    <div class="row-actions"><span class="btn sm" data-goto="sys:sync" role="button" tabindex="0">Abrir Sincronização</span></div>
  </div>`;
}

// Por que a lista pode estar vazia sem ser vazio legítimo. A ordem é a das recusas do
// aceite (sync-grupo.js): compartilhamento primeiro, consentimento depois.
function avisoDaOrigem(s, cfg) {
  if (s.shared !== true) return '<div class="callout warn apar-aviso"><span>O compartilhamento cifrado está desligado: nenhum grupo é lido nem publicado, e nenhum teto de grupo vale aqui.</span></div>';
  if (cfg.aceitarAdmin !== true) return '<div class="callout warn apar-aviso"><span>Este aparelho não aceita configuração de admin, então os grupos publicados não chegam aqui. <span class="btn sm" data-goto="sys:devices" role="button" tabindex="0">Ver o consentimento em Aparelhos</span></span></div>';
  return '';
}

export function gruposSecaoHtml(entrada) {
  const e = entrada || {};
  const cfg = e.cfg || {};
  if (cfg.enabled !== true) return desligadaHtml();
  const s = e.sync || {};
  const grupos = Array.isArray(s.gruposDeConsumo) ? s.gruposDeConsumo : [];
  const souAdmin = e.souAdmin === true;
  const topo = souAdmin
    ? '<div class="row-actions"><button class="btn sm" id="grupoNovo">Novo grupo</button></div>'
    : '<p class="apar-nota">Só o admin cria e ativa grupos. Este aparelho vê e vincula.</p>';
  const lista = grupos.length
    ? grupos.map((g) => grupoCartaoHtml(g, { perfis: e.perfis, souAdmin, devices: s.devices })).join('')
    : '<div class="card"><p class="sync-vago sync-vazio">Nenhum grupo de consumo neste aparelho.</p></div>';
  return `${avisoDaOrigem(s, cfg)}${topo}
    ${e.form ? grupoFormHtml(e.form.grupo) : ''}
    ${pendentesHtml(e.pendentes, grupos, cfg)}
    ${lista}
    ${gruposPerfisHtml(e.perfis, grupos, s.vinculosDePerfis)}`;
}

// O grupo publicado daqui só entra na lista quando o aceite do relógio o lê do banco, e o
// aceite exige consentimento também neste aparelho. Enquanto isso, o que foi publicado
// aparece como publicado, com a versão que a rota devolveu, e nunca como grupo valendo.
function pendentesHtml(pendentes, grupos, cfg) {
  const chegaram = new Set(grupos.map((g) => g && g.id));
  const lista = (Array.isArray(pendentes) ? pendentes : []).filter((p) => p && p.id && !chegaram.has(p.id));
  const quando = cfg.aceitarAdmin === true
    ? 'aparece aqui quando o próximo ciclo o aceitar.'
    : 'mas este aparelho não aceita configuração de admin, então o grupo não volta para esta lista enquanto o consentimento estiver desligado.';
  return lista.map((p) => `<div class="card sync-card off grupo-cartao"><div class="sync-topo"><span class="sync-titulo">${esc(p.nome || 'grupo sem nome')}</span>${chip('mute', 'esperando o aceite')}</div>
    <div class="apar-corpo"><span class="set-desc">Grupo publicado na versão ${Number(p.versao) || 0}; ${quando}</span></div></div>`).join('');
}
