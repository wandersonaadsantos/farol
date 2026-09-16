// Sonda da versão das regras publicadas (anexo C1, "Estratégia de regras", princípio 8).
//
// O contrato v2 depende de regras que ainda são publicadas À MÃO, uma vez, pelo dono. Um
// aparelho atualizado falando com um banco de regras velhas escreveria conteúdo cifrado
// achando que a raiz está protegida, quando o apagão da v2.59.x ainda existe ali.
//
// COMO A SONDA DECIDE, e por que não é pelo DELETE da raiz: sob as regras velhas o
// `users/{uid}` tem '.write', e sob as v2 ele não tem. A diferença observável é que,
// nas velhas, um caminho SEM concessão própria continua gravável por herança. Então a
// sonda tenta escrever num caminho que as regras v2 negam (`rulesProbe/v1`) e trata o
// sucesso como prova de regra velha.
//
// Provar isso pelo DELETE de `/users/{uid}` seria destrutivo justamente no caso que a
// sonda existe para detectar: com regra velha o DELETE passaria e apagaria a árvore
// inteira do usuário. A sonda nunca apaga dado de verdade: ela escreve e remove apenas
// os próprios nós de teste.
const PROBE_V2 = 'rulesProbe/v2';
const PROBE_V1 = 'rulesProbe/v1';

function falha(motivo) { return { ok: false, motivo }; }

async function limpar(client, caminho) {
  try { await client.del(caminho); } catch { /* nó de sonda que não sai agora não atrapalha nada */ }
}

async function sondarRegras(client, uid, deviceId) {
  if (!client || !uid || !deviceId) return falha('indisponivel');
  const meu = `/users/${uid}/${PROBE_V2}/${deviceId}`;
  const semConcessao = `/users/${uid}/${PROBE_V1}/${deviceId}`;
  try {
    // 1. o nó da sonda v2 TEM concessão nas regras novas: se ele não grava, o problema é
    //    de rede ou de token, e nada pode ser concluído sobre a versão da regra
    const w = await client.put(meu, { at: Date.now(), v: 2 });
    if (!w.ok) return falha('indisponivel');
    // 2. este outro NÃO tem concessão nenhuma nas regras novas. Gravar aqui só é possível
    //    com a herança da raiz, que só existe nas regras velhas.
    const heranca = await client.put(semConcessao, { at: Date.now(), v: 1 });
    await limpar(client, meu);
    if (heranca && heranca.ok) {
      await limpar(client, semConcessao);
      return falha('regra-velha');
    }
    return { ok: true, versao: 2 };
  } catch {
    // rede fora, token vencido ou resposta ilegível: não dá para concluir nada sobre a
    // versão da regra, e concluir "v2" aqui liberaria escrita de conteúdo cifrado
    return falha('indisponivel');
  }
}

export default { sondarRegras };
export { sondarRegras };
