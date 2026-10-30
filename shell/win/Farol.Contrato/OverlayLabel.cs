namespace Farol.Contrato;

/// <summary>
/// O texto do badge na barra de tarefas e o tooltip da bandeja, como o <c>updateBadge</c> do
/// Electron: o rótulo vem pronto do motor (<c>casca.badge.rotulo</c>), e só quando ele chega
/// vazio com contador positivo a casca monta o mesmo texto por conta própria.
/// </summary>
public static class OverlayLabel
{
    /// <summary>
    /// Vazio com contador zero ou negativo (mesmo que o rótulo venha preenchido); senão o
    /// rótulo do motor, ou o texto calculado quando ele vem vazio.
    /// </summary>
    public static string For(ShellEvent.Shell state)
    {
        if (state.BadgeCount <= 0)
        {
            return "";
        }
        if (!string.IsNullOrEmpty(state.BadgeLabel))
        {
            return state.BadgeLabel;
        }
        return state.BadgeCount == 1
            ? "1 decisão esperando você"
            : $"{state.BadgeCount} decisões esperando você";
    }

    /// <summary><c>Farol</c> sem rótulo; senão <c>Farol · &lt;rótulo&gt;</c> (ponto médio, como no Electron).</summary>
    public static string Tooltip(ShellEvent.Shell state)
    {
        var label = For(state);
        return label.Length == 0 ? "Farol" : $"Farol · {label}";
    }
}
