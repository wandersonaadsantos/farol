namespace Farol.Contrato;

/// <summary>A janela vista pelo clique num aviso; injetável para o teste não precisar de WinUI.</summary>
public interface IWindowPresenter
{
    /// <summary>Mostra a janela (mesmo escondida na bandeja) e traz para a frente.</summary>
    void ShowAndActivate();

    /// <summary>Abre um caminho da interface do motor, como <c>/?pr=o%2Fr%231</c>.</summary>
    Task NavigateAsync(string path);

    /// <summary>Abre o endereço no navegador padrão.</summary>
    void OpenExternal(Uri url);
}

/// <summary>Aplica a ação do clique na janela.</summary>
public static class NoticeDispatcher
{
    /// <summary>
    /// <see cref="NoticeAction.OpenUrl"/> só abre fora; <see cref="NoticeAction.FocusPr"/> mostra
    /// a janela e depois navega para o PR; <see cref="NoticeAction.FocusWindow"/> só mostra.
    /// </summary>
    public static Task ApplyAsync(NoticeAction action, IWindowPresenter presenter)
    {
        ArgumentNullException.ThrowIfNull(action);
        ArgumentNullException.ThrowIfNull(presenter);
        switch (action)
        {
            case NoticeAction.OpenUrl open:
                presenter.OpenExternal(open.Url);
                return Task.CompletedTask;
            case NoticeAction.FocusPr focus:
                presenter.ShowAndActivate();
                return presenter.NavigateAsync(ActionRouter.PrPath(focus.Pr));
            default:
                presenter.ShowAndActivate();
                return Task.CompletedTask;
        }
    }
}
