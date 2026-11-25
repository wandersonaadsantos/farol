// O config.json presente e ilegível impede o boot em vez de virar os padrões (porte do fork,
// 16/11/2026).
//
// Até aqui o arquivo que não dava para ler, vazio, que não era JSON ou que era JSON mas não um
// objeto fazia o motor subir com os padrões, com um WARN e uma cópia `.bad` ao lado. A primeira
// gravação da config (a migração das contas roda no boot) regravava então o arquivo com os
// padrões, e a pessoa perdia contas, políticas, perfis e a autenticação exigida sem perceber: a
// conta detectada de novo subia com a política padrão, e quem tinha `localAuth: "exigir"` ficava
// com a API local aberta. Agora a Engine lança antes de qualquer gravação, o arquivo não é
// tocado, e a mensagem diz o que está errado e onde.
//
// Arquivo ausente continua sendo instalação nova e sobe. Zero bytes é ilegível, de propósito: o
// motor só grava o config.json por escrita atômica, que nunca deixa o arquivo vazio; vazio é
// edição ou cópia interrompida. O BOM UTF-8 que editor do Windows grava no início não é erro: a
// leitura o ignora (lerJsonTeimoso, lib/io.js), sem tocar o arquivo.
//
// A mensagem não leva o texto cru do parser, que cita um trecho do arquivo: segredos (chave de
// API de perfil, credenciais de site) moram nele. Do erro do parser fica só a posição.
import fs from 'node:fs';
import { lerJsonTeimoso } from './io.js';
import { CONFIG_FILE } from './paths.js';

const CODIGO_CONFIG_ILEGIVEL = 'FAROL_CONFIG_ILEGIVEL';

function ondeQuebra(mensagemDoParser) {
  const msg = String(mensagemDoParser || '');
  const linhaColuna = /\(line (\d+) column (\d+)\)/.exec(msg);
  if (linhaColuna) return ` (linha ${linhaColuna[1]}, coluna ${linhaColuna[2]})`;
  const posicao = /at position (\d+)/.exec(msg);
  return posicao ? ` (posição ${posicao[1]})` : '';
}

function tipoDe(valor) {
  if (valor === null) return 'null';
  if (Array.isArray(valor)) return 'uma lista';
  return { string: 'um texto', number: 'um número', boolean: 'um booleano' }[typeof valor] || 'outra coisa';
}

// A leitura respondeu "não existe". Ou o nome não existe mesmo, e é a instalação nova, ou é um
// link simbólico para nada (pasta sincronizada que não montou, alvo apagado): subir com os
// padrões trocaria o link por um arquivo novo. O lstat olha o próprio nome, sem seguir o link.
function motivoDoAusente(arquivo) {
  try { fs.lstatSync(arquivo); } catch (erro) { return erro.code === 'ENOENT' ? '' : `não deu para ler (${erro.message})`; }
  return 'é um link simbólico que aponta para um arquivo que não existe';
}

// '' quando o arquivo serve (ou não existe); senão, o motivo da recusa.
function motivoDoIlegivel(lido, cru, arquivo) {
  if (!lido.ok && lido.motivo === 'ausente') return motivoDoAusente(arquivo);
  if (!lido.ok && cru === null) return `não deu para ler (${lido.motivo})`;
  if (!lido.ok) return cru.trim() === '' ? 'o arquivo está vazio' : `não é JSON válido${ondeQuebra(lido.motivo)}`;
  const objeto = !!lido.data && typeof lido.data === 'object' && !Array.isArray(lido.data);
  return objeto ? '' : `é JSON válido, mas não é um objeto (é ${tipoDe(lido.data)})`;
}

// O config.json como veio do disco: o objeto, ou {} quando o arquivo não existe. Presente e
// ilegível, entrega a linha a `log` e lança um erro com `code` CODIGO_CONFIG_ILEGIVEL.
function lerConfigOuRecusar(log, arquivo = CONFIG_FILE) {
  let cru = null;
  const lido = lerJsonTeimoso(arquivo, { tentativas: 1, ler: (f) => (cru = fs.readFileSync(f, 'utf8')) });
  const motivo = motivoDoIlegivel(lido, cru, arquivo);
  if (!motivo) return lido.ok ? lido.data : {};
  const linha = `config.json ilegível, o Farol não sobe: ${motivo}. Arquivo: ${arquivo}. Corrija o arquivo: ele não foi alterado nem renomeado, e o Farol não sobe com os padrões no lugar dele.`;
  if (log) log(linha);
  throw Object.assign(new Error(linha), { code: CODIGO_CONFIG_ILEGIVEL });
}

// Roda a subida do motor sem janela (`node server.js`): a recusa do config ilegível sai limpa, a
// mensagem no stderr, sem pilha, e código de saída 1. Qualquer outro erro segue como antes.
function subirOuRecusar(subir, { erro: escrever = console.error, sair = process.exit } = {}) {
  try { return subir(); } catch (erro) {
    if (!erro || erro.code !== CODIGO_CONFIG_ILEGIVEL) throw erro;
    escrever(`[farol] ${erro.message}`);
    return sair(1);
  }
}

export { CODIGO_CONFIG_ILEGIVEL, lerConfigOuRecusar, subirOuRecusar };
export default { CODIGO_CONFIG_ILEGIVEL, lerConfigOuRecusar, subirOuRecusar };
