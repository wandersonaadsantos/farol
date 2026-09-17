// O pente anti-vazamento do pacote (invariante 7) lido do PRÓPRIO empacotador, nunca copiado
// para cá: duas listas de padrões seriam duas respostas para a mesma pergunta, e a que ficasse
// para trás mentiria em silêncio.
//
// POR QUE ESTE ARQUIVO EXISTE: em 16/09/2026 o empacotamento foi rodado de verdade e reprovou.
// Não havia segredo nenhum no pacote: o pente casava o PREFIXO (`ghp_`, `Bearer `) e acusava a
// máscara de segredo da A1 e o formato do token de sessão da A4, que são código. O padrão
// passou a exigir a FORMA de um segredo (prefixo mais valor), e estes casos travam as duas
// pontas: continua pegando credencial de verdade, e não pega mais o código que fala sobre ela.
import path from 'node:path';
import fs from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const RAIZ = path.join(import.meta.dirname, '..');
const EMPACOTADOR = fs.readFileSync(path.join(RAIZ, 'tools', 'make-package.ps1'), 'utf8');

function padraoDoEmpacotador() {
  const m = /Select-String -Pattern '([^']+)'/.exec(EMPACOTADOR);
  assert.ok(m, 'o empacotador tem que continuar tendo UM padrão de auditoria');
  // o Select-String ignora caixa por padrão: o espelho aqui tem que ignorar também, senão
  // este teste seria mais frouxo que o pente que ele descreve
  return new RegExp(m[1], 'i');
}

// credenciais fabricadas para o teste, nunca válidas em lugar nenhum
const SEGREDOS = [
  'ghp_' + 'A1b2C3d4'.repeat(5),
  'github_pat_' + 'x9'.repeat(15),
  'gho_' + 'Z7y6X5w4'.repeat(4),
  'ATATT' + 'q1w2e3r4t5y6',
  'Authorization: Bearer ' + 'k'.repeat(43),
  'conta wandersonbiuder no meio da linha',
];

// o que o código do Farol legitimamente contém e NÃO é credencial
const CODIGO = [
  '/\\bgithub_pat_[A-Za-z0-9_]{20,}/g,',
  "const FORMATO_BEARER = /^Bearer ([A-Za-z0-9_-]{43})$/;",
  'return token ? { ...cabecalhos, Authorization: `Bearer ${token}` } : { ...cabecalhos };',
  '// Authorization: Bearer com uma sessão válida, exceto POST /api/auth/pair',
  '/\\bgh[pousr]_[A-Za-z0-9]{20,}/g,',
  // menção NUA do prefixo, sem valor: é sobre credencial, não é credencial
  '// um token pessoal do GitHub começa com ghp_ e o Farol nunca o grava',
  '// o token de app começa com github_pat_ e o de OAuth com gho_',
];

// A outra barreira do empacotador: nome de arquivo que não pode entrar no pacote.
function proibidosDoEmpacotador() {
  const m = /\$_ -match '([^']+)'\s*\n\}\s*\nif \(\$proibidos\)/.exec(EMPACOTADOR);
  assert.ok(m, 'o empacotador tem que continuar tendo UM padrão de arquivo proibido');
  return new RegExp(m[1], 'i');
}

const PROIBIDOS = [
  'lib/config.json', 'lib/state/sintetico.json', 'ui/farol.log', 'node_modules/x/index.js',
  'sessions/abc.json', 'state/seen', 'lib/baselined.json', 'workspace-template/highlights.md', 'authors/pessoa.md',
];

const LEGITIMOS = [
  'lib/paths.js', 'ui/app.css', 'package.json', 'workspace-template/CLAUDE.md',
  'installer/install.ps1', 'docs/RELEASE.md', 'assets/farol.ico', 'tools/jira-mcp.js',
];

test('o pente do pacote pega toda credencial de verdade', () => {
  const re = padraoDoEmpacotador();
  for (const s of SEGREDOS) assert.ok(re.test(s), `passou batido: ${s.slice(0, 24)}…`);
});

test('o pente não reprova o código que fala sobre credencial', () => {
  const re = padraoDoEmpacotador();
  for (const s of CODIGO) assert.equal(re.test(s), false, `falso positivo: ${s.slice(0, 40)}…`);
});

test('a barreira de nome barra estado, configuração e log, e deixa passar o que viaja', () => {
  const re = proibidosDoEmpacotador();
  for (const p of PROIBIDOS) assert.ok(re.test(p), `entraria no pacote: ${p}`);
  for (const p of LEGITIMOS) assert.equal(re.test(p), false, `o pacote não sairia por causa de: ${p}`);
});

// Verificação C (16/09/2026): a varredura tinha lista de nove extensões, e texto que VIAJA
// ficava fora dela. Medido no caminho real: segredo sintético em `ui/favicon.svg`, em
// `installer/farol.nsi` e num `.txt` novo de `lib/` saiu no pacote sem uma linha de aviso.
test('a varredura de conteúdo do empacotador não tem lista de extensão', () => {
  const m = /\$hits = Get-ChildItem \$tmpDir([^|]*)\|/.exec(EMPACOTADOR);
  assert.ok(m, 'a varredura continua saindo de um Get-ChildItem do diretório extraído');
  assert.equal(/-Include|-Filter|-Exclude/.test(m[1]), false, `filtro de arquivo na varredura: ${m[1].trim()}`);
  assert.match(m[1], /-Recurse -File/);
});

test('nada que viaja no pacote casa o pente hoje', () => {
  const re = padraoDoEmpacotador();
  const ignorar = new Set(['node_modules', '.git', 'dist', 'test', 'docs', 'scratchpad']);
  const achados = [];
  const varrer = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ignorar.has(e.name)) continue;
      const alvo = path.join(dir, e.name);
      if (e.isDirectory()) { varrer(alvo); continue; }
      // sem lista de extensão, como o empacotador: binário entra lido byte a byte
      if (e.name === 'make-package.ps1') continue;
      const linhas = fs.readFileSync(alvo, 'latin1').split(/\r?\n/);
      linhas.forEach((l, i) => { if (re.test(l)) achados.push(`${path.relative(RAIZ, alvo)}:${i + 1}`); });
    }
  };
  varrer(RAIZ);
  assert.deepEqual(achados, [], 'linha com forma de credencial no que viaja');
});
