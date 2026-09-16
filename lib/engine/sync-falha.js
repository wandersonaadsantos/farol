// Vocabulário de estado e de falha da sincronização: os estados da conexão, quais recusas
// são permanentes, quais são o banco fora de alcance, e o registro de falha que o
// Diagnóstico lê.
//
// Saiu de lib/engine/sync.js na C2b, quando os colaboradores passaram a precisar dele.
// Ficar lá dentro obrigaria cada módulo novo a importar do sync.js, e sync.js já importa
// todos eles: o ciclo funcionaria no ESM e seria exatamente o tipo de dependência que
// ninguém consegue seguir depois. De quebra, libera o teto de linhas do sync.js, que
// estava travando cada entrega nova.
//
// A regra de log é a de sempre: o farol.log é de FALHA, não de estado. Loga só quando o
// CÓDIGO muda, senão a mesma recusa a cada tick inundaria o Diagnóstico.
import { coordinationActive } from '../sync/config.js';
import { SYNC_CODES, motivoDe } from '../sync/errors.js';

const STATUS = {
  DESLIGADO: 'desligado', SEM_CREDENCIAL: 'sem-credencial', CONECTANDO: 'conectando',
  CONECTADO: 'conectado', ERRO: 'erro',
};

// Recusas que só se resolvem com ação de quem usa (entrar de novo, corrigir a chave ou
// a URL): o tick não insiste nelas, senão cada ciclo de polling gastaria uma chamada ao
// securetoken para ouvir a mesma recusa.
const PERMANENTES = new Set([
  SYNC_CODES.CREDENCIAL_INVALIDA, SYNC_CODES.CONFIG_INVALIDA, SYNC_CODES.NAO_ENCONTRADO,
  SYNC_CODES.SEM_CREDENCIAL, SYNC_CODES.FALHA_INTERNA,
  // provedor desligado e Authentication não inicializado só saem com alguém abrindo o
  // console do Firebase: insistir a cada tick gastaria cota pra ouvir a mesma recusa
  SYNC_CODES.PROVEDOR_DESABILITADO, SYNC_CODES.AUTH_NAO_CONFIGURADO,
  // segundo fator o Farol não sabe fazer: insistir nunca vira sessão, só gasta cota
  SYNC_CODES.SEGUNDO_FATOR,
]);

// Estas falhas são o banco fora de alcance: o log usa a frase que a classe
// `coordenacao-indisponivel` da taxonomia reconhece, pro Diagnóstico agrupar certo.
const TRANSITORIAS = new Set([SYNC_CODES.INDISPONIVEL, SYNC_CODES.TIMEOUT, SYNC_CODES.NAO_AUTORIZADO]);

function cfgDe(engine) { return (engine.config && engine.config.sync) || {}; }

function falhaSem(code, motivo) { return { ok: false, code, motivo: motivo || motivoDe(code) }; }

function avisarTela(engine) {
  if (typeof engine.pushState === 'function') engine.pushState();
}

// A falha transitória é a mesma; o NOME dela depende do que a pessoa ligou. Com a
// coordenação desligada (só consolidação), dizer "coordenação entre dispositivos
// indisponível" punha no Diagnóstico um recurso que ninguém ligou. As duas frases caem
// na mesma classe da taxonomia (lib/log-taxonomy.js).
function prefixoDaFalha(engine, code) {
  if (!TRANSITORIAS.has(code)) return 'sincronização entre dispositivos parada';
  return coordinationActive(cfgDe(engine)) ? 'coordenação entre dispositivos indisponível' : 'sincronização entre dispositivos indisponível';
}

// Não dá pra usar o status como sinal de transição, porque cada reconexão passa por
// 'conectando' antes de falhar de novo; o lastError sobrevive à tentativa e só é zerado
// quando a conexão volta.
function registrarFalha(engine, code, motivo) {
  const rt = engine.sync;
  const frase = motivo || motivoDe(code);
  const novidade = !rt.lastError || rt.lastError.code !== code;
  if (novidade && typeof engine.log === 'function') {
    engine.log('WARN', `${prefixoDaFalha(engine, code)}: ${frase} (${code})`);
  }
  rt.lastError = { code, motivo: frase, at: Date.now() };
  rt.status = STATUS.ERRO;
  return falhaSem(code, frase);
}

function superado() { return falhaSem(SYNC_CODES.DESLIGADO, 'a conexão foi substituída antes de terminar'); }

export default { STATUS, PERMANENTES, TRANSITORIAS, falhaSem, avisarTela, registrarFalha, superado };
export { STATUS, PERMANENTES, TRANSITORIAS, falhaSem, avisarTela, registrarFalha, superado };
