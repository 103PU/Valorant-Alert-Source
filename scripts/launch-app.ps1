param(
    [Parameter(Mandatory = $true)]
    [string] $CommandLine
)

$code = @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

public class AppLauncher2 {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct STARTUPINFO {
        public Int32 cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public Int32 dwX;
        public Int32 dwY;
        public Int32 dwXSize;
        public Int32 dwYSize;
        public Int32 dwXCountChars;
        public Int32 dwYCountChars;
        public Int32 dwFillAttribute;
        public Int32 dwFlags;
        public Int16 wShowWindow;
        public Int16 cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_INFORMATION {
        public IntPtr hProcess;
        public IntPtr hThread;
        public Int32 dwProcessId;
        public Int32 dwThreadId;
    }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CreateProcess(
        string lpApplicationName,
        string lpCommandLine,
        IntPtr lpProcessAttributes,
        IntPtr lpThreadAttributes,
        bool bInheritHandles,
        uint dwCreationFlags,
        IntPtr lpEnvironment,
        string lpCurrentDirectory,
        ref STARTUPINFO lpStartupInfo,
        out PROCESS_INFORMATION lpProcessInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr hObject);

    public const uint DETACHED_PROCESS = 0x00000008;
    public const uint CREATE_NEW_PROCESS_GROUP = 0x00000200;

    public static int Launch(string cmdLine) {
        STARTUPINFO si = new STARTUPINFO();
        si.cb = Marshal.SizeOf(si);
        si.lpDesktop = @"WinSta0\Default";

        PROCESS_INFORMATION pi = new PROCESS_INFORMATION();
        bool success = CreateProcess(null, cmdLine, IntPtr.Zero, IntPtr.Zero, false, DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP, IntPtr.Zero, null, ref si, out pi);
        if (!success) {
            return -Marshal.GetLastWin32Error();
        }
        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);
        return pi.dwProcessId;
    }
}
"@

if (-not ([System.Management.Automation.PSTypeName]'AppLauncher2').Type) {
    Add-Type -TypeDefinition $code
}

[AppLauncher2]::Launch($CommandLine)
