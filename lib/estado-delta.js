// O snapshot vai para a tela POR DIFERENÇA, não inteiro a cada empurrão.
//
// Medido em 30/09/2026 no Farol real desta máquina, escutando /api/events por 65 s
// durante uma revisão: 10 eventos `state`, 436 KB cada, 4,16 MB no minuto. Dos ~40
// campos do snapshot, 193 KB não mudaram em nenhum dos 10, e mandar só o que mudou
// daria 0,68 MB, 84% a menos. O custo não é rede (é 127.0.0.1): é serializar 436 KB
// dezenas de vezes por revisão no engine e repintar a tela inteira do outro lado,
// que é a sensação de "realtime fraco" que originou esta mudança.
//
// A comparação é por campo de TOPO e por texto JSON: o snapshot é montado do zero a
// cada `snapshot()`, então comparar referência não diria nada, e uma comparação
// profunda custaria mais do que o envio que ela economiza.
//
// Quem serializa é o `safeStringify` do lib/io.js, o santuário de JSON do repositório:
// campo que não serializa (ciclo) vira `null` e segue, em vez de derrubar o empurrão
// inteiro e deixar a tela sem atualização nenhuma.
import { safeStringify } from './io.js';

// Cada campo de topo vira o seu proprio texto JSON, UMA vez por empurrao, para
// servir a todos os clientes conectados sem re-serializar por cliente.
function camposSerializados(estado) {
  const fora = Object.create(null);
  if (!estado || typeof estado !== 'object') return fora;
  for (const [chave, valor] of Object.entries(estado)) {
    fora[chave] = safeStringify(valor === undefined ? null : valor);
  }
  return fora;
}

// O que mudou entre dois retratos serializados. Campo que sumiu e campo que mudou
// sao coisas diferentes: o cliente precisa APAGAR o primeiro, e mesclar o segundo.
function mudancas(anterior, atual) {
  const a = anterior || Object.create(null);
  const b = atual || Object.create(null);
  const alterados = Object.keys(b).filter((k) => a[k] !== b[k]);
  const removidos = Object.keys(a).filter((k) => !(k in b));
  return { alterados, removidos };
}

// Monta o corpo do patch reaproveitando os textos JSON ja prontos: nada aqui
// serializa de novo o que camposSerializados ja serializou.
function corpoDoPatch(serializado, { alterados, removidos }) {
  const campos = alterados.map((k) => `${safeStringify(k)}:${serializado[k]}`).join(',');
  return `{"campos":{${campos}},"removidos":${safeStringify(removidos)}}`;
}

// true quando nao ha o que enviar. Empurrao que nao muda nada nao vira evento:
// hoje ele custa 436 KB e uma repintura completa da tela para dizer o mesmo.
function semMudanca({ alterados, removidos }) {
  return alterados.length === 0 && removidos.length === 0;
}

const estadoDeltaMod = { camposSerializados, mudancas, corpoDoPatch, semMudanca };
export default estadoDeltaMod;
export { camposSerializados, mudancas, corpoDoPatch, semMudanca };
