// Leitura do fonte da UI para os testes que casam regex contra ele.
//
// POR QUE EXISTE: desde a Fase 1a da reorganização o código puro da tela mora em
// ui/pure/*.js, e o ui/pure.js é só fachada. Teste que lê SÓ o ui/pure.js fica cego
// quando o trecho que ele afirma muda de módulo, e cego aqui é pior que vermelho: o
// piso de contagem passa a medir o que sobrou no arquivo, não o que a tela emite.
// Já aconteceu uma vez, e o comentário de test/ui-widgets.test.js registra: ao mover
// o bloco de Consumo, o piso caiu de 6 para 5 sem nenhuma menção ter perdido
// role ou tabindex.
//
// Sem efeito colateral no import: o `node --test` executa test/**/*.js, e um arquivo
// que só exporta funções passa vazio.
import fs from 'node:fs';
import path from 'node:path';

const RAIZ = path.join(import.meta.dirname, '..', '..');

/** Todo o código puro da UI (ui/pure.js e ui/pure/*.js) concatenado, na ordem de leitura. */
function fonteDosPuros() {
  const dir = path.join(RAIZ, 'ui', 'pure');
  const modulos = fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.js'))
      .map((e) => fs.readFileSync(path.join(dir, e.name), 'utf8'))
    : [];
  return [fs.readFileSync(path.join(RAIZ, 'ui', 'pure.js'), 'utf8'), ...modulos].join('\n');
}

export { fonteDosPuros };
