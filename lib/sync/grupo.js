// Identidade e forma do grupo de consumo (CT-GRUPO). Puro: sem estado, sem IO, sem rede.
//
// O ID É SORTEADO, e essa é a decisão central. Derivar o grupo de um hash da credencial
// parece prático e é o caminho que a spec recusa: o hash reconhece a MESMA credencial, e o
// problema real é outro. Duas chaves diferentes podem precisar dividir um teto, e a mesma
// pessoa pode rotacionar a chave sem querer começar a contagem do zero. Identidade de
// consumo é uma decisão de quem administra, não uma coincidência de bytes. Por isso aqui
// não entra `createHash`, `createHmac` nem `tags.js`, e um teste guarda essa ausência.
//
// Nome igual ou caminho parecido também não é prova de identidade, e por isso nada aqui
// pré-seleciona grupo a partir deles.
//
// Configurar não é ativar: este módulo descreve o grupo, e nada do que ele devolve barra
// execução. O teto passa a barrar na C4b.
import { randomBytes } from 'node:crypto';

const TIPOS_DE_PERFIL = ['assinatura', 'api', 'openrouter', 'codex'];
const CONTROLADOS = ['assinatura', 'api', 'openrouter'];
const PERIODOS = ['dia', 'semana', 'mes'];
const ID_BYTES = 16;

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function novoIdDeGrupo() {
  return randomBytes(ID_BYTES).toString('hex');
}

// Tipo desconhecido NÃO é controlado: assumir controle sobre um tipo que o Farol não sabe
// medir mostraria orçamento protegido onde não existe medição nenhuma.
function controlado(tipo) {
  return CONTROLADOS.includes(String(tipo || ''));
}

function idDe(v) {
  return typeof v === 'string' && /^[0-9a-f]{32}$/.test(v) ? v : null;
}

function nomeDe(v) {
  const t = typeof v === 'string' ? v.trim() : '';
  return t ? t.slice(0, 80) : null;
}

function periodoDe(v) {
  return PERIODOS.includes(String(v || '')) ? String(v) : null;
}

// Teto inválido é DESCARTADO, nunca virado zero: zero é "teto de nada", mais restritivo do
// que o dono pediu, e restringir por causa de um campo torto é decidir no lugar dele.
function tetoDe(v) {
  const n = Number(v);
  if (typeof v !== 'number' || !Number.isFinite(n) || n < 0) return null;
  return n;
}

const CAMPOS = { id: idDe, nome: nomeDe, periodo: periodoDe, tetoUsd: tetoDe };

function sanearGrupo(bruto) {
  if (!objeto(bruto)) return {};
  const saida = {};
  for (const [campo, sanear] of Object.entries(CAMPOS)) {
    const valor = sanear(bruto[campo]);
    if (valor !== null) saida[campo] = valor;
  }
  return saida;
}

function perfisDoGrupo(id, vinculos) {
  const dentro = objeto(vinculos) ? Object.entries(vinculos) : [];
  return dentro.filter(([, v]) => objeto(v) && v.grupo === id);
}

function estadoDe(g) {
  if (!objeto(g) || !g.id) return 'nao-identificado';
  return g.tetoUsd === undefined ? 'sem-teto' : 'configurado';
}

// Grupo misto mostra as duas partes separadas: quem é medido e quem não é. Somar os dois
// num número só diria que o orçamento cobre o que ele não cobre.
function resumoDoGrupo(g, { vinculos } = {}) {
  const grupoLimpo = objeto(g) ? g : null;
  const id = grupoLimpo ? grupoLimpo.id : null;
  const perfis = id ? perfisDoGrupo(id, vinculos) : [];
  return {
    id: id || '',
    nome: (grupoLimpo && grupoLimpo.nome) || '',
    periodo: (grupoLimpo && grupoLimpo.periodo) || '',
    tetoUsd: grupoLimpo ? grupoLimpo.tetoUsd : undefined,
    controlados: perfis.filter(([, v]) => controlado(v.tipo)).map(([p]) => p),
    naoControlados: perfis.filter(([, v]) => !controlado(v.tipo)).map(([p]) => p),
    estado: estadoDe(grupoLimpo),
  };
}

export default { TIPOS_DE_PERFIL, CONTROLADOS, PERIODOS, novoIdDeGrupo, controlado, sanearGrupo, resumoDoGrupo };
export { TIPOS_DE_PERFIL, CONTROLADOS, PERIODOS, novoIdDeGrupo, controlado, sanearGrupo, resumoDoGrupo };
