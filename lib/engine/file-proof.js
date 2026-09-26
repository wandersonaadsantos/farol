// Prova por arquivo (blob SHA): memória determinística do que a última revisão
// completa LEU de um PR, com granularidade de arquivo. Cada prova guarda o diff
// efetivo do PR no momento da leitura (caminho + blob SHA + status por arquivo,
// via endpoint pulls/files, que devolve o blob; o gh pr view --json files não) e
// a lista de arquivos comprovadamente cobertos (coverage.reviewed do envelope).
//
// Duas economias saem daqui, ambas sem IA na decisão:
// 1. Push trivial (rebase limpo, merge da base que não toca o diff): se o diff
//    efetivo atual é byte a byte o que a última sessão leu, o round 2 automático
//    nem abre sessão (launchReReviews consulta sameEffectiveDiff).
// 2. Revisão incremental: no round 2 de verdade, arquivo cujo blob não mudou
//    desde a leitura anterior herda a prova de cobertura (splitByProof +
//    reconcileInheritedCoverage) e a sessão só precisa ler o que mudou.
//
// Regra de ouro, a mesma do resto do engine: falta de dado NUNCA vira herança.
// Sem prova salva, sem blob, sem head ou com a medição falhando, a revisão volta
// a ser cheia, que é o caminho sempre seguro.
import path from 'node:path';
import fs from 'node:fs';
import { STATE_DIR } from '../paths.js';
import { TEMPOS } from '../constants.js';
import io, { ensureDir, readJson, parseJson, writeJsonAtomic } from '../io.js';

function fileProofPath(prKey) {
  // encodeURIComponent pelo mesmo motivo do checkpoint: trocar `/`/`#` por `__`
  // colidiria (a__b/c e a/b__c dariam o mesmo arquivo)
  return path.join(STATE_DIR, 'file-proof', `${encodeURIComponent(prKey)}.json`);
}

// O --paginate do gh emite UM JSON por página (linhas separadas). Junta tudo num
// array só e valida a forma; qualquer linha inválida invalida o lote inteiro
// (mapa parcial mentiria sobre o diff, e mentira aqui vira herança indevida).
function parseFilesStdout(stdout) {
  const linhas = String(stdout || '').split('\n').map(s => s.trim()).filter(Boolean);
  if (!linhas.length) return null;
  const out = [];
  for (const linha of linhas) {
    const page = parseJson(linha, null);
    if (!Array.isArray(page)) return null;
    for (const f of page) {
      if (!f || typeof f !== 'object' || !f.path) return null;
      out.push({
        path: String(f.path),
        sha: String(f.sha || ''),
        status: String(f.status || ''),
        lines: Number(f.lines) || 0,
      });
    }
  }
  return out.length ? out : null;
}

// Diff efetivo do PR com blob SHA por arquivo. null quando não deu pra medir
// (sem token, rede, resposta torta): o chamador degrada pro fluxo cheio.
async function fetchPrFiles(engine, pr) {
  if (!pr || !pr.repo || !pr.number) return null;
  const acc = engine.accountForPr(pr);
  if (!engine.tokenFor(acc)) return null;
  const r = await io.run('gh', ['api', `repos/${pr.repo}/pulls/${pr.number}/files`, '--paginate',
    '--jq', '[.[] | {path: .filename, sha: (.sha // ""), status: (.status // ""), lines: ((.additions // 0) + (.deletions // 0))}]'],
    { env: engine.ghEnv(acc) });
  if (!r.ok) return null;
  return parseFilesStdout(r.stdout);
}

function blobMapFrom(files) {
  if (!Array.isArray(files) || !files.length) return null;
  const map = {};
  for (const f of files) { if (f.path && f.sha) map[f.path] = f.sha; }
  return Object.keys(map).length ? map : null;
}

// O diff efetivo mudou? Compara dois retratos do pulls/files: mesmos caminhos,
// mesmo blob e mesmo status em todos. Blob vazio nunca prova igualdade (arquivo
// removido, resposta incompleta), então qualquer sha vazio devolve false: na
// dúvida, o push NÃO é trivial e a revisão roda.
function sameEffectiveDiff(atuais, anteriores) {
  if (!Array.isArray(atuais) || !Array.isArray(anteriores)) return false;
  if (!atuais.length || atuais.length !== anteriores.length) return false;
  const prev = new Map(anteriores.map(f => [f.path, f]));
  for (const f of atuais) {
    const p = prev.get(f.path);
    if (!p) return false;
    if (!f.sha || !p.sha || f.sha !== p.sha) return false;
    if (String(f.status || '') !== String(p.status || '')) return false;
  }
  return true;
}

// Separa o diff atual em herdável x a ler. Um arquivo só HERDA cobertura quando
// as três provas valem juntas: blob idêntico ao da prova, status igual, e a
// revisão anterior DECLAROU tê-lo lido (coverage.reviewed). Todo o resto é
// leitura obrigatória desta sessão.
function splitByProof(atuais, prova) {
  const vazio = { ativa: false, unchanged: [], changed: [] };
  if (!Array.isArray(atuais) || !atuais.length) return vazio;
  if (!prova || !Array.isArray(prova.files) || !prova.files.length) {
    return { ativa: false, unchanged: [], changed: atuais.map(f => f.path) };
  }
  const lidos = new Set(Array.isArray(prova.reviewed) ? prova.reviewed : []);
  const prev = new Map(prova.files.map(f => [f.path, f]));
  const unchanged = [], changed = [];
  for (const f of atuais) {
    const p = prev.get(f.path);
    const herdavel = p && f.sha && p.sha && f.sha === p.sha &&
      String(f.status || '') === String(p.status || '') && lidos.has(f.path);
    (herdavel ? unchanged : changed).push(f.path);
  }
  return { ativa: unchanged.length > 0, unchanged, changed };
}

// Reconciliação da cobertura DEPOIS da sessão: arquivo inalterado que a sessão
// não releu sai de missing e entra em reviewed, com a origem registrada em
// inherited (leitura desta sessão e prova herdada nunca se confundem). A segunda
// passada cobre a sessão que nem listou o inalterado em missing mas o contou no
// total: a prova herdada vale independente de como a sessão contabilizou.
function reconcileInheritedCoverage(coverage, unchangedPaths) {
  if (!coverage || typeof coverage !== 'object') return coverage;
  const unchanged = new Set(unchangedPaths || []);
  const reviewed = Array.isArray(coverage.reviewed) ? coverage.reviewed.map(String) : [];
  const reviewedSet = new Set(reviewed);
  const inherited = [];
  const missing = [];
  for (const p of (Array.isArray(coverage.missing) ? coverage.missing.map(String) : [])) {
    if (unchanged.has(p) && !reviewedSet.has(p)) {
      inherited.push(p); reviewed.push(p); reviewedSet.add(p);
    } else missing.push(p);
  }
  for (const p of unchanged) {
    if (!reviewedSet.has(p)) { inherited.push(p); reviewed.push(p); reviewedSet.add(p); }
  }
  return { ...coverage, reviewed, missing, inherited };
}

// Deixa a cobertura pronta para o gate (coverageGap, em lib/engine/decision.js), num lugar
// só: a herança de arquivo inalterado vira coberta com a origem em coverage.inherited, e o
// diff MEDIDO no head vai junto em result.diffMedido, para o gate conferir a cobertura
// declarada caminho a caminho (26/09/2026). Medição que falhou fica ausente, e o gate volta
// à conta declarada: falta de dado não inventa lacuna nem cobertura. Devolve quantos
// arquivos vieram por herança, para a atividade da revisão contar.
function prepararCoberturaParaOGate(result, arquivosAtuais, heranca) {
  let herdados = 0;
  if (heranca && heranca.ativa && result.coverage && typeof result.coverage === 'object') {
    result.coverage = reconcileInheritedCoverage(result.coverage, heranca.unchanged);
    herdados = (result.coverage.inherited || []).length;
  }
  if (Array.isArray(arquivosAtuais) && arquivosAtuais.length) result.diffMedido = arquivosAtuais.map((f) => f.path);
  return herdados;
}

// Arquivos do diff que a revisão NÃO conseguiu revisar (campo `coverage` do envelope).
// Cobertura incompleta não é achado, é falta de prova: a revisão não pode afirmar que o PR
// está limpo se não olhou o PR inteiro. Por isso segura a postagem automática, nos dois
// sentidos (shouldAutoApprove e shouldAutoReject).
//
// Duas regras de 26/09/2026, da revisão do gate de qualidade:
//   - envelope SEM `coverage` é lacuna. Até aqui ele passava como "sem lacuna" (o
//     comentário dizia "PR pequeno, passe único"), mas o prompt exige o campo desde o PR
//     pequeno, então ausência é envelope quebrado, e um envelope quebrado aprovava
//     sozinho. Medido antes de fechar: das 249 sessões desde 10/09/2026, nenhuma veio sem
//     cobertura, então a regra não segura o que hoje passa.
//   - quando o engine mediu o diff no head (`result.diffMedido`, a lista de caminhos que
//     o runHeadlessReview anexa, no mesmo desenho do checksObrigatorios), a cobertura é
//     conferida contra ELA, caminho a caminho: arquivo medido fora do que a revisão
//     declarou ter coberto é lacuna, e caminho declarado que não existe no diff também
//     (contar `reviewed.length` contra um `total` que o próprio modelo informa não pega
//     caminho inventado, duplicado nem total errado). `reviewed` já chega com a herança
//     reconciliada (coverage.inherited), então arquivo inalterado lido no head anterior
//     conta como coberto, com a origem separada.
// Sem a medição (a leitura dos arquivos falhou), vale a conta declarada, como antes.
function normalizarCaminho(p) { return String(p || '').trim().replace(/^\.?\/+/, ''); }

function lacunaContraODiff(c, medido) {
  const diff = new Set(medido.map(normalizarCaminho).filter(Boolean));
  const cobertos = new Set((Array.isArray(c.reviewed) ? c.reviewed : []).map(normalizarCaminho).filter(Boolean));
  const faltando = [...diff].filter((p) => !cobertos.has(p));
  const fora = [...cobertos].filter((p) => !diff.has(p));
  if (fora.length) faltando.push(`${fora.length} caminho(s) declarado(s) como revisado(s) que não estão no diff medido (${fora.slice(0, 3).join(', ')})`);
  return faltando;
}

function coverageGap(result) {
  const c = (result && result.coverage) || null;
  if (!c || typeof c !== 'object') return ['a revisão não declarou a cobertura da leitura'];
  const missing = Array.isArray(c.missing) ? c.missing.map(p => String(p || '').trim()).filter(Boolean) : [];
  if (missing.length) return missing;
  const medido = result && result.diffMedido;
  if (Array.isArray(medido) && medido.length) return lacunaContraODiff(c, medido);
  // rede de segurança: revisados a menos que o total também é lacuna, mesmo com
  // missing vazio (a sessão pode ter contado errado ou esquecido de listar).
  // Zero revisado NÃO é passe livre: total declarado sem nenhum arquivo lido é
  // o pior caso (nada foi lido), e reviewed fora do contrato conta como zero.
  const total = Number(c.total) || 0;
  const revisados = Array.isArray(c.reviewed) ? c.reviewed.length : 0;
  if (total > 0 && revisados < total) {
    return [`${total - revisados} arquivo(s) do diff sem revisão declarada (revisou ${revisados} de ${total})`];
  }
  return [];
}

const MAX_LISTADOS = 200; // limite de sanidade do prompt; acima disso o resto vira contagem

function listaArquivos(paths) {
  const mostrados = paths.slice(0, MAX_LISTADOS).map(p => `- ${p}`).join('\n');
  const resto = paths.length - MAX_LISTADOS;
  return resto > 0 ? `${mostrados}\n- (e mais ${resto} arquivo(s))` : mostrados;
}

// Bloco injetado no prompt do round incremental. Só entra quando heranca.ativa;
// a instrução manda a sessão declarar em coverage.reviewed APENAS o que leu de
// verdade (o app reconcilia com a prova, a sessão nunca inventa leitura).
function fileProofBlock(heranca, headAnterior) {
  const sha7 = String(headAnterior || '').slice(0, 7) || '(desconhecido)';
  return `\n\n## Revisão incremental (prova por arquivo)\n` +
    `Sua revisão anterior deste PR leu por completo os arquivos INALTERADOS listados abaixo ` +
    `(o conteúdo deles é byte a byte o mesmo de quando foram lidos: blob idêntico no GitHub, head anterior ${sha7}).\n` +
    `1. Concentre a leitura nos arquivos ALTERADOS e reverifique neles os achados do seu review anterior (o pedido de mudanças foi atendido?).\n` +
    `2. Arquivo INALTERADO não precisa ser relido, SALVO quando uma mudança nos alterados interagir com ele (importa, chama, muda contrato): nesse caso releia o trecho relevante.\n` +
    `3. No envelope, declare em coverage.reviewed SOMENTE o que você leu NESTA sessão; os inalterados que você não releu ficam em coverage.missing normalmente. O app reconcilia com a prova anterior; nunca declare leitura que não fez.\n\n` +
    `Arquivos ALTERADOS desde a leitura anterior (${heranca.changed.length}):\n${listaArquivos(heranca.changed)}\n\n` +
    `Arquivos INALTERADOS com leitura já comprovada (${heranca.unchanged.length}):\n${listaArquivos(heranca.unchanged)}\n`;
}

function saveFileProof(prKey, proof) {
  const p = fileProofPath(prKey);
  ensureDir(path.dirname(p));
  writeJsonAtomic(p, proof);
}

function readFileProof(prKey) {
  const data = readJson(fileProofPath(prKey), null);
  if (!data || !Array.isArray(data.files) || !data.files.length) return null;
  return {
    head: String(data.head || ''),
    files: data.files,
    reviewed: Array.isArray(data.reviewed) ? data.reviewed.map(String) : [],
  };
}

// Poda por idade (padrão do G20, best-effort por entrada): prova de PR fechado
// há semanas não serve pra nada e o diretório não pode crescer pra sempre.
// Prova podada só custa uma revisão cheia na próxima vez, nunca postagem errada.
function pruneFileProofs(maxAgeMs = TEMPOS.PROVA_ARQUIVO_MAX_AGE_MS, agora = Date.now()) {
  const dir = path.join(STATE_DIR, 'file-proof');
  let nomes;
  try { nomes = fs.readdirSync(dir); } catch { return; }
  for (const nome of nomes) {
    try {
      const alvo = path.join(dir, nome);
      if (agora - fs.statSync(alvo).mtimeMs > maxAgeMs) fs.unlinkSync(alvo);
    } catch { /* lixo que não sai hoje sai amanhã */ }
  }
}

const fileProofMod = {
  fileProofPath, parseFilesStdout, fetchPrFiles, blobMapFrom, sameEffectiveDiff,
  splitByProof, reconcileInheritedCoverage, prepararCoberturaParaOGate, coverageGap, fileProofBlock, saveFileProof,
  readFileProof, pruneFileProofs,
};
export default fileProofMod;
export {
  fileProofPath, parseFilesStdout, fetchPrFiles, blobMapFrom, sameEffectiveDiff,
  splitByProof, reconcileInheritedCoverage, prepararCoberturaParaOGate, coverageGap, fileProofBlock, saveFileProof,
  readFileProof, pruneFileProofs,
};
