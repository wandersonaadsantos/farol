// Controle explícito dos marcadores de revisão; não apaga definições de labels do repositório.
import io from '../io.js';
import { atribuicaoDoPr } from './contas-gh.js';
import labelsATirar from './labels-a-tirar.js';
import { labelGerenciada, prDaUrl } from './review-label-target.js';
import { recusaDeSilenciada } from './conta-que-age.js';
function listas(engine) { return [engine.queue, engine.panorama, engine.myPRs, engine.headlessQueue].filter(Array.isArray); }
function atualizar(engine, pr, label) {
  for (const lista of listas(engine)) for (const item of lista) {
    if (item.key?.toLowerCase() !== pr.key.toLowerCase()) continue;
    if (Array.isArray(item.labels)) item.labels = item.labels.filter(l => l.toLowerCase() !== label.toLowerCase());
    if (Array.isArray(item.outrosRevisando)) item.outrosRevisando = item.outrosRevisando.filter(login => `${login}:revisando`.toLowerCase() !== label.toLowerCase());
  }
  for (const sessao of engine.activeReviews?.values() || []) {
    if (sessao.keys?.includes(pr.key)) sessao.labelsRemovidas = [...new Set([...(sessao.labelsRemovidas || []), label.toLowerCase()])];
  }
  engine.pushState?.();
}
async function command(engine, body, run = io.run) {
  const pr = prDaUrl(body?.url);
  if (!pr || !['list', 'remove'].includes(body?.action)) return { ok: false, error: 'Informe a URL de um pull request do GitHub e uma ação válida.' };
  if (body.action === 'remove' && !labelGerenciada(body.label)) return { ok: false, error: 'Somente tags de revisão no formato conta:revisando podem ser removidas aqui.' };
  const conhecida = listas(engine).flat().find(item => item.key?.toLowerCase() === pr.key.toLowerCase());
  const identidade = atribuicaoDoPr(engine, { ...pr, account: conhecida?.account });
  if (!identidade.conta || identidade.por === 'reserva' || !engine.accountList().some(a => a.user === identidade.conta) || !engine.tokenFor(identidade.conta)) return { ok: false, error: 'Não foi possível confirmar uma conta autenticada para este PR. Confira as contas e organizações em Sistema.' };
  const silenciada = recusaDeSilenciada(engine, identidade.conta);
  if (body.action === 'remove' && silenciada) return silenciada;
  try {
    const labels = await labelsATirar.ler(engine, pr, identidade.conta, run);
    if (!labels) return { ok: false, error: 'Não foi possível consultar as tags no GitHub. Nenhuma remoção foi confirmada.' };
    if (body.action === 'remove') {
      const label = labels.find(l => l.toLowerCase() === body.label.toLowerCase());
      if (label && !labelsATirar.anotar(engine, pr, label, Date.now(), identidade.conta)) return { ok: false, error: 'Não foi possível registrar a remoção com segurança. Nenhuma alteração foi enviada.' };
      if (label && !await labelsATirar.remover(engine, pr, label, run, identidade.conta)) return { ok: false, error: 'O GitHub não confirmou a remoção. Ela ficou pendente e será tentada novamente.' };
      if (!label) labelsATirar.concluir(engine, pr, body.label);
      atualizar(engine, pr, body.label);
    }
    return { ok: true, key: pr.key, account: identidade.conta, labels: labels.filter(l => labelGerenciada(l) && (body.action !== 'remove' || l.toLowerCase() !== body.label.toLowerCase())) };
  } catch { return { ok: false, error: 'Operação indisponível. Confira o acesso ao GitHub e tente novamente.' }; }
}
export { command, prDaUrl };
