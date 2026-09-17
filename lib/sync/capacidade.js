// Abrir a capacidade que outro aparelho publicou em `live/deviceStatus/{dev}` (C3a). Folha:
// sem estado, sem rede; quem lê o banco é quem chama.
//
// Dois leitores dependem dela, e por isso ela mora num lugar só: o agendador da
// distribuição (ocupação e pausa) e o teto do grupo (sequência do consumo e reservas por
// grupo). Falha FECHADA: envelope que não abre, de outro caminho ou de outro esquema,
// devolve `null`, nunca um objeto parcial.
import envelope from './envelope.js';

const CAMPO = 'capacidade';
const ESQUEMA = 'cap1';

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function abrirCapacidade({ uid, material, dev, no }) {
  if (!objeto(no) || !no.enc || !material) return null;
  const aberto = envelope.decifrar({
    enc: no.enc, material, uid, caminho: `live/deviceStatus/${dev}`, campo: CAMPO, esquema: ESQUEMA,
  });
  if (!aberto.ok || !objeto(aberto.valor) || !objeto(aberto.valor.c)) return null;
  return { u: Number(no.u) || 0, c: aberto.valor.c };
}

export default { abrirCapacidade, CAMPO, ESQUEMA };
export { abrirCapacidade, CAMPO, ESQUEMA };
