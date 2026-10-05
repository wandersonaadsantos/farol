// Leitura do GitHub que só se repete quando o PR mudou (05/10/2026).
//
// Medido no spawns.log de 05/10/2026: 19.832 chamadas gh num dia, quase todas leituras que
// o check() refazia em TODO ciclo (180 s) sobre PRs que não tinham mudado: 4.202 `pr view`
// dos ramos dos meus PRs e cerca de 7 mil leituras de head e de reviews para saber se entrou
// commit depois do meu review. O updatedAt que a busca do próprio ciclo já traz muda com
// qualquer coisa que importa para essas leituras (push, review, pedido, troca de base), então
// ele serve de chave: mesmo updatedAt, mesma resposta, sem chamada nenhuma.
//
// Memória de processo, de propósito: reiniciar custa uma leitura por PR, e guardar em disco
// seria estado durável sem nada a proteger. Só resposta VÁLIDA entra no cache (a função
// `valida` diz qual é): falha de rede nunca fica guardada como se fosse a resposta.
import io from '../io.js';

function cache(engine, nome) {
  if (!(engine.leiturasPorMudanca instanceof Map)) engine.leiturasPorMudanca = new Map();
  if (!engine.leiturasPorMudanca.has(nome)) engine.leiturasPorMudanca.set(nome, new Map());
  return engine.leiturasPorMudanca.get(nome);
}

async function lerSeMudou(engine, nome, pr, ler, valida = (v) => v != null) {
  const chave = String((pr && pr.key) || '');
  const versao = String((pr && pr.updatedAt) || '');
  const c = cache(engine, nome);
  const guardado = c.get(chave);
  if (versao && guardado && guardado.versao === versao) return guardado.valor;
  const valor = await ler();
  if (versao && valida(valor)) c.set(chave, { versao, valor });
  else c.delete(chave);
  return valor;
}

// Os ramos e o head de um PR meu (o card mostra o de/para; o head invalida a autoanálise).
async function lerRamos(engine, pr, acc) {
  const r = await io.run('gh', ['pr', 'view', pr.url, '--json', 'headRefName,baseRefName,headRefOid'], { env: engine.ghEnv(acc) });
  if (!r.ok) return null;
  return io.parseJson(r.stdout || '{}', null);
}

export default { lerSeMudou, lerRamos };
export { lerSeMudou, lerRamos };
