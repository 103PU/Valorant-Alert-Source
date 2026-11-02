param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $CommandArgs
)

$code = @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.IO;
using System.Text;

public class DesktopRunner {
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

    [StructLayout(LayoutKind.Sequential)]
    public struct SECURITY_ATTRIBUTES {
        public int nLength;
        public IntPtr lpSecurityDescriptor;
        public bool bInheritHandle;
    }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CreateProcess(
        string lpApplicationName,
        string lpCommandLine,
        ref SECURITY_ATTRIBUTES lpProcessAttributes,
        ref SECURITY_ATTRIBUTES lpThreadAttributes,
        bool bInheritHandles,
        uint dwCreationFlags,
        IntPtr lpEnvironment,
        string lpCurrentDirectory,
        ref STARTUPINFO lpStartupInfo,
        out PROCESS_INFORMATION lpProcessInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CreatePipe(out IntPtr hReadPipe, out IntPtr hWritePipe, ref SECURITY_ATTRIBUTES lpPipeAttributes, uint nSize);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern UInt32 WaitForSingleObject(IntPtr hHandle, UInt32 dwMilliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr hObject);

    public const int STARTF_USESTDHANDLES = 0x00000100;
    public const uint HANDLE_FLAG_INHERIT = 0x00000001;

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool SetHandleInformation(IntPtr hObject, uint dwMask, uint dwFlags);

    public static string Run(string exePath, string arguments) {
        SECURITY_ATTRIBUTES sa = new SECURITY_ATTRIBUTES();
        sa.nLength = Marshal.SizeOf(sa);
        sa.bInheritHandle = true;
        sa.lpSecurityDescriptor = IntPtr.Zero;

        IntPtr hRead, hWrite;
        if (!CreatePipe(out hRead, out hWrite, ref sa, 0)) {
            return "CreatePipe failed: " + Marshal.GetLastWin32Error();
        }
        SetHandleInformation(hRead, HANDLE_FLAG_INHERIT, 0);

        STARTUPINFO si = new STARTUPINFO();
        si.cb = Marshal.SizeOf(si);
        si.lpDesktop = @"WinSta0\Default";
        si.dwFlags = STARTF_USESTDHANDLES;
        si.hStdOutput = hWrite;
        si.hStdError = hWrite;
        si.hStdInput = IntPtr.Zero;

        PROCESS_INFORMATION pi = new PROCESS_INFORMATION();
        string cmd = "\"" + exePath + "\" " + arguments;

        bool success = CreateProcess(null, cmd, ref sa, ref sa, true, 0, IntPtr.Zero, null, ref si, out pi);
        CloseHandle(hWrite);

        if (!success) {
            int err = Marshal.GetLastWin32Error();
            CloseHandle(hRead);
            return "CreateProcess failed: " + err;
        }

        string output = "";
        using (FileStream fs = new FileStream(new Microsoft.Win32.SafeHandles.SafeFileHandle(hRead, true), FileAccess.Read))
        using (StreamReader reader = new StreamReader(fs, Encoding.UTF8)) {
            output = reader.ReadToEnd();
        }

        WaitForSingleObject(pi.hProcess, 30000);
        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);

        return output;
    }
}
"@

if (-not ([System.Management.Automation.PSTypeName]'DesktopRunner').Type) {
    Add-Type -TypeDefinition $code
}

$agentBin = "C:\Users\Administrator\AppData\Roaming\npm\node_modules\agent-desktop\bin\agent-desktop-win32-x64.exe"
$escaped = @()
foreach ($arg in $CommandArgs) {
    if ($arg -match '\s' -and -not ($arg.StartsWith('\"') -and $arg.EndsWith('\"'))) {
        $escaped += ('\"' + $arg + '\"')
    } else {
        $escaped += $arg
    }
}
$joinedArgs = ($escaped -join " ")
[DesktopRunner]::Run($agentBin, $joinedArgs)
