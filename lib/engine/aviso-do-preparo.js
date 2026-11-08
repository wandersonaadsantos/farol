// O que a sessão escreve no feed enquanto se prepara (08/11/2026), PURO.
//
// Antes da primeira linha do feed rodavam, em silêncio, a busca do código (numa fila de um por
// vez) e a preparação da avaliação técnica: um PR de 2 arquivos ficou quase 5 minutos em "preparo"
// sem nada dizendo o que acontecia. Cada passo agora diz o que faz, e quanto levou.

function textoDaBusca(outros) {
  const n = Number(outros) || 0;
  if (n <= 0) return 'Buscando o código do PR.';
  return `Buscando o código do PR, com ${n} ${n === 1 ? 'outro preparo' : 'outros preparos'} em andamento.`;
}

const TEXTO_DA_AVALIACAO = 'Preparando a avaliação técnica: cópia do repositório e verificações automáticas.';
const TEXTO_SEM_MATERIAL = 'A busca do código do PR terminou sem o material completo.';

function duracao(ms) {
  const s = Math.round((Number(ms) || 0) / 1000);
  if (s < 60) return `${s} s`;
  const resto = s % 60;
  return resto ? `${Math.floor(s / 60)} min ${resto} s` : `${Math.floor(s / 60)} min`;
}

function textoDePronto(rotulo, ms) {
  return `${rotulo} em ${duracao(ms)}.`;
}

// Nem toda chamada tem sessão no feed (autoanálise por agente, testes com motor mínimo). O preparo
// não é sinal do provedor: `ultimoSinalEm` diz há quanto tempo o stream calou, e uma fila ou uma
// auditoria demorada não pode virar "sem sinal há Xs". A etapa vai estampada para os outros aparelhos.
function avisarPreparo(engine, id, texto) {
  if (!id || typeof engine?.pushActivity !== 'function') return;
  const sessao = engine.activeReviews?.get?.(id);
  const sinal = sessao?.ultimoSinalEm;
  engine.pushActivity(id, 'info', texto, undefined, 'preparo');
  if (sessao) sessao.ultimoSinalEm = sinal;
}

export { textoDaBusca, TEXTO_DA_AVALIACAO, TEXTO_SEM_MATERIAL, duracao, textoDePronto, avisarPreparo };
