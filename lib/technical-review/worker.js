// Processo auxiliar: carrega somente a ferramenta fixada, nunca código executável do PR.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import io from '../io.js';
import { executadoDireto } from '../paths.js';
import { bindConsumer, finishBoundConsumer } from './material-record.js';

async function evaluate(request) {
  const api = await import(pathToFileURL(path.join(request.toolHome, 'dist', 'index.js')).href);
  const declaration = await api.parseDeclaration(request.profile.declaration, request.snapshot);
  const catalog = await api.loadBundledCatalog();
  const assessments = (request.assessments || []).map(a => api.validarAssessment(a, 'avaliação da revisão'));
  const result = await api.runAudit({ repoDir: request.snapshot, declaration, catalog,
    target: { repositoryId: request.repo, base: request.base, head: request.head },
    assessments, baselines: request.profile.baselines || [],
    instrucaoDeProduto: request.profile.instrucaoDeProduto || null });
  return { ...result, excerpt: api.renderExcerpt(catalog, declaration.scopes) };
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

export { evaluate };
