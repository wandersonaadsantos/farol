// Credencial no texto que sairia no GitHub com a conta da pessoa (03/11/2026).
//
// A trava mora em postReviewOnce (lib/engine/decision.js), a boca por onde toda via posta:
// revisão automática, clique, reenvio, espera do CI, chat e co-assinatura. Roda antes da trava de
// linguagem, porque a recusa dela volta para a reconstrução automática do texto, e aqui a saída é
// a pessoa decidir, nunca o Farol recortar o parágrafo e publicar o resto sozinho.
//
// O valor não sai daqui: a recusa diz os campos, nunca o trecho. E a pendência gravada também não
// o guarda: recordDecision passa o item por retirarCredenciais antes de ir para decisions.json,
// para a tela e para o histórico. A marca que fica no lugar é recusada aqui como se fosse a própria
// credencial, senão a espera do CI ou um clique publicariam sozinhos um texto que alguém recortou.
// Por isso ela é diferente do "[segredo mascarado]" das projeções: esse a sessão pode ler e citar
// ao apontar um segredo no diff, e o review que faz isso é legítimo.
import { hasCredential, replaceCredentials } from '../sensitive-text.js';

const BLOQUEIO_CREDENCIAL = 'credencial_no_texto';
const MARCA_RETIRADA = '[credencial retirada]';
const TEXTO_DA_RECUSA = 'o texto do review tem o que parece uma credencial, então nada foi postado; confira no card e redija pelo chat deste PR';

function temCredencial(texto) {
  const valor = String(texto === undefined || texto === null ? '' : texto);
  return valor.includes(MARCA_RETIRADA) || hasCredential(valor);
}

function camposComCredencial(payload) {
  const campos = temCredencial(payload && payload.body) ? ['body'] : [];
  const comentarios = Array.isArray(payload && payload.comments) ? payload.comments : [];
  comentarios.forEach((comentario, i) => {
    if (temCredencial(comentario && comentario.body) || temCredencial(comentario && comentario.path)) campos.push(`comments[${i}]`);
  });
  return campos;
}

function recusaPorCredencial(engine, pr, payload) {
  const campos = camposComCredencial(payload);
  if (!campos.length) return null;
  engine.log('ERROR', `postar review ${pr.key}: texto público bloqueado por credencial (${campos.join(', ')})`);
  return { ok: false, blocked: BLOQUEIO_CREDENCIAL, attempted: false, error: TEXTO_DA_RECUSA, campos };
}

function objetoSimples(valor) {
  if (!valor || typeof valor !== 'object') return false;
  const proto = Object.getPrototypeOf(valor);
  return proto === Object.prototype || proto === null;
}

function retirarDoObjeto(valor) {
  let copia = null;
  for (const chave of Object.keys(valor)) {
    const novo = retirarCredenciais(valor[chave]);
    if (novo === valor[chave]) continue;
    copia ||= { ...valor };
    copia[chave] = novo;
  }
  return copia || valor;
}

// Devolve a MESMA referência quando não há o que retirar, que é o caso de quase toda decisão.
function retirarCredenciais(valor) {
  if (typeof valor === 'string') return hasCredential(valor) ? replaceCredentials(valor, MARCA_RETIRADA) : valor;
  if (Array.isArray(valor)) {
    const novos = valor.map(retirarCredenciais);
    return novos.some((novo, i) => novo !== valor[i]) ? novos : valor;
  }
  return objetoSimples(valor) ? retirarDoObjeto(valor) : valor;
}

export { BLOQUEIO_CREDENCIAL, MARCA_RETIRADA, camposComCredencial, recusaPorCredencial, retirarCredenciais };
