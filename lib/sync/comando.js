// Comando remoto (7.C6 e o esboço de comandos do anexo S3). Puro: sem estado, sem IO.
//
// A REGRA QUE MANDA EM TUDO (CT-FIO): comando NUNCA vira `pr.manual` nem `requested`.
// Hoje `manual` atravessa a saída de cena, o gate de consciência, os checks obrigatórios e
// os overrides de coordenação, e só é carimbado no CLIQUE, feito por quem está na frente
// deste aparelho. Marcar comando como manual por conveniência derrubaria quatro gates de
// uma vez, em silêncio. O comando carrega origem própria, que não atravessa nada.
//
// A ORDEM DAS RECUSAS É O CONTRATO, e é sempre esta:
//   1. `nao-aceita-admin`  este aparelho não consente em obedecer a um admin;
//   2. `nao-e-meu`         o comando é de outro alvo (nem vira recibo);
//   3. `forma`             o nó não tem os campos do contrato;
//   4. `geracao`           veio de outra geração de admin;
//   5. `assinatura`        só aqui se prova que veio do admin vigente;
//   6. `autoridade`        assinatura válida não diz QUANDO: o frescor diz;
//   7. `vencido`           passou do TTL, e o que era para agora não vale depois.
//
// A ASSINATURA NÃO É PERMISSÃO: o banco não verifica criptografia, e qualquer aparelho com
// a credencial da conta escreve nestes nós. Ela vale contra cliente honesto com bug e
// contra versão divergente. Quem recusa é sempre o cliente que lê, aqui.
import { randomBytes } from 'node:crypto';
import { verificar } from './assinatura.js';

const ESQUEMA = 'cmd1';
const TIPOS = ['cancelar', 'repetir', 'decidir', 'iniciar', 'designar-admin'];
const ACOES = ['approve', 'reject'];
const TAG_RE = /^[0-9a-f]{32}$/;
const ID_BYTES = 16;

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function tag(v) {
  return TAG_RE.test(String(v || '')) ? String(v) : '';
}

function novoCmdId() {
  return randomBytes(ID_BYTES).toString('hex');
}

// Allowlist por tipo: argumento fora dela não viaja, e argumento obrigatório faltando
// invalida o comando (nada de "comando pela metade" chegando ao executor).
const ARGUMENTOS = {
  cancelar: (a) => (tag(a.prTag) ? { prTag: tag(a.prTag) } : null),
  repetir: (a) => (tag(a.prTag) && tag(a.matTag) ? { prTag: tag(a.prTag), matTag: tag(a.matTag) } : null),
  decidir: (a) => (tag(a.itemId) && ACOES.includes(String(a.acao)) ? { itemId: tag(a.itemId), acao: String(a.acao) } : null),
  iniciar: (a) => (tag(a.itemId) ? { itemId: tag(a.itemId) } : null),
  'designar-admin': () => ({}),
};

function sanearComando(bruto) {
  const b = objeto(bruto) ? bruto : {};
  const tipo = TIPOS.includes(String(b.tipo)) ? String(b.tipo) : '';
  if (!tipo) return null;
  const args = ARGUMENTOS[tipo](objeto(b.args) ? b.args : {});
  if (!args) return null;
  return { tipo, args };
}

function claroDoComando({ tipo, args, issuedAt }) {
  const limpo = sanearComando({ tipo, args });
  if (!limpo) return null;
  return { c: { ...limpo, issuedAt: Number(issuedAt) || 0 } };
}

// O nó: `alvo` e `ttl` viajam em CLARO porque a regra do banco precisa deles (alvo para
// dizer quem responde, ttl para a remoção depois do vencimento); tipo e argumentos vão
// cifrados.
function noValido(no) {
  return objeto(no) && !!no.enc && !!no.sig && !!no.alvo && Number(no.ttl) > 0 && Number(no.generation) > 0;
}

function valorAssinado(no) {
  return { v: Number(no.v) || 0, generation: Number(no.generation) || 0, alvo: String(no.alvo || ''), ttl: Number(no.ttl) || 0, enc: String(no.enc || '') };
}

function recusa(code) {
  return { ok: false, code };
}

function podeAplicar(no, { cmdId, uid, dev, aceitarAdmin, publicKey, generationVigente, fresca, agora }) {
  if (aceitarAdmin !== true) return recusa('nao-aceita-admin');
  if (!objeto(no) || String(no.alvo || '') !== String(dev)) return recusa('nao-e-meu');
  if (!noValido(no)) return recusa('forma');
  const generation = Number(generationVigente) || 0;
  if (!generation || Number(no.generation) !== generation) return recusa('geracao');
  const caminho = `live/commands/${cmdId}`;
  if (!verificar(publicKey, no.sig, { uid, caminho, generation, valor: valorAssinado(no) })) return recusa('assinatura');
  if (fresca !== true) return recusa('autoridade');
  if (Number(agora) > Number(no.ttl)) return recusa('vencido');
  return { ok: true, code: '' };
}

// O que o executor enfileira a partir de um comando. Nunca `manual`, nunca `requested`:
// os dois são removidos aqui, mesmo que alguém os tenha posto no objeto local.
function prDoComando(pr) {
  const base = objeto(pr) ? { ...pr } : {};
  delete base.manual;
  delete base.requested;
  return { ...base, viaComando: true };
}

function recibo({ dev, estado, code = '', agora }) {
  return { dev: String(dev || ''), estado: String(estado || ''), code: String(code || ''), at: Number(agora) || 0 };
}

export default { ESQUEMA, TIPOS, ACOES, novoCmdId, sanearComando, claroDoComando, valorAssinado, podeAplicar, prDoComando, recibo };
export { ESQUEMA, TIPOS, ACOES, novoCmdId, sanearComando, claroDoComando, valorAssinado, podeAplicar, prDoComando, recibo };
