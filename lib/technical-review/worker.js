// Processo auxiliar: carrega somente a ferramenta fixada, nunca código executável do PR.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import io from '../io.js';
import { executadoDireto } from '../paths.js';
import { bindConsumer, finishBoundConsumer } from './material-record.js';
import { medirIntervalos } from './intervalos-dos-achados.js';

// O repositório da avaliação é identidade do alvo, e o alvo quem conhece é o motor: a ferramenta só
// aproveita a avaliação cujo repositoryId é igual ao do alvo (o nome dono/repo passado em runAudit).
// Deixado para o modelo, ele preencheu com o id numérico do GitHub, a ferramenta recusou todas as
// avaliações por formato e o relatório perdeu até a violação já confirmada (num PR real,
// 21/11/2026). O motor grava o do alvo em toda avaliação, como o prompt já prometia.
function comRepositorioDoAlvo(entries, repo) {
  if (!Array.isArray(entries)) return [];
  return entries.map((e) => {
    if (!e || typeof e !== 'object' || Array.isArray(e)) return e;
    return { ...e, repositoryId: repo };
  });
}

async function evaluate(request) {
  const api = await import(pathToFileURL(path.join(request.toolHome, 'dist', 'index.js')).href);
  const assessments = [], assessmentIssues = [];
  for (const [index, entry] of comRepositorioDoAlvo(request.assessments, request.repo).entries()) {
    try { assessments.push(api.validarAssessment(entry, `technicalAssessments[${index}]`)); }
    catch (error) { assessmentIssues.push(String(error.message).slice(0, 500)); }
  }
  if (assessmentIssues.length) return { assessmentIssues };
  const declaration = await api.parseDeclaration(request.profile.declaration, request.snapshot);
  const catalog = await api.loadBundledCatalog();
  const result = await api.runAudit({ repoDir: request.snapshot, declaration, catalog,
    target: { repositoryId: request.repo, base: request.base, head: request.head },
    assessments, baselines: request.profile.baselines || [],
    instrucaoDeProduto: request.profile.instrucaoDeProduto || null });
  const findings = await medirIntervalos(request.snapshot, result.findings || []);
  return { ...result, findings, rules: result.rules.map(r => ({ ...r, ruleVersion: catalog.find(c => c.id === r.rule)?.since })),
    excerpt: api.renderExcerpt(catalog, declaration.scopes) };
}

async function main(file) {
  const request = io.parseJson(fs.readFileSync(file, 'utf8'));
  if (request.materialConsumer) await bindConsumer(request.snapshot, request.materialConsumer);
  try {
    const result = await evaluate(request);
    process.stdout.write(io.safeStringify(result));
  } finally {
    if (request.materialConsumer) finishBoundConsumer(request.snapshot, request.materialConsumer);
  }
}

if (executadoDireto(import.meta.url)) main(process.argv[2]).catch(() => {
  process.stderr.write('a avaliação técnica não pôde ser concluída');
  process.exitCode = 2;
});

export { evaluate, comRepositorioDoAlvo };
