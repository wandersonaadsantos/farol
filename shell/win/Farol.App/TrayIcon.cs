using System.ComponentModel;
using System.Runtime.InteropServices;

namespace Farol.App;

/// <summary>
/// O ícone do Farol na bandeja, direto pelo <c>Shell_NotifyIconW</c>, sem pacote de terceiros.
/// Clique esquerdo (ou Enter no ícone) dispara <see cref="Open"/>; clique direito abre o menu
/// "Abrir", "Checar agora", separador, "Sair".
/// </summary>
/// <remarks>
/// Tem de ser criado, usado e descartado na thread que bombeia mensagens do Win32: a thread
/// principal do WinUI faz isso. A janela oculta que recebe os cliques é dessa thread, e os
/// eventos saem nela.
/// A janela é de nível superior e nunca é mostrada, e NÃO filha de <c>HWND_MESSAGE</c>: janela
/// só de mensagens não recebe mensagem difundida, e o <c>TaskbarCreated</c> (o Explorer que
/// reinicia e esquece os ícones da bandeja) chega por difusão.
/// </remarks>
internal sealed class TrayIcon : IDisposable
{
    private const uint IconId = 1;
    private const uint CallbackMessage = WmApp + 1;

    private const int CommandOpen = 1;
    private const int CommandCheckNow = 2;
    private const int CommandQuit = 3;

    private readonly string _className = "FarolTrayWindow." + Guid.NewGuid().ToString("N");
    private readonly Action<string>? _log;

    // O delegate do WndProc mora num campo: o sistema guarda só o ponteiro, e sem a referência
    // o coletor de lixo o recolheria com a janela ainda viva.
    private readonly WndProcDelegate _wndProc;
    private readonly IntPtr _hInstance;
    private readonly uint _taskbarCreated;
    private IntPtr _hwnd;
    private IntPtr _icon;
    private string _tooltip = "Farol";
    private bool _version4;
    private bool _added;
    private bool _disposed;

    /// <param name="iconPath">Caminho do <c>.ico</c> (o <c>Assets\farol.ico</c> ao lado do executável).</param>
    /// <param name="log">Linha de falha para o log; nunca recebe segredo.</param>
    public TrayIcon(string iconPath, Action<string>? log = null)
    {
        _log = log;
        _wndProc = WndProc;
        _hInstance = GetModuleHandleW(null);

        var wc = new WndClassExW
        {
            cbSize = (uint)Marshal.SizeOf<WndClassExW>(),
            lpfnWndProc = Marshal.GetFunctionPointerForDelegate(_wndProc),
            hInstance = _hInstance,
            lpszClassName = _className,
        };
        if (RegisterClassExW(ref wc) == 0)
        {
            throw new Win32Exception(Marshal.GetLastWin32Error());
        }

        _hwnd = CreateWindowExW(WsExToolWindow, _className, "Farol", WsPopup, 0, 0, 0, 0,
            IntPtr.Zero, IntPtr.Zero, _hInstance, IntPtr.Zero);
        if (_hwnd == IntPtr.Zero)
        {
            var error = Marshal.GetLastWin32Error();
            UnregisterClassW(_className, _hInstance);
            throw new Win32Exception(error);
        }

        _taskbarCreated = RegisterWindowMessageW("TaskbarCreated");

        // Tamanho do ícone pequeno do sistema (16 px a 100%): o LoadImageW escolhe no .ico a
        // imagem mais próxima. Falha aqui não impede a bandeja: o ícone fica vazio e vai ao log.
        _icon = LoadImageW(IntPtr.Zero, iconPath, ImageIcon,
            GetSystemMetrics(SmCxSmIcon), GetSystemMetrics(SmCySmIcon), LrLoadFromFile);
        if (_icon == IntPtr.Zero)
        {
            _log?.Invoke($"WARN bandeja: ícone não carregou (erro {Marshal.GetLastWin32Error()})");
        }

        Add();
    }

    /// <summary>Clique esquerdo no ícone, Enter nele, ou "Abrir" no menu.</summary>
    public event Action? Open;

    /// <summary>"Checar agora" no menu (quem escuta faz o POST <c>/api/check</c>).</summary>
    public event Action? CheckNow;

    /// <summary>"Sair" no menu.</summary>
    public event Action? Quit;

    /// <summary>Troca o texto do tooltip; mais de 127 caracteres é cortado (o limite do <c>szTip</c>).</summary>
    public void SetTooltip(string text)
    {
        _tooltip = Truncate(text ?? "", 127);
        if (_disposed || !_added)
        {
            return;
        }
        var data = NewData(NifTip | NifShowTip);
        if (!Shell_NotifyIconW(NimModify, ref data))
        {
            _log?.Invoke("WARN bandeja: tooltip não foi atualizado");
        }
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }
        _disposed = true;
        if (_added)
        {
            var data = NewData(0);
            Shell_NotifyIconW(NimDelete, ref data);
            _added = false;
        }
        if (_hwnd != IntPtr.Zero)
        {
            DestroyWindow(_hwnd);
            _hwnd = IntPtr.Zero;
        }
        UnregisterClassW(_className, _hInstance);
        if (_icon != IntPtr.Zero)
        {
            DestroyIcon(_icon);
            _icon = IntPtr.Zero;
        }
    }

    // NIM_ADD e depois NIM_SETVERSION 4. Também roda de novo no TaskbarCreated.
    private void Add()
    {
        var data = NewData(NifMessage | NifIcon | NifTip | NifShowTip);
        _added = Shell_NotifyIconW(NimAdd, ref data);
        if (!_added)
        {
            // Explorer ainda não pronto (sessão recém aberta): o TaskbarCreated traz outra chance.
            _log?.Invoke("WARN bandeja: o ícone não entrou na área de notificação");
            return;
        }
        var version = NewData(0);
        version.uVersionOrTimeout = NotifyIconVersion4;
        _version4 = Shell_NotifyIconW(NimSetVersion, ref version);
    }

    private NotifyIconDataW NewData(uint flags) => new()
    {
        cbSize = (uint)Marshal.SizeOf<NotifyIconDataW>(),
        hWnd = _hwnd,
        uID = IconId,
        uFlags = flags,
        uCallbackMessage = CallbackMessage,
        hIcon = _icon,
        szTip = _tooltip,
        szInfo = "",
        szInfoTitle = "",
    };

    private IntPtr WndProc(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam)
    {
        try
        {
            if (msg == CallbackMessage)
            {
                OnTrayMessage(wParam, lParam);
                return IntPtr.Zero;
            }
            if (_taskbarCreated != 0 && msg == _taskbarCreated && !_disposed)
            {
                Add();
                return IntPtr.Zero;
            }
        }
        catch (Exception e)
        {
            // Exceção que atravessa o WndProc derruba o processo: vira linha de log.
            _log?.Invoke($"WARN bandeja: falha ao tratar o clique ({e.GetType().Name})");
            return IntPtr.Zero;
        }
        return DefWindowProcW(hwnd, msg, wParam, lParam);
    }

    // Na versão 4 o evento vem no LOWORD do lParam e o ponto de ancoragem no wParam. O sistema
    // manda também os WM_*BUTTON*, então só NIN_SELECT/NIN_KEYSELECT e WM_CONTEXTMENU contam,
    // senão o menu abriria duas vezes. Sem a versão 4 (o NIM_SETVERSION falhou), o lParam é a
    // própria mensagem do mouse.
    private void OnTrayMessage(IntPtr wParam, IntPtr lParam)
    {
        var evt = (uint)(lParam.ToInt64() & 0xFFFF);
        if (_version4)
        {
            switch (evt)
            {
                case NinSelect or NinKeySelect:
                    Open?.Invoke();
                    return;
                case WmContextMenu:
                    var x = (short)(wParam.ToInt64() & 0xFFFF);
                    var y = (short)((wParam.ToInt64() >> 16) & 0xFFFF);
                    ShowMenu(x, y);
                    return;
            }
            return;
        }

        switch (evt)
        {
            case WmLButtonUp:
                Open?.Invoke();
                return;
            case WmRButtonUp:
                GetCursorPos(out var point);
                ShowMenu(point.X, point.Y);
                return;
        }
    }

    private void ShowMenu(int x, int y)
    {
        var menu = CreatePopupMenu();
        if (menu == IntPtr.Zero)
        {
            return;
        }
        try
        {
            AppendMenuW(menu, MfString, (UIntPtr)CommandOpen, "Abrir");
            AppendMenuW(menu, MfString, (UIntPtr)CommandCheckNow, "Checar agora");
            AppendMenuW(menu, MfSeparator, UIntPtr.Zero, null);
            AppendMenuW(menu, MfString, (UIntPtr)CommandQuit, "Sair");

            // Sem trazer a janela para a frente, o menu não fecha ao clicar fora dele; o WM_NULL
            // depois é a outra metade da correção clássica (KB135788).
            SetForegroundWindow(_hwnd);
            var command = TrackPopupMenuEx(menu, TpmReturnCmd | TpmRightButton | TpmBottomAlign,
                x, y, _hwnd, IntPtr.Zero);
            PostMessageW(_hwnd, WmNull, IntPtr.Zero, IntPtr.Zero);

            switch (command)
            {
                case CommandOpen:
                    Open?.Invoke();
                    break;
                case CommandCheckNow:
                    CheckNow?.Invoke();
                    break;
                case CommandQuit:
                    Quit?.Invoke();
                    break;
            }
        }
        finally
        {
            DestroyMenu(menu);
        }
    }

    // Corta sem partir um par substituto (emoji no rótulo viraria lixo no fim).
    private static string Truncate(string text, int max)
    {
        if (text.Length <= max)
        {
            return text;
        }
        var cut = char.IsHighSurrogate(text[max - 1]) ? max - 1 : max;
        return text[..cut];
    }

    private const uint WmNull = 0x0000;
    private const uint WmContextMenu = 0x007B;
    private const uint WmLButtonUp = 0x0202;
    private const uint WmRButtonUp = 0x0205;
    private const uint WmUser = 0x0400;
    private const uint WmApp = 0x8000;
    private const uint NinSelect = WmUser + 0;
    private const uint NinKeySelect = NinSelect | 0x1;

    private const uint NimAdd = 0x0;
    private const uint NimModify = 0x1;
    private const uint NimDelete = 0x2;
    private const uint NimSetVersion = 0x4;
    private const uint NifMessage = 0x01;
    private const uint NifIcon = 0x02;
    private const uint NifTip = 0x04;
    private const uint NifShowTip = 0x80;
    private const uint NotifyIconVersion4 = 4;

    private const uint MfString = 0x0000;
    private const uint MfSeparator = 0x0800;
    private const uint TpmRightButton = 0x0002;
    private const uint TpmBottomAlign = 0x0020;
    private const uint TpmReturnCmd = 0x0100;

    private const uint ImageIcon = 1;
    private const uint LrLoadFromFile = 0x0010;
    private const int SmCxSmIcon = 49;
    private const int SmCySmIcon = 50;

    private const uint WsPopup = 0x80000000;
    private const uint WsExToolWindow = 0x00000080;

    private delegate IntPtr WndProcDelegate(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);

    // Layout de shellapi.h com _WIN32_IE >= 0x600 (Vista em diante): 976 bytes no x64. O
    // marshaller alinha hWnd, hIcon e hBalloonIcon em 8; os textos são buffers fixos de WCHAR.
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NotifyIconDataW
    {
        public uint cbSize;
        public IntPtr hWnd;
        public uint uID;
        public uint uFlags;
        public uint uCallbackMessage;
        public IntPtr hIcon;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string szTip;

        public uint dwState;
        public uint dwStateMask;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)]
        public string szInfo;

        // A união uTimeout/uVersion: os dois são UINT no mesmo lugar.
        public uint uVersionOrTimeout;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)]
        public string szInfoTitle;

        public uint dwInfoFlags;
        public Guid guidItem;
        public IntPtr hBalloonIcon;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WndClassExW
    {
        public uint cbSize;
        public uint style;
        public IntPtr lpfnWndProc;
        public int cbClsExtra;
        public int cbWndExtra;
        public IntPtr hInstance;
        public IntPtr hIcon;
        public IntPtr hCursor;
        public IntPtr hbrBackground;

        [MarshalAs(UnmanagedType.LPWStr)]
        public string? lpszMenuName;

        [MarshalAs(UnmanagedType.LPWStr)]
        public string lpszClassName;

        public IntPtr hIconSm;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Point
    {
        public int X;
        public int Y;
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool Shell_NotifyIconW(uint message, ref NotifyIconDataW data);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr GetModuleHandleW(string? moduleName);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern ushort RegisterClassExW(ref WndClassExW wc);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnregisterClassW(string className, IntPtr hInstance);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateWindowExW(uint exStyle, string className, string windowName, uint style,
        int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr hInstance, IntPtr param);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DestroyWindow(IntPtr hwnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr DefWindowProcW(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint RegisterWindowMessageW(string name);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr LoadImageW(IntPtr hInstance, string name, uint type, int cx, int cy, uint load);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DestroyIcon(IntPtr icon);

    [DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int index);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr CreatePopupMenu();

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AppendMenuW(IntPtr menu, uint flags, UIntPtr id, string? text);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DestroyMenu(IntPtr menu);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetForegroundWindow(IntPtr hwnd);

    // Com TPM_RETURNCMD o retorno é o id do item escolhido, ou 0 quando o menu fecha sem escolha.
    [DllImport("user32.dll", SetLastError = true)]
    private static extern int TrackPopupMenuEx(IntPtr menu, uint flags, int x, int y, IntPtr hwnd, IntPtr tpmParams);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool PostMessageW(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetCursorPos(out Point point);
}
