// "Executor perfeito": aplica um plano gerado por gerar-plano.mjs sobre uma cópia da
// base e confere, tarefa a tarefa, que a árvore resultante é byte a byte a do commit
// de origem. Se isto passa, o plano é internamente consistente; o que sobra pro teste
// com o modelo menor é só a capacidade de SEGUIR as instruções.
//
// Uso: node executor-perfeito.mjs <repo> <manifesto.json> <plano.md>
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [repo, manifestoPath, planoPath] = process.argv.slice(2);
const manifesto = JSON.parse(fs.readFileSync(manifestoPath, 'utf8'));
const plano = fs.readFileSync(planoPath, 'utf8');
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

// árvore virtual: só os arquivos que o plano toca, partindo do pai da 1a tarefa
const base = git('rev-parse', `${manifesto.tarefas[0].commit}^`).trim();
const arvore = new Map();
const ler = (p, rev) => { if (arvore.has(p)) return arvore.get(p); try { return git('show', `${rev}:${p}`); } catch { return null; } };

const secoes = plano.split(/\n### Tarefa /).slice(1);
let falhas = 0;
secoes.forEach((sec, i) => {
  const t = manifesto.tarefas[i];
  // blocos de código na ordem em que aparecem
  const blocos = [];
  const re = /(`{3,})([a-z]*)\n([\s\S]*?)\n\1(?=\n|$)/g;
  let m; while ((m = re.exec(sec))) blocos.push({ idx: m.index, texto: m[3] + '\n' });
  const instr = [];
  const reCrie = /Crie `([^`]+)` com EXATAMENTE este conteúdo:/g;
  while ((m = reCrie.exec(sec))) instr.push({ tipo: 'crie', p: m[1], idx: m.index });
  const reEm = /Em `([^`]+)`, aplique as (\d+) substituições/g;
  while ((m = reEm.exec(sec))) instr.push({ tipo: 'edite', p: m[1], n: Number(m[2]), idx: m.index });
  const reApague = /Apague `([^`]+)`/g;
  while ((m = reApague.exec(sec))) instr.push({ tipo: 'apague', p: m[1], idx: m.index });
  instr.sort((a, b) => a.idx - b.idx);
  for (const ins of instr) {
    const depois = blocos.filter(b => b.idx > ins.idx);
    if (ins.tipo === 'crie') arvore.set(ins.p, depois[0].texto);
    if (ins.tipo === 'apague') arvore.set(ins.p, null);
    if (ins.tipo === 'edite') {
      let atual = ler(ins.p, base);
      for (let k = 0; k < ins.n; k++) {
        const velho = depois[2 * k].texto, novo = depois[2 * k + 1].texto;
        const n = atual.split(velho).length - 1;
        if (n !== 1) { console.log(`tarefa ${t.id} ${ins.p} troca ${k + 1}: trecho aparece ${n} vezes`); falhas++; }
        atual = atual.replace(velho, () => novo);
      }
      arvore.set(ins.p, atual);
    }
  }
  // compara com o commit de origem
  const tocados = git('diff', '--name-only', '--no-renames', `${t.commit}^`, t.commit).trim().split('\n').filter(Boolean);
  for (const p of tocados) {
    let esperado = null; try { esperado = git('show', `${t.commit}:${p}`); } catch { /* apagado */ }
    if (arvore.get(p) !== esperado) { console.log(`tarefa ${t.id}: ${p} diverge do commit ${t.commit}`); falhas++; }
  }
});
console.log(falhas ? `FALHOU: ${falhas} divergência(s)` : `ok: ${secoes.length} tarefas reproduzem os commits byte a byte`);
process.exit(falhas ? 1 : 0);
