# Diagnóstico remoto de identidade

Em **Radar > Aparelhos**, selecione o executor e clique em **Coletar diagnóstico**.
O aparelho precisa estar conectado, aceitar os comandos do admin e ter a versão 2.73.0
ou posterior. A coleta usa a sincronização existente; não exige SSH nem abre porta no aparelho.

O relatório contém:

- conta pretendida e login que o GitHub autentica com a credencial dessa conta;
- autor e conta presentes na fila, nas sessões ativas, nas pendências e nas retomadas;
- metadados de entrada do boot, capturados antes da recuperação das sessões;
- versão, plataforma, versão do Node e hashes dos arquivos que resolvem a identidade.

A resposta só aparece após o executor responder ao comando assinado. Ela é cifrada,
vinculada ao comando e ao alvo e fica disponível por cinco minutos. Falta de resposta,
parte ausente, identidade não confirmada e divergência são estados distintos de sucesso.

Tokens, senha, configuração completa, conteúdo de arquivos e comandos de shell não fazem
parte do relatório. O recurso não permite executar comandos arbitrários nem administrar
um aparelho que deixou de consentir. Se o executor estiver desligado ou sem rede, o
computador só poderá coletar quando ele voltar a responder.

A primeira atualização ainda precisa chegar ao aparelho. No modo servidor do Android,
a atualização automática espera as sessões terminarem e preserva o estado local. Uma
instalação que não consiga atualizar nem se conectar exige intervenção no aparelho.
