// Label `<conta>:revisando` que não saiu no fim da revisão (10/10/2026).
//
// O `removeInProgressLabel` roda no `finally` da revisão e, quando o gh falha (rede caída,
// token sumido do keyring), só registrava um WARN. Ninguém tentava de novo: a limpeza do boot
// (`limparLabelsOrfas`) só cobre sessão que estava viva quando o app morreu, e a sessão que
// falhou já tinha saído do inflight. A label ficava no PR até a PRÓXIMA revisão daquele PR
// pela mesma conta, que a põe de novo (no-op) e a tira no fim dela. Visto num PR real: 24h28
// de label para uma revisão que leva minutos, e quem lê a label (o time e o Farol das outras
// contas) passou esse tempo achando que havia alguém revisando.
//
// Agora a remoção que falhou fica anotada em `state/labels-a-tirar.json` (durável: sobrevive a
// reinício) e o `check()` tenta de novo a cada ciclo. Revisão viva DESTE aparelho no mesmo PR
// adia a tentativa: a label passou a ser dela, e o finally dela é quem tira.
import path from 'node:path';
import { STATE_DIR } from '../paths.js';
import io, { writeJsonAtomic } from '../io.js';
import { TEMPOS } from '../constants.js';

const ARQUIVO = path.join(STATE_DIR, 'labels-a-tirar.json');
// depois disso a anotação sai com um WARN: o PR provavelmente fechou ou a conta perdeu
// acesso, e insistir para sempre seria uma chamada gh por ciclo sem fim
const DESISTE_DEPOIS_MS = 7 * 24 * TEMPOS.HORA_MS;
// a label não está mais lá (alguém tirou, ou ela nem existe no repo): nada a fazer
const JA_SAIU = /not found|não encontrad|does not exist/i;

function pendentes(engine) {
  if (!engine.labelsATirar) {
    const bruto = io.readJson(ARQUIVO, {}, (m) => engine.log('WARN', m));
    engine.labelsATirar = (bruto && typeof bruto === 'object' && !Array.isArray(bruto)) ? bruto : {};
  }
  return engine.labelsATirar;
}

function salvar(engine) {
  try { io.ensureDir(STATE_DIR); writeJsonAtomic(ARQUIVO, engine.labelsATirar || {}); }
  catch (err) { engine.log('WARN', `salvar labels a tirar: ${err.message}`); }
}

function anotar(engine, pr, label, agora = Date.now()) {
  if (!pr || !pr.key || !pr.url || !label) return;
  const p = pendentes(engine);
  const antes = p[pr.key];
  p[pr.key] = { url: pr.url, label, desde: (antes && antes.label === label && antes.desde) || agora };
  salvar(engine);
}

function revisandoAqui(engine, key) {
  return [...((engine.activeReviews && engine.activeReviews.values()) || [])]
    .some(s => s && s.mode !== 'self' && (s.keys || []).includes(key));
}

async function tirarPendentes(engine, run = io.run, agora = Date.now()) {
  const p = pendentes(engine);
  let mudou = false;
  for (const [key, item] of Object.entries(p)) {
    if (revisandoAqui(engine, key)) continue;
    if (agora - Number(item.desde || 0) > DESISTE_DEPOIS_MS) {
      engine.log('WARN', `label ${item.label} de ${key} continua sem sair depois de 7 dias; parei de tentar (tire à mão no GitHub)`);
      delete p[key]; mudou = true;
      continue;
    }
    const pr = { key, url: item.url };
    const acc = engine.accountForPr(pr);
    if (!engine.tokenFor(acc)) continue;
    const r = await run('gh', ['pr', 'edit', item.url, '--remove-label', item.label], { env: engine.ghEnv(acc) });
    if (r && (r.ok || JA_SAIU.test(String(r.stderr || '')))) { delete p[key]; mudou = true; }
  }
  if (mudou) salvar(engine);
}

const labelsATirar = { anotar, tirarPendentes, ARQUIVO };
export default labelsATirar;
export { anotar, tirarPendentes, ARQUIVO };
