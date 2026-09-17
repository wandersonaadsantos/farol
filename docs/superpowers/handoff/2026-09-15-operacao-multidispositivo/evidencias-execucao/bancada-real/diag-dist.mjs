// Diagnóstico da bancada: envolve publicarCandidato do MÓDULO REAL para registrar por que
// a publicação do candidato falha. Não muda decisão nenhuma, só observa entrada e saída.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
const raiz = process.env.FAROL_RAIZ;
const saida = process.env.FAROL_DIAG_LOG || 'diag.log';
const dist = (await import(pathToFileURL(path.join(raiz, 'lib', 'engine', 'sync-distribuicao.js')).href)).default;
function anota(o) { try { fs.appendFileSync(saida, `${JSON.stringify({ at: new Date().toISOString(), ...o })}\n`); } catch {} }
const publicar = dist.publicarCandidato;
dist.publicarCandidato = async (engine, cfg, pr, opts) => {
  const rt = engine.sync || {};
  anota({ chamada: pr && pr.key, head: pr && (pr.headSha || pr.knownHead), temClient: !!rt.client, uid: !!rt.uid, material: !!rt.material, cur: !!rt.cur, autoridade: rt.autoridade });
  try {
    const r = await publicar(engine, cfg, pr, opts);
    anota({ resultado: r, pr: pr && pr.key });
    return r;
  } catch (e) { anota({ excecao: String(e && e.stack || e) }); throw e; }
};
const distribuindo = dist.distribuindo;
dist.distribuindo = (engine, cfg, o) => { const r = distribuindo(engine, cfg, o); return r; };
