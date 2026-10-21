// A porta de execução deste aparelho (28/09/2026): a UMA pergunta que toda revisão headless
// faz antes de existir. As regras de hoje moram nos próprios módulos: PR da própria conta
// (pr-proprio.js) e conta silenciada (conta-que-age.js, 06/10/2026), que continua
// monitorada, mas não inicia trabalhos novos. A revisão roda com o GH_TOKEN da conta e põe
// a label `<conta>:revisando` no PR, então a silenciada não passa nem pelo clique.
import admissao from './admissao.js';
import prProprio from './pr-proprio.js';
import { recusaDeSilenciada, textoDeSilenciada } from './conta-que-age.js';

function motivoParaNaoExecutar(engine, pr) {
  if (prProprio.ehMeu(engine, pr)) return 'pr-proprio';
  if (recusaDeSilenciada(engine, engine.accountForPr(pr))) return 'conta_silenciada';
  return '';
}

function avisoDoMotivo(engine, it, motivo) {
  if (motivo === 'conta_silenciada') return { kind: 'error', text: `${it.key}: ${textoDeSilenciada(engine.accountForPr(it))}.` };
  return { kind: 'info', text: prProprio.avisoPrProprio(it.key) };
}

// Tira do lote o que não pode executar aqui, com um aviso por PR barrado.
function executaveis(engine, itens) {
  const fica = [];
  const avisos = new Set();
  for (const it of itens) {
    const motivo = motivoParaNaoExecutar(engine, it);
    if (!motivo) { fica.push(it); continue; }
    const aviso = avisoDoMotivo(engine, it, motivo);
    if (!avisos.has(aviso.text)) engine.emit('toast', aviso);
    avisos.add(aviso.text);
  }
  return fica;
}

function devolverSilenciados(engine) {
  const devolvidos = engine.headlessQueue.filter(pr => engine.isMuted?.(engine.accountForPr(pr)));
  if (!devolvidos.length) return;
  engine.headlessQueue = engine.headlessQueue.filter(pr => !devolvidos.includes(pr));
  for (const pr of devolvidos) {
    if (pr.admissaoId) { admissao.liberar(engine, pr.admissaoId); delete pr.admissaoId; }
    engine.unsee(pr.key);
    if (!engine.queue.some(p => p.key === pr.key)) engine.queue.push(pr);
  }
  engine.writeInflight();
  engine.pushState();
}

// Reconfere depois dos gates assíncronos anteriores ao início da sessão.
function devolverSeSilenciada(engine, pr) {
  if (!engine.isMuted?.(engine.accountForPr(pr))) return false;
  engine.unsee(pr.key);
  if (!engine.queue.some(p => p.key === pr.key)) engine.queue.push(pr);
  return true;
}

// A sessao deste PR terminou ou nem vai comecar: libera a vaga da conta, persiste o
// inflight, atualiza a tela e chama a proxima da fila. Os quatro passos andavam copiados
// em cinco ramos deste arquivo, e separa-los ja custou vaga presa.
function encerrarSemSessao(engine, pr, acct) {
  engine.freeHeadlessSlot(acct, pr);
  engine.writeInflight();
  engine.pushState();
  engine.processHeadless();
}

export default { motivoParaNaoExecutar, executaveis, devolverSilenciados, devolverSeSilenciada, encerrarSemSessao };
export { motivoParaNaoExecutar, executaveis, devolverSilenciados, devolverSeSilenciada, encerrarSemSessao };
