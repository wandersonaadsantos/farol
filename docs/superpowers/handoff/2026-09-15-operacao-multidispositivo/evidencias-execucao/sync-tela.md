# Evidência: Sincronização na tela, a parte da trilha C

Branch `md/sync-tela`, da ponta de `md/integracao` (`e9f8183`). Desenho de referência: quadro
"Sincronização (C0, C1)" do canvas do B2. Brief, item 2.4.

## 1. O que passou a existir

| Peça | Onde |
|---|---|
| Interruptores "Compartilhar a visão" e "Distribuir a fila" | `syncTogglesHtml(cfg, sync)` (`ui/pure/sync.js`); distribuir fica travado sem compartilhar e sem coordenar, que é o que o engine exige |
| "pedido, não aplicado aqui" | chip nos dois interruptores quando o engine mantém o efeito desligado (`sync.bloqueioCompartilhamento`) |
| Chave geral desligada zera também compartilhar e distribuir | `syncCfgComGeral`; religar a geral não religa nada sozinho |
| Desligar compartilhar leva distribuir junto | `syncCfgSemCompartilhamento` (pura), usada pela tela |
| Cartão da chave do conjunto | `syncChaveHtml` (`ui/pure/sync-chave.js`): pronta, bloqueada (senha e Desbloquear, com o aviso de que redefinir a senha não abre a chave antiga) e perdida (gerar chave nova com confirmação; o Farol nunca recria sozinho). Cada estado oferece só a ação que cabe |
| Ações da chave | `POST /api/sync/unlock` e `POST /api/sync/new-epoch`, com a senha lida na hora e nunca guardada, e a recusa com o motivo do engine |

## 2. Defeito achado antes de implementar

No celular com o compartilhamento bloqueado, o snapshot mandava à tela a configuração já
zerada pela guarda. A tela salva o objeto de sincronização inteiro, então qualquer salvamento
(renomear o aparelho, por exemplo) devolveria `shared: false` e apagaria o pedido, contornando
a correção da jornada anterior. Agora o snapshot manda a configuração PEDIDA (a mesma que vai
ao disco), e o engine continua aplicando o bloqueio. Teste novo em
`test/local-auth-compartilhamento.test.js`.

## 3. Jornada na instância isolada em modo celular

Porta 47194, `TERMUX_VERSION` simulado, compartilhamento e distribuição pedidos no arquivo.
Sistema, Sincronização: os dois interruptores aparecem marcados, com o chip "pedido, não
aplicado aqui", e o cartão "O que ainda não está valendo" lista a autenticação local. O nome
do aparelho foi trocado pela própria tela: o disco ficou com o nome novo E com os dois pedidos,
e o efeito seguiu bloqueado. Viewport estreito não é validação de Android nem de Termux.

O cartão da chave não aparece nessa instância porque o efeito do compartilhamento está
desligado (`chave: desligada`); os estados bloqueada e perdida estão provados por teste, e a
jornada deles depende de um banco (emulador ou projeto) que não existe nesta máquina.

## 4. Testes, contraprova e gates

- `test/ui-sync-conjunto.test.js` (8): interruptores e dependências, chip do bloqueio, chave
  geral, desligar compartilhar, os três estados da chave, recusa escapada, a seção inteira e a
  fiação da tela.
- Ajustes declarados: `test/ui-pure-sync.test.js` afirmava que nenhum interruptor fica travado
  com a geral ligada; o de distribuir fica, com razão, sem compartilhar. A garantia passou a
  valer para os dois interruptores de que o caso fala. `test/capacidades-indisponiveis.test.js`
  procurava `estado().capacidades)` e a chamada ganhou um argumento depois.
- Contraprova: 13 mutações, 12 reprovaram de primeira; a inerte (campo de senha aparecendo na
  chave pronta) virou asserção, e reprovou na segunda rodada.
- Gates: `npm run check` verde (538 arquivos); `npm run lint` verde depois de desfazer um
  ternário aninhado e dois objetos aninhados; `npm test`, primeira rodada `rc=1` pelo teste
  antigo acima (saída preservada como `suite-sync-rodada1-falhou.txt` no scratchpad da sessão),
  segunda rodada 3967 testes, 3939 aprovados, 28 pulados, 0 falhas, `rc=0`.
