using System.Runtime.InteropServices;
using Farol.Contrato;

namespace Farol.App;

/// <summary>
/// O badge da janela na barra de tarefas: a bolinha vermelha de <see cref="OverlayDot"/> pelo
/// <c>ITaskbarList3.SetOverlayIcon</c>, com o rótulo de <see cref="OverlayLabel.For"/> como
/// descrição de acessibilidade, igual ao <c>setOverlayIcon</c> do Electron. Contador zero limpa.
/// </summary>
/// <remarks>
/// Usar na thread da interface (STA), a mesma da janela. O overlay só pega depois que o botão
/// da janela existe na barra (a janela já foi ativada uma vez); antes disso a chamada falha
/// calada e o próximo evento <c>casca</c> aplica de novo. Badge é cosmético: falha nunca lança.
/// </remarks>
internal sealed class TaskbarOverlay : IDisposable
{
    private static readonly Guid TaskbarListClsid = new("56FDF344-FD6D-11d0-958A-006097C9A090");

    private readonly Action<string>? _log;
    private ITaskbarList3? _taskbar;
    private bool _initFailed;
    private IntPtr _dot;
    private bool _warned;

    public TaskbarOverlay(Action<string>? log = null)
    {
        _log = log;
    }

    public void Apply(IntPtr hwnd, ShellEvent.Shell state)
    {
        if (hwnd == IntPtr.Zero || !OperatingSystem.IsWindowsVersionAtLeast(6, 1))
        {
            return;
        }
        var taskbar = Taskbar();
        if (taskbar is null)
        {
            return;
        }
        var label = OverlayLabel.For(state);
        var icon = label.Length == 0 ? IntPtr.Zero : Dot();
        var hr = taskbar.SetOverlayIcon(hwnd, icon, label);
        if (hr < 0 && !_warned)
        {
            // Uma linha só: o botão pode ainda não existir, e o próximo evento tenta de novo.
            _warned = true;
            _log?.Invoke($"WARN barra de tarefas: overlay recusado (0x{hr:X8})");
        }
        else if (hr >= 0)
        {
            _warned = false;
        }
    }

    public void Dispose()
    {
        if (_dot != IntPtr.Zero)
        {
            DestroyIcon(_dot);
            _dot = IntPtr.Zero;
        }
        if (_taskbar is not null)
        {
            Marshal.ReleaseComObject(_taskbar);
            _taskbar = null;
        }
    }

    // Criado uma vez, com HrInit uma vez; se falhar, não tenta de novo a cada evento.
    private ITaskbarList3? Taskbar()
    {
        if (_taskbar is not null || _initFailed)
        {
            return _taskbar;
        }
        try
        {
            var type = Type.GetTypeFromCLSID(TaskbarListClsid, throwOnError: true)!;
            var taskbar = (ITaskbarList3)Activator.CreateInstance(type)!;
            var hr = taskbar.HrInit();
            if (hr < 0)
            {
                Marshal.ReleaseComObject(taskbar);
                throw new COMException("HrInit falhou", hr);
            }
            _taskbar = taskbar;
        }
        catch (Exception e)
        {
            _initFailed = true;
            _log?.Invoke($"WARN barra de tarefas: ITaskbarList3 indisponível ({e.GetType().Name})");
        }
        return _taskbar;
    }

    // A bolinha vira um HICON de 16x16 com alfa: bitmap de cor de 32 bits (DIB de cima para
    // baixo) e máscara monocromática zerada, que o sistema ignora quando o alfa existe.
    private IntPtr Dot()
    {
        if (_dot != IntPtr.Zero)
        {
            return _dot;
        }
        var size = OverlayDot.Size;
        var header = new BitmapInfoHeader
        {
            biSize = (uint)Marshal.SizeOf<BitmapInfoHeader>(),
            biWidth = size,
            biHeight = -size,
            biPlanes = 1,
            biBitCount = 32,
            biCompression = BiRgb,
        };
        var color = CreateDIBSection(IntPtr.Zero, ref header, DibRgbColors, out var bits, IntPtr.Zero, 0);
        if (color == IntPtr.Zero || bits == IntPtr.Zero)
        {
            if (color != IntPtr.Zero)
            {
                DeleteObject(color);
            }
            return IntPtr.Zero;
        }
        var pixels = OverlayDot.Pixels();
        var raw = new int[pixels.Length];
        Buffer.BlockCopy(pixels, 0, raw, 0, pixels.Length * sizeof(uint));
        Marshal.Copy(raw, 0, bits, raw.Length);

        // Cada linha da máscara de 1 bit é alinhada em 16 bits: 2 bytes por linha de 16 pixels.
        var mask = CreateBitmap(size, size, 1, 1, new byte[size * 2]);
        try
        {
            var info = new IconInfo { fIcon = true, hbmMask = mask, hbmColor = color };
            _dot = CreateIconIndirect(ref info);
        }
        finally
        {
            // O ícone guarda cópias dos dois bitmaps.
            DeleteObject(color);
            if (mask != IntPtr.Zero)
            {
                DeleteObject(mask);
            }
        }
        return _dot;
    }

    private const uint BiRgb = 0;
    private const uint DibRgbColors = 0;

    // A ordem dos métodos é a da vtable (shobjidl_core.h): ITaskbarList, ITaskbarList2 e
    // ITaskbarList3. Os que o Farol não usa estão aqui só para manter o lugar do SetOverlayIcon.
    [ComImport]
    [Guid("ea1afb91-9e28-4b86-90e9-9e9f8a5eefaf")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface ITaskbarList3
    {
        // ITaskbarList
        [PreserveSig]
        int HrInit();

        [PreserveSig]
        int AddTab(IntPtr hwnd);

        [PreserveSig]
        int DeleteTab(IntPtr hwnd);

        [PreserveSig]
        int ActivateTab(IntPtr hwnd);

        [PreserveSig]
        int SetActiveAlt(IntPtr hwnd);

        // ITaskbarList2
        [PreserveSig]
        int MarkFullscreenWindow(IntPtr hwnd, [MarshalAs(UnmanagedType.Bool)] bool fullscreen);

        // ITaskbarList3
        [PreserveSig]
        int SetProgressValue(IntPtr hwnd, ulong completed, ulong total);

        [PreserveSig]
        int SetProgressState(IntPtr hwnd, int flags);

        [PreserveSig]
        int RegisterTab(IntPtr hwndTab, IntPtr hwndMdi);

        [PreserveSig]
        int UnregisterTab(IntPtr hwndTab);

        [PreserveSig]
        int SetTabOrder(IntPtr hwndTab, IntPtr hwndInsertBefore);

        [PreserveSig]
        int SetTabActive(IntPtr hwndTab, IntPtr hwndMdi, uint reserved);

        [PreserveSig]
        int ThumbBarAddButtons(IntPtr hwnd, uint count, IntPtr buttons);

        [PreserveSig]
        int ThumbBarUpdateButtons(IntPtr hwnd, uint count, IntPtr buttons);

        [PreserveSig]
        int ThumbBarSetImageList(IntPtr hwnd, IntPtr imageList);

        [PreserveSig]
        int SetOverlayIcon(IntPtr hwnd, IntPtr icon, [MarshalAs(UnmanagedType.LPWStr)] string? description);

        [PreserveSig]
        int SetThumbnailTooltip(IntPtr hwnd, [MarshalAs(UnmanagedType.LPWStr)] string? tip);

        [PreserveSig]
        int SetThumbnailClip(IntPtr hwnd, IntPtr clip);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct BitmapInfoHeader
    {
        public uint biSize;
        public int biWidth;
        public int biHeight;
        public ushort biPlanes;
        public ushort biBitCount;
        public uint biCompression;
        public uint biSizeImage;
        public int biXPelsPerMeter;
        public int biYPelsPerMeter;
        public uint biClrUsed;
        public uint biClrImportant;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IconInfo
    {
        [MarshalAs(UnmanagedType.Bool)]
        public bool fIcon;

        public uint xHotspot;
        public uint yHotspot;
        public IntPtr hbmMask;
        public IntPtr hbmColor;
    }

    // BITMAPINFO com só o cabeçalho: em BI_RGB de 32 bits não há tabela de cores.
    [DllImport("gdi32.dll", SetLastError = true)]
    private static extern IntPtr CreateDIBSection(IntPtr hdc, ref BitmapInfoHeader info, uint usage,
        out IntPtr bits, IntPtr section, uint offset);

    [DllImport("gdi32.dll", SetLastError = true)]
    private static extern IntPtr CreateBitmap(int width, int height, uint planes, uint bitCount, byte[] bits);

    [DllImport("gdi32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DeleteObject(IntPtr obj);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr CreateIconIndirect(ref IconInfo info);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DestroyIcon(IntPtr icon);
}
