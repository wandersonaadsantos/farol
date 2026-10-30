namespace Farol.Contrato;

/// <summary>
/// A vigia do visor: enquanto a casca só mostra a tela de outro Farol (um Electron, ou um
/// <c>node server.js</c> na mesma porta), a composição pergunta a cada <see cref="Interval"/> se
/// ele ainda responde. Duas faltas seguidas dizem que ele saiu, uma vez só; uma resposta no meio
/// recomeça a contagem (uma sonda perdida não derruba o visor). Sem relógio e sem rede: quem
/// sonda é a composição.
/// </summary>
public sealed class ViewerWatch
{
    /// <summary>De quanto em quanto tempo o visor confere o outro Farol.</summary>
    public static readonly TimeSpan Interval = TimeSpan.FromSeconds(5);

    /// <summary>Quantas faltas seguidas contam como "o outro Farol saiu".</summary>
    public const int MissesToLose = 2;

    private int _misses;
    private bool _lost;

    /// <summary>
    /// Registra uma sonda. Devolve <c>true</c> só na primeira vez em que as faltas seguidas
    /// chegam a <see cref="MissesToLose"/>.
    /// </summary>
    public bool OnProbe(bool farolAnswered)
    {
        if (_lost)
        {
            return false;
        }
        _misses = farolAnswered ? 0 : _misses + 1;
        _lost = _misses >= MissesToLose;
        return _lost;
    }
}
