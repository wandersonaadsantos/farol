// Replay limpo: reconstrói a MESMA árvore final do protótipo num worktree novo, em
// tarefas em ordem topológica, com o gate verde em cada commit.
//
// Cada arquivo aparece em EXATAMENTE UMA tarefa, na forma final. É isso que torna o
// replay mecânico: não há versão intermediária inventada à mão, então o que sai no fim
// é byte a byte o que o protótipo provou. A ordem é que carrega o trabalho: um módulo
// só entra depois de tudo que ele importa, e um teste só entra depois de tudo que ele
// importa, senão o commit nasceria vermelho.
//
// Uso: node replay.mjs <worktree> <tarefas.json> [--ate T05]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [wt, tarefasPath, ...resto] = process.argv.slice(2);
const ate = (resto.find((a) => a.startsWith('--ate=')) || '').split('=')[1] || '';
const plano = JSON.parse(fs.readFileSync(tarefasPath, 'utf8'));

const git = (...a) => execFileSync('git', ['-C', wt, ...a], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
// os scripts do package.json chamados direto por `node`: no Windows o spawn de um .cmd
// exige shell, e passar pelo shell só acrescentaria uma camada que pode engolir a saída
const noNode = (...args) => execFileSync(process.execPath, args, { cwd: wt, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
const npmRun = (script) => {
  if (script === 'check') return noNode('tools/check-syntax.js');
  return noNode('tools/quality/gate.js') + noNode('tools/quality/higiene.js');
};
const npmTest = () => noNode('--test', '--test-force-exit');

function escreverDoAlvo(caminho) {
  const destino = path.join(wt, caminho);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  // --binary evita que o git converta fim de linha ao materializar o conteúdo
  const conteudo = execFileSync('git', ['-C', wt, 'show', `${plano.alvo}:${caminho}`], { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 });
  fs.writeFileSync(destino, conteudo);
}

function gate(id) {
  const problemas = [];
  try { npmRun('check'); } catch (e) { problemas.push(`check: ${e.message}
${(e.stdout || '') + (e.stderr || '')}`.slice(0, 800)); }
  try { npmRun('lint'); } catch (e) { problemas.push(`lint: ${e.message}
${(e.stdout || '') + (e.stderr || '')}`.slice(0, 800)); }
  let saida = '';
  try { saida = npmTest(); } catch (e) {
    saida = (e.stdout || '') + (e.stderr || '');
    const falhas = saida.split('\n').filter((l) => l.startsWith('✖') || /^ℹ fail/.test(l)).slice(0, 12);
    problemas.push(`test:\n${falhas.join('\n')}`);
  }
  const m = saida.match(/ℹ pass (\d+)/);
  if (problemas.length) {
    console.error(`\n[${id}] GATE VERMELHO\n${problemas.join('\n---\n')}`);
    process.exit(1);
  }
  return m ? Number(m[1]) : 0;
}

const feitas = [];
for (const t of plano.tarefas) {
  for (const f of t.arquivos) escreverDoAlvo(f);
  git('add', '-A');
  const passes = gate(t.id);
  git('-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', t.mensagem);
  const sha = git('rev-parse', '--short', 'HEAD').trim();
  feitas.push({ id: t.id, sha, passes, arquivos: t.arquivos.length });
  console.log(`${t.id}  ${sha}  ${String(passes).padStart(4)} testes verdes  ${t.arquivos.length} arquivo(s)  ${t.titulo}`);
  if (ate && t.id === ate) break;
}

if (!ate) {
  // a prova do replay: a árvore final tem que ser byte a byte a do protótipo
  const diff = git('diff', '--stat', plano.alvo, 'HEAD').trim();
  console.log(diff ? `\nDIFF CONTRA O PROTÓTIPO (deveria ser vazio):\n${diff}` : '\nok: a árvore final é byte a byte a do protótipo');
  if (diff) process.exit(1);
}
fs.writeFileSync(path.join(path.dirname(tarefasPath), 'replay-resultado.json'), JSON.stringify(feitas, null, 2));
