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

/**
 * Os arquivos do código puro da UI, fachada primeiro: `[{ nome, texto }]`.
 *
 * É a fonte única de "quais arquivos compõem o ui/pure". Quem precisa do texto inteiro usa
 * `fonteDosPuros`; quem precisa saber EM QUAL arquivo algo mora (a trava de nome declarado
 * em dois arquivos) usa esta. Duas enumerações do diretório seriam duas respostas para a
 * mesma pergunta, e a primeira que ficasse para trás mentiria em silêncio.
 */
function arquivosDosPuros() {
  const dir = path.join(RAIZ, 'ui', 'pure');
  const modulos = fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.js'))
      .map((e) => ({ nome: `pure/${e.name}`, texto: fs.readFileSync(path.join(dir, e.name), 'utf8') }))
    : [];
  return [{ nome: 'pure.js', texto: fs.readFileSync(path.join(RAIZ, 'ui', 'pure.js'), 'utf8') }, ...modulos];
}

/** Todo o código puro da UI concatenado, na ordem de leitura. */
function fonteDosPuros() {
  return arquivosDosPuros().map((a) => a.texto).join('\n');
}

/**
 * Os arquivos da tela com DOM (ui/app.js e ui/telas/*.js), bootstrap primeiro:
 * `[{ nome, texto }]`. Mesmo motivo do `arquivosDosPuros`: teste preso a um arquivo fica
 * cego quando o trecho que ele afirma muda de módulo, e cego passa verde.
 */
function arquivosDasTelas() {
  const dir = path.join(RAIZ, 'ui', 'telas');
  const modulos = fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.js'))
      .map((e) => ({ nome: `telas/${e.name}`, texto: fs.readFileSync(path.join(dir, e.name), 'utf8') }))
    : [];
  return [{ nome: 'app.js', texto: fs.readFileSync(path.join(RAIZ, 'ui', 'app.js'), 'utf8') }, ...modulos];
}

/** Todo o código de tela com DOM concatenado, na ordem de leitura. */
function fonteDasTelas() {
  return arquivosDasTelas().map((a) => a.texto).join('\n');
}

export { arquivosDosPuros, fonteDosPuros, arquivosDasTelas, fonteDasTelas };
