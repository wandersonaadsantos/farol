// Sistema > Aparelhos: a lista dos aparelhos da conta de sincronização, quem administra o
// conjunto, a política de um aparelho, os navegadores pareados com ESTE aparelho e os dois
// atos irreversíveis (limpeza protegida e revogação).
//
// Tudo aqui é PURO: recebe a projeção `STATE.sync` (statusForUi, em lib/engine/sync.js), a
// config e o que a tela leu sob demanda (status de autenticação, sessões, estado da chave
// de limpeza), e devolve HTML. Nenhuma regra é recalculada deste lado: se o engine não
// afirma, a tela não afirma.
//
// TRÊS COISAS QUE ESTA SEÇÃO NÃO PODE FAZER, e que os testes guardam:
//
// 1. Mostrar proteção desligada como ativa. Admin sem batimento recente não vale (a
//    política dele não é aplicada), e a tela diz isso com a mesma palavra que o engine usa
//    (`fresca`). Chave de limpeza "desligada ou não verificável" não vira "ligada" nem
//    "desligada": ela é um terceiro estado, porque o banco não confirmou nada.
// 2. Disfarçar falha de vazio. Navegadores pareados e chave de limpeza são LEITURAS, e cada
//    uma tem cinco saídas distintas: carregando, vazio legítimo, falha com motivo,
//    indisponível (dependência fora) e desligado (escolha de quem usa).
// 3. Oferecer um ato onde ele não pode acontecer. Publicar política, ligar a chave de
//    limpeza e limpar são do admin da geração vigente; aposentar um aparelho já aposentado
//    não existe. Botão que não faz nada é pior que botão nenhum (doutrina das menções
//    navegáveis, no CLAUDE.md).
//
// Aposentar NÃO é revogar (lib/engine/sync-aparelho.js): não apaga dado, não tira chave,
// não depõe admin, e tem volta. O texto da tela repete isso porque é o que evita o clique
// com medo, e o clique com medo é o que faz ninguém aposentar aparelho nenhum.
import { esc, fmtWhenDay } from './comum.js';

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

function nomeDe(d) {
  const o = d || {};
  return String(o.name || o.deviceId || 'aparelho');
}

// O engine identifica o aparelho não coberto por nome, e cai no id quando não há nome
// (lib/sync/cobertura-postagem.js). A tela casa pela MESMA regra: casar só por nome
// deixaria o aparelho sem nome invisível justamente no aviso que importa.
export function aparelhosContasNaoCobertas(cobertura, aparelho) {
  const lista = Array.isArray(cobertura) ? cobertura : [];
  const quem = nomeDe(aparelho);
  return lista.filter((c) => Array.isArray(c && c.naoCobertaPor) && c.naoCobertaPor.includes(quem)).map((c) => String(c.account || ''));
}

function chipsDoAparelho(d, opcoes) {
  const o = opcoes || {};
  const admin = o.admin || {};
  const chips = [];
  if (d.euMesmo) chips.push(chip('mute', 'este'));
  if (String(admin.deviceId || '') === String(d.deviceId || '')) chips.push(chip('warn', 'admin'));
  if (Number(d.retiredAt) > 0) chips.push(chip('mute', 'aposentado'));
  if (aparelhosContasNaoCobertas(o.cobertura, d).length) chips.push(chip('bad', 'garantia não coberta'));
  return chips.join('');
}

function acoesDoAparelho(d, souAdmin) {
  const id = esc(String(d.deviceId || ''));
  const botoes = [`<button class="btn sm ghost" data-apar-renomear="${id}">Renomear</button>`];
  if (souAdmin) botoes.push(`<button class="btn sm ghost" data-apar-politica="${id}">Política</button>`);
  if (Number(d.retiredAt) > 0) botoes.push(`<button class="btn sm ghost" data-apar-reativar="${id}">Reativar</button>`);
  else botoes.push(`<button class="btn sm ghost" data-apar-aposentar="${id}">Aposentar</button>`);
  return `<span class="row-actions">${botoes.join('')}</span>`;
}

function linhaDoAparelho(d, opcoes) {
  const o = opcoes || {};
  // aparelho em versão antiga ainda não publica a versão: "desconhecida" é honesto, e
  // vazio pareceria um aparelho sem app
  const versao = d.farolVersion ? `v${d.farolVersion}` : 'desconhecida';
  const visto = Number(d.lastSeenAt) > 0 ? fmtWhenDay(d.lastSeenAt, o.agora) : 'nunca';
  return `<div class="apar-linha"><span class="sync-nome">${esc(nomeDe(d))}${chipsDoAparelho(d, o)}</span><span class="sync-fraco">${esc(d.platform || 'sistema desconhecido')}</span><span class="sync-fraco">${esc(versao)}</span><span class="sync-fraco">${esc(visto)}</span>${acoesDoAparelho(d, o.souAdmin === true)}</div>`;
}

function notaDaCobertura(devices, cobertura) {
  const contas = new Set();
  for (const d of devices) for (const c of aparelhosContasNaoCobertas(cobertura, d)) contas.add(c);
  if (!contas.size) return '';
  const nomes = [...contas].map((c) => esc(c)).join(', ');
  return `<p class="apar-nota">"Garantia não coberta": um aparelho em versão anterior à da postagem coordenada não participa da arbitragem. Nas contas que ele também revisa (${nomes}), dois Farois podem postar no mesmo PR até ele ser atualizado.</p>`;
}

export function aparelhosListaHtml(devices, opcoes) {
  const lista = Array.isArray(devices) ? devices : [];
  const o = opcoes || {};
  if (!lista.length) return '<div class="card sync-lista"><p class="sync-vago sync-vazio">Nenhum aparelho registrado ainda. O primeiro aparece assim que a conexão sobe.</p></div>';
  const linhas = lista.map((d) => linhaDoAparelho(d || {}, o)).join('');
  return `<div class="card sync-lista">
    <div class="apar-linha apar-head"><span>aparelho</span><span>sistema</span><span>versão</span><span>visto por último</span><span></span></div>
    ${linhas}
    ${notaDaCobertura(lista, o.cobertura)}
  </div>`;
}

/* ---------- administração ---------- */

function campoDeSenha(id, rotulo) {
  // A senha é lida do DOM no instante do clique e some com a repintura: ela nunca entra no
  // estado nem em nada que o snapshot carregue (mesmo contrato do login do Firebase).
  return `<span class="sync-campo"><label for="${esc(id)}">${esc(rotulo)}</label><input id="${esc(id)}" class="sync-input" type="password" placeholder="senha da sincronização" spellcheck="false" autocomplete="off"></span>`;
}

function nomeDoDevice(devices, deviceId) {
  const lista = Array.isArray(devices) ? devices : [];
  const achado = lista.find((d) => d && String(d.deviceId || '') === String(deviceId || ''));
  return achado ? nomeDe(achado) : String(deviceId || 'aparelho desconhecido');
}

function adminSemAdmin() {
  return {
    classe: 'off', selo: chip('mute', 'sem admin'),
    texto: 'Ninguém administra este conjunto ainda. Sem admin, cada aparelho vale pela própria configuração: nada é pausado, limitado ou agrupado de fora.',
  };
}

function adminComigo(admin) {
  if (admin.fresca) {
    return { classe: '', selo: chip('ok', 'este aparelho é o admin'), texto: `Este aparelho é o admin da geração ${Number(admin.generation) || 0}, com batimento em dia. Políticas, grupos e comandos publicados daqui valem nos aparelhos que aceitam admin.` };
  }
  return { classe: 'warn', selo: chip('warn', 'admin sem sinal de vida'), texto: `Este aparelho é o admin da geração ${Number(admin.generation) || 0}, mas o batimento dele não está recente. Enquanto isso, o que ele publica não é aplicado: cada aparelho segue a própria configuração, e nada fica mais permissivo por causa da queda.` };
}

function adminDeOutro(admin, nome) {
  if (admin.fresca) {
    return { classe: '', selo: chip('info', 'admin em outro aparelho'), texto: `O admin vigente é o ${nome}, na geração ${Number(admin.generation) || 0}, com batimento em dia.` };
  }
  return { classe: 'warn', selo: chip('warn', 'admin sem sinal de vida'), texto: `O admin vigente é o ${nome}, sem batimento recente. Políticas e comandos dele não valem enquanto isso: cada aparelho segue a própria configuração, e nada fica mais permissivo por causa da queda.` };
}

function visaoDoAdmin(admin, devices) {
  if (!admin || !admin.deviceId) return adminSemAdmin();
  if (admin.souEu === true) return adminComigo(admin);
  return adminDeOutro(admin, nomeDoDevice(devices, admin.deviceId));
}

// Quem já é o admin da geração vigente não vira admin de novo: o ato existe para TROCAR a
// autoridade, e oferecê-lo aqui geraria uma geração nova sem nada mudar.
function tornarAdminHtml(admin) {
  if (admin && admin.souEu === true && admin.fresca === true) return '';
  const proxima = (Number(admin && admin.generation) || 0) + 1;
  return `<div class="apar-acao">
    ${campoDeSenha('aparSenhaAdmin', 'Senha da sincronização')}
    <button class="btn sm primary" id="aparTornarAdmin">Tornar este aparelho admin</button>
    <span class="sync-dica">Isso cria a geração ${proxima}. O admin anterior perde a autoridade, e a senha é usada só agora, sem ser guardada.</span>
  </div>`;
}

export function aparelhosAdminHtml(admin, opcoes) {
  const o = opcoes || {};
  const v = visaoDoAdmin(admin, o.devices);
  const geracao = admin && admin.deviceId ? `<span class="sync-fraco">geração ${Number(admin.generation) || 0}</span>` : '';
  return `<div class="card sync-card ${v.classe}">
    <div class="sync-topo"><span class="sync-titulo">Administração</span>${v.selo}<span class="sync-espaco"></span>${geracao}</div>
    <div class="apar-corpo">
      <span class="set-desc">${esc(v.texto)}</span>
      ${tornarAdminHtml(admin)}
    </div>
  </div>`;
}

// O pedido de designação (C6) não vira admin sozinho: ninguém assume autoridade sem a senha
// digitada NESTE aparelho, e é por isso que aceitar é o mesmo ato de tornar-se admin.
export function aparelhosDesignacaoHtml(designacao, agora) {
  if (!designacao) return '';
  const desde = Number(designacao.desde) > 0 ? ` (pedido ${esc(fmtWhenDay(designacao.desde, agora))})` : '';
  return `<div class="card apar-corpo">
    <span class="set-title">Pedido para este aparelho ser o admin${desde}</span>
    <span class="set-desc">Um comando designou este aparelho como admin. Ninguém vira admin sem a senha digitada aqui: aceitar publica uma geração nova e guarda a chave privada só neste aparelho.</span>
    ${campoDeSenha('aparSenhaDesignacao', 'Senha da sincronização')}
    <div class="row-actions"><button class="btn sm primary" id="aparAceitarDesignacao">Aceitar com a senha</button></div>
  </div>`;
}

/* ---------- consentimento ---------- */

// o .switch tem que ser IRMÃO IMEDIATO do input, senão ele para de refletir o estado sem
// erro nenhum (salva certo e parece desligado); ver o comentário em ui/app.css
export function aparelhosConsentimentoHtml(cfg) {
  const marcado = cfg && cfg.aceitarAdmin === true ? ' checked' : '';
  return `<div class="card set-list">
    <label class="set-row" id="sys-row-setSyncAceitarAdmin">
      <span class="set-txt"><span class="set-title">Aceitar políticas e comandos do admin</span><span class="set-desc">Sem isto, este aparelho ignora pausa, teto de paralelismo, grupo de consumo e comandos vindos do admin. Retirar vale na hora, e a última política aceita é esquecida junto.</span></span>
      <span class="set-ctl"><input type="checkbox" id="setSyncAceitarAdmin"${marcado}><span class="switch"></span></span>
    </label>
  </div>`;
}

/* ---------- política de um aparelho ---------- */

function opcoesDoTeto() {
  return APARELHOS_TETOS.map((n) => `<option value="${n}">${n} sessão(ões)</option>`).join('');
}

function caixasDosTipos() {
  return APARELHOS_TIPOS.map(([id, rotulo]) => `<label class="apar-tipo"><input type="checkbox" class="apar-tipo-check" value="${esc(id)}" checked> ${esc(rotulo)}</label>`).join('');
}

export function aparelhoPoliticaHtml(aparelho, opcoes) {
  if (!aparelho || !aparelho.deviceId) return '';
  const o = opcoes || {};
  const recusa = o.recusa ? `<p class="apar-recusa">${esc(o.recusa)}</p>` : '';
  return `<div class="card apar-corpo">
    <div class="apar-titulo"><span class="sync-titulo">Política do ${esc(nomeDe(aparelho))}</span><span class="sync-espaco"></span><button class="btn sm ghost" id="aparFecharPolitica">Fechar</button></div>
    <span class="set-desc">A política só RESTRINGE: nada do que chega pelo banco amplia o que o aparelho já permite. O aparelho de destino só aplica se ele aceitar admin, se a assinatura for da geração vigente e se o admin tiver batimento recente.</span>
    <div class="apar-grade">
      <label class="apar-campo"><span>Pausado</span><span class="set-ctl"><input type="checkbox" id="aparPolPausado"><span class="switch"></span></span></label>
      <label class="apar-campo" for="aparPolTeto"><span>Teto de paralelismo</span><select id="aparPolTeto" class="sync-input">${opcoesDoTeto()}</select></label>
      <div class="apar-campo"><span>Tipos permitidos</span><div class="apar-tipos">${caixasDosTipos()}</div></div>
    </div>
    ${recusa}
    <div class="row-actions"><button class="btn sm primary" id="aparPublicarPolitica">Publicar política</button></div>
  </div>`;
}

/* ---------- navegadores pareados ---------- */

function linhaDaSessao(s, agora) {
  const atual = s.atual ? chip('info', 'este navegador') : '';
  const criado = Number(s.criadoEm) > 0 ? `pareado ${fmtWhenDay(s.criadoEm, agora)}` : 'pareado em data desconhecida';
  const usado = Number(s.ultimoUsoEm) > 0 ? `usado ${fmtWhenDay(s.ultimoUsoEm, agora)}` : 'nunca usado';
  return `<div class="sync-linha"><span class="sync-nome">${esc(s.rotulo || 'navegador sem rótulo')}${atual}</span><span class="sync-fraco">${esc(criado)}</span><span class="sync-fraco">${esc(usado)}</span><button class="btn sm ghost" data-apar-revogar-sessao="${esc(String(s.id || ''))}">Revogar</button></div>`;
}

// Cinco saídas, nunca uma só: quem lê precisa distinguir "ainda não sei" de "não há" e de
// "não deu para saber".
const NAVEGADORES_AVISO = {
  carregando: 'carregando as sessões pareadas…',
  'nao-exigida': 'A API local deste aparelho não exige credencial, então não há navegador pareado. A exigência é configurada fora desta tela.',
};

function corpoDosNavegadores(auth, agora) {
  const a = auth || {};
  if (Object.hasOwn(NAVEGADORES_AVISO, a.estado)) return `<p class="sync-vago sync-vazio">${esc(NAVEGADORES_AVISO[a.estado])}</p>`;
  if (a.estado === 'falha') return `<p class="apar-recusa">Não deu para ler as sessões: ${esc(a.motivo || 'o servidor não respondeu')}.</p>`;
  const lista = Array.isArray(a.sessoes) ? a.sessoes : [];
  if (!lista.length) return '<p class="sync-vago sync-vazio">Nenhum navegador pareado com este aparelho agora.</p>';
  return lista.map((s) => linhaDaSessao(s || {}, agora)).join('');
}

export function aparelhosNavegadoresHtml(auth, agora) {
  return `<div class="sync-sub-head">Navegadores pareados com este aparelho</div>
  <div class="card sync-lista">${corpoDosNavegadores(auth, agora)}
    <p class="apar-nota">Revogar o navegador que você está usando leva direto ao pareamento. Para revogar todos de uma vez, no terminal: <code>node tools/farol-parear.js --revogar-todas</code>.</p>
  </div>`;
}

/* ---------- limpeza e revogação ---------- */

// A chave de limpeza tem QUATRO respostas do engine mais dois estados da tela, e cada uma
// diz uma coisa diferente sobre o que dá para fazer. "Desligada ou não verificável" é o
// caso em que o banco não confirmou a chave: oferecer limpar ali seria prometer um ato que
// o servidor vai recusar.
const LIMPEZA = {
  carregando: { classe: 'mute', selo: 'carregando', texto: 'carregando o estado da chave de limpeza…' },
  'compartilhamento-desligado': { classe: 'mute', selo: 'não se aplica', texto: 'O compartilhamento cifrado está desligado, então não há dado sincronizado para apagar.' },
  desligada: { classe: 'mute', selo: 'desligada', texto: 'A limpeza de dados sincronizados está desligada. Ligar é ato do admin, e a chave fica registrada no banco.' },
  ligada: { classe: 'warn', selo: 'ligada', texto: 'A limpeza está liberada. Ela apaga o conteúdo sincronizado das categorias alcançáveis, em todos os aparelhos, e não tem volta.' },
  'desligada-ou-nao-verificavel': { classe: 'bad', selo: 'não confirmada', texto: 'O banco não dá para confirmar a chave de limpeza agora (ela pode estar desligada, ou a autoridade do admin não está verificável). Enquanto isso a limpeza não é oferecida, e apagar dado compartilhado fica no console do Firebase.' },
};

const LIMPEZA_FALHA = { classe: 'bad', selo: 'falha na leitura', texto: '' };

function visaoDaLimpeza(limpeza) {
  const l = limpeza || {};
  if (l.estado === 'falha') return { ...LIMPEZA_FALHA, texto: `Não deu para ler a chave de limpeza: ${l.motivo || 'o servidor não respondeu'}.` };
  return LIMPEZA[l.estado] || LIMPEZA.carregando;
}

function acoesDaLimpeza(limpeza, souAdmin) {
  const estado = (limpeza || {}).estado;
  if (!souAdmin) return '';
  if (estado === 'desligada') return '<div class="row-actions"><button class="btn sm" id="aparLigarLimpeza">Ligar a chave de limpeza</button></div>';
  if (estado === 'ligada') return '<div class="row-actions"><button class="btn sm ghost" id="aparDesligarLimpeza">Desligar a chave</button><button class="btn sm danger-ghost" id="aparLimpar">Limpar com a senha…</button></div>';
  return '';
}

export function aparelhosLimpezaHtml(limpeza, opcoes) {
  const o = opcoes || {};
  const v = visaoDaLimpeza(limpeza);
  return `<div class="sync-sub-head">Limpeza e revogação</div>
  <div class="apar-duo">
    <div class="card apar-corpo">
      <div class="apar-titulo"><span class="set-title">Chave de limpeza</span>${chip(v.classe, v.selo)}</div>
      <span class="set-desc">${esc(v.texto)}</span>
      ${acoesDaLimpeza(limpeza, o.souAdmin === true)}
      <span class="sync-dica">Nunca apagados pelo app: chaveiro, posses, recibos, rodadas do dia e o controle do conjunto.</span>
    </div>
    <div class="card apar-corpo">
      <span class="set-title">Revogar o conjunto</span>
      <span class="set-desc">Corta todos os acessos anteriores a agora e obriga cada aparelho a entrar de novo. Não cancela sessão em andamento em outro aparelho, não apaga o que eles já receberam e não depõe o admin.</span>
      <div class="row-actions"><button class="btn sm danger-ghost" id="aparRevogar">Revogar com a senha…</button></div>
    </div>
  </div>`;
}

/* ---------- a seção inteira ---------- */

// "Sou o admin" para OFERECER ato de admin exige as duas coisas que o engine exige para o
// ato valer: ser o dono da geração vigente E ter batimento recente. Admin sem sinal de vida
// publica política que ninguém aplica, e oferecer o botão ali seria prometer efeito.
export function aparelhosSouAdmin(admin) {
  return !!(admin && admin.souEu === true && admin.fresca === true);
}

function desligadaHtml() {
  return `<div class="card apar-corpo">
    <span class="set-title">A sincronização entre dispositivos está desligada</span>
    <span class="set-desc">Sem ela não existe conjunto de aparelhos: nada é publicado, nada é lido e não há admin. Ligue a chave geral para administrar aparelhos aqui.</span>
    <div class="row-actions"><span class="btn sm" data-goto="sys:sync" role="button" tabindex="0">Abrir Sincronização</span></div>
  </div>`;
}

export function aparelhosSecaoHtml(entrada) {
  const e = entrada || {};
  const cfg = e.cfg || {};
  if (cfg.enabled !== true) return desligadaHtml();
  const s = e.sync || {};
  const admin = s.admin || null;
  const souAdmin = aparelhosSouAdmin(admin);
  return `${aparelhosAdminHtml(admin, { devices: s.devices })}
    ${aparelhosDesignacaoHtml(s.designacaoAdmin, e.agora)}
    <div class="sync-sub-head">Aparelhos da conta</div>
    ${aparelhosListaHtml(s.devices, { cobertura: s.coberturaPostagem, admin: admin || {}, agora: e.agora, souAdmin })}
    ${aparelhoPoliticaHtml(e.politicaDe, { recusa: e.politicaRecusa })}
    ${aparelhosConsentimentoHtml(cfg)}
    ${aparelhosNavegadoresHtml(e.auth, e.agora)}
    ${aparelhosLimpezaHtml(e.limpeza, { souAdmin })}`;
}
