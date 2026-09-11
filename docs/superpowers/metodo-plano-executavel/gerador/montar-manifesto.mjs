// Junta as três fontes do plano num manifesto só pro gerar-plano.mjs:
//   tarefas-replay.json   o QUE cada tarefa toca (a decomposição topológica)
//   replay-resultado.json o commit limpo que o replay produziu pra cada uma
//   prosa-tarefas.json    o PORQUÊ e a falha esperada, que é o que nenhuma máquina deduz
//
// Uso: node montar-manifesto.mjs <saida.json>
import fs from 'node:fs';
import path from 'node:path';

const saida = process.argv[2] || 'manifesto-sync.json';
const aqui = import.meta.dirname;
const ler = (n) => JSON.parse(fs.readFileSync(path.join(aqui, n), 'utf8'));

const plano = ler('tarefas-replay.json');
const feitas = new Map(ler('replay-resultado.json').map((f) => [f.id, f]));
const prosa = ler('prosa-tarefas.json');

const CABECALHO = `# Sincronização entre dispositivos: plano de implementação

Gerado por máquina a partir de commits já provados verdes (\`gerador/gerar-plano.mjs\`), e
conferido pelo executor perfeito: aplicar este plano sobre a base reproduz, tarefa a
tarefa, exatamente a árvore que o protótipo provou.

**Como executar.** Uma tarefa por vez, na ordem. Em cada uma: aplique as mudanças
EXATAMENTE como escritas, rode os testes indicados e depois \`npm run check && npm run
lint && npm test\`. Só passe para a próxima com os três verdes. Um commit por tarefa, com
a mensagem indicada, sem trailer de co-autoria e sem mencionar IA.

**Onde colar.** Arquivo NOVO entra inteiro, com o conteúdo literal. Arquivo QUE JÁ EXISTE
entra como pares "localize este trecho / troque por este": o trecho a localizar aparece
uma única vez no arquivo naquele momento, e isso foi PROVADO na geração. Não reescreva o
arquivo inteiro, não reformate, não mude nada que o plano não peça.

**Escreva os arquivos com a ferramenta de escrita de arquivo, não por heredoc de shell.**
O conteúdo tem sequências como \`\\u0000\` que o shell interpreta: \`bash\`, \`cat <<EOF\` e
amigos transformam a barra invertida antes de o arquivo existir, e aí o hash nunca bate. A
ferramenta que grava o conteúdo direto (Write, ou equivalente do seu ambiente) copia byte
a byte e é a única forma confiável aqui.

**Sequência de escape é TEXTO, não atalho.** Onde o bloco mostra \`\\u2014\`, \`\\u0000\` ou
qualquer \`\\u\` seguido de quatro dígitos, escreva esses seis caracteres, um a um. NÃO os
troque pelo caractere que eles representam, mesmo sabendo qual é: o JavaScript fica
equivalente, a suíte fica verde, e ainda assim a árvore deixa de ser a que foi provada.
Cada arquivo criado vem com uma conferência por hash logo abaixo; rode-a antes de seguir.

**O contrato** (\`docs/superpowers/plans/2026-09-10-sync-00-contrato.md\`) explica as
decisões. Leia a seção "Atualização pós-protótipo" antes de começar: é onde estão os
pontos em que o contrato original estava errado.`;

const tarefas = plano.tarefas.map((t) => {
  const feita = feitas.get(t.id);
  if (!feita) throw new Error(`${t.id} não tem commit no replay-resultado.json`);
  const p = prosa[t.id] || {};
  return {
    id: t.id,
    titulo: t.titulo,
    commit: feita.sha,
    porque: p.porque || '',
    falhaEsperada: p.falhaEsperada || '',
    testes: t.arquivos.filter((a) => a.startsWith('test/') && a.endsWith('.test.js')),
    mensagem: t.mensagem,
  };
});

const semProsa = tarefas.filter((t) => !t.porque).map((t) => t.id);
if (semProsa.length) console.error(`aviso: sem "porque" em ${semProsa.join(', ')}`);

fs.writeFileSync(path.join(aqui, saida), `${JSON.stringify({ titulo: 'Sincronização entre dispositivos', cabecalho: CABECALHO, tarefas }, null, 2)}\n`);
console.log(`${saida}: ${tarefas.length} tarefas, ${tarefas.filter((t) => t.testes.length).length} com teste próprio`);
