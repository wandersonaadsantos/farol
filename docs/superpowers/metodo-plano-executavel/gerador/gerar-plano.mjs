// Gera tarefas de plano executáveis por um modelo menor a partir de commits já
// provados verdes. Arquivo novo entra inteiro; arquivo existente entra como pares
// "localize este trecho exato / troque por este", e o gerador PROVA que cada trecho
// aparece exatamente uma vez no arquivo no estado anterior à tarefa, ampliando o
// contexto até ficar único.
//
// Uso: node gerar-plano.mjs <repo> <manifesto.json> <saida.md>
// manifesto: { titulo, cabecalho (markdown), tarefas: [{ id, titulo, commit, porque,
//   falhaEsperada, testes: [paths], mensagem }] }
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';

const [repo, manifestoPath, saidaPath] = process.argv.slice(2);
const manifesto = JSON.parse(fs.readFileSync(manifestoPath, 'utf8'));
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const mostrar = (rev, caminho) => {
  try { return git('show', `${rev}:${caminho}`); } catch { return null; }
};

// cerca com crases suficientes pra nunca colidir com o conteúdo
function cerca(texto, lang = '') {
  const maior = Math.max(2, ...[...texto.matchAll(/`+/g)].map(m => m[0].length));
  const f = '`'.repeat(Math.max(3, maior + 1));
  const corpo = texto.endsWith('\n') ? texto : texto + '\n';
  return `${f}${lang}\n${corpo}${f}`;
}
// Conferência por hash, arquivo a arquivo. O aceite de 11/09/2026 mostrou por que ela
// precisa existir: o executor menor trocou `\u2014` pelo travessão literal e
// `\u0000-\u001f` pelos caracteres de controle de verdade. O JavaScript resultante é
// EQUIVALENTE, a suíte fica verde, e mesmo assim a árvore deixa de ser a que foi provada.
// Sem esta conferência a deriva só aparece no diff do fim, com vinte tarefas construídas
// em cima dela.
// Escotilha mecânica, e ela nasceu de medição: o executor menor NÃO consegue reproduzir
// uma sequência como \u0000 atravessando a fronteira JSON de uma chamada de ferramenta.
// Três tentativas independentes travaram no mesmo arquivo. Transcrever continua sendo o
// caminho principal (é ele que torna o plano legível e revisável); isto aqui é o degrau
// de recuo para o punhado de arquivos cujo conteúdo é hostil à transcrição, e ele grava
// os bytes exatos, então o hash sempre fecha.
function materializar(caminho, conteudo) {
  if (!/\\u[0-9a-fA-F]{4}/.test(conteudo)) return '';
  const b64 = Buffer.from(conteudo, 'utf8').toString('base64');
  const cmd = `node -e "require('fs').writeFileSync('${caminho}', Buffer.from(process.argv[1],'base64'))" ${b64}`;
  return [
    '',
    'Este arquivo tem sequências de escape que a transcrição costuma normalizar sem querer. Se o hash não bater na segunda tentativa, PARE de transcrever e materialize-o com o comando abaixo, que grava os bytes exatos:',
    '',
    cerca(cmd, 'bash'),
    '',
    'Depois rode a conferência de novo: agora ela bate.',
  ].join('\n');
}

function confira(caminho, conteudo) {
  const soma = createHash('sha256').update(conteudo, 'utf8').digest('hex').slice(0, 16);
  const cmd = `node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('${caminho}')).digest('hex').slice(0,16))"`;
  return [
    'Confira que o arquivo ficou IDÊNTICO antes de seguir:',
    '',
    cerca(cmd, 'bash'),
    '',
    `Esperado: \`${soma}\`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \\u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.`,
  ].join('\n');
}

// status do git -> verbo da instrucao; qualquer outro status e modificacao
const VERBO_DO_STATUS = { A: 'Criar', D: 'Apagar' };

// extensao -> linguagem da cerca de codigo no plano; a primeira que casa vence
const LINGUAGEM_POR_EXTENSAO = [
  [['.js', '.mjs'], 'js'], [['.json'], 'json'], [['.css'], 'css'],
  [['.html'], 'html'], [['.md'], 'markdown'],
];
function langDe(p) {
  for (const [exts, lang] of LINGUAGEM_POR_EXTENSAO) {
    if (exts.some((e) => p.endsWith(e))) return lang;
  }
  return '';
}

function contar(hay, agulha) {
  if (!agulha) return 0;
  let n = 0, i = 0;
  while ((i = hay.indexOf(agulha, i)) !== -1) { n++; i += 1; }
  return n;
}

// Divide a transformação antes -> depois em pares (velho, novo) com velho único em
// "antes", usando diff de linhas. Os pares são aplicados em ordem sobre o texto que
// vai mudando, então a unicidade é conferida contra o texto CORRENTE da simulação.
function pares(antes, depois, caminho) {
  for (const ctx of [3, 6, 10, 20, 40, 80, 200]) {
    // --no-index sai com código 1 quando os arquivos diferem, que é o caso normal aqui
    let diff;
    try {
      diff = execFileSync('git', ['diff', '--no-index', `-U${ctx}`, '--no-color', 'A', 'B'], {
        cwd: prepararTmp(antes, depois), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
      });
    } catch (err) { if (err.status !== 1) throw err; diff = err.stdout; }
    const hunks = parseHunks(diff);
    let corrente = antes;
    const saida = [];
    let ok = true;
    for (const h of hunks) {
      if (contar(corrente, h.velho) !== 1 || h.velho === '') { ok = false; break; }
      corrente = corrente.replace(h.velho, () => h.novo);
      saida.push(h);
    }
    if (ok && corrente === depois) return saida;
  }
  throw new Error(`não consegui pares únicos para ${caminho}`);
}

let tmpBase = null;
function prepararTmp(antes, depois) {
  if (!tmpBase) tmpBase = fs.mkdtempSync(`${process.env.TEMP || '/tmp'}/plano-`);
  fs.writeFileSync(`${tmpBase}/A`, antes);
  fs.writeFileSync(`${tmpBase}/B`, depois);
  return tmpBase;
}

function parseHunks(diff) {
  const linhas = diff.split('\n');
  const hunks = [];
  let atual = null;
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    if (l.startsWith('@@')) { atual = { v: [], n: [] }; hunks.push(atual); continue; }
    if (!atual) continue;
    if (l.startsWith('\\ No newline')) { atual.semNL = true; continue; }
    const c = l[0], resto = l.slice(1);
    if (c === ' ') { atual.v.push(resto); atual.n.push(resto); }
    else if (c === '-') atual.v.push(resto);
    else if (c === '+') atual.n.push(resto);
  }
  // o git diff não diz se a última linha tem \n; como os arquivos do repo são LF com
  // \n final, junta com \n e acrescenta \n no fim de cada bloco que não é o último
  // pedaço do arquivo. Blocos com velho vazio (inserção sem contexto) viram inválidos.
  return hunks.map(h => ({ velho: h.v.join('\n') + '\n', novo: h.n.join('\n') + '\n' }));
}

let md = `${manifesto.cabecalho}\n`;
for (const t of manifesto.tarefas) {
  const pai = git('rev-parse', `${t.commit}^`).trim();
  const status = git('diff', '--name-status', '--no-renames', pai, t.commit).trim().split('\n').filter(Boolean)
    .map(l => { const [s, p] = l.split('\t'); return { s, p }; });
  const testes = status.filter(x => x.p.startsWith('test/'));
  const impl = status.filter(x => !x.p.startsWith('test/'));
  md += `\n### Tarefa ${t.id}: ${t.titulo}\n\n`;
  if (t.porque) md += `${t.porque}\n\n`;
  md += `**Arquivos:**\n`;
  for (const x of status) md += `- ${VERBO_DO_STATUS[x.s] || 'Modificar'}: \`${x.p}\`\n`;
  md += '\n';

  let passo = 1;
  const blocoArquivo = (x) => {
    let s = '';
    if (x.s === 'A') {
      const conteudo = mostrar(t.commit, x.p);
      const cerc = cerca(conteudo, langDe(x.p));
      s += `Crie \`${x.p}\` com EXATAMENTE este conteúdo:\n\n${cerc}\n\n`;
      s += `${confira(x.p, conteudo)}${materializar(x.p, conteudo)}\n\n`;
    } else if (x.s === 'D') {
      s += `Apague \`${x.p}\` (\`git rm ${x.p}\`).\n\n`;
    } else {
      const antes = mostrar(pai, x.p), depois = mostrar(t.commit, x.p);
      const ps = pares(antes, depois, x.p);
      s += `Em \`${x.p}\`, aplique as ${ps.length} substituições abaixo, NA ORDEM. Cada trecho "localize" aparece exatamente uma vez no arquivo no momento em que você aplica aquela substituição; copie-o sem mudar espaço nem acento.\n\n`;
      ps.forEach((p, i) => {
        s += `${i + 1}. Localize:\n\n${cerca(p.velho, langDe(x.p))}\n\n   Troque por:\n\n${cerca(p.novo, langDe(x.p))}\n\n`;
      });
      s += `${confira(x.p, depois)}

`;
    }
    return s;
  };

  if (testes.length) {
    md += `- [ ] **Passo ${passo++}: escrever o teste**\n\n`;
    for (const x of testes) md += blocoArquivo(x);
    if (t.falhaEsperada) {
      md += `- [ ] **Passo ${passo++}: rodar e ver falhar**\n\n${cerca(`node --test --test-force-exit ${t.testes.join(' ')}`, 'bash')}\n\nEsperado: FALHA. ${t.falhaEsperada}\n\n`;
    }
  }
  if (impl.length) {
    md += `- [ ] **Passo ${passo++}: implementar**\n\n`;
    for (const x of impl) md += blocoArquivo(x);
  }
  if (t.testes && t.testes.length) {
    md += `- [ ] **Passo ${passo++}: rodar e ver passar**\n\n${cerca(`node --test --test-force-exit ${t.testes.join(' ')}`, 'bash')}\n\nEsperado: PASSA, 0 falhas.\n\n`;
  }
  md += `- [ ] **Passo ${passo++}: gate e commit**\n\n${cerca('npm run check && npm run lint && npm test', 'bash')}\n\nEsperado: \`fail 0\` e \`gate de qualidade: sem regressão\`. Se algo falhar, PARE e relate; não mexa em outro arquivo para fazer passar.\n\n`;
  md += `${cerca(`git add ${status.map(x => x.p).join(' ')}\ngit commit -m ${JSON.stringify(t.mensagem)}`, 'bash')}\n\n`;
}
fs.writeFileSync(saidaPath, md.replace(/\r\n/g, '\n'));
console.log('ok', manifesto.tarefas.length, 'tarefas ->', saidaPath);
