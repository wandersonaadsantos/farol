# Evidência: C2b Grupo de consumo, gestão de aparelho, limpeza protegida e revogação

Plano: `docs/superpowers/plans/2026-09-15-md-c2b-grupo-aparelho-limpeza.md` (escrito nesta execução). Branch `md/c2b`, cortada da ponta de `md/integracao` já com C1a, C0, A5, A1, A4, C0b, C1 e C2a.

## Estado

Implementada e validada localmente. Existe grupo de consumo com identidade sorteada e vínculo por intervalo, publicação assinada do grupo, renomear e aposentar aparelho, limpeza protegida com chave, trava e ato, e revogação com os limites escritos. As regras v2 ganharam cinco nós e duas concessões de remoção, geradas pelo mesmo macro e conferidas byte a byte.

**O que esta entrega NÃO faz, de propósito:**

- **Não ativa teto nenhum.** O teto do grupo é configurado, assinado e exibido, e não entra em caminho de admissão. Um teste publica teto de zero dólar e confere que nada é segurado. Ligar o gate é da C4b, que exige A1, C2, C4 e as duas definições de métrica.
- **Não tem tela.** As seis rotas existem e estão classificadas no inventário da A4; o desenho vem do Claude Design, em tarefa própria.
- **Não encerra sessões de outros aparelhos**, por decisão da spec.
- **Não infere nada.** Aposentadoria é ato explícito, e identidade de grupo não é derivada de credencial.

Com tudo desligado, nada muda: `test/sync-c2b-desligado.test.js` nasceu verde contra o código anterior e continua verde.

## Gate

    npm run check && npm run lint && npm test

| Medida | Antes (`md/integracao`) | `md/c2b` |
|---|---|---|
| arquivos do `check` | 390 | 409 |
| `tests` | 3351 | 3430 |
| `pass` | 3323 | 3402 |
| `fail` | 0 | 0 |
| `skipped` | 28 | 28 |
| lint | sem regressão | sem regressão |

Windows 11, Node v24.15.0. `node tools/sync-rules.js --check`: o arquivo publicado confere com o gerado.

## Critério de aceite x teste

| Critério (7.C2, CT-GRUPO, D2, D-b, D8) | Teste | Estado |
|---|---|---|
| Desligado: nada muda | `sync-c2b-desligado` | comprovado |
| Identidade de grupo explícita, nunca por hash de credencial | `sync-grupo`: varredura do fonte | comprovado |
| Teto inválido não vira zero; Codex é não controlado | `sync-grupo` | comprovado |
| Grupo sem teto e perfil não identificado são estados diferentes | `sync-grupo` | comprovado |
| Rotação de credencial não reinicia a contagem | `sync-vinculo`: revincular ao mesmo grupo | comprovado |
| Mudança de vínculo preserva histórico | `sync-vinculo`: `grupoDoConsumo` por intervalo | comprovado |
| Perfil sem vínculo não herda grupo | `sync-vinculo` | comprovado |
| Grupo publicado assinado, cifrado, com a mesma ordem de recusa | `sync-grupo-remoto` | comprovado |
| Configurado não barra nada | `sync-grupo-remoto`: teto zero | comprovado |
| Publicação concorrente perde no ETag | `sync-grupo-remoto` | comprovado |
| Aposentar é explícito; ausência não infere | `sync-aparelho`, `sync-c2b-desligado` | comprovado |
| Aposentar não apaga dado, não tira chave, não encerra sessão | `sync-aparelho` | comprovado |
| Ligar a chave de limpeza não pede senha (D-b) | `sync-limpeza-chave`, `sync-rules-contrato` | comprovado |
| A chave sozinha não apaga nada | `sync-limpeza-chave` | comprovado |
| Chave fail-closed (ausente, mal assinada, geração velha, admin morto) | `sync-limpeza-chave` | comprovado |
| O clique em apagar pede a senha, ANTES de qualquer gravação | `sync-limpeza-ato` | comprovado |
| Keyring, controle, leases, recibos e rodadas nunca entram | `sync-limpeza-ato` (um `assert` por nó) e `sync-rules-contrato` | comprovado |
| Categoria proibida pedida junto não recusa o pacote | `sync-limpeza-ato` | comprovado |
| Operação viva (aqui ou no conjunto) barra o ato | `sync-limpeza-ato` | comprovado |
| A trava sai sempre, inclusive com falha no meio | `sync-limpeza-ato` | comprovado |
| Limpeza sem prova de senha recente não é publicada (D8) | `sync-limpeza-ato` | comprovado |
| `revokedBefore` abaixo do `auth_time` do ato e só cresce | `sync-revogacao`, `sync-rules-contrato` | comprovado |
| Retirar o consentimento descarta a política em cache | `sync-revogacao` (pelo ato e pela configuração) | comprovado |
| A tela não promete o que a revogação não faz | `sync-revogacao`: varredura do texto | comprovado |
| Regras dos cinco nós novos e das duas remoções | `sync-rules-contrato` (7 casos novos) | comprovado no estático |
| Comportamento das regras novas no servidor | roteiro manual do `firebase/README.md`, itens 14 a 21 | **aguardando validação externa** |

## Contraprovas (restauração byte a byte conferida)

45 mutações por script, todas medidas, mais 1 manual com regeneração.

| Tarefa | Mutação | Falhas |
|---|---|---|
| 2 | id derivado do nome; teto inválido vira zero; Codex entre os controlados; tipo desconhecido vira controlado; sem teto e não identificado viram o mesmo estado; allowlist some | 1, 2, 2, 1, 1, 3 |
| 3 | vincular sobrescreve em vez de fechar o intervalo; `grupoDoConsumo` responde pelo vigente; revincular abre intervalo novo; perfil sem vínculo volta a aparecer; consumo anterior ao vínculo passa a contar; grupo sem forma de id vale | 2, 2, 1, 1, 1, 1 |
| 4 | assinatura conferida depois de decifrar; `aceitarAdmin` deixa de ser exigido; grupo deixa de ser saneado na entrada; frescor deixa de ser exigido; publicar sem ser admin da geração vigente; publicar sem CAS | 2, 1, 1, 1, 2, 1 |
| 5 | a leitura de aparelhos aposenta quem sumiu; aposentado volta a contar como ativo; aposentar apaga o nó; nome vazio apaga o nome; renomear outro renomeia este; desaposentar deixa de ter volta | 2, 1, 2, 1, 1, 1 |
| 6 | alcance vira lista negativa; pedido com proibido recusa o pacote; a trava nunca vence; chave sem assinatura conta como ligada; `enabled` deixa de exigir `true`; `rev` deixa de subir; frescor deixa de contar | 1, 1, 1, 1, 1, 1, 1 |
| 7 | trava gravada antes da senha; remoção sem filtrar pelo alcance; trava não sai na falha; operação viva deixa de barrar; sessão local deixa de contar; chave desligada deixa de barrar; corte gravado sem nada apagado; corte publica o pedido em vez do que saiu | 3, 2, 3, 2, 1, 1, 1, 1 |
| 8 | corte igual ao `auth_time` do ato; corte anda para trás; `auth_time` do JWT deixa de ser lido; consentimento retirado preserva o cache; o resumo promete remover dados; o resumo perde o limite de 1 h | 1, 1, 1, 1, 1, 1 |
| 9 | (manual) tirar a comparação com `auth_time` do `revokedBefore`, **com regeneração** | 1, e só o caso do corte |

**Três contraprovas não provaram nada na primeira rodada, e cada uma virou teste novo:**

1. *Tarefa 4, allowlist do consumidor.* O publicador já saneia, então nenhum nó com campo fora da allowlist chegava ao consumidor. O caso novo monta o nó **à mão**, com a chave do admin, simulando um admin em versão mais nova (ou com defeito).
2. *Tarefa 4, CAS por ETag.* Sem concorrente, a janela entre a leitura e a escrita nunca se abre. O caso novo injeta uma escrita de outro aparelho **entre** as duas, que é exatamente o que o CAS fecha.
3. *Tarefa 6, `enabled` exigindo `true` explícito.* Como o valor é normalizado antes de assinar, um nó DESLIGADO com o campo trocado por um valor truthy continua com assinatura válida. O caso novo usa esse nó, e só ele exercita a exigência.

## Ajustes técnicos em relação ao plano

- **`lib/engine/sync-falha.js` nasceu fora do plano.** `lib/engine/sync.js` bateu no teto de 400 linhas úteis outra vez. Os estados da conexão e o registro de falha saíram para um módulo próprio: os colaboradores passaram a precisar desse vocabulário, e mantê-lo dentro do `sync.js` obrigaria cada módulo novo a importar de quem já importa todos eles (ciclo que o ESM aceita e ninguém consegue seguir depois).
- **`lib/sync/no-assinado.js` e `lib/engine/sync-publicar.js` também nasceram fora do plano**, e a política foi refeita sobre eles sem mudar um teste. O plano mandava "extrair se a duplicação passar de trivial", e passou: a ordem de recusa e o ritual de publicação são a mesma regra de negócio nos dois conteúdos.
- **A remoção acontece no nó PAI da categoria.** Só apareceu ao escrever a regra: o cliente apaga `live/groups` inteiro, e a regra do filho nunca seria consultada, então o banco real recusaria o DELETE. Os dois pais ganharam concessão **só de remoção**, sob as condições da limpeza.
- **`live/deviceStatus` saiu da lista de categorias.** O nó ainda não existe (é da C3), e categoria sem regra de remoção é promessa que não se cumpre. A regra ficou escrita no módulo: categoria nova entra **junto com a regra dela**.
- **O nó `revokedBefore` é um número cru.** O leitor genérico devolve `null` para ele, e um vigente lido como zero deixaria o corte andar para trás. Ele ganhou leitura própria.
- **`rt.cur` passou a existir no runtime** (veio da C2a e foi usado aqui): o material aberto tinha as chaves por geração, mas não qual é a corrente.
- **Retirar o consentimento tem duas portas.** O ato explícito e a tela de configuração. A segunda passou a descartar o cache também, senão a restrição sobreviveria por ter sido retirada pela porta errada.
- **`docs/CONFIGURATION.md` não existe nesta linha de trabalho**, então o passo do plano que mandava documentar lá não se aplica. O conteúdo foi para o `CLAUDE.md` e para o `firebase/README.md`.
- **Line endings:** uma edição por script converteu o `CLAUDE.md` para CRLF e reprovou o teste do índice (ele compara linha a linha). Os arquivos tocados foram normalizados para LF, que é o que o repositório guarda.

## Limites declarados

- **`usageEvents` continua com concessão de escrita ampla**, herdada do v1: a remoção dele não depende da chave de limpeza do lado do servidor. Quem protege esse nó é o cliente, pelas cinco condições do ato. Está escrito no `firebase/README.md`.
- **Ativar o teto é da C4b.** Aqui ele é configurado e exibido.
- **O banco não verifica assinatura**, como na C2a.
- **`REC` depende do emulador e do projeto real.** Sem `auth_time` conferível, a limpeza não é publicada (D8) e a saída é o console do Firebase.

## Pendências desta entrega

| O que falta provar | Onde |
|---|---|
| Comportamento no servidor dos cinco nós novos e das duas remoções | emulador e projeto real, itens 14 a 21 do `firebase/README.md` |
| Publicação das regras v2 já com os nós da C2b | console do Firebase, manual, pelo dono |
