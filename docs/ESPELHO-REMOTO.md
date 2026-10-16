# Espelho remoto da sessão

Em Radar → Aparelhos, “Ver ao vivo” solicita ao executor a mesma janela de atividade que a sessão local mantém: últimas 120 linhas, texto e descrições das ferramentas, horários, etapas, progresso e agentes. Inclui autoanálises e mantém sessões simultâneas do mesmo PR separadas pelo identificador da operação. Não é uma gravação da área de trabalho nem um histórico ilimitado.

O pedido é renovado a cada 10 segundos enquanto a página está visível. Sem observador, o executor continua publicando apenas o resumo limitado existente. O espelho usa o canal autenticado da sincronização e cifra adicional com chave temporária ECDH exclusiva do observador; credenciais reconhecidas são ocultadas antes da transmissão. Não exige outro serviço nem alteração das regras do banco.

O manifesto só é publicado depois dos fragmentos. O leitor exige todas as partes e confere o hash antes de mostrar a captura. Sinal vencido é identificado como última captura, sem afirmar execução atual. O pedido vence em 35 segundos; fragmentos expiram em 150 segundos e são removidos quando o observador fecha ou a sessão termina. Versões anteriores continuam exibindo o resumo limitado, identificado como tal.

Apenas sessões que o executor publica na sincronização podem ser espelhadas. A revisão executada na Hostinger continua independente do Windows; acompanhar uma sessão do Windows requer que aquele executor esteja ligado.
