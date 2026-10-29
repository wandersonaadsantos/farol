namespace Farol.Contrato;

/// <summary>O que a composição faz depois de cada sinal da prova do pareamento.</summary>
public enum ProofStep
{
    /// <summary>Nada: a prova já terminou, ou o sinal não muda nada.</summary>
    None,

    /// <summary>O motor aceitou o token: manda <c>Paired</c> à máquina.</summary>
    Proven,

    /// <summary>O token guardado foi recusado: pareia com o código do <c>casca.json</c>.</summary>
    PairWithCode,

    /// <summary>Sem prova: manda <c>PairFailed</c> à máquina.</summary>
    Failed,
}

/// <summary>
/// Quando o token de um pareamento conta como aceito. Só o motor que responde prova isso: o
/// primeiro retrato <c>casca</c> de um fluxo SSE novo (o motor o manda logo depois de conectar).
/// Mandar <c>Paired</c> antes zeraria as falhas seguidas da máquina, e um motor que grava o
/// <c>casca.json</c> e cai em seguida seria religado para sempre. A recusa do token guardado
/// gasta o código uma vez; recusa de token novo, prazo esgotado ou abandono encerram. Não
/// decide fase nenhuma: diz à composição QUANDO mandar a entrada à máquina.
/// </summary>
public sealed class PairingProof
{
    /// <summary>Quanto a casca espera a prova antes de desistir (motor de pé que não responde).</summary>
    public static readonly TimeSpan Timeout = TimeSpan.FromSeconds(15);

    private bool _canRetry;

    /// <param name="tokenFromStore">O token veio do cofre (e não de um pareamento agora).</param>
    public PairingProof(bool tokenFromStore)
    {
        _canRetry = tokenFromStore;
    }

    /// <summary>A prova terminou (aceita, falha ou abandonada).</summary>
    public bool Settled { get; private set; }

    /// <summary>O primeiro retrato <c>casca</c> do fluxo novo.</summary>
    public ProofStep OnShell() => Settle(ProofStep.Proven);

    /// <summary>O fluxo novo recebeu 401.</summary>
    public ProofStep OnUnauthorized()
    {
        if (Settled)
        {
            return ProofStep.None;
        }
        if (_canRetry)
        {
            _canRetry = false;
            return ProofStep.PairWithCode;
        }
        return Settle(ProofStep.Failed);
    }

    /// <summary>O código trocou por um token novo; a prova recomeça com ele, sem nova chance.</summary>
    public void OnPairedWithCode() => _canRetry = false;

    /// <summary>O prazo de <see cref="Timeout"/> passou sem resposta.</summary>
    public ProofStep OnTimeout() => Settle(ProofStep.Failed);

    /// <summary>O motor saiu ou outro pareamento começou: esta prova não vale mais nada.</summary>
    public void Abandon() => Settled = true;

    private ProofStep Settle(ProofStep step)
    {
        if (Settled)
        {
            return ProofStep.None;
        }
        Settled = true;
        return step;
    }
}
