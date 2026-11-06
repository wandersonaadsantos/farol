// Snapshot privado das objeções: objeção NOVA de pessoa durante a revisão invalida a decisão.
import { createHash } from 'node:crypto';
import io from '../io.js';
import { ehFerramenta } from '../engine/skip-review.js';

const sha256 = valor => createHash('sha256').update(io.safeStringify(valor)).digest('hex');

async function readList(engine, pr, suffix) {
  const response = await io.run('gh', ['api', `repos/${pr.repo}/pulls/${pr.number}/${suffix}`, '--paginate', '--slurp'], {
    env: engine.ghEnv(engine.accountForPr(pr)),
  });
  const pages = response.ok && io.parseJson(response.stdout);
  if (!Array.isArray(pages) || pages.some(page => !Array.isArray(page))) throw new Error('histórico de objeções não conferido');
  return pages.flat().filter(r => r.user).sort((a, b) => a.id - b.id);
}

// A projeção que vai ao prompt e à impressão inteira. Não ganha campo: a impressão gravada
// por versões anteriores tem de continuar batendo com o mesmo histórico.
const projetar = r => ({ id: r.id, author: r.user.login, state: r.state || '', head: r.commit_id || '',
  body: r.body || '', file: r.path || '', line: r.line || r.original_line || null });

/* O que é objeção de pessoa (05/11/2026). Medido nas sete recusas "histórico de objeções mudou"
   gravadas até ali: seis vieram de evento que não objeta nada (review da ferramenta, aprovação
   de pessoa com "Nit"/"Optional" nas linhas) e descartaram revisões pagas. Fica de fora:
   - ferramenta (`ehFerramenta`, a mesma régua do gate de consciência);
   - review APPROVED, e os comentários de linha que nasceram dentro dele (quem aprova declarou
     que nada ali segura o merge);
   - review DISMISSED (dispensa tira objeção, não acrescenta) e review sem texto (o conteúdo,
     se houver, está nos comentários de linha, contados um a um).
   Conta: pedido de mudanças, review comentado com texto e comentário de linha de pessoa fora de
   aprovação, inclusive da própria conta. A identidade inclui o texto: corpo editado é objeção
   nova. Fica fora o que muda sem ninguém objetar (commit e linha andam com o push). */
function objecoesDePessoa(reviews, comments) {
  const aprovacoes = new Set(reviews.filter(r => r.state === 'APPROVED').map(r => r.id));
  const deReview = reviews
    .filter(r => !ehFerramenta(r.user.login, r.user.type) && r.state !== 'APPROVED' && r.state !== 'DISMISSED')
    .filter(r => r.state === 'CHANGES_REQUESTED' || String(r.body || '').trim())
    .map(r => sha256({ tipo: 'review', id: r.id, author: r.user.login, state: r.state || '', body: r.body || '' }));
  const deLinha = comments
    .filter(c => !ehFerramenta(c.user.login, c.user.type) && !aprovacoes.has(c.pull_request_review_id))
    .map(c => sha256({ tipo: 'comment', id: c.id, author: c.user.login, body: c.body || '', file: c.path || '' }));
  return [...deReview, ...deLinha].sort();
}

async function reviewSnapshot(engine, pr) {
  const [reviews, comments] = await Promise.all([readList(engine, pr, 'reviews'), readList(engine, pr, 'comments')]);
  const data = { reviews: reviews.map(projetar), comments: comments.map(projetar) };
  // não enumerável: o prompt serializa o snapshot inteiro, e lista de hash ali é só ruído
  return Object.defineProperty({ ...data, fingerprint: sha256(data) }, 'objecoes',
    { value: objecoesDePessoa(reviews, comments), enumerable: false });
}

// O que o relatório da avaliação grava sobre as objeções que a revisão leu.
function impressaoDasObjecoes(snapshot) {
  return { humanReviewFingerprint: snapshot.fingerprint, humanObjections: snapshot.objecoes };
}

// Há objeção de pessoa que a revisão não viu? Relatório com a lista gravada compara por
// inclusão (sumir não é novo); relatório de antes desta versão só tem a impressão inteira, e
// sem a lista não há como provar que a mudança não foi de pessoa.
function objecoesMudaram(report, atual) {
  if (!Array.isArray(report.humanObjections)) return atual.fingerprint !== report.humanReviewFingerprint;
  if (!Array.isArray(atual.objecoes)) return true;
  const vistas = new Set(report.humanObjections);
  return atual.objecoes.some(o => !vistas.has(o));
}

export { reviewSnapshot, impressaoDasObjecoes, objecoesMudaram };
