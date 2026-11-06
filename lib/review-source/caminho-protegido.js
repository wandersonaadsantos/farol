// Caminho protegido e o que a sessão de revisão pode ver dele: a fonte ÚNICA (06/11/2026).
//
// Por que existe: a mesma pergunta ("este arquivo do PR é protegido, e que forma dele chega à
// sessão?") era respondida em três lugares, cada um com a própria lista: o patch por arquivo
// que o engine materializa (`lib/engine/pr-scope.js`), a fonte preparada do GitHub
// (`lib/review-source/github.js`) e o leitor do arquivo inteiro na versão fixada
// (`lib/review-source/reader.js`). Três respostas divergem na primeira correção. Aqui mora a
// régua, e os três só perguntam.
//
// A regra, em uma frase: caminho protegido (`.env*`, `.ssh`, credencial, chave) nunca chega cru.
// O arquivo de ambiente chega como PROJEÇÃO das linhas alteradas (`env-changes.js`); o template
// público (`.env.example`, `.env.sample`) chega como chaves sem valor só na execução restrita,
// que pede projeção; o resto não chega.
//
// O NOME da projeção no disco é desta régua também. A sessão headless herda as settings do
// usuário, e `deny: Read(.env.*)` (o caso medido em 06/11/2026: quatro de quatro PRs com
// `.env.example` sem leitura, `erro-do-read` em medicoes-leitura.jsonl) casa pelo nome-base em
// qualquer profundidade, mesmo em caminho absoluto, e casa também o DIRETÓRIO (semântica do
// gitignore: `.env.d/prod.env` cai por causa do `.env.d`). A projeção vai para
// `_farol_redigido_/_<caminho achatado>.redigido`, um componente só abaixo da pasta redigida, com
// `/` escrito `%2F` e `%` escrito `%25`: o `_` na frente tira o nome das regras que ancoram no
// início (`.env*`, `.env.*`), o sufixo tira das que ancoram no fim (`*.env`), e nenhum diretório
// do caminho original sobra no disco para casar. O caminho do PR continua sendo o que a sessão
// declara em `coverage.reviewed`. PURO.
import { sourcePath, isSourceTemplate } from './contract.js';
import { KIND as ENV_KIND, projetarPatchDeAmbiente } from './env-changes.js';
import { mascararSegredos } from '../engine/falhas.js';

const PASTA_REDIGIDA = '_farol_redigido_';
const PREFIXO_REDIGIDO = '_';
const SUFIXO_REDIGIDO = '.redigido';
// Achatamento reversível: só `%` e `/` mudam, numa passada, para o nome voltar sem ambiguidade.
const achatar = (caminho) => caminho.replace(/[%/]/g, (c) => (c === '%' ? '%25' : '%2F'));
const desachatar = (nome) => nome.replace(/%(25|2F)/g, (_m, c) => (c === '25' ? '%' : '/'));

function caminhoProtegido(value) {
  if (!value) return false;
  try { sourcePath(value); return false; } catch { return true; }
}

// Arquivo do diff ({ path, previousPath }) protegido de um lado ou do outro do rename: o patch
// de um rename traz o conteúdo do caminho de antes.
function arquivoProtegido(f) {
  return !!f && (caminhoProtegido(f.path) || caminhoProtegido(f.previousPath));
}

// O que a sessão vê do patch de um arquivo do PR. `projection` é a projeção da execução restrita
// (source-redaction-v1), que é a única a pedir o template público; sem ela, template é protegido.
//   - `envChanges`: a projeção das linhas alteradas do arquivo de ambiente (fluxo normal)
//   - `patchAvailable`: o patch cru pode ser entregue (não protegido, e sem segredo reconhecido
//     fora da execução restrita, que o mascara por conta própria)
//   - `politica`: o rótulo gravado no manifesto e no card, na ordem de precedência de sempre
function politicaDoPatch(caminho, anterior, patch, projection = null) {
  const lados = [caminho, anterior].filter(Boolean);
  const protegidos = lados.filter(caminhoProtegido);
  const template = !!projection && protegidos.length > 0 && protegidos.every(isSourceTemplate);
  const sensitivePath = protegidos.length > 0 && !template;
  const sensitiveContent = typeof patch === 'string' && mascararSegredos(patch) !== patch;
  const envChanges = !projection && sensitivePath ? projetarPatchDeAmbiente(caminho, anterior, patch) : null;
  const patchAvailable = !sensitivePath && !template && (!sensitiveContent || !!projection)
    && typeof patch === 'string' && patch.length > 0;
  let politica = null;
  if (envChanges) politica = ENV_KIND;
  else if (sensitivePath) politica = 'protected-path';
  else if (template) politica = 'template-keys';
  else if (sensitiveContent && !projection) politica = 'sensitive-content';
  return { protegido: protegidos.length > 0, sensitivePath, template, sensitiveContent, envChanges, patchAvailable, politica };
}

// O patch que vai para o disco da sessão no fluxo normal: a projeção do arquivo de ambiente, o
// patch cru de quem não é protegido e não traz segredo reconhecido, ou nada.
function patchParaASessao(caminho, anterior, patch) {
  if (!patch) return '';
  const visao = politicaDoPatch(caminho, anterior, patch);
  return visao.envChanges?.text ?? (visao.patchAvailable ? patch : '');
}

// O arquivo INTEIRO numa versão fixada (head, base, merge-base): só caminho não protegido, e o
// template público só na execução restrita, que o projeta.
function leituraInteiraPermitida(caminho, projection = null) {
  return !caminhoProtegido(caminho) || (!!projection && isSourceTemplate(caminho));
}

// Onde o patch de um caminho do PR fica no escopo materializado, relativo à raiz. Caminho comum
// fica onde está; o protegido vai para a pasta redigida, achatado num nome só que não casa
// `.env*` em componente nenhum (o diretório `.env.d` de `.env.d/prod.env` também casaria).
function nomeMaterializado(prPath) {
  const caminho = String(prPath || '');
  if (!caminhoProtegido(caminho)) return caminho;
  return `${PASTA_REDIGIDA}/${PREFIXO_REDIGIDO}${achatar(caminho)}${SUFIXO_REDIGIDO}`;
}

// O caminho do PR a partir do caminho relativo lido na raiz do escopo, ou null quando a leitura
// não corresponde a nada que o engine materializou: nome redigido malformado, ou caminho
// protegido lido no lugar comum (lá não existe arquivo, e creditar o pedido seria leitura de nada).
function caminhoDoPr(rel) {
  const caminho = String(rel || '');
  if (!caminho) return null;
  const partes = caminho.split('/');
  if (partes[0] !== PASTA_REDIGIDA) return caminhoProtegido(caminho) ? null : caminho;
  const nome = partes[1] || '';
  if (partes.length !== 2 || !nome.startsWith(PREFIXO_REDIGIDO) || !nome.endsWith(SUFIXO_REDIGIDO)
    || nome.length <= PREFIXO_REDIGIDO.length + SUFIXO_REDIGIDO.length) return null;
  const original = desachatar(nome.slice(PREFIXO_REDIGIDO.length, -SUFIXO_REDIGIDO.length));
  // só o nome que o próprio nomeMaterializado escreveria: `%2f` minúsculo ou `%41` não voltam
  return caminhoProtegido(original) && nomeMaterializado(original) === caminho ? original : null;
}

export { PASTA_REDIGIDA, caminhoProtegido, arquivoProtegido, politicaDoPatch, patchParaASessao, leituraInteiraPermitida, nomeMaterializado, caminhoDoPr };
