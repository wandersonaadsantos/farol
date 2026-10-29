using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace Farol.Sidecar;

/// <summary>
/// Job Object do Windows com <c>JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE</c> e
/// <c>JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK</c>. Só existe no Windows.
/// </summary>
/// <remarks>
/// O job segura SÓ o node que a casca abriu: com o breakaway silencioso, todo filho que ele
/// abre nasce fora do job. É de propósito: o motor abre terminais visíveis por
/// <c>powershell Start-Process cmd.exe</c>, e dentro do job fechar a casca mataria a sessão
/// interativa do Claude Code que a pessoa tem aberta, o que o Electron não faz hoje.
/// O que isso dá:
/// parada normal sem mudança: <c>taskkill /T /F</c> mata o motor e os filhos headless pela
/// cadeia de pais, e os terminais sobrevivem porque o powershell que os abriu já saiu, como hoje;
/// casca que cai: o sistema fecha o handle do job (é do processo da casca) e o node aberto morre;
/// se esse node era o bootstrap, o motor reexecutado vê o pai sumir (<c>vigiarPai</c>) e sai pelo
/// caminho ordenado, levando os próprios filhos; se era o motor direto, filhos headless podem
/// ficar órfãos (custo aceito).
/// </remarks>
internal sealed class JobObject : IDisposable
{
    private const int JobObjectExtendedLimitInformation = 9;
    private const uint JobObjectLimitKillOnJobClose = 0x2000;
    private const uint JobObjectLimitSilentBreakawayOk = 0x1000;

    private readonly JobHandle _handle;

    private JobObject(JobHandle handle)
    {
        _handle = handle;
    }

    /// <summary>Cria o job já com o limite de matar ao fechar. Falha lança <see cref="Win32Exception"/>.</summary>
    public static JobObject Create()
    {
        if (!OperatingSystem.IsWindows())
        {
            throw new PlatformNotSupportedException("Job Object só existe no Windows.");
        }
        var handle = CreateJobObjectW(IntPtr.Zero, null);
        if (handle.IsInvalid)
        {
            var error = Marshal.GetLastWin32Error();
            handle.Dispose();
            throw new Win32Exception(error);
        }

        var info = new JobObjectExtendedLimitInformationData
        {
            BasicLimitInformation = new JobObjectBasicLimitInformation
            {
                LimitFlags = JobObjectLimitKillOnJobClose | JobObjectLimitSilentBreakawayOk,
            },
        };
        var size = Marshal.SizeOf<JobObjectExtendedLimitInformationData>();
        var buffer = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(info, buffer, fDeleteOld: false);
            if (!SetInformationJobObject(handle, JobObjectExtendedLimitInformation, buffer, (uint)size))
            {
                var error = Marshal.GetLastWin32Error();
                handle.Dispose();
                throw new Win32Exception(error);
            }
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
        return new JobObject(handle);
    }

    /// <summary>Põe o processo no job. Falha lança <see cref="Win32Exception"/>.</summary>
    public void Assign(SafeProcessHandle process)
    {
        if (!AssignProcessToJobObject(_handle, process))
        {
            throw new Win32Exception(Marshal.GetLastWin32Error());
        }
    }

    /// <summary>Fecha o handle do job; com o limite, o que ainda estiver nele morre.</summary>
    public void Dispose() => _handle.Dispose();

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern JobHandle CreateJobObjectW(IntPtr securityAttributes, string? name);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetInformationJobObject(JobHandle job, int infoClass, IntPtr info, uint infoLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AssignProcessToJobObject(JobHandle job, SafeProcessHandle process);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr handle);

    private sealed class JobHandle : SafeHandleZeroOrMinusOneIsInvalid
    {
        public JobHandle()
            : base(ownsHandle: true)
        {
        }

        protected override bool ReleaseHandle() => CloseHandle(handle);
    }

    // Os layouts abaixo seguem winnt.h; campos do tamanho de ponteiro são UIntPtr para o x64.
    [StructLayout(LayoutKind.Sequential)]
    private struct JobObjectBasicLimitInformation
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JobObjectExtendedLimitInformationData
    {
        public JobObjectBasicLimitInformation BasicLimitInformation;
        public IoCounters IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }
}
