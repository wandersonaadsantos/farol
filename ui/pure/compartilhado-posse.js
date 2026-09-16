// Transferência e tomada pela tela (brief B2, item 2.9, e o quadro C8), parte PURA.
//
// Recebe o que o engine entrega (a resposta de `POST /api/sync/transfer-targets`, a
// operação do evento `sync-live`, `sync.comandosEmitidos` e `sync.tomadas`) e devolve o
// texto e as opções do diálogo. Nada toca DOM nem lê estado global.
//
// A ESCOLHA NA TELA NÃO É A DECISÃO. O aparelho de origem confere o destino de novo na
// hora de largar a sessão (lib/engine/sync-transferencia.js), e o executor da tomada
// confere o head e a vaga. A tela só não oferece o que ela já sabe que seria recusado, e
// diz por quê.
import { esc, fmtClock } from './comum.js';
import { prRefMention } from './mencoes.js';
import { nomeDoAparelho } from './compartilhado.js';

// Os motivos de `lib/sync/transferencia.js` (motivoDoDestino e motivoDaOrigem), em texto.
const MOTIVO_DESTINO = {
  'dono-atual': 'é o aparelho que roda a análise agora',
  aposentado: 'aposentado',
  'versao-antiga': 'em versão antiga, sem o contrato atual da sincronização',
  'sem-chave': 'sem a chave do conjunto aberta',
  'sem-sinal': 'sem sinal recente',
  'sem-consentimento': 'não aceita comandos do admin',
  pausado: 'pausado pelo admin',
  'sem-ia': 'sem IA pronta',
  'sem-vaga': 'sem vaga',
  'sem-credencial': 'sem credencial desta conta',
  'memoria-desconhecida': 'sem medida de memória livre, e a admissão não admite assim',
  'memoria-baixa': 'com memória livre abaixo do piso da admissão',
};

function textoDoMotivo(motivo) {
  return MOTIVO_DESTINO[motivo] || `motivo registrado: ${motivo}`;
}

function rotuloDoDestino(d) {
  const nome = String(d.nome || d.deviceId || '');
  return d.souEu ? `este aparelho (${nome})` : nome;
}

function rotuloDoPr(op) {
  const pr = (op && op.pr) || null;
  return pr && pr.key ? pr.key : 'esta análise';
}

function destinoHtml(d) {
  if (d.apto) return `<li class="md-destino md-apto"><b>${esc(rotuloDoDestino(d))}</b><span class="md-fraco">com vaga, IA pronta e credencial da conta</span></li>`;
  return `<li class="md-destino md-inapto" aria-disabled="true"><b>${esc(rotuloDoDestino(d))}</b><span class="md-fraco">inapto: ${esc(textoDoMotivo(d.motivo))}</span></li>`;
}

function listaHtml(destinos) {
  return `<ul class="md-destinos">${destinos.map(destinoHtml).join('')}</ul>`;
}

function indisponivel(titulo, corpo) {
  return { pode: false, titulo, corpo, opcoes: [], aptos: [] };
}

// O diálogo de escolha. Só os aptos viram opção de envio; os inaptos aparecem na lista,
// desabilitados, com o motivo. A origem que não aplicaria o comando fecha o diálogo inteiro.
export function transferenciaDialogo(resposta, op) {
  const r = resposta || null;
  if (!r || r.ok !== true || !Array.isArray(r.destinos)) {
    return indisponivel('Destinos indisponíveis', '<p>Não deu para ler a capacidade dos aparelhos agora. A transferência fica indisponível até a leitura voltar.</p>');
  }
  const origem = (r.origem && r.origem.motivo) || '';
  const nomeOrigem = (op && op.aparelho) || 'o aparelho de origem';
  if (origem) {
    return indisponivel('Transferência indisponível', `<p>O ${esc(nomeOrigem)} ${esc(textoDoMotivo(origem))}, e é ele quem aplica a transferência.</p>${listaHtml(r.destinos)}`);
  }
  const aptos = r.destinos.filter((d) => d && d.apto === true);
  if (!aptos.length) {
    return indisponivel('Nenhum aparelho apto agora', `<p>Nenhum aparelho pode receber esta análise agora. Os motivos de cada um:</p>${listaHtml(r.destinos)}`);
  }
  return {
    pode: true,
    titulo: `Transferir ${rotuloDoPr(op)}`,
    corpo: `<p>O ${esc(nomeOrigem)} publica o que já verificou, encerra a sessão e devolve a revisão preferindo o destino por um prazo curto. Nenhuma sessão migra: o destino começa uma nova, com essa memória.</p>${listaHtml(r.destinos)}`,
    opcoes: aptos.map((d) => ({ valor: d.deviceId, rotulo: `Transferir para ${rotuloDoDestino(d)}`, classe: 'primary' })),
    aptos: aptos.map((d) => d.deviceId),
  };
}

// A confirmação depois da escolha: quem aplica, para onde, e que o desfecho é o recibo.
export function transferenciaConfirmacao({ origem, destino }) {
  return {
    title: `Transferir para ${destino}?`,
    body: `<p>O comando vai ao <b>${esc(origem)}</b>, que confere o destino de novo antes de largar a sessão. O resultado aparece quando ele responder com o recibo.</p>`,
  };
}

/* ---------- divergência 4: o comando no card do PR ---------- */

const TIPO_NA_NOTA = { cancelar: 'cancelar', repetir: 'repetir', transferir: 'transferir', tomar: 'tomar', iniciar: 'iniciar' };

function nomeNaNota(sync, deviceId) {
  if (deviceId && deviceId === sync.deviceId) return 'este aparelho';
  return nomeDoAparelho(sync.devices, deviceId) || deviceId || 'outro aparelho';
}

// Só o comando cujo PR o engine resolveu (`prKey`) é amarrado a um card: sem isso, seria
// palpite. O mais recente vale, e o desfecho continua na lista de comandos enviados.
export function notaComandoHtml(key, sync) {
  const s = sync || {};
  const cmd = (Array.isArray(s.comandosEmitidos) ? s.comandosEmitidos : []).find((c) => c && c.prKey && c.prKey === key);
  if (!cmd) return '';
  const destino = cmd.destino ? ` para ${esc(nomeNaNota(s, cmd.destino))}` : '';
  const tipo = esc(TIPO_NA_NOTA[cmd.tipo] || cmd.tipo);
  return `<div class="pr-coord">Comando enviado ao ${esc(nomeNaNota(s, cmd.alvo))}: ${tipo}${destino}, às ${esc(fmtClock(cmd.at))}. O desfecho aparece em <span class="md-goto" data-goto="aba:radar:#mdComandosWrap" role="button" tabindex="0">Comandos enviados</span>, quando o aparelho responder.</div>`;
}

/* ---------- divergência 10: histórico de tomadas feitas ---------- */

const RISCO = { provavel: { classe: 'warn', rotulo: 'duplicidade provável' }, possivel: { classe: 'mute', rotulo: 'duplicidade possível' } };

function nomeNaLista(devices, deviceIdLocal, deviceId) {
  if (deviceId && deviceId === deviceIdLocal) return 'este aparelho';
  return nomeDoAparelho(devices, deviceId) || deviceId || 'outro aparelho';
}

function tomadaHtml(t, devices, deviceIdLocal) {
  const risco = RISCO[t.risco] || RISCO.possivel;
  const de = nomeNaLista(devices, deviceIdLocal, t.de);
  const para = nomeNaLista(devices, deviceIdLocal, t.para);
  return `<div class="md-cmd">
    <span>${prRefMention(t.prKey)}: ${esc(de)} para ${esc(para)}, geração ${esc(String(t.geracao || ''))}</span>
    <span class="md-espaco"></span>
    <span class="sync-chip ${risco.classe}">${esc(risco.rotulo)}</span>
    <span class="md-fraco">${esc(fmtClock(t.at))}</span>
  </div>`;
}

// `sync.tomadas` (lib/sync/coordinator.js, evidenciaDaTomada): de quem, para quem, geração,
// risco e quando. Lista vazia não desenha nada: a seção some.
export function tomadasFeitasHtml(tomadas, devices, deviceIdLocal) {
  const lista = Array.isArray(tomadas) ? tomadas.filter((t) => t && t.prKey) : [];
  if (!lista.length) return '';
  return `<div class="card md-lista">${lista.map((t) => tomadaHtml(t, devices, deviceIdLocal)).join('')}</div>`;
}
