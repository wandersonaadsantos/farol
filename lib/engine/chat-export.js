// Exportação da conversa do chat por PR (PURA): o arquivo que sai do app para análise
// externa. Pedido do dono em 26/09/2026: a conversa INTEIRA, com os metadados, e data e
// hora no horário de Brasília.
//
// Três escolhas, cada uma com o seu porquê:
//   - o horário sai do logStamp (lib/format.js), com o fuso EXPLÍCITO na linha: é o mesmo
//     carimbo do farol.log e do checkpoint, então dá para cruzar a conversa com o log sem
//     conta de fuso, e o offset acompanha o IANA se o horário de verão voltar;
//   - o texto passa pela máscara de segredo do registro de falhas: a tela mostra o que você
//     colou, mas um arquivo para análise externa não pode levar token junto;
//   - a exportação lê a conversa guardada inteira (até 200 mensagens), e não a janela que a
//     tela recebe, e avisa quando a conversa chegou no teto de retenção.
import { logStamp } from '../format.js';
import { mascararSegredos } from './falhas.js';

// Quantas mensagens cada conversa guarda. Mora aqui, e o chatSend (lib/engine/chat.js)
// poda por ele: o aviso "as anteriores podem ter saído" e a poda são a mesma regra.
const TETO_DE_MENSAGENS = 200;
const FUSO = 'America/Sao_Paulo';
const SEM_CONVERSA = { ok: false, error: 'não há conversa deste PR para exportar' };

const PAPEIS = {
  user: { rotulo: 'Você', papel: 'voce' },
  assistant: { rotulo: 'Claude', papel: 'claude' },
  system: { rotulo: 'Farol', papel: 'farol' },
};

function papelDe(role) { return PAPEIS[role] || PAPEIS.system; }

function carimbo(ms) {
  return Number.isFinite(ms) ? logStamp(new Date(ms)) : 'sem horário registrado';
}

function iso(ms) {
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

// "acme-exemplo/app#42" + 13:06 de 26/09 -> "farol-chat-acme-exemplo-app-42-2026-09-26-1306".
// Só [a-z0-9-]: nome que vale no Windows, no macOS e no celular.
function nomeDoArquivo(key, agora) {
  const pr = String(key).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const [dia, hora] = logStamp(new Date(agora)).split(' ');
  return `farol-chat-${pr}-${dia}-${hora.slice(0, 5).replace(':', '')}`;
}

function mensagemExportada(m) {
  const saida = {
    papel: papelDe(m.role).papel,
    texto: mascararSegredos(m.text),
    em: iso(m.at),
    emBrasilia: carimbo(m.at),
  };
  if (m.partial) saida.parcial = true;
  return saida;
}

function linhaDeMetadado(campo, valor) { return `| ${campo} | ${valor} |`; }

function markdownDe(dados) {
  const linhas = [
    `# Conversa do Farol: ${dados.pr}`,
    '',
    `Horários no horário de Brasília (${FUSO}), com o fuso explícito em cada linha.`,
    '',
    '| campo | valor |',
    '|---|---|',
    linhaDeMetadado('PR', dados.pr),
    linhaDeMetadado('Link', dados.url || 'sem link registrado'),
    linhaDeMetadado('Id da sessão do Claude', dados.sessionId ? `\`${dados.sessionId}\`` : 'ainda sem sessão'),
    linhaDeMetadado('Conversa iniciada em', dados.iniciadaEmBrasilia),
    linhaDeMetadado('Exportada em', dados.exportadaEmBrasilia),
    linhaDeMetadado('Mensagens', dados.mensagens.length),
    linhaDeMetadado('Versão do Farol', dados.versaoDoFarol || 'desconhecida'),
  ];
  if (dados.podeTerMensagensAnteriores) {
    linhas.push('', `O Farol guarda as ${TETO_DE_MENSAGENS} mensagens mais recentes de cada conversa; mensagens anteriores a estas podem ter saído.`);
  }
  for (const m of dados.mensagens) {
    const rotulo = Object.values(PAPEIS).find((p) => p.papel === m.papel).rotulo;
    const parcial = m.parcial ? ' (resposta ainda sendo gerada)' : '';
    linhas.push('', '---', '', `### ${rotulo} · ${m.emBrasilia}${parcial}`, '', m.texto);
  }
  return `${linhas.join('\n')}\n`;
}

// chat: o registro guardado em engine.chats[key]. opts.agora (ms) e opts.versao vêm de
// quem chama, para a função seguir pura.
function exportarConversa(chat, { agora = Date.now(), versao = '' } = {}) {
  const mensagens = chat && Array.isArray(chat.messages) ? chat.messages : [];
  if (!mensagens.length) return SEM_CONVERSA;
  const inicio = Number.isFinite(chat.createdAt) ? chat.createdAt : mensagens[0].at;
  const json = {
    pr: String(chat.key || ''),
    url: chat.url || null,
    sessionId: chat.sessionId || null,
    status: chat.status || 'idle',
    fuso: FUSO,
    iniciadaEm: iso(inicio),
    iniciadaEmBrasilia: carimbo(inicio),
    exportadaEm: iso(agora),
    exportadaEmBrasilia: carimbo(agora),
    versaoDoFarol: versao || null,
    podeTerMensagensAnteriores: mensagens.length >= TETO_DE_MENSAGENS,
    mensagens: mensagens.map(mensagemExportada),
  };
  return { ok: true, nome: nomeDoArquivo(json.pr, agora), markdown: markdownDe(json), json };
}

const chatExportMod = { exportarConversa, TETO_DE_MENSAGENS };
export default chatExportMod;
export { exportarConversa, TETO_DE_MENSAGENS };
