// Frescor da autoridade do admin (CT-ADM-POL). A parte de decisão é PURA; o único IO é a
// sequência já vista, que precisa sobreviver a reinício.
//
// O PROBLEMA QUE ISTO RESOLVE: uma assinatura válida não diz QUANDO o valor foi publicado.
// O banco reentrega o último valor no snapshot de cada conexão, e um admin que morreu há
// horas continua com o último batimento lá, perfeitamente assinado. Se "assinatura válida"
// bastasse, um admin morto continuaria mandando para sempre.
//
// Por isso frescor aqui é OBSERVAR UMA MUDANÇA: uma sequência maior que a última vista,
// chegando DEPOIS do início da conexão atual, medida pelo relógio local. Snapshot inicial,
// reentrega do mesmo valor e keep-alive não provam nada.
//
// A maior sequência vista é persistida: sem isso, bastaria reiniciar o Farol para um valor
// antigo voltar a parecer novidade.
import path from 'node:path';
import { STATE_DIR } from '../paths.js';
import io from '../io.js';
import { verificar } from './assinatura.js';

const ARQUIVO = path.join(STATE_DIR, 'sync-autoridade.json');
const CAMINHO_BEAT = 'live/control/beat';

function caminhoDaSequencia() { return ARQUIVO; }

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function numero(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function lerSequenciaVista() {
  const d = io.readJson(ARQUIVO, null);
  return objeto(d) ? numero(d.sequenciaVista) : 0;
}

function gravarSequenciaVista(sequencia) {
  try {
    io.ensureDir(path.dirname(ARQUIVO));
    io.writeJsonAtomic(ARQUIVO, { v: 1, sequenciaVista: numero(sequencia) });
    return true;
  } catch {
    // sem o arquivo, o pior caso é aceitar de novo um valor já visto depois de um reinício
    return false;
  }
}

function apagarSequenciaVista() {
  return gravarSequenciaVista(0);
}

function novoEstadoDeAutoridade(sequenciaVista = 0) {
  return { sequenciaVista: numero(sequenciaVista), fresca: false, ultimaMudancaEm: 0, dev: '', generation: 0 };
}

// O sinal precisa estar inteiro, ser da geração vigente e ter assinatura válida daquela
// geração. Qualquer falha aqui devolve o estado INTACTO: um sinal que não se prova não
// muda nem a sequência vista, senão ele conseguiria envenenar o corte de frescor.
function sinalValido(sinal, ctx) {
  if (!objeto(sinal) || !numero(sinal.sequencia) || !sinal.dev) return false;
  if (Number(sinal.generation) !== Number(ctx.generationVigente)) return false;
  const valor = { dev: sinal.dev, generation: Number(sinal.generation), sequencia: Number(sinal.sequencia), beatAt: Number(sinal.beatAt) || 0 };
  return verificar(ctx.publicKey, sinal.sig, { uid: ctx.uid, caminho: CAMINHO_BEAT, generation: Number(sinal.generation), valor });
}

function observarAutoridade(estado, sinal, ctx) {
  const atual = objeto(estado) ? estado : novoEstadoDeAutoridade();
  if (!sinalValido(sinal, ctx || {})) return atual;
  const sequencia = Number(sinal.sequencia);
  // sequência menor ou igual à maior já vista: reentrega ou valor antigo, nunca novidade
  if (sequencia <= atual.sequenciaVista) return { ...atual, dev: sinal.dev, generation: Number(sinal.generation) };
  const visto = { ...atual, sequenciaVista: sequencia, dev: sinal.dev, generation: Number(sinal.generation) };
  // mudança que chega no snapshot inicial, ou antes do início desta conexão, conta como
  // vista (para não valer de novo depois) mas NÃO prova que o admin está vivo agora
  if (ctx.doSnapshot === true || Number(ctx.agora) < Number(ctx.conexaoIniciadaEm)) return visto;
  return { ...visto, fresca: true, ultimaMudancaEm: Number(ctx.agora) };
}

// Vence sem mudança por três intervalos de publicação, contados do último valor fresco.
function autoridadeFresca(estado, { agora, intervaloMs }) {
  if (!objeto(estado) || estado.fresca !== true) return false;
  const limite = Number(intervaloMs) * 3;
  return Number(agora) - Number(estado.ultimaMudancaEm) <= limite;
}

export default { caminhoDaSequencia, lerSequenciaVista, gravarSequenciaVista, apagarSequenciaVista, novoEstadoDeAutoridade, observarAutoridade, autoridadeFresca };
export { caminhoDaSequencia, lerSequenciaVista, gravarSequenciaVista, apagarSequenciaVista, novoEstadoDeAutoridade, observarAutoridade, autoridadeFresca };
