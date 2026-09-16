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
  return new RegExp(m[1]);
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
];

test('o pente do pacote pega toda credencial de verdade', () => {
  const re = padraoDoEmpacotador();
  for (const s of SEGREDOS) assert.ok(re.test(s), `passou batido: ${s.slice(0, 24)}…`);
});

test('o pente não reprova o código que fala sobre credencial', () => {
  const re = padraoDoEmpacotador();
  for (const s of CODIGO) assert.equal(re.test(s), false, `falso positivo: ${s.slice(0, 40)}…`);
});

test('nada que viaja no pacote casa o pente hoje', () => {
  const re = padraoDoEmpacotador();
  const extensoes = new Set(['.js', '.md', '.json', '.cmd', '.ps1', '.html', '.css', '.sh', '.command']);
  const ignorar = new Set(['node_modules', '.git', 'dist', 'test', 'docs', 'scratchpad']);
  const achados = [];
  const varrer = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ignorar.has(e.name)) continue;
      const alvo = path.join(dir, e.name);
      if (e.isDirectory()) { varrer(alvo); continue; }
      if (!extensoes.has(path.extname(e.name)) || e.name === 'make-package.ps1') continue;
      const linhas = fs.readFileSync(alvo, 'utf8').split(/\r?\n/);
      linhas.forEach((l, i) => { if (re.test(l)) achados.push(`${path.relative(RAIZ, alvo)}:${i + 1}`); });
    }
  };
  varrer(RAIZ);
  assert.deepEqual(achados, [], 'linha com forma de credencial no que viaja');
});
