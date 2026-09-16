# Evidência: A4, a tela de pareamento e a vigília do stream

Branch `md/a4-tela`, da ponta de `md/integracao` (`285bcad`, com o desenho B2 versão 2).
Desenho de referência: quadros "Pareamento (A4)" e "Celular: pareamento" do canvas
https://claude.ai/artifact/TpikCGQajjhpN8JDZ2K2Q6.

## 1. O que passou a existir

| Peça | Onde |
|---|---|
| Recusa com motivo e tentativas restantes | `tentarCodigo` (`lib/local-auth/pareamento.js`), usado por `POST /api/auth/pair`. `consumirCodigo` continua booleano |
| Tela de pareamento | `pareamentoHtml` e `textoDaRecusa` (`ui/pure/pareamento.js`), `montarPareamento`, `submeterPareamento`, `precisaParear` (`ui/telas/pareamento.js`) |
| Gate do boot | `ui/app.js` pergunta `GET /api/auth/status` antes de conectar; com exigência e sem credencial, a interface inteira vira o pareamento (`body.parear`) e nada do estado é pedido |
| Token guardado com forma conferida | `salvarToken` e `esquecerToken` (`ui/transporte.js`) |
| Volta ao pareamento quando a credencial cai | o stream autenticado avisa `nao-autenticado` no 401, e a página troca pela tela |
| Stream aberto não sobrevive à credencial | `vigiaDoStream` (`lib/local-auth/acesso.js`), conferida antes de cada envio e a cada batimento (`lib/http-server.js`), com memória de `TEMPOS.STREAM_RECONFERENCIA_MS` |

**Recusas que a tela distingue:** código errado com tentativas restantes, bloqueio por
tentativas, e "não há código esperando". Este último junta três casos (vencido, já usado,
inexistente) de propósito: depois que o registro sai do disco, nada os distingue. O desenho
tinha dois estados separados para vencido e usado e foi corrigido para bater com isto.

## 2. Jornada na aplicação real isolada

Instância com `FAROL_HOME` próprio, porta 47196, `autoReview: false`, `localAuth: 'exigir'`,
navegador embutido em 390 px:

1. `GET /api/auth/status` sem token: `{ exigida: true, autenticado: false }`; `/api/state`
   sem token: 401.
2. A página abriu direto no pareamento, com o resto do app escondido (conferido pela classe
   do corpo e por captura de tela). Visual igual ao quadro de celular.
3. Código errado pelo botão: "Código não confere. Restam 4 tentativas antes do bloqueio."
4. **Defeito achado:** o Enter no campo não enviava. Nenhum ouvinte bloqueava a tecla (medido
   com evento sintético); o envio implícito do formulário não acontecia com a tecla mandada.
   Corrigido com um ouvinte de Enter que pede o envio. Reconferido: Enter envia, e a recusa
   aparece junto do campo com "Restam 3 tentativas".
5. **Defeito achado:** a recusa aparecia no passo 1 (onde ficam os comandos), não junto do
   código. Corrigido passando a recusa para o próprio HTML.
6. Código certo com Enter: token de 43 caracteres guardado, rascunho apagado, página
   recarregada no app com o stream autenticado ("monitorando").
7. Servidor reiniciado: a sessão sobreviveu e a página abriu direto no app.
8. `node tools/farol-parear.js --revogar-todas` com a aba aberta: a página voltou ao
   pareamento sozinha em menos de 35 segundos (batimento de 25 s mais a reconexão de 3 s),
   com o aviso de credencial revogada.
9. **Defeito achado:** esse aviso prometia que "o que você estava digitando foi guardado", e
   só o rascunho do próprio pareamento é guardado. A frase foi corrigida no app e no desenho.

## 3. Defeito de segurança achado pela jornada

Antes da vigília, um stream de eventos já aberto continuava recebendo o estado inteiro
depois de a sessão ser revogada: a credencial só era conferida na conexão. "Revogar todas"
não revogava a aba que já estava aberta. Agora o servidor encerra o stream antes do próximo
envio e também no batimento, sem ler o disco a cada envio (memória de 2 segundos).

## 4. Testes

- `test/local-auth-tentativa.test.js` (7): os quatro desfechos, código vencido, o contrato
  booleano preservado e a rota com motivo e contagem.
- `test/ui-pareamento.test.js` (11): textos de recusa, HTML (dois passos, as duas sintaxes do
  comando, sistema de quem olha primeiro, escape), envio aceito e recusado, token com forma
  errada, gate do boot (inclusive servidor mudo, que não pode trancar ninguém fora), rascunho,
  rótulo sugerido e a fiação do bootstrap, do HTML e do CSS.
- `test/ui-transporte.test.js` (+2): `salvarToken`/`esquecerToken` e o aviso só no 401.
- `test/local-auth-stream-revogado.test.js` (5): stream válido recebe, revogação encerra antes
  do próximo envio, o batimento encerra sem envio nenhum, o desktop sem exigência não é
  cortado, e o pareamento segue funcionando.
- Ajuste declarado: `test/local-auth-http.test.js` esperava `{ ok: false, code:
  'codigo_invalido' }` ao reusar um código; agora a recusa diz `sem_codigo_pendente` e leva
  `restantes`. A garantia (código não vale duas vezes) é a mesma.
- `test/ui-pure-superficie.test.js`: nomes novos `pareamentoHtml` e `textoDaRecusa`.

## 5. Contraprova

17 mutações. Na primeira rodada, 12 reprovaram e **5 passaram**, todas por teste fraco:

1. o batimento sem vigília: o caso "sem envio" terminava por um **400** do socket
   reaproveitado do caso anterior, e o teste lia esse fim como o encerramento esperado (falso
   positivo). Corrigido com `agent: false`, status 200 conferido e o tempo mínimo do batimento;
2. o desktop também conferindo: não havia caso de stream sem exigência depois da
   reconferência;
3. e 4. o aviso do 401 e o formato do token só eram "provados" por leitura de fonte;
5. a regra de CSS era casada por um comentário.

Na segunda rodada, as cinco reprovaram. O Enter não tem teste automatizado (o duplo de DOM
não tem eventos); ficou provado na jornada real, item 4.

## 6. Gates

| Gate | Resultado |
|---|---|
| `npm run check` | verde, 531 arquivos `.js` |
| `npm run lint` | verde, sem regressão (a primeira versão tinha ternário aninhado e JSON cru e foi refeita) |
| `npm test` | 3944 testes, 3916 aprovados, 28 pulados, 0 falhas |

## 7. O que continua fora

A exigência automática no celular segue desligada (`ATIVACAO_AUTOMATICA_A4 = false`), agora
com a tela pronta. Falta a validação num Termux real: detecção do modo, navegador do próprio
aparelho e o alcance do loopback. A lista de navegadores pareados com revogação individual
entra com a tela de Aparelhos.
