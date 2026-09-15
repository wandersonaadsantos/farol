// Os guias que viajam com o app instalado, lidos do empacotador.
//
// POR QUE EXISTE: desde a Fase 1.5 da reorganização o CLAUDE.md da raiz é sumário e o
// conteúdo operacional mora em quatro guias de docs/, que viajam por allowlist explícita.
// Os testes de guia (índice, âncora, link só para o que viaja, nada duplicado) precisam da
// MESMA lista que o pacote usa; uma lista escrita à mão aqui envelheceria sozinha. Os testes
// de distribuição continuam lendo as seis rotas por conta própria, porque o que eles provam
// é justamente a concordância entre elas.
//
// Sem efeito colateral no import: o `node --test` executa test/**/*.js, e um arquivo que só
// exporta funções passa vazio.
import fs from 'node:fs';
import path from 'node:path';

const RAIZ = path.join(import.meta.dirname, '..', '..');

function listaDoPacote(variavel) {
  const fonte = fs.readFileSync(path.join(RAIZ, 'tools', 'make-package.ps1'), 'utf8');
  const m = fonte.match(new RegExp(`foreach \\(\\$${variavel} in @\\(([\\s\\S]*?)\\)\\)`));
  if (!m) throw new Error(`tools/make-package.ps1 sem a lista $${variavel}`);
  return (m[1].match(/'([^']+)'/g) || []).map((s) => s.slice(1, -1));
}

/** Caminhos relativos dos guias distribuídos: o CLAUDE.md e os guias da allowlist. */
function guiasDistribuidos() {
  return ['CLAUDE.md', ...listaDoPacote('doc').map((d) => `docs/${d}`)];
}

/** Tudo que viaja: arquivos (raiz, tools nomeados, guias) e pastas inteiras. */
function alvosDistribuidos() {
  return {
    arquivos: new Set([
      ...listaDoPacote('f'),
      ...listaDoPacote('t').map((t) => `tools/${t}`),
      ...guiasDistribuidos(),
    ]),
    pastas: listaDoPacote('d'),
  };
}

export { guiasDistribuidos, alvosDistribuidos };
