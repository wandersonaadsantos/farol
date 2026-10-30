namespace Farol.Contrato;

/// <summary>
/// A saída do motor que a própria casca pediu (a parada antes do reinício do update). O código
/// dessa saída chega pelo mesmo canal de qualquer outra e depois de mais saltos pela fila da
/// interface do que a continuação do <c>StopAsync</c>; sem o filtro, ele podia cair na máquina
/// nova criada quando o sistema recusa o reinício e ser lido como queda do motor novo.
/// </summary>
/// <remarks>
/// Puro e de uso na thread da interface. Marca uma saída só: quem para o motor chama
/// <see cref="Expect"/> antes de pedir a parada, o <c>Feed</c> descarta a primeira saída que vier
/// (<see cref="TryConsume"/>), e as seguintes, que são quedas de verdade, passam. Se a saída
/// esperada não chegar no prazo, <see cref="Clear"/> desiste dela, para não engolir uma queda real
/// mais tarde.
/// </remarks>
public sealed class OwnExitFilter
{
    private bool _expecting;

    /// <summary>Há uma saída pedida pela casca ainda por chegar.</summary>
    public bool Expecting => _expecting;

    /// <summary>A próxima saída do motor é pedida pela casca e não vai à máquina.</summary>
    public void Expect() => _expecting = true;

    /// <summary>
    /// Chamado a cada saída: <c>true</c> quando é a saída pedida (descartar), uma vez só.
    /// </summary>
    public bool TryConsume()
    {
        if (!_expecting)
        {
            return false;
        }
        _expecting = false;
        return true;
    }

    /// <summary>Desiste da saída pedida que não chegou.</summary>
    public void Clear() => _expecting = false;
}
