param([Parameter(Mandatory=$true)][long]$Handle)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class WindowIdentityProbe {
 [StructLayout(LayoutKind.Sequential)] public struct Key { public Guid id; public uint pid; }
 [StructLayout(LayoutKind.Explicit, Size=24)] public struct Value { [FieldOffset(0)] public ushort type; [FieldOffset(8)] public IntPtr str; }
 [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
 public interface Store { void GetCount(out uint count); void GetAt(uint index,out Key key); void GetValue(ref Key key,out Value value); void SetValue(ref Key key,ref Value value); void Commit(); }
 [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr hwnd,ref Guid iid,out Store store);
 [DllImport("ole32.dll")] static extern int PropVariantClear(ref Value value);
 public static string Read(long hwnd,uint pid) {
  var iid=typeof(Store).GUID; Store store;
  Marshal.ThrowExceptionForHR(SHGetPropertyStoreForWindow(new IntPtr(hwnd),ref iid,out store));
  var key=new Key{id=new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"),pid=pid}; Value value;
  store.GetValue(ref key,out value);
  try { return value.type==31?Marshal.PtrToStringUni(value.str):null; }
  finally { PropVariantClear(ref value); Marshal.ReleaseComObject(store); }
 }
}
'@
@{
 appId = [WindowIdentityProbe]::Read($Handle,5)
 icon = [WindowIdentityProbe]::Read($Handle,3)
 command = [WindowIdentityProbe]::Read($Handle,2)
 name = [WindowIdentityProbe]::Read($Handle,4)
} | ConvertTo-Json -Compress
