# C6, comandos remotos (plano)

**Objetivo:** o admin manda quatro comandos para um aparelho do conjunto (cancelar,
repetir, decidir e postar, iniciar aqui) e designa outro admin, com idempotência por
identificador, recibo de desfecho e revalidação no destino.

**Spec:** 7.C6 e o campo "Comandos (esboço)" do anexo S3, com CT-FIO e CT-POST.

## Regras que mandam

1. **Comando NUNCA vira `pr.manual` nem `requested`** (CT-FIO). Ele carrega origem
   própria, `comando`, que não atravessa saída de cena, gate de consciência, checks
   obrigatórios nem override de coordenação. Um teste lê o fonte e proíbe.
2. **Quatro condições para aplicar:** consentimento local (`aceitarAdmin`), assinatura da
   geração vigente, geração corrente e autoridade fresca. Sem as quatro, ignora e o
   recibo diz por quê.
3. **Assinatura não é permissão:** o banco não verifica criptografia. A regra impõe forma,
   geração e janela; quem recusa é o cliente que lê.
4. **Sucesso só existe com recibo do executor.** O emissor nunca marca sucesso sozinho.
5. **Executor offline:** o comando fica pendente até o TTL e, ao voltar, revalida estado,
   head e posse antes de agir.
6. **Decidir e postar** vai obrigatoriamente ao aparelho DONO da pendência (payload,
   motivo e retry moram nele) e passa pelo funil de CT-POST.
7. **Designar admin** exige a senha digitada NO DESTINO: o comando só acende o pedido na
   tela de lá; quem promove é o `syncTornarAdmin` local.

## Nós e forma

- `live/commands/{cmdId}`: `{ v: 1, generation, alvo, ttl, enc, sig }`. `alvo` e `ttl` em
  claro (a regra precisa deles); tipo e argumentos vão cifrados. `cmdId` = 32 hex.
- `commandReceipts/{cmdId}`: `{ dev, estado, code, at }` com estado em
  `aplicado|recusado|ignorado|pendente`.
- Regras: escrita do comando com `@GEN@` e `@ENC(2048)@`; remoção só depois do TTL ou pela
  limpeza; recibo escrito pelo alvo, imutável depois de gravado (estado final não muda).

## Tarefas previstas

1. Puro `lib/sync/comando.js`: forma, saneamento, `podeAplicar` (as quatro condições mais
   TTL), `recibo`, e a proibição de `manual`/`requested` na conversão para PR.
2. Regras: `live/commands` e `commandReceipts` no gabarito, com os itens 40 e 41 do
   `firebase/README.md`, e as duas categorias na limpeza.
3. Engine `lib/engine/sync-comandos.js`: emitir (admin), ler e aplicar no relógio,
   idempotência durável (`state/sync-comandos.json`), recibos e revalidação.
4. Os quatro tipos, cada um reusando o caminho local existente: `cancelSession`,
   `enfileirarDaDistribuicao`/`enqueueHeadless` com origem `comando`, `decide` e a
   admissão por lease.
5. Designação de admin: pedido visível e `syncTornarAdmin` com senha local.
6. Docs, evidência, EXECUCAO.

## Contraprovas previstas

Idempotência removida (efeito repetido); TTL ignorado; head antigo aceito; consentimento
ignorado; assinatura de outra geração aceita; recibo antes do efeito; comando marcando
`manual` (teste de fonte); decidir roteado para aparelho que não é dono.
