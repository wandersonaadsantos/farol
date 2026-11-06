// Leituras adicionais declaradas pela sessão só valem para o conteúdo reconferido ao publicar.
import { fileURLToPath } from 'node:url';
import { canonicalPrKey } from '../sync/keys.js';
import { safeStringify } from '../io.js';

const CLI = fileURLToPath(new URL('./query-objections.js', import.meta.url));
const IMPRESSAO = /^[a-f0-9]{64}$/;

function registrarLeiturasDeObjecoes(result) {
  const declaradas = result.objecoesLidas;
  delete result.objecoesLidas;
  if (!Array.isArray(declaradas) || !Array.isArray(result.technicalReview?.humanObjections)) return;
  result.technicalReview.humanObjectionReads = declaradas.filter(r => r && ['review', 'comment'].includes(r.tipo)
    && Number.isSafeInteger(r.id) && r.id > 0 && IMPRESSAO.test(r.impressao || ''))
    .map(({ tipo, id, impressao }) => ({ tipo, id, impressao }));
}

function promptDeLeituraDeObjecoes(pr) {
  const key = canonicalPrKey(`${pr.repo}#${pr.number}`);
  if (!key) return '';
  const [repo, numero] = key.split('#');
  return '\n\n## Reviews consultados durante a análise\n'
    + 'Se consultar reviews que chegaram depois do contexto inicial, leia pelo comando abaixo. '
    + 'Ele devolve os textos e os recibos de conteúdo em objecoesLidas. Depois de confrontar as objeções '
    + 'com o código, copie no envelope final somente os recibos dos itens que leu e incorporou à análise. '
    + 'O app reconfirma id e conteúdo na publicação; id sozinho ou conteúdo alterado depois da leitura não vale. '
    + 'Isso não autoriza ignorar uma objeção procedente nem substitui os gates. Sem leitura adicional, omita o campo.\n'
    + 'Consulta somente de leitura; preserve a identidade GitHub já fornecida à sessão:\n'
    + safeStringify({ runtime: { executable: process.execPath, environment: { ELECTRON_RUN_AS_NODE: '1' } },
      read: [process.execPath, CLI, repo, numero] }) + '\n';
}

export { registrarLeiturasDeObjecoes, promptDeLeituraDeObjecoes };
