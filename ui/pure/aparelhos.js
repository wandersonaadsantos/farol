// Sistema > Aparelhos: a lista dos aparelhos da conta de sincronização, quem administra o
// conjunto, o consentimento deste aparelho e a montagem da seção inteira. A política de um
// aparelho mora em aparelhos-politica.js; navegadores, limpeza e revogação, em
// aparelhos-limpeza.js.
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
import { esc, fmtWhenDay, fmtSpan } from './comum.js';
import { capacidadesIndisponiveisHtml } from './capacidades.js';
import { syncOlhoHtml } from './sync.js';
import { aparelhoPoliticaHtml } from './aparelhos-politica.js';
import { aparelhosNavegadoresHtml, aparelhosLimpezaHtml } from './aparelhos-limpeza.js';

const MINUTO_MS = 60 * 1000;

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

// "Sem presença" é do engine (mesma janela da frota); a tela só dá o selo.
function chipsDoAparelho(d, opcoes) {
  const o = opcoes || {};
  const admin = o.admin || {};
  const chips = [];
  if (d.euMesmo) chips.push(chip('mute', 'este'));
  if (String(admin.deviceId || '') === String(d.deviceId || '')) chips.push(chip('warn', 'admin'));
  if (Number(d.retiredAt) > 0) chips.push(chip('mute', 'aposentado'));
  if (d.semPresenca === true) chips.push(chip('mute', 'sem presença'));
  if (aparelhosContasNaoCobertas(o.cobertura, d).length) chips.push(chip('bad', 'garantia não coberta'));
  return chips.join('');
}

// DESIGNAR OUTRO ADMIN (C6) não promove ninguém: o comando acende o pedido no aparelho de
// destino, e quem promove é a senha digitada LÁ. Por isso a ação só existe para outro
// aparelho, vivo e não aposentado, e o desfecho fica pendente até o recibo de lá.
export function aparelhosDesignarAcao(d, ctx) {
  const x = ctx || {};
  const a = d || {};
  if (a.euMesmo === true) return { pode: false, motivo: 'este aparelho já decide a própria autoridade em "Tornar este aparelho admin"' };
  if (x.souAdmin !== true) return { pode: false, motivo: 'só o aparelho admin, com sinal fresco, designa outro admin' };
  if (Number(a.retiredAt) > 0) return { pode: false, motivo: 'aparelho aposentado' };
  if (a.semPresenca === true) return { pode: false, motivo: 'sem presença recente, e o pedido venceria antes de ele ler' };
  if (a.contract !== 2 || a.keyReady !== true) return { pode: false, motivo: 'em versão antiga ou sem a chave do conjunto aberta' };
  return { pode: true, motivo: '' };
}

// O texto que a pessoa lê ANTES de mandar: o que acontece, e o que não acontece.
export function aparelhosDesignarConfirmacao(nome) {
  return {
    title: `Designar o ${nome} como admin?`,
    body: `<p><b>Acontece:</b> um pedido acende no <b>${esc(nome)}</b>, e ele vira admin só quando alguém digitar a senha da sincronização lá. O desfecho aparece aqui quando ele responder: aceito ou recusado.</p>
      <p><b>Não acontece:</b> nada muda no admin vigente agora, nenhuma geração nova é criada daqui, e nenhuma senha é pedida neste aparelho.</p>`,
  };
}

// Enquanto o recibo não chega, o pedido é PENDENTE, e vencido não quer dizer recusado: o
// aparelho pode ter lido e estar esperando a senha. A tela diz as duas possibilidades em
// vez de escolher uma.
export function aparelhosDesignacaoPendente(comandos, recibos, deviceId) {
  const lista = (Array.isArray(comandos) ? comandos : []).filter((c) => c && c.tipo === 'designar-admin' && c.alvo === deviceId);
  if (!lista.length) return '';
  const cmd = lista[0];
  const recibo = (recibos || {})[cmd.cmdId] || null;
  if (recibo && recibo.estado === 'aplicado') return '';
  if (recibo && recibo.estado === 'recusado') return chip('bad', 'recusou ser admin');
  if (recibo && recibo.estado === 'ignorado') return chip('mute', 'ignorou a designação');
  return chip('info', 'designação pendente');
}

// O admin vê o ato ou o motivo dele não caber: aparelho aposentado, sem presença ou em
// versão antiga não vira admin, e o silêncio ali pareceria esquecimento da tela.
function designarHtml(d, souAdmin) {
  const acao = aparelhosDesignarAcao(d, { souAdmin });
  if (acao.pode) return `<button class="btn sm ghost" data-apar-designar="${esc(String(d.deviceId || ''))}">Designar como admin</button>`;
  if (!souAdmin || d.euMesmo === true) return '';
  return `<span class="sync-fraco">designar: ${esc(acao.motivo)}</span>`;
}

// Aposentar e reativar são de quem administra (lib/engine/sync-aparelho.js), e renomear
// OUTRO aparelho também: os dois escrevem no registro alheio. Renomear a SI MESMO fica com
// todo mundo, porque é o mesmo ato do campo "Nome deste aparelho" em Sincronização.
//
// A tela não é a barreira, o engine é. Esconder o botão aqui evita oferecer um ato que vai
// ser recusado; e o clique reconfere a autoridade, porque um snapshot novo pode tirá-la
// entre o desenho da linha e o clique.
function aposentarHtml(d, souAdmin) {
  if (!souAdmin) return '';
  const id = esc(String(d.deviceId || ''));
  if (Number(d.retiredAt) > 0) return `<button class="btn sm ghost" data-apar-reativar="${id}">Reativar</button>`;
  return `<button class="btn sm ghost" data-apar-aposentar="${id}">Aposentar</button>`;
}

function renomearHtml(d, souAdmin) {
  if (!souAdmin && d.euMesmo !== true) return '';
  return `<button class="btn sm ghost" data-apar-renomear="${esc(String(d.deviceId || ''))}">Renomear</button>`;
}

function acoesDoAparelho(d, souAdmin) {
  const id = esc(String(d.deviceId || ''));
  const botoes = [renomearHtml(d, souAdmin)];
  if (souAdmin) botoes.push(`<button class="btn sm ghost" data-apar-politica="${id}">Política</button>`);
  botoes.push(aposentarHtml(d, souAdmin));
  botoes.push(designarHtml(d, souAdmin));
  return `<span class="row-actions">${botoes.filter(Boolean).join('')}</span>`;
}

// O que a pessoa lê ANTES de aposentar. O NOME está no título, no corpo e no aviso: o botão
// vive na linha de cada aparelho da lista, e o modal antigo dizia "este aparelho" para
// qualquer um deles. Quem clicava na linha errada aposentava o aparelho errado e não tinha
// como perceber, porque o toast também não dizia qual.
export function aparelhosAposentarConfirmacao(nome, opcoes) {
  const o = opcoes || {};
  const quem = o.euMesmo === true ? `<b>${esc(nome)}</b> (este aparelho)` : `<b>${esc(nome)}</b>`;
  return {
    title: `Aposentar o ${nome}?`,
    body: `<p><b>Acontece:</b> o ${quem} deixa de contar como ativo no conjunto.</p>
      <p><b>Não acontece:</b> nenhum dado é apagado, nenhuma chave é retirada, o admin não é deposto e nenhuma sessão é encerrada. Dá para reativar depois.</p>`,
  };
}

// Renomear a si mesmo e renomear outro são atos diferentes, e o texto precisa dizer qual é:
// "é o nome que os outros aparelhos mostram" só faz sentido quando o alvo é este aparelho.
export function aparelhosRenomearDialogo(nome, atual, opcoes) {
  const o = opcoes || {};
  const explicacao = o.euMesmo === true
    ? 'É o nome que os outros aparelhos mostram para este. Nome vazio mantém o atual.'
    : `É o nome com que <b>${esc(nome)}</b> aparece em todos os aparelhos, inclusive neste. Nome vazio mantém o atual.`;
  return {
    title: o.euMesmo === true ? 'Renomear este aparelho' : `Renomear o ${nome}`,
    body: `<p>${explicacao}</p>
      <input id="aparModalNome" class="sync-input" type="text" maxlength="40" spellcheck="false" autocomplete="off" value="${esc(atual || '')}">`,
  };
}

function linhaDoAparelho(d, opcoes) {
  const o = opcoes || {};
  // aparelho em versão antiga ainda não publica a versão: "desconhecida" é honesto, e
  // vazio pareceria um aparelho sem app
  const versao = d.farolVersion ? `v${d.farolVersion}` : 'desconhecida';
  const visto = Number(d.lastSeenAt) > 0 ? fmtWhenDay(d.lastSeenAt, o.agora) : 'nunca';
  const pendente = aparelhosDesignacaoPendente(o.comandosEmitidos, o.recibos, String(d.deviceId || ''));
  // data-rot é o rótulo que o CSS mostra no estreito, onde o cabeçalho da lista some: sem
  // ele a linha vira uma pilha de valores crus (win32, v2.62.4, hoje 13:28) sem dizer o que
  // é cada um. No largo o cabeçalho manda, e o rótulo fica escondido.
  return `<div class="apar-linha"><span class="sync-nome">${esc(nomeDe(d))}${chipsDoAparelho(d, o)}${pendente}</span><span class="sync-fraco" data-rot="sistema">${esc(d.platform || 'sistema desconhecido')}</span><span class="sync-fraco" data-rot="versão">${esc(versao)}</span><span class="sync-fraco" data-rot="visto">${esc(visto)}</span>${acoesDoAparelho(d, o.souAdmin === true)}</div>`;
}

// A versão mínima vem do snapshot (a MESMA constante que decide a cobertura); sem ela, a
// nota não inventa número. O atalho leva a "Verificar atualização", na Visão geral.
function notaDaCobertura(devices, cobertura, versaoMinima) {
  const contas = new Set();
  for (const d of devices) for (const c of aparelhosContasNaoCobertas(cobertura, d)) contas.add(c);
  if (!contas.size) return '';
  const nomes = [...contas].map((c) => esc(c)).join(', ');
  const versao = versaoMinima ? `anterior à ${esc(versaoMinima)}` : 'anterior à da postagem coordenada';
  return `<p class="apar-nota">"Garantia não coberta": um aparelho em versão ${versao} não participa da arbitragem de postagem. Nas contas que ele também revisa (${nomes}), dois Farois podem postar no mesmo PR até ele ser atualizado. <span class="btn sm ghost" data-goto="sys:overview:#updateBox" role="button" tabindex="0">Como atualizar o Farol</span></p>`;
}

// Só este aparelho ativo: nada é compartilhado, porque a frota exige OUTRO aparelho pronto
// para ler (lib/sync/frota.js). Aposentado não conta como outro.
function notaDoPrimeiro(devices) {
  const ativos = devices.filter((d) => d && !(Number(d.retiredAt) > 0));
  if (ativos.length !== 1 || ativos[0].euMesmo !== true) return '';
  return '<p class="apar-nota">Só este aparelho na conta. Nada é compartilhado até haver outro pronto.</p>';
}

export function aparelhosListaHtml(devices, opcoes) {
  const lista = Array.isArray(devices) ? devices : [];
  const o = opcoes || {};
  if (!lista.length) return '<div class="card sync-lista"><p class="sync-vago sync-vazio">Nenhum aparelho registrado ainda. O primeiro aparece assim que a conexão sobe.</p></div>';
  const linhas = lista.map((d) => linhaDoAparelho(d || {}, o)).join('');
  // apar-lista é QUEM TEM as colunas: cada .apar-linha herda a grade dela (subgrid). Com a
  // grade em cada linha, a coluna de ações (`auto`) media 0 px no cabeçalho e centenas nas
  // linhas, e o nome era espremido na proporção do número de botões, ou seja, do papel do
  // aparelho: quanto mais poder a linha oferecia, menos nome cabia.
  return `<div class="card sync-lista apar-lista">
    <div class="apar-linha apar-head"><span>aparelho</span><span>sistema</span><span>versão</span><span>visto por último</span><span></span></div>
    ${linhas}
    ${notaDoPrimeiro(lista)}
    ${notaDaCobertura(lista, o.cobertura, o.versaoMinima)}
  </div>`;
}

/* ---------- administração ---------- */

function campoDeSenha(id, rotulo) {
  // A senha é lida do DOM no instante do clique e some com a repintura: ela nunca entra no
  // estado nem em nada que o snapshot carregue (mesmo contrato do login do Firebase).
  return `<span class="sync-campo"><label for="${esc(id)}">${esc(rotulo)}</label><span class="sync-senha"><input id="${esc(id)}" class="sync-input" type="password" placeholder="senha da sincronização" spellcheck="false" autocomplete="off">${syncOlhoHtml(false, id)}</span></span>`;
}

// O campo de senha dos modais de limpeza e revogação, com o mesmo olho.
export function aparelhosCampoSenhaModal() {
  return `<span class="sync-senha"><input id="aparModalSenha" class="sync-input" type="password" placeholder="senha da sincronização" spellcheck="false" autocomplete="off">${syncOlhoHtml(false, 'aparModalSenha')}</span>`;
}

function nomeDoDevice(devices, deviceId) {
  const lista = Array.isArray(devices) ? devices : [];
  const achado = lista.find((d) => d && String(d.deviceId || '') === String(deviceId || ''));
  return achado ? nomeDe(achado) : String(deviceId || 'aparelho desconhecido');
}

// A duração sai do instante que ESTE aparelho observou; sem observação, nenhuma é dita.
function semBatimento(admin, agora) {
  const visto = Number(admin.ultimoBatimentoEm) || 0;
  if (visto <= 0) return 'nenhum batimento observado desde que este aparelho conectou';
  return `sem batimento há ${fmtSpan((Number(agora) - visto) / MINUTO_MS)}`;
}

function adminSemAdmin() {
  return {
    classe: 'off', selo: chip('mute', 'sem admin'),
    texto: 'Ninguém administra este conjunto ainda. Sem admin, cada aparelho vale pela própria configuração: nada é pausado, limitado ou agrupado de fora.',
  };
}

function adminComigo(admin, agora) {
  if (admin.fresca) {
    return { classe: '', selo: chip('ok', 'este aparelho é o admin'), texto: `Este aparelho é o admin da geração ${Number(admin.generation) || 0}, com batimento em dia. Políticas, grupos e comandos publicados daqui valem nos aparelhos que aceitam admin.` };
  }
  return { classe: 'warn', selo: chip('warn', 'admin sem sinal de vida'), texto: `Este aparelho é o admin da geração ${Number(admin.generation) || 0}, ${semBatimento(admin, agora)}. Enquanto isso, o que ele publica não é aplicado: cada aparelho segue a própria configuração, e nada fica mais permissivo por causa da queda.` };
}

function adminDeOutro(admin, nome, agora) {
  if (admin.fresca) {
    return { classe: '', selo: chip('info', 'admin em outro aparelho'), texto: `O admin vigente é o ${nome}, na geração ${Number(admin.generation) || 0}, com batimento em dia.` };
  }
  return { classe: 'warn', selo: chip('warn', 'admin sem sinal de vida'), texto: `O admin vigente é o ${nome}, ${semBatimento(admin, agora)}. Políticas e comandos dele não valem enquanto isso: cada aparelho segue a própria configuração, e nada fica mais permissivo por causa da queda.` };
}

function visaoDoAdmin(admin, devices, agora) {
  if (!admin || !admin.deviceId) return adminSemAdmin();
  if (admin.souEu === true) return adminComigo(admin, agora);
  return adminDeOutro(admin, nomeDoDevice(devices, admin.deviceId), agora);
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
  const v = visaoDoAdmin(admin, o.devices, o.agora === undefined ? Date.now() : o.agora);
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
// Recusar fecha o pedido com recibo, e quem designou vê a recusa.
export function aparelhosDesignacaoHtml(designacao, agora) {
  if (!designacao) return '';
  const desde = Number(designacao.desde) > 0 ? ` (pedido ${esc(fmtWhenDay(designacao.desde, agora))})` : '';
  return `<div class="card apar-corpo">
    <span class="set-title">Pedido para este aparelho ser o admin${desde}</span>
    <span class="set-desc">Um comando designou este aparelho como admin. Ninguém vira admin sem a senha digitada aqui: aceitar publica uma geração nova e guarda a chave privada só neste aparelho. Recusar fecha o pedido, e quem designou vê a recusa.</span>
    ${campoDeSenha('aparSenhaDesignacao', 'Senha da sincronização')}
    <div class="row-actions"><button class="btn sm primary" id="aparAceitarDesignacao">Aceitar com a senha</button><button class="btn sm ghost" id="aparRecusarDesignacao">Recusar</button></div>
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

// O cartão do que não está valendo mora no topo da Sincronização; no estreito ele também
// abre Aparelhos, que é onde o celular chega primeiro (a classe esconde no largo).
function capacidadesDoEstreito(capacidades) {
  const html = capacidadesIndisponiveisHtml(capacidades);
  return html ? `<div class="apar-so-estreito">${html}</div>` : '';
}

export function aparelhosSecaoHtml(entrada) {
  const e = entrada || {};
  const cfg = e.cfg || {};
  if (cfg.enabled !== true) return desligadaHtml();
  const s = e.sync || {};
  const admin = s.admin || null;
  const souAdmin = aparelhosSouAdmin(admin);
  return `${capacidadesDoEstreito(e.capacidades)}${aparelhosAdminHtml(admin, { devices: s.devices, agora: e.agora })}
    ${aparelhosDesignacaoHtml(s.designacaoAdmin, e.agora)}
    <div class="sync-sub-head">Aparelhos da conta</div>
    ${aparelhosListaHtml(s.devices, { cobertura: s.coberturaPostagem, admin: admin || {}, agora: e.agora, souAdmin, versaoMinima: s.versaoPostagemCoordenada, comandosEmitidos: s.comandosEmitidos, recibos: e.recibos })}
    ${aparelhoPoliticaHtml(e.politicaDe, { recusa: e.politicaRecusa, leitura: e.politicaLeitura })}
    ${aparelhosConsentimentoHtml(cfg)}
    ${aparelhosNavegadoresHtml(e.auth, e.agora)}
    ${aparelhosLimpezaHtml(e.limpeza, { souAdmin, devices: s.devices, agora: e.agora, limpando: e.limpando === true })}`;
}
