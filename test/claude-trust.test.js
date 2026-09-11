// Pré-confiança do workspace no ~/.claude.json: a DECISÃO, isolada do disco.
//
// 10 e 11/09/2026, farol.log: "~/.claude.json ilegivel; nao vou pre-confiar o workspace"
// em todo boot. Duas causas somadas:
//   - o Farol reescrevia o arquivo A CADA BOOT, porque exigia hasCompletedProjectOnboarding
//     true e o próprio Claude Code, ao regravar o arquivo inteiro a partir da cópia que
//     tinha em memória, dropava o campo. Guerra de lost update sem fim;
//   - a escrita era writeFileSync direto no arquivo final, não atômica, então a janela
//     entre truncar e terminar de escrever era exatamente o que o leitor pegava pela metade.
// Aqui mora a primeira metade: quando MUDAR e o quê. A segunda (writeJsonAtomic) é o
// chamador, em server.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workspaceTrust } from '../lib/parse.js';

const WS = 'C:\\Users\\w\\.farol\\workspace';
const WS_BARRA = 'C:/Users/w/.farol/workspace';

test('workspaceTrust: arquivo sem o workspace ganha as duas variantes de chave', () => {
  const { data, changed } = workspaceTrust({ projects: {} }, WS);
  assert.equal(changed, true);
  for (const k of [WS, WS_BARRA]) {
    assert.equal(data.projects[k].hasTrustDialogAccepted, true);
    assert.equal(data.projects[k].hasCompletedProjectOnboarding, true);
  }
});

test('workspaceTrust: já confiado não reescreve, mesmo sem o onboarding', () => {
  // o caso medido: o Claude Code preserva a confiança e come o onboarding. Confiança é
  // o que decide o diálogo bloqueante; sem isso o app entrava em loop de reescrita.
  const projects = { [WS]: { hasTrustDialogAccepted: true }, [WS_BARRA]: { hasTrustDialogAccepted: true } };
  assert.equal(workspaceTrust({ projects }, WS).changed, false);
});

test('workspaceTrust: preserva o que já estava na entrada e o resto do arquivo', () => {
  const { data } = workspaceTrust({ oauthAccount: { id: 'x' }, projects: { [WS]: { history: [1, 2] } } }, WS);
  assert.deepEqual(data.oauthAccount, { id: 'x' });
  assert.deepEqual(data.projects[WS].history, [1, 2]);
  assert.equal(data.projects[WS].hasTrustDialogAccepted, true);
});

test('workspaceTrust: arquivo sem projects não explode', () => {
  assert.equal(workspaceTrust({}, WS).changed, true);
});
