# Farol: grava System.AppUserModel.ID nos atalhos (.lnk).
# Sem isso, a barra de tarefas nao casa a janela (AUMID do app) com o atalho
# e cai no icone embutido no exe (o atomo do Electron). Nao da pra trocar o
# recurso do exe: quebraria a assinatura e o Smart App Control bloquearia.
param(
  [Parameter(Mandatory = $true)][string[]]$ShortcutPath,
  [string]$AppId = 'com.biud.farol'
)
$ErrorActionPreference = 'Stop'

$code = @"
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

namespace FarolSetup {
  [StructLayout(LayoutKind.Sequential, Pack=4)]
  public struct PropertyKey {
    public Guid fmtid; public uint pid;
    public PropertyKey(Guid g, uint p){ fmtid=g; pid=p; }
  }
  [StructLayout(LayoutKind.Explicit)]
  public struct PropVariant {
    [FieldOffset(0)] public ushort vt;
    [FieldOffset(8)] public IntPtr pointerValue;
  }
  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IPropertyStore {
    int GetCount(out uint cProps);
    int GetAt(uint iProp, out PropertyKey pkey);
    int GetValue(ref PropertyKey key, out PropVariant pv);
    int SetValue(ref PropertyKey key, ref PropVariant pv);
    int Commit();
  }
  public static class ShortcutAppId {
    public static void Set(string lnkPath, string appId) {
      Type t = Type.GetTypeFromCLSID(new Guid("00021401-0000-0000-C000-000000000046")); // ShellLink
      object link = Activator.CreateInstance(t);
      try {
        ((IPersistFile)link).Load(lnkPath, 2 /*STGM_READWRITE*/);
        IPropertyStore store = (IPropertyStore)link;
        PropertyKey key = new PropertyKey(new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), 5); // PKEY_AppUserModel_ID
        PropVariant pv = new PropVariant();
        pv.vt = 31; // VT_LPWSTR
        pv.pointerValue = Marshal.StringToCoTaskMemUni(appId);
        try {
          int hr = store.SetValue(ref key, ref pv);
          if (hr != 0) throw new COMException("SetValue falhou", hr);
          hr = store.Commit();
          if (hr != 0) throw new COMException("Commit falhou", hr);
          ((IPersistFile)link).Save(lnkPath, true);
        } finally { Marshal.FreeCoTaskMem(pv.pointerValue); }
      } finally { Marshal.ReleaseComObject(link); }
    }
  }
}
"@
Add-Type -TypeDefinition $code

foreach ($lnk in $ShortcutPath) {
  if (-not (Test-Path $lnk)) { continue }
  [FarolSetup.ShortcutAppId]::Set($lnk, $AppId)
  Write-Host "  ok  AUMID '$AppId' gravado em $lnk"
}
