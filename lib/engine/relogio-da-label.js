// Notebook fechado ou app parado: ninguém olhou a label nesse intervalo, então o prazo dela não pode
// ter corrido. Sem isto, acordar liberava de uma vez a revisão de todo PR que um colega está revisando.
// A contagem PAUSA, nunca recomeça: recomeçar prenderia o PR para sempre em quem dorme mais vezes do
// que o prazo da label, e ressuscitaria a label já caducada.
import { TEMPOS } from '../constants.js';

// Devolve quanto somar aos carimbos neste ciclo; negativo quando o relógio voltou.
function pausaDaObservacao(engine, agora) {
  const ultima = Number(engine.labelVistaObservadaEm);
  const gravada = Number(engine.labelVistaObservadaGravadaEm) || 0;
  engine.labelVistaObservadaEm = agora;
  if (agora < gravada || agora - gravada >= TEMPOS.LABEL_GRAVAR_OBSERVACAO_MS) {
    engine.labelVistaObservadaGravadaEm = agora;
    if (typeof engine.saveLabelVistaObservada === 'function') engine.saveLabelVistaObservada();
  }
  if (!Number.isFinite(ultima) || ultima <= 0) return 0;
  const passou = agora - ultima;
  return passou < 0 || passou > limiteDaObservacao(engine) ? passou : 0;
}

// Até quanto tempo entre duas rodadas ainda conta como observação contínua: dois intervalos de
// polling, ou um intervalo mais a folga, o que for maior.
function limiteDaObservacao(engine) {
  const intervalo = (Number(engine.config?.intervalSeconds) || 0) * 1000;
  return Math.max(2 * intervalo, intervalo + TEMPOS.LABEL_FOLGA_OBSERVACAO_MS);
}

export { pausaDaObservacao, limiteDaObservacao };
