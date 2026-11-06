// Farol · texto da linha de log quando um processo do Electron morre.
// O main.js só observa (render-process-gone, child-process-gone, amostra de
// memória); quem decide o que vai na linha é este módulo, puro e testado.
// Motivo: até 05/11/2026 o farol.log tinha 23 quedas do renderer só com
// "(crashed)", sem código de saída nem memória, e nenhuma dava diagnóstico.

// Códigos de saída do Windows (NTSTATUS e o código de falta de memória do
// Chromium). O Electron entrega como inteiro com sinal; a leitura é sem sinal.
const CODIGOS_WINDOWS = {
  0xC0000005: 'acesso inválido à memória',
  0xC00000FD: 'estouro de pilha',
  0xC0000409: 'encerramento forçado pelo próprio Chromium',
  0xC0000374: 'heap corrompido',
  0xC0000017: 'sem memória do sistema',
  0xE0000008: 'sem memória (limite do Chromium)',
  0x80000003: 'parada fatal do Chromium ou do V8',
  0xC000001D: 'instrução ilegal',
  0xC0000142: 'falha ao iniciar biblioteca',
};

const KB_POR_MB = 1024;
const MS_POR_SEGUNDO = 1000;
const SEGUNDOS_POR_MINUTO = 60;
const MINUTOS_POR_HORA = 60;

function hex(n) {
  return `0x${(n >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
}

// "código 0xC0000005, acesso inválido à memória" (Windows) ou "código 11" (POSIX)
function textoDoCodigo(exitCode, ehWindows) {
  if (!Number.isInteger(exitCode)) return '';
  if (!ehWindows) return `código ${exitCode}`;
  const nome = CODIGOS_WINDOWS[exitCode >>> 0];
  return nome ? `código ${hex(exitCode)}, ${nome}` : `código ${hex(exitCode)}`;
}

function duracao(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const s = Math.round(ms / MS_POR_SEGUNDO);
  if (s < SEGUNDOS_POR_MINUTO) return `${s} s`;
  const min = Math.floor(s / SEGUNDOS_POR_MINUTO);
  if (min < MINUTOS_POR_HORA) return `${min} min`;
  return `${Math.floor(min / MINUTOS_POR_HORA)} h ${min % MINUTOS_POR_HORA} min`;
}

function mb(kb) {
  return `${Math.round(kb / KB_POR_MB)} MB`;
}

// Memória vem do app.getAppMetrics(): em KB, e privateBytes só existe no Windows.
// Devolve { kb, picoKb } do processo com esse pid, ou null.
export function memoriaDoProcesso(metricas, pid) {
  if (!Array.isArray(metricas) || !Number.isInteger(pid) || pid <= 0) return null;
  const m = metricas.find((x) => x && x.pid === pid);
  const mem = m && m.memory;
  if (!mem) return null;
  const kb = Number.isFinite(mem.privateBytes) ? mem.privateBytes : mem.workingSetSize;
  if (!Number.isFinite(kb)) return null;
  return { kb, picoKb: Number.isFinite(mem.peakWorkingSetSize) ? mem.peakWorkingSetSize : null };
}

// details: o do evento render-process-gone ({ reason, exitCode }).
// amostra: a última { kb, picoKb, em } do renderer (null se nunca deu pra medir).
// carregadaEm: quando a página terminou de carregar pela última vez (ms).
export function linhaDaQuedaDoRenderer({ details, amostra, carregadaEm, visivel, agora, ehWindows }) {
  const motivo = [details?.reason || 'motivo desconhecido', textoDoCodigo(details?.exitCode, ehWindows)]
    .filter(Boolean).join(', ');
  const partes = [];
  if (amostra && Number.isFinite(amostra.kb)) {
    const pico = Number.isFinite(amostra.picoKb) ? ` (pico ${mb(amostra.picoKb)})` : '';
    partes.push(`memória ${mb(amostra.kb)}${pico} medida há ${duracao(agora - amostra.em)}`);
  } else {
    partes.push('memória não medida');
  }
  // null - número vira número em JS: sem o teste, "nunca carregou" virava 277 h
  const desde = Number.isFinite(carregadaEm) ? duracao(agora - carregadaEm) : '';
  partes.push(desde ? `página carregada há ${desde}` : 'página ainda não tinha carregado');
  if (typeof visivel === 'boolean') partes.push(visivel ? 'janela visível' : 'janela escondida');
  return `renderer caiu (${motivo}); ${partes.join('; ')}; recarregando a janela`;
}

// child-process-gone: GPU, utilitários (rede, áudio). Saída limpa não é falha
// e não vira linha (invariante 3); o resto devolve o texto, senão null.
export function linhaDaQuedaDeProcesso(details, ehWindows) {
  if (!details || details.reason === 'clean-exit') return null;
  const quem = [details.type || 'processo', details.name || details.serviceName].filter(Boolean).join(' ');
  const motivo = [details.reason || 'motivo desconhecido', textoDoCodigo(details.exitCode, ehWindows)]
    .filter(Boolean).join(', ');
  return `processo ${quem} do Electron caiu (${motivo})`;
}
