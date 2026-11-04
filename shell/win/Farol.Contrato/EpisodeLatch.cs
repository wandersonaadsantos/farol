namespace Farol.Contrato;

/// <summary>
/// Uma linha de log por episódio (invariante 3, log só de falhas e sem ruído): a primeira
/// ocorrência entra, as repetidas do mesmo episódio não, e <see cref="End"/> arma de novo. Nasceu
/// do renderizador do WebView2 travado, que avisa de novo a cada poucos segundos enquanto não
/// volta.
/// </summary>
public sealed class EpisodeLatch
{
    private bool _inside;

    /// <summary><c>true</c> só na primeira ocorrência do episódio.</summary>
    public bool TryEnter()
    {
        if (_inside)
        {
            return false;
        }
        _inside = true;
        return true;
    }

    /// <summary>O episódio acabou; a próxima ocorrência é outro episódio.</summary>
    public void End() => _inside = false;
}
