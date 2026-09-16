// A visão compartilhada no Radar (brief B2, itens 2.7, 2.8, 2.9 e 2.11), parte PURA.
//
// Tudo aqui recebe a projeção `STATE.sync` (statusForUi, em lib/engine/sync.js), os eventos
// SSE `sync-live` e `sync-pending` já decodificados, e devolve HTML. Nada toca DOM nem lê
// estado global.
//
// TRÊS AFIRMAÇÕES QUE ESTE MÓDULO NÃO PODE ERRAR, e que estão travadas em teste:
//   1. compartilhamento bloqueado pelo Farol nunca aparece como ligado (é o caso do celular
//      sem autenticação local exigida: a configuração PEDE, o engine DESLIGA);
//   2. comando nunca aparece como concluído sem recibo do aparelho alvo. Sem recibo existem
//      só dois estados honestos, "enviado" e "vencido";
//   3. o que o engine não entrega, a tela não inventa. O andamento e a pendência de outro
//      aparelho viajam com o PR como TAG (lib/sync/tags.js), nunca com o nome. O engine
//      resolve a tag pelo catálogo cifrado e entrega `pr: { key, account, title, author }`
//      no andamento; quando o catálogo não abre, `pr` vem nulo e a tela diz "um PR seu",
//      em vez de escrever um endereço que não tem.
import { esc, fmtClock, fmtDur, plural } from './comum.js';
import { prRefMention } from './mencoes.js';

// texto só quando a condição vale: evita ternário dentro de template
function se(condicao, texto) {
  return condicao ? texto : '';
}

/* ---------- a visão está valendo? ---------- */

// Três estados, e o bloqueada existe justamente para não virar "desligada" na tela: a
// pessoa PEDIU o compartilhamento, e precisa ler que o Farol o segurou, com o motivo.
export function visaoCompartilhada(sync) {
  const s = sync || {};
  if (s.bloqueioCompartilhamento) return 'bloqueada';
  return s.shared === true ? 'ligada' : 'desligada';
}

const BLOQUEIO_MOTIVO = {
  'autenticacao-local': 'a autenticação local não está exigida neste aparelho',
};

export function compartilhadoBloqueioHtml(sync) {
  const s = sync || {};
  if (visaoCompartilhada(s) !== 'bloqueada') return '';
  const motivo = BLOQUEIO_MOTIVO[s.bloqueioCompartilhamento] || `motivo registrado: ${s.bloqueioCompartilhamento}`;
  return `<div class="md-faixa warn"><span class="sync-chip warn">bloqueada</span><span>A visão compartilhada está pedida na configuração e o Farol a desligou neste aparelho, porque ${esc(motivo)}. Nada sobe, nada desce, e o Radar mostra só este aparelho.</span><span class="md-espaco"></span><span class="md-goto" data-goto="sys:sync" role="button" tabindex="0">Sincronização</span></div>`;
}

/* ---------- 2.8: a faixa do modo da distribuição ---------- */

export function nomeDoAparelho(devices, deviceId) {
  const lista = Array.isArray(devices) ? devices : [];
  const achado = lista.find((d) => d && d.deviceId === deviceId);
  return (achado && achado.name) || '';
}

// O texto do modo depende de QUEM distribui e de o admin ter sinal fresco. Sem admin
// conhecido o campo `admin` nem existe na projeção (lib/engine/sync-telas.js), e dizer
// "o distribuidor sumiu" nesse caso seria inventar um distribuidor.
function textoDoModoDistribuido(sync) {
  const admin = sync.admin || null;
  if (admin && admin.souEu) return 'Este aparelho distribui a fila do conjunto.';
  const nome = admin ? nomeDoAparelho(sync.devices, admin.deviceId) : '';
  return `O aparelho ${nome ? esc(nome) : 'distribuidor'} escolhe onde cada revisão roda.`;
}

function faixaDoModo(classe, chip, texto, extra) {
  return `<div class="md-faixa ${classe}"><span class="sync-chip ${classe}">${esc(chip)}</span><span>${texto}${extra}</span></div>`;
}

function esperandoTexto(distribuicao) {
  const esperando = (distribuicao && Array.isArray(distribuicao.esperando)) ? distribuicao.esperando : [];
  if (!esperando.length) return '';
  const n = esperando.length;
  return ` ${n === 1 ? '1 PR espera' : `${n} PRs esperam`} colocação agora.`;
}

// A faixa só existe com a distribuição PEDIDA na configuração: sem o interruptor, falar de
// modo prometeria um comportamento que este aparelho não tem.
export function modoDistribuicaoHtml(sync, cfgSync) {
  const s = sync || {};
  const cfg = cfgSync || {};
  if (!(cfg.distribution && cfg.distribution.enabled === true)) return '';
  if (visaoCompartilhada(s) !== 'ligada') return '';
  const d = s.distribuicao || {};
  const espera = esperandoTexto(d);
  const admin = s.admin || null;
  if (d.modo === 'distribuido') {
    const semSinal = admin && admin.fresca !== true
      ? ' O distribuidor está sem sinal agora: até três giros sem ninguém enfileirar, e depois a fila volta a ser local.'
      : '';
    const classe = semSinal ? 'warn' : 'ok';
    return faixaDoModo(classe, semSinal ? 'sem sinal do distribuidor' : 'fila distribuída', textoDoModoDistribuido(s), `${semSinal}${espera}`);
  }
  if (d.modo === 'local') {
    return faixaDoModo('warn', 'fila local', 'Nenhum distribuidor com sinal fresco. Este aparelho voltou a cuidar da própria fila, e os itens voltam aos poucos, os mais antigos primeiro.', espera);
  }
  // modo vazio é a JANELA de até três giros sem ninguém enfileirar, e ela é um estado:
  // silêncio aqui pareceria fila parada sem motivo
  return faixaDoModo('mute', 'modo ainda não decidido', 'A distribuição está ligada e este aparelho ainda não fechou um giro para dizer se a fila é distribuída ou local. Nada é perdido nesse meio tempo.', espera);
}

/* ---------- 2.8 e 2.9: notas por PR no card da fila ---------- */

// Chamadas por prCoordNoteHtml (sync.js), que continua sendo a boca única da nota do card.
// Os dados já vêm no snapshot: `distribuicao.esperando[{key, desde, motivo}]` e
// `tomadasSofridas[{prKey, para, geracao, at}]`. O comando emitido entra pela nota própria
// (notaComandoHtml), só quando o engine resolveu o PR dele.
//
// O motivo chega pelo que o conjunto publicou (o veredito do agendador no nó do item, a
// atribuição viva e a recusa do executor) ou pelo que este aparelho mesmo decidiu. Vazio
// não é "sem motivo": é "não se sabe daqui", e a nota diz isso. As recusas nomeiam "o
// aparelho escolhido" porque quem recusou pode ser outro, e o detalhe diz qual.
const MOTIVO_ESPERA = {
  'sem-aparelho-apto': 'nenhum aparelho apto agora (sem vaga, pausado, sem sinal, ou que já recusou este commit)',
  'atribuicao-viva': 'o distribuidor já escolheu um aparelho e espera ele aceitar',
  sem_vaga: 'o aparelho escolhido recusou a atribuição por estar sem vaga',
  head_mudou: 'o commit mudou antes de a análise começar',
  orcamento: 'o teto do grupo de consumo segurou a atribuição',
  inapto: 'o aparelho escolhido não estava apto quando a atribuição chegou',
  saida_de_cena: 'outra pessoa já pegou este PR',
  sem_token: 'faltou a credencial da conta no aparelho escolhido',
};

// O motivo POR APARELHO: o veredito do agendador (lib/engine/escolha.js,
// motivosPorAparelho) e o detalhe da admissão de quem recusou (lib/engine/admissao.js).
const MOTIVO_APARELHO = {
  'sem-sinal': 'sem sinal recente',
  pausado: 'pausado pelo admin',
  'sem-vaga': 'sem vaga',
  recusou: 'recusou este commit há pouco, e a espera da recusa ainda vale',
  'memoria-desconhecida': 'sem medida de memória livre, e a admissão não admite assim',
  'memoria-insuficiente': 'com memória livre abaixo do piso da admissão',
  'presenca-vencida': 'sem presença recente',
  'provedor-nao-pronto': 'sem IA pronta',
  root: 'rodando como root, que o Claude Code recusa',
  'grupo-nao-verificavel': 'com o teto do grupo de consumo não verificável agora',
  'nao-publiquei': 'sem este item publicado lá',
  'tipo-desconhecido': 'sem permissão para este tipo de análise',
};

function textoDoAparelho(motivo) {
  return MOTIVO_APARELHO[motivo] || MOTIVO_ESPERA[motivo] || `motivo registrado: ${motivo}`;
}

function nomeNaNotaDeEspera(sync, deviceId) {
  if (deviceId && deviceId === sync.deviceId) return 'este aparelho';
  return nomeDoAparelho(sync.devices, deviceId) || 'um aparelho sem nome nesta tela';
}

// "O Notebook está sem vaga": o detalhe que faltava na divergência 5. Sem detalhe, a nota
// fica no motivo geral, que já é verdadeiro.
function detalheDaEspera(item, sync) {
  if (item.motivo === 'atribuicao-viva' && item.dev) {
    return ` O distribuidor escolheu o ${esc(nomeNaNotaDeEspera(sync, item.dev))} e espera ele aceitar.`;
  }
  const aparelhos = (Array.isArray(item.aparelhos) ? item.aparelhos : []).filter((a) => a && a.deviceId && a.motivo);
  if (!aparelhos.length) return '';
  const partes = aparelhos.map((a) => `${esc(nomeNaNotaDeEspera(sync, a.deviceId))}, ${esc(textoDoAparelho(a.motivo))}`);
  return ` Por aparelho: ${partes.join('; ')}.`;
}

// A recusa por PESO não existe ainda: o tamanho do PR não entra na escolha de aparelho.
// A nota diz isso onde a pergunta aparece, que é quando ninguém pôde receber o item.
const PESO_NAO_ATIVO = ' O tamanho do PR ainda não entra na escolha: a recusa por peso não está ativa.';

function textoDaEspera(item, sync) {
  const motivo = item.motivo;
  if (!motivo) return 'Ele volta a ser oferecido a cada giro, e o motivo da espera não chega a esta tela.';
  const peso = motivo === 'sem-aparelho-apto' || motivo === 'sem_vaga' ? PESO_NAO_ATIVO : '';
  return `Motivo: ${esc(MOTIVO_ESPERA[motivo] || `motivo registrado: ${motivo}`)}.${detalheDaEspera(item, sync)}${peso} Ele volta a ser oferecido a cada giro.`;
}

export function notaDistribuicaoHtml(key, sync, agora = Date.now()) {
  const s = sync || {};
  const d = s.distribuicao || {};
  const item = (Array.isArray(d.esperando) ? d.esperando : []).find((x) => x && x.key === key);
  if (!item) return '';
  const ha = item.desde ? ` há ${esc(fmtDur(Math.max(0, agora - item.desde)))}` : '';
  return `<div class="pr-coord">Esperando distribuição${ha}: nenhum aparelho recebeu este PR ainda. ${textoDaEspera(item, s)}</div>`;
}

export function notaTomadaSofridaHtml(key, sync) {
  const s = sync || {};
  const t = (Array.isArray(s.tomadasSofridas) ? s.tomadasSofridas : []).find((x) => x && x.prKey === key);
  if (!t) return '';
  const quem = nomeDoAparelho(s.devices, t.para) || 'outro aparelho';
  return `<div class="pr-coord bad">Tomado pelo ${esc(quem)} às ${esc(fmtClock(t.at))}, geração ${esc(String(t.geracao || ''))}. Nada desta revisão será postado por este aparelho, e a sessão daqui foi encerrada ao perceber.</div>`;
}

/* ---------- quem pode emitir comando ---------- */

// Comando só sai do aparelho ADMIN da geração vigente, e só vale com autoridade fresca
// (lib/engine/sync-comandos.js recusa `nao-e-admin`, e o alvo ignora com `autoridade`).
// Oferecer o botão fora disso seria prometer um efeito que o contrato já recusa.
export function comandoPermitido(sync) {
  const admin = (sync && sync.admin) || null;
  if (!admin) return { pode: false, motivo: 'nenhum aparelho admin é conhecido, e só o admin emite comandos' };
  if (admin.souEu !== true) return { pode: false, motivo: 'só o aparelho admin emite comandos, e este não é o admin' };
  if (admin.fresca !== true) return { pode: false, motivo: 'o admin está sem sinal fresco agora, e comando sem autoridade fresca é ignorado' };
  return { pode: true, motivo: '' };
}

/* ---------- 2.7: precisa de você em todos os aparelhos ---------- */

const VEREDITO = { approve: 'aprovar', request_changes: 'pedir mudanças', comment: 'só comentar', skip: 'pular' };
const BLOQUEIO_PEND = { stale_head: 'o PR ganhou commit novo depois da análise' };

// O PR viaja como tag e não como endereço (D6), então o card diz o que sabe: de qual
// aparelho veio, qual foi o veredito e quantos motivos travam. Menção navegável aqui seria
// um link para lugar nenhum.
function pendenciaHtml(p, ctx) {
  const nova = ctx.novas.has(p.itemId);
  const onde = p.aparelho || 'outro aparelho';
  const veredito = VEREDITO[p.veredito] || 'sem veredito';
  const motivos = Array.isArray(p.motivos) ? p.motivos.length : 0;
  const bloqueio = BLOQUEIO_PEND[p.bloqueio] || '';
  const chips = [
    `<span class="sync-chip mute">no ${esc(onde)}</span>`,
    se(p.visto, '<span class="sync-chip mute">visto</span>'),
    se(nova && !p.visto, '<span class="sync-chip warn">nova</span>'),
  ].join('');
  const detalhe = `${se(motivos, `, ${plural(motivos, 'motivo registrado', 'motivos registrados')}`)}${se(bloqueio, `, ${esc(bloqueio)}`)}`;
  const classe = p.visto ? 'settled' : 'urgent';
  const acoes = ctx.podeComandar
    ? `<button class="btn sm primary md-decidir" data-item="${esc(p.itemId)}" data-dev="${esc(p.dev)}" data-aparelho="${esc(onde)}">Decidir no ${esc(onde)}…</button>`
    : `<span class="md-nota">${esc(ctx.motivoSemComando)}</span>`;
  const visto = p.visto ? '' : `<button class="btn sm ghost md-visto" data-item="${esc(p.itemId)}">Marcar como visto</button>`;
  return `<div class="card md-pend ${classe}" data-item="${esc(p.itemId)}">
    <div class="md-linha">${chips}<span class="md-espaco"></span><span class="md-fraco">${esc(fmtClock(p.at))}</span></div>
    <div class="md-titulo">Um PR seu, analisado no ${esc(onde)}, esperando decisão</div>
    <div class="md-sub">veredito: ${esc(veredito)}${detalhe}</div>
    <div class="md-acoes">${acoes}${visto}</div>
  </div>`;
}

export function pendenciasCompartilhadasHtml(pendencias, ctx) {
  const lista = Array.isArray(pendencias) ? pendencias : [];
  const c = ctx || {};
  const contexto = {
    novas: c.novas instanceof Set ? c.novas : new Set(),
    podeComandar: c.podeComandar === true,
    motivoSemComando: c.motivoSemComando || 'só o aparelho admin, com sinal fresco, emite comandos',
  };
  if (!lista.length) return '<p class="md-vazio">Nada precisa de você em nenhum outro aparelho.</p>';
  return `${lista.map((p) => pendenciaHtml(p, contexto)).join('')}
    <p class="md-nota">Marcar como visto cala o aviso nos outros aparelhos. Decidir manda um comando ao aparelho dono, que decide com os gates dele. O endereço do PR não viaja entre aparelhos, por isso ele não é nomeado aqui.</p>`;
}

/* ---------- 2.7: em outros aparelhos (andamento ao vivo) ---------- */

const ETAPA = {
  preparo: 'preparando', leitura: 'lendo o diff', card: 'conferindo o card',
  verificacao: 'verificando', raciocinio: 'raciocinando', fechamento: 'fechando',
  desconhecida: 'sem etapa conhecida',
};
const TIPO_OP = { review: 'revisão', self: 'autoanálise', pushback: 'contestação' };

function tempoDaOperacao(op) {
  const ms = (op && op.msPorEtapa) || {};
  return Object.values(ms).reduce((total, v) => total + (Number(v) || 0), 0);
}

// Os comandos de posse exigem dados diferentes, e a tela diz qual falta em vez de oferecer
// um botão que sempre recusaria. Transferir anda só com tags (PR e commit): a lista de
// destinos vem de uma rota própria, e o aparelho de origem confere tudo de novo. Tomar
// precisa também do PR em claro, porque o aviso lê a posse pela chave e pela conta.
function faltaParaTransferir(op) {
  if (!op.prTag) return 'o andamento não identifica o PR';
  return op.matTag ? '' : 'o andamento não traz o commit, que a transferência exige';
}

function faltaParaTomar(op) {
  if (!op.matTag) return 'o andamento não traz o commit, que a tomada exige';
  const pr = op.pr || {};
  return pr.key && pr.account ? '' : 'o nome do PR não abriu no catálogo, e o aviso da tomada precisa dele';
}

function acao(semAdmin, falta) {
  return { pode: !semAdmin && !falta, motivo: semAdmin || falta };
}

export function acoesDaOperacao(op, ctx) {
  const o = op || {};
  const c = ctx || {};
  const semAdmin = c.podeComandar === true ? '' : (c.motivoSemComando || 'só o aparelho admin, com sinal fresco, emite comandos');
  return {
    cancelar: acao(semAdmin, o.prTag ? '' : 'o andamento não identifica o PR'),
    transferir: acao(semAdmin, faltaParaTransferir(o)),
    tomar: acao(semAdmin, faltaParaTomar(o)),
  };
}

const HERANCA = {
  integral: 'herdou a memória inteira de outro aparelho',
  parcial: 'herdou parte da memória de outro aparelho',
  reinicio: 'começou do zero, sem memória herdada',
};

// O PR só é nomeado quando o catálogo abriu: sem isso, rótulo genérico
function tituloDaOperacao(op) {
  const pr = op.pr || null;
  if (!pr || !pr.key) return 'Um PR seu, sem nome nesta tela (o catálogo cifrado não abriu)';
  return `${prRefMention(pr.key)}${se(pr.title, ` <span class="md-fraco">${esc(pr.title)}</span>`)}`;
}

function botaoOuNota(classe, rotulo, acao, dados) {
  if (acao.pode) return `<button class="btn sm ghost ${classe}" ${dados}>${esc(rotulo)}</button>`;
  return `<span class="md-nota">${esc(rotulo)}: indisponível, ${esc(acao.motivo)}</span>`;
}

function operacaoHtml(op, ctx) {
  const acoes = acoesDaOperacao(op, ctx);
  const dados = `data-op="${esc(op.opId)}" data-dev="${esc(op.dev)}" data-prtag="${esc(op.prTag || '')}"`;
  const subagentes = Array.isArray(op.subagentes) ? op.subagentes.length : 0;
  const situacao = se(op.situacao === 'interrompida', '<span class="sync-chip warn">sem renovar</span>');
  const tempo = `${esc(fmtDur(tempoDaOperacao(op)))}${se(op.modelo, `, ${esc(op.modelo)}`)}`;
  const heranca = HERANCA[op.heranca] || '';
  const etapa = `${esc(ETAPA[op.etapa] || ETAPA.desconhecida)}${se(subagentes, `, ${plural(subagentes, 'subagente', 'subagentes')}`)}${se(heranca, `, ${esc(heranca)}`)}`;
  return `<div class="card working md-op">
    <div class="md-linha"><span class="sync-chip mute">${esc(op.aparelho || 'outro aparelho')}</span><span class="md-fraco">${esc(TIPO_OP[op.tipo] || 'revisão')}</span>${situacao}<span class="md-espaco"></span><span class="md-fraco">${tempo}</span></div>
    <div class="md-titulo">${tituloDaOperacao(op)}</div>
    <div class="md-sub">${etapa}</div>
    <div class="md-acoes">
      ${botaoOuNota('md-cancelar', 'Cancelar', acoes.cancelar, dados)}
      ${botaoOuNota('md-transferir', 'Transferir', acoes.transferir, dados)}
      ${botaoOuNota('md-tomar', 'Tomar para este aparelho', acoes.tomar, dados)}
    </div>
  </div>`;
}

export function operacoesRemotasHtml(operacoes, ctx) {
  const lista = Array.isArray(operacoes) ? operacoes : [];
  if (!lista.length) return '<p class="md-vazio">Nenhuma análise rodando em outro aparelho agora.</p>';
  return lista.map((op) => operacaoHtml(op || {}, ctx || {})).join('');
}

// A leitura do andamento gira a cada 10 segundos, e a leitura que falha NÃO apaga a visão
// anterior (lib/engine/sync-andamento.js). O que a tela consegue afirmar é a idade do que
// está na tela, e é isso que ela diz, sem chamar de falha o que pode ser silêncio.
const ANDAMENTO_FRESCO_MS = 45000;

export function andamentoAtrasado(lastAt, agora = Date.now()) {
  const at = Number(lastAt) || 0;
  if (!at || agora - at <= ANDAMENTO_FRESCO_MS) return { atrasada: false, texto: '' };
  return { atrasada: true, texto: `Leitura atrasada: o último andamento chegou às ${fmtClock(at)} e o que está aqui pode estar velho.` };
}

export function andamentoAtrasadoHtml(lastAt, agora = Date.now()) {
  const r = andamentoAtrasado(lastAt, agora);
  if (!r.atrasada) return '';
  return `<div class="md-faixa warn"><span class="sync-chip warn">leitura atrasada</span><span>${esc(r.texto)}</span></div>`;
}

/* ---------- 2.9: comandos emitidos e os recibos ---------- */

const RECIBO = {
  aplicado: { classe: 'ok', rotulo: 'aplicado' },
  recusado: { classe: 'bad', rotulo: 'recusado' },
  ignorado: { classe: 'mute', rotulo: 'ignorado' },
  pendente: { classe: 'info', rotulo: 'pendente no aparelho alvo' },
};

const CODIGO = {
  'nao-aceita-admin': 'aquele aparelho não aceita comandos do admin',
  geracao: 'veio de outra geração de admin', assinatura: 'a assinatura não confere',
  autoridade: 'o admin estava sem sinal fresco', vencido: 'o comando venceu antes de ser lido',
  forma: 'o comando chegou fora do contrato', cifra: 'o comando não abriu',
  nada_rodando: 'nada daquele PR estava rodando lá', nao_conheco: 'aquele aparelho não conhece o PR',
  head_mudou: 'o commit mudou desde o pedido', sem_vaga: 'o aparelho estava sem vaga',
  inapto: 'o aparelho não estava apto', nao_e_minha: 'a pendência não é daquele aparelho',
  nao_postou: 'a decisão não foi postada', destino_inapto: 'o destino não estava apto',
  espera_senha: 'esperando a senha naquele aparelho',
  nao_publiquei: 'aquele aparelho não publicou este item',
  nao_enfileirou: 'a análise não entrou na fila de lá',
  duplicado: 'já havia uma análise deste PR na fila ou rodando lá',
  'saida-de-cena': 'outra pessoa já pegou este PR, e lá o Farol saiu de cena',
  recusado_no_aparelho: 'recusado por quem está naquele aparelho',
};

const TIPO_CMD = { cancelar: 'cancelar', repetir: 'repetir', decidir: 'decidir', iniciar: 'iniciar', transferir: 'transferir', tomar: 'tomar', 'designar-admin': 'designar admin' };

function detalheDoCodigo(code) {
  if (!code) return '';
  return CODIGO[code] || `código ${code}`;
}

// Recibo que não muda mais: a tela para de perguntar por ele.
export function reciboFinal(recibo) {
  return !!recibo && ['aplicado', 'recusado', 'ignorado'].includes(recibo.estado);
}

// SUCESSO SÓ EXISTE COM RECIBO. Sem ele há dois estados, e nenhum deles é concluído.
// `leituraFalhou` diz que a última consulta do recibo não chegou: isso aparece, porque
// "sem recibo" e "não deu para perguntar" são coisas diferentes.
export function reciboEstado(cmd, recibo, agora = Date.now(), leituraFalhou = false) {
  const c = cmd || {};
  const r = recibo || null;
  const modelo = r && RECIBO[r.estado];
  if (modelo) {
    const quando = r.at ? `, às ${fmtClock(r.at)}` : '';
    const porque = detalheDoCodigo(r.code);
    return { estado: r.estado, classe: modelo.classe, rotulo: modelo.rotulo, detalhe: `${porque ? `${porque}` : 'recibo do aparelho alvo'}${quando}` };
  }
  if (c.vence && Number(agora) > Number(c.vence)) {
    return { estado: 'vencido', classe: 'bad', rotulo: 'vencido', detalhe: `sem recibo até ${fmtClock(c.vence)}` };
  }
  const prazo = c.vence ? `, e vale até ${fmtClock(c.vence)}` : '';
  const falha = leituraFalhou ? '; a última consulta do recibo falhou' : '';
  return { estado: 'enviado', classe: 'info', rotulo: 'enviado', detalhe: `esperando o recibo do aparelho alvo${prazo}${falha}` };
}

// o destino da transferência e o PR (quando o engine o resolveu) completam a linha
function detalheDoComando(cmd, ctx) {
  const destino = cmd.destino ? `, destino ${esc(nomeDoAparelhoOuEste(ctx, cmd.destino))}` : '';
  const pr = cmd.prKey ? `, ${prRefMention(cmd.prKey)}` : '';
  return `${destino}${pr}`;
}

function nomeDoAparelhoOuEste(ctx, deviceId) {
  if (ctx.deviceIdLocal && deviceId === ctx.deviceIdLocal) return 'este aparelho';
  return nomeDoAparelho(ctx.devices, deviceId) || deviceId;
}

function comandoLinhaHtml(cmd, recibos, ctx) {
  const r = reciboEstado(cmd, recibos[cmd.cmdId], ctx.agora, ctx.falhas.has(cmd.cmdId));
  const onde = nomeDoAparelhoOuEste(ctx, cmd.alvo);
  return `<div class="md-cmd" data-cmd="${esc(cmd.cmdId)}">
    <span><b>${esc(TIPO_CMD[cmd.tipo] || cmd.tipo)}</b> para ${esc(onde)}${detalheDoComando(cmd, ctx)}, às ${esc(fmtClock(cmd.at))}</span>
    <span class="md-espaco"></span>
    <span class="sync-chip ${r.classe}">${esc(r.rotulo)}</span>
    <span class="md-fraco">${esc(r.detalhe)}</span>
  </div>`;
}

export function comandosEmitidosHtml(comandos, recibos, ctx) {
  const lista = Array.isArray(comandos) ? comandos : [];
  if (!lista.length) return '';
  const c = ctx || {};
  const contexto = { devices: c.devices, deviceIdLocal: c.deviceIdLocal || '', agora: c.agora || Date.now(), falhas: c.falhas instanceof Set ? c.falhas : new Set() };
  const mapa = recibos || {};
  return `<div class="card md-lista">${lista.map((cmd) => comandoLinhaHtml(cmd, mapa, contexto)).join('')}</div>`;
}

/* ---------- 2.9: o aviso antes de tomar ---------- */

const SEM_TOMADA = {
  'sem-lease': 'Ninguém está com este PR agora, então não há o que tomar.',
  'ja-e-meu': 'Este PR já está com este aparelho.',
  vencido: 'A posse do outro aparelho já venceu, então o caminho normal vale: não é tomada.',
};

// A leitura do lease acontece ANTES de confirmar (POST /api/sync/takeover-notice), e o
// texto do aviso vem pronto do engine (lib/sync/tomada.js). A tela não reescreve o risco.
export function tomadaDialogo(resposta) {
  const r = resposta || null;
  if (!r || r.ok !== true) {
    return { pode: false, titulo: 'Aviso da tomada indisponível', corpo: '<p>Não deu para ler quem está com este PR agora. A tomada fica indisponível até a leitura voltar.</p>' };
  }
  if (r.podeTomar !== true) {
    return { pode: false, titulo: 'Nada a tomar', corpo: `<p>${esc(SEM_TOMADA[r.motivo] || 'A tomada não se aplica a este PR agora.')}</p>` };
  }
  const risco = r.risco === 'provavel' ? 'Duplicidade provável.' : 'Duplicidade possível.';
  return {
    pode: true,
    titulo: 'Tomar este PR para este aparelho?',
    corpo: `<p>${esc(r.aviso || '')}</p><p><b>${esc(risco)}</b></p><ul><li>O processo do outro aparelho não é encerrado daqui.</li><li>A análise pode custar duas vezes.</li><li>Depois da tomada, só este aparelho consegue postar o review deste PR.</li></ul>`,
  };
}

/* ---------- 2.7: o que é só deste aparelho ---------- */

export function oQueELocalHtml() {
  return '<p class="md-nota">Destaques, Kudos e Time continuam locais: não sobem nem descem, mesmo com a visão compartilhada ligada.</p>';
}
