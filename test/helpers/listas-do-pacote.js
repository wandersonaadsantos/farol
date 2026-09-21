// A ÚNICA derivação das listas do empacotador. `tools/make-package.ps1` decide o que viaja;
// quem precisa saber disso num teste lê daqui, nunca copia o nome de um arquivo à mão.
//
// POR QUE ESTE ARQUIVO EXISTE: `test/distribuicao-listas.test.js` já derivava as quatro
// listas do fonte, mas `test/pacote-auditoria.test.js` varria a raiz do repositório com
// uma lista PRÓPRIA de pastas a ignorar. As duas respondiam "o que viaja?" e discordavam:
// a varredura entrava em `scratchpad_test/` (rascunho ignorado pelo git, que não viaja) e
// reprovava o `npm test` local por um achado que nunca chegaria ao pacote, enquanto deixava
// os quatro guias de `docs/` — que VIAJAM — fora do pente. Medido em 20/09/2026.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

export const RE_PS = {
  f: /foreach \(\$f in @\(([\s\S]*?)\)\)/g,
  d: /foreach \(\$d in @\(([\s\S]*?)\)\)/g,
  t: /foreach \(\$t in @\(([\s\S]*?)\)\)/g,
  doc: /foreach \(\$doc in @\(([\s\S]*?)\)\)/g,
};

export function listaPowershell(texto, variavel, arquivo) {
  const re = new RegExp(RE_PS[variavel].source, 'g');
  const achadas = [...texto.matchAll(re)].map((m) => (m[1].match(/'([^']+)'/g) || []).map((s) => s.slice(1, -1)));
  assert.equal(achadas.length, 1, `${arquivo}: esperava UMA lista de $${variavel}, achei ${achadas.length}`);
  return achadas[0];
}

// Todo arquivo que o empacotador copia para o staging, em caminho relativo à raiz: os de
// raiz e os nomeados de tools/ e docs/ um a um, e as pastas inteiras (o empacotador usa
// robocopy /E, então subpasta entra junto).
export function arquivosQueViajam(raiz) {
  const pacote = fs.readFileSync(path.join(raiz, 'tools', 'make-package.ps1'), 'utf8');
  const arq = 'tools/make-package.ps1';
  const nomeados = [
    ...listaPowershell(pacote, 'f', arq),
    ...listaPowershell(pacote, 't', arq).map((t) => `tools/${t}`),
    ...listaPowershell(pacote, 'doc', arq).map((d) => `docs/${d}`),
  ];
  const viajam = [];
  const descer = (rel) => {
    for (const e of fs.readdirSync(path.join(raiz, rel), { withFileTypes: true })) {
      const filho = `${rel}/${e.name}`;
      if (e.isDirectory()) descer(filho); else viajam.push(filho);
    }
  };
  for (const d of listaPowershell(pacote, 'd', arq)) descer(d);
  return [...nomeados, ...viajam];
}
