using Farol.Contrato;
using Microsoft.Web.WebView2.Core;

namespace Farol.App;

/// <summary>
/// Pergunta ao sistema pelo WebView2 Runtime. Sem o runtime Evergreen instalado, a chamada
/// lança <c>WebView2RuntimeNotFoundException</c>; qualquer exceção vira <c>null</c> (ausente).
/// </summary>
internal sealed class WebView2Check : IWebView2Check
{
    public string? AvailableBrowserVersion()
    {
        try
        {
            return CoreWebView2Environment.GetAvailableBrowserVersionString();
        }
        catch (Exception)
        {
            return null;
        }
    }
}
