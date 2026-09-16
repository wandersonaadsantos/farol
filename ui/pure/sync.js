// Sincronização entre dispositivos: estado, selo, toggles, conta, envio, aparelhos e as
// confirmações de clique.
//
// Inclui a nota de coordenação que o card da FILA renderiza (U3): ela nasce aqui porque a
// regra é de sincronização, e o Radar só a exibe.
//
// Extraído do ui/pure.js na Fase 1a da reorganização; o conteúdo não mudou.
//
// Sincronização entre dispositivos (Sistema > Sincronização).
//
// Tudo aqui é PURO: recebe a projeção `STATE.sync` (statusForUi, em lib/engine/sync.js)
// e a config, e devolve texto ou HTML. A seção usa os tokens de ui/app.css e as classes
// que o resto do app já tem (.card, .set-list, .set-row, .switch, .callout, .btn, .chip);
// o prefixo .sync- fica só no que é novo.
//
// A cor da coordenação é DELIBERADA: azul para espera, âmbar para atenção, e nunca o
// vermelho do estacionamento. Segurar um PR porque outro aparelho está com ele não é
// falha, e pintar de vermelho faria procurar defeito onde não há.
//
// U3: a nota de coordenação no card da fila.
//
// Mesmo molde do parkedNoteHtml, e a diferença de COR é a regra: espera é azul
// (--info), atenção é âmbar (--accent), e o vermelho fica reservado ao estacionamento,
// que é falha de verdade. Estacionamento e coordenação juntos: o estacionamento VENCE,
// porque ele é o que exige ação sua, e a espera se resolve sozinha.
import { esc, fmtClock, fmtTok, fmtWhenDay } from './comum.js';

const SYNC_SELOS = {
  desligada: { classe: 'mute', texto: 'desligada' },
  'sem-login': { classe: 'warn', texto: 'falta o login' },
  entrando: { classe: 'info', texto: 'entrando' },
  conectada: { classe: 'ok', texto: 'conectado' },
  degradada: { classe: 'warn', texto: 'coordenação indisponível' },
  'login-expirado': { classe: 'bad', texto: 'login expirado' },
};

const SYNC_BORDA = { desligada: 'off', 'sem-login': 'warn', entrando: 'warn', conectada: '', degradada: 'warn', 'login-expirado': 'bad' };

// o Firebase recusou a credencial guardada: é o único erro que se resolve entrando de
// novo, e por isso o único que vira "login expirado" em vez de indisponibilidade
const SYNC_ERROS_DE_LOGIN = new Set(['credencial_invalida', 'sem_credencial']);

// UM estado, derivado do runtime, porque a tela precisava escolher entre seis em três
// lugares diferentes (selo, borda do cartão e corpo), e três derivações separadas
// divergiriam na primeira mudança.
export function syncEstado(sync) {
  const s = sync || {};
  if (s.enabled !== true || s.status === 'desligado') return 'desligada';
  if (s.status === 'conectado') return 'conectada';
  if (s.status === 'conectando') return 'entrando';
  if (s.status === 'sem-credencial') return 'sem-login';
  const code = (s.lastError && s.lastError.code) || '';
  return SYNC_ERROS_DE_LOGIN.has(code) ? 'login-expirado' : 'degradada';
}

export function syncSeloHtml(estado) {
  const selo = SYNC_SELOS[estado] || SYNC_SELOS.desligada;
  return `<span class="sync-chip ${selo.classe}">${esc(selo.texto)}</span>`;
}

export function syncClasseCartao(estado) {
  const b = SYNC_BORDA[estado];
  return b === undefined ? 'off' : b;
}

/* Os três interruptores. A chave geral manda nos outros dois: com ela desligada este
   Farol não fala com o Firebase, então oferecer as sub-chaves ativas prometeria um
   efeito que não existe. */
// o .switch tem que ser IRMÃO IMEDIATO do input, senão ele para de refletir o estado
// sem erro nenhum (salva certo e parece desligado); ver o comentário em ui/app.css
function syncSubToggle(id, ligada, on, titulo, desc) {
  const classe = ligada ? '' : ' off';
  const marcado = on ? ' checked' : '';
  const travado = ligada ? '' : ' disabled';
  return `<label class="set-row${classe}" id="sys-row-${esc(id)}">
      <span class="set-txt"><span class="set-title">${esc(titulo)}</span><span class="set-desc">${esc(desc)}</span></span>
      <span class="set-ctl"><input type="checkbox" id="${esc(id)}"${marcado}${travado}><span class="switch"></span></span>
    </label>`;
}

// Desligar a chave geral zera as DUAS sub-chaves no objeto salvo, e não só na tela.
// Sem isso, o config guardaria "coordenação ligada" com o recurso desligado, e religar a
// geral faria a consolidação voltar a enviar consumo sozinha, sem ninguém ter pedido.
// Ligar a geral não liga sub-chave nenhuma: quem religa escolhe o que quer de volta.
export function syncCfgComGeral(cfg, ligado) {
  const c = cfg || {};
  if (ligado) return { ...c, enabled: true };
  return {
    ...c,
    enabled: false,
    coordination: { ...(c.coordination || {}), enabled: false },
    consolidation: { ...(c.consolidation || {}), enabled: false },
  };
}

export function syncTogglesHtml(cfg) {
  const c = cfg || {};
  const geral = c.enabled === true;
  const coord = geral && !!(c.coordination && c.coordination.enabled === true);
  const cons = geral && !!(c.consolidation && c.consolidation.enabled === true);
  return `<div class="card set-list">
    <label class="set-row" id="sys-row-setSyncEnabled">
      <span class="set-txt"><span class="set-title">Sincronizar entre dispositivos</span><span class="set-desc">Chave geral. Desligada, este Farol não fala com o Firebase: nenhuma conexão, nenhum envio, nenhuma consulta.</span></span>
      <span class="set-ctl"><input type="checkbox" id="setSyncEnabled"${geral ? ' checked' : ''}><span class="switch"></span></span>
    </label>
    ${syncSubToggle('setSyncCoordination', geral, coord, 'Evitar análises simultâneas', 'Antes de abrir uma revisão, autoanálise ou classificação de pushback automática, confere se outro aparelho seu já cuidou daquele PR neste commit. Se já cuidou, nenhuma sessão nasce aqui.')}
    ${syncSubToggle('setSyncConsolidation', geral, cons, 'Consolidar histórico de consumo', 'Envia tokens, custo e desfecho de cada sessão, sem prompt, diff ou relatório, pra aba Consumo mostrar todos os aparelhos juntos. O histórico deste aparelho continua aqui do jeito que está.')}
  </div>`;
}

function syncCampo(id, rotulo, valor, dica) {
  return `<div class="sync-campo">
    <label for="${esc(id)}">${esc(rotulo)}</label>
    <input id="${esc(id)}" type="text" class="sync-input" value="${esc(valor || '')}" spellcheck="false" autocomplete="off">
    <span class="sync-dica">${esc(dica)}</span>
  </div>`;
}

/* O olho que alterna a senha entre oculta e visível. Estado no `aria-pressed`, que é a
   fonte única: quem alterna (ui/app.js) lê dali e troca o `type` do input, então a
   leitura assistiva e o que se vê na tela nunca divergem. */
function syncOlhoHtml(visivel) {
  const rotulo = visivel ? 'Ocultar senha' : 'Mostrar senha';
  const desenho = visivel
    ? '<path d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M9.9 4.9A9.6 9.6 0 0 1 12 4.7c5 0 9 4.3 9 7.3a11 11 0 0 1-2.5 3.9M6.3 6.4A11.9 11.9 0 0 0 3 12c0 3 4 7.3 9 7.3a9.9 9.9 0 0 0 3.6-.7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
    : '<path d="M3 12c0-3 4-7.3 9-7.3s9 4.3 9 7.3-4 7.3-9 7.3S3 15 3 12z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/>';
  return `<button type="button" class="sync-olho" id="syncSenhaOlho" aria-pressed="${visivel ? 'true' : 'false'}" aria-label="${rotulo}" title="${rotulo}"><svg aria-hidden="true" viewBox="0 0 24 24">${desenho}</svg></button>`;
}

/* O bloco de login. Conectado mostra quem é e o botão de sair; desconectado pede e-mail
   e senha. A senha é `type="password"`, lida do DOM na hora e nunca guardada NO DISCO: o
   engine troca por um acesso renovável, e só ele é gravado.

   O `rascunho` é o que a pessoa digitou, devolvido pela tela a cada repintura. Sem ele o
   `renderSync()` que vem depois da tentativa reescreve o cartão inteiro e apaga o e-mail
   junto, e o ciclo de polling seguinte faria o mesmo: uma recusa do Firebase custava
   redigitar tudo. O preço assumido é a senha continuar na tela enquanto o login não deu
   certo, que é exatamente o caso em que ela ainda é útil; no sucesso ela é apagada. */
export function syncContaHtml(sync, rascunho) {
  const s = sync || {};
  const d = rascunho || {};
  const estado = syncEstado(s);
  if (estado === 'conectada' || estado === 'entrando') {
    const quem = s.email ? `<span class="sync-quem">${esc(s.email)}</span>` : '<span class="sync-vago">sem e-mail</span>';
    return `<div class="sync-conta">
      <div class="sync-conta-topo"><span class="sync-conta-titulo">Login no Firebase</span><span class="sync-conta-onde">sync-credentials.json</span></div>
      <div class="sync-conta-corpo">
        <span>Conectado como ${quem}. A senha não fica guardada; só o acesso renovável, fora do <code>config.json</code>.</span>
        <span class="sync-espaco"></span>
        <button class="btn sm danger-ghost" id="syncLogout">Sair deste aparelho</button>
      </div>
    </div>`;
  }
  const aviso = estado === 'login-expirado'
    ? '<p class="sync-conta-nota sync-conta-nota-ruim">O Firebase recusou o acesso guardado. Enquanto isso a automação espera.</p>'
    : '';
  const rotulo = estado === 'login-expirado' ? 'Entrar de novo' : 'Entrar';
  return `<div class="sync-conta">
    <div class="sync-conta-topo warn"><span class="sync-conta-titulo">Login no Firebase</span><span class="sync-conta-onde">o mesmo usuário em todos os aparelhos</span></div>
    <div class="sync-conta-corpo">
      <span class="sync-campo"><label for="syncEmail">E-mail</label><input id="syncEmail" class="sync-input" type="email" value="${esc(d.email || '')}" placeholder="voce@exemplo.com" spellcheck="false" autocomplete="off"></span>
      <span class="sync-campo"><label for="syncSenha">Senha</label><span class="sync-senha"><input id="syncSenha" class="sync-input" type="${d.senhaVisivel ? 'text' : 'password'}" value="${esc(d.senha || '')}" placeholder="senha do Firebase" spellcheck="false" autocomplete="off">${syncOlhoHtml(!!d.senhaVisivel)}</span></span>
      <button class="btn sm primary" id="syncLogin">${rotulo}</button>
    </div>
    ${aviso}
    <p class="sync-conta-nota">Crie o usuário uma vez no console do Firebase (Authentication, provedor e-mail e senha) e entre com ele em cada aparelho. A senha é usada só agora e não é gravada.</p>
  </div>`;
}

/* A linha do envio do histórico. Só existe com a consolidação ligada E com a outbox já
   reconciliada: antes disso não há número honesto a mostrar, e o `null` diz isso. */
export function syncEnvioHtml(sync) {
  const s = sync || {};
  if (!s.consolidation || !s.outbox) return '';
  const o = s.outbox;
  if (o.paused) return `<span class="sync-teste ruim">envio do histórico pausado, ${fmtTok(o.pendentes)} pendente(s)</span>`;
  if (o.pendentes > 0) return `<span class="sync-teste">enviando o histórico de consumo: ${fmtTok(o.pendentes)} pendente(s), ${fmtTok(o.rejeitados)} recusada(s)</span>`;
  const quando = o.lastSentAt ? fmtWhenDay(o.lastSentAt) : 'ainda não';
  return `<span class="sync-teste ok">histórico enviado ${esc(quando)}, nada pendente</span>`;
}

export function syncConexaoHtml(sync, cfg, rascunho) {
  const s = sync || {};
  const c = cfg || {};
  const estado = syncEstado(s);
  const campos = `<div class="sync-corpo">
    ${syncCampo('syncApiKey', 'Chave web do projeto', c.apiKey, 'em Configurações do projeto, no Firebase')}
    ${syncCampo('syncDatabaseUrl', 'URL do banco', c.databaseUrl, 'Realtime Database')}
    ${syncCampo('syncDeviceName', 'Nome deste aparelho', c.deviceName, 'é como os outros aparelhos o chamam')}
  </div>`;
  const motivo = (s.lastError && s.lastError.motivo) || 'A coordenação está indisponível.';
  const degradada = estado === 'degradada'
    ? `<div class="callout warn sync-degradada"><span><b>O Firebase não respondeu no último ciclo:</b> ${esc(motivo)}. A revisão automática espera a conexão voltar, sem gastar sessão. O clique manual continua podendo executar, com confirmação.</span></div>`
    : '';
  return `<div class="card sync-card ${syncClasseCartao(estado)}">
    <div class="sync-topo"><span class="sync-titulo">Firebase pessoal</span><span class="sync-espaco"></span>${syncSeloHtml(estado)}</div>
    ${campos}
    ${degradada}
    ${syncContaHtml(s, rascunho)}
    <div class="sync-rodape">
      <button class="btn sm" id="syncTest">Testar conexão</button>
      <span class="sync-teste" id="syncTestOut"></span>
      ${syncEnvioHtml(s)}
    </div>
  </div>`;
}

export function syncAparelhosHtml(devices, agora = Date.now()) {
  const lista = Array.isArray(devices) ? devices : [];
  if (!lista.length) return '<div class="card sync-lista"><p class="sync-vago sync-vazio">Nenhum aparelho registrado ainda. O primeiro aparece assim que a conexão sobe.</p></div>';
  const linhas = lista.map((d) => {
    const eu = d.euMesmo ? ' <span class="sync-chip mute">este</span>' : '';
    const visto = d.lastSeenAt ? fmtWhenDay(d.lastSeenAt, agora) : 'nunca';
    return `<div class="sync-linha"><span class="sync-nome">${esc(d.name || d.deviceId || 'aparelho')}${eu}</span><span class="sync-fraco">${esc(d.platform || '')}</span><span class="sync-fraco">${esc(visto)}</span></div>`;
  }).join('');
  return `<div class="card sync-lista">
    <div class="sync-linha sync-head"><span>aparelho</span><span>sistema</span><span>visto por último</span></div>
    ${linhas}
  </div>`;
}

// Uma linha por PR que a coordenação está segurando ou que já foi analisado em outro
// aparelho. O recibo ÓRFÃO é o único que ganha botão: refazer um recibo vivo apagaria a
// prova de uma análise que ainda vale (ver recusaDoRefazer, em lib/engine/sync-redo.js).
function syncLinhaLease(key, v) {
  const onde = v.deviceName || 'outro aparelho';
  const desde = v.since ? ` desde ${esc(fmtClock(v.since))}` : '';
  return `<div class="sync-coord"><span><span class="sync-ref">${esc(key)}</span><span class="sync-o-que">sendo analisado no ${esc(onde)}${desde}; este aparelho espera</span></span><span class="sync-chip info">em outro aparelho</span></div>`;
}

// O chip diz o estado REAL da publicação. Antes dizia "pendente lá" para todo recibo,
// inclusive o já postado, e a linha mentia justamente no caso comum.
const RECIBO_CHIP = {
  published: '<span class="sync-chip ok">publicado lá</span>',
  pending: '<span class="sync-chip mute">pendente lá</span>',
  failed: '<span class="sync-chip bad">postagem falhou lá</span>',
};
const RECIBO_CHIP_SEM_PUBLICACAO = '<span class="sync-chip mute">concluído lá</span>';

function syncLinhaRecibo(key, r) {
  const onde = r.deviceName || 'outro aparelho';
  const quando = r.at ? ` em ${esc(fmtWhenDay(r.at))}` : '';
  if (r.orfao === 'orfao') {
    return `<div class="sync-coord"><span><span class="sync-ref">${esc(key)}</span><span class="sync-o-que sync-orfao">pendente no ${esc(onde)}${quando}, sem atividade há dias; o resultado só existe lá</span></span><button class="btn sm sync-redo" data-key="${esc(key)}">Refazer neste aparelho</button></div>`;
  }
  const chip = Object.hasOwn(RECIBO_CHIP, String(r.publicationState)) ? RECIBO_CHIP[r.publicationState] : RECIBO_CHIP_SEM_PUBLICACAO;
  return `<div class="sync-coord"><span><span class="sync-ref">${esc(key)}</span><span class="sync-o-que">analisado no ${esc(onde)}${quando} neste commit</span></span>${chip}</div>`;
}

export function syncCoordenacaoHtml(sync) {
  const s = sync || {};
  if (!s.coordination) return '';
  const leases = s.leasesVistos || {};
  const recibos = s.recibosVistos || {};
  const linhas = [
    ...Object.entries(leases).map(([k, v]) => syncLinhaLease(k, v || {})),
    ...Object.entries(recibos).map(([k, v]) => syncLinhaRecibo(k, v || {})),
  ];
  const outros = Number(s.leasesOutros) || 0;
  // PR que ESTE aparelho não acompanha nunca é nomeado: o nome do PR não sobe pro banco
  // (D6), então a tela só consegue contá-lo
  const nota = outros > 0 ? `<p class="sync-legenda sync-outros">e mais ${fmtTok(outros)} em PR que este aparelho não acompanha</p>` : '';
  const corpo = linhas.length || nota
    ? `${linhas.join('')}${nota}`
    : '<p class="sync-vago sync-vazio">Nenhum PR seu está sendo analisado em outro aparelho agora.</p>';
  return `<div class="sync-sub-head">Coordenação agora</div><div class="card sync-lista">${corpo}</div>`;
}

export function syncSecaoHtml(sync, cfg, rascunho) {
  const s = sync || {};
  if (!(cfg && cfg.enabled === true)) return syncTogglesHtml(cfg);
  return `${syncTogglesHtml(cfg)}
    <div class="sync-sub-head">Conexão</div>
    ${syncConexaoHtml(s, cfg, rascunho)}
    <div class="sync-sub-head">Aparelhos</div>
    ${syncAparelhosHtml(s.devices)}
    ${syncCoordenacaoHtml(s)}`;
}

/* A resposta de /api/review traz `coordenacao[]` quando o preflight do clique segurou
   algum PR. Cada motivo tem um desfecho DIFERENTE, e é essa escolha que mora aqui:

   - `indisponivel`: o banco não respondeu, então este aparelho não SABE se outro está
     revisando. Dá pra seguir assumindo o risco, com confirmação.
   - `recibo`: outro aparelho já analisou este commit. Refazer é legítimo (o resultado
     só existe lá), mas custa uma sessão nova, então também confirma.
   - `alheio`: outro aparelho está com o PR AGORA. Não existe override, e é de propósito:
     o Farol nunca toma uma análise em andamento. Só avisa quem está com ele.

   Motivo desconhecido cai no aviso, nunca num override: contornar a coordenação por
   um motivo que a tela não entende seria exatamente o contrário do que ela existe pra
   fazer. */
const SYNC_CONFIRMACOES = {
  indisponivel: {
    override: 'semCoordenacao',
    titulo: 'Revisar sem coordenação?',
    acao: 'Revisar mesmo assim',
  },
  recibo: {
    override: 'ignorarRecibo',
    titulo: 'Revisar de novo este commit?',
    acao: 'Refazer neste aparelho',
  },
};

function syncCorpoIndisponivel(key, detalhe) {
  const motivo = detalhe.motivo ? ` (${esc(detalhe.motivo)})` : '';
  return `<p>O Firebase não respondeu${motivo}, então este aparelho não consegue saber se outro já está revisando <code>${esc(key)}</code>.</p>
    <p>Se estiver, as duas sessões gastam tokens pelo mesmo PR. O dedup de postagem continua impedindo review duplicado no GitHub.</p>`;
}

function syncCorpoRecibo(key, detalhe) {
  const onde = esc(detalhe.deviceName || 'outro aparelho');
  const quando = detalhe.receipt && detalhe.receipt.completedAt ? ` em ${esc(fmtWhenDay(detalhe.receipt.completedAt))}` : '';
  return `<p><code>${esc(key)}</code> já foi analisado no <b>${onde}</b> neste commit${quando}. O resultado só existe lá.</p>
    <p>Refazer aqui abre uma sessão nova e consome tokens. Se o ${onde} voltar, ele confere antes de postar e não publica por cima.</p>`;
}

export function syncConfirmacaoDoClique(entrada) {
  const e = entrada || {};
  const key = String(e.key || '');
  const detalhe = (e.detail && typeof e.detail === 'object') ? e.detail : {};
  const modelo = SYNC_CONFIRMACOES[e.reason];
  if (!modelo) {
    const onde = detalhe.deviceName || 'outro aparelho';
    // não é falha: é o app respeitando uma análise que já está rodando
    return { tipo: 'aviso', key, texto: `${key} está sendo analisado no ${onde} agora. O Farol não toma uma análise em andamento; tente de novo quando ela terminar.` };
  }
  const corpo = e.reason === 'recibo' ? syncCorpoRecibo(key, detalhe) : syncCorpoIndisponivel(key, detalhe);
  return { tipo: 'confirma', key, titulo: modelo.titulo, acao: modelo.acao, override: modelo.override, corpo };
}

/* Uma confirmação por PR, na ordem em que o engine devolveu. Lista vazia (ou resposta
   sem coordenação nenhuma) não produz nada: o silêncio aqui quer dizer que a revisão
   seguiu normalmente. */
export function syncConfirmacoesDoClique(resposta) {
  const lista = resposta && Array.isArray(resposta.coordenacao) ? resposta.coordenacao : [];
  return lista.map(syncConfirmacaoDoClique);
}

const SYNC_ESPERA_FRASE = {
  alheio: (onde) => `Em análise no ${onde}. A revisão automática espera por aqui.`,
  indisponivel: () => 'Coordenação entre dispositivos indisponível agora. A revisão automática espera a conexão voltar.',
  esgotado: () => 'Teto de rodadas automáticas de hoje atingido entre seus aparelhos. Volta amanhã; o Revisar vale agora.',
};

const SYNC_ESPERA_CLASSE = { alheio: '', indisponivel: ' warn', esgotado: ' warn' };

export function prCoordNoteHtml(key, sync) {
  const s = sync || {};
  const espera = (s.espera || {})[key];
  const lease = (s.leasesVistos || {})[key];
  if (espera && SYNC_ESPERA_FRASE[espera.reason]) {
    const onde = esc(espera.deviceName || (lease && lease.deviceName) || 'outro aparelho');
    return `<div class="pr-coord${SYNC_ESPERA_CLASSE[espera.reason]}">${SYNC_ESPERA_FRASE[espera.reason](onde)}</div>`;
  }
  // sem espera registrada, o stream ainda pode saber que outro aparelho está com ele
  if (lease) return `<div class="pr-coord">${SYNC_ESPERA_FRASE.alheio(esc(lease.deviceName || 'outro aparelho'))}</div>`;
  return '';
}
