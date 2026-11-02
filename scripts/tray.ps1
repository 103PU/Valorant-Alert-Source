Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Terminate any duplicate tray process
$currentPid = $PID
try {
    Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" | Where-Object {
        $_.ProcessId -ne $currentPid -and $_.CommandLine -like "*tray.ps1*"
    } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
} catch {}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
if (-not $scriptDir) { $scriptDir = $PSScriptRoot }
$rootDir = Split-Path -Parent $scriptDir
if (-not (Test-Path "$rootDir\server") -and -not (Test-Path "$rootDir\config.json")) {
    $rootDir = $scriptDir
}
Set-Location $rootDir

# Read Config for dynamic port
$configPort = 3000
$configPath = Join-Path $rootDir "config.json"
if (Test-Path $configPath) {
    try {
        $cfgJson = Get-Content $configPath -Raw | ConvertFrom-Json
        if ($cfgJson.port) { $configPort = $cfgJson.port }
    } catch {}
}

# Global URL State
$global:token = ""
$global:dashboardUrl = "http://localhost:$configPort/dashboard.html"
$global:lanUrl = ""

# Quick non-blocking server probe function
function Probe-Server-Info {
    try {
        $info = Invoke-RestMethod -Uri "http://localhost:$configPort/api/info" -Method Get -TimeoutSec 3 -ErrorAction Stop
        if ($info) {
            $global:token = $info.token
            $global:dashboardUrl = $info.dashboardUrl
            $global:lanUrl = $info.lanUrl
            return $true
        }
    } catch {}
    return $false
}

# Initial probe
Probe-Server-Info | Out-Null

# ==============================================================================
# RIOT VANGUARD-STYLE CUSTOM TRAY MENU (WS_POPUP + CreateRoundRectRgn + GDI)
# ==============================================================================
$csharpVanguardMenu = @"
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace ValorantAlert.Tray {
    public class MenuItemDef {
        public string Text;
        public Action Action;
        public bool IsDivider;
        public bool IsHeader;
        public bool HasSubmenu;
        public List<MenuItemDef> SubItems;
        public Image Icon;
        public Color CustomColor = Color.Empty;

        public static MenuItemDef Header(string text, Image icon) {
            return new MenuItemDef { Text = text, Icon = icon, IsHeader = true };
        }
        public static MenuItemDef Divider() {
            return new MenuItemDef { IsDivider = true };
        }
        public static MenuItemDef Item(string text, Action action, Color? color = null) {
            return new MenuItemDef { Text = text, Action = action, CustomColor = color ?? Color.Empty };
        }
        public static MenuItemDef Submenu(string text, List<MenuItemDef> subItems) {
            return new MenuItemDef { Text = text, HasSubmenu = true, SubItems = subItems };
        }
    }

    public class VanguardMenuPopup : Form {
        [DllImport("gdi32.dll")]
        public static extern IntPtr CreateRoundRectRgn(int x1, int y1, int x2, int y2, int cx, int cy);

        [DllImport("user32.dll")]
        public static extern int SetWindowRgn(IntPtr hWnd, IntPtr hRgn, bool bRedraw);

        [DllImport("gdi32.dll")]
        public static extern bool DeleteObject(IntPtr hObject);

        private List<MenuItemDef> items;
        private int hoverIndex = -1;
        private VanguardMenuPopup submenuPopup = null;
        private VanguardMenuPopup parentMenu = null;
        private Timer hoverTimer = null;
        private int pendingSubmenuIndex = -1;

        // Visual design tokens matching Riot Vanguard
        private readonly Color colBg = Color.FromArgb(15, 16, 18);        // #0F1012
        private readonly Color colBorder = Color.FromArgb(38, 40, 46);    // #26282E
        private readonly Color colDivider = Color.FromArgb(30, 32, 34);   // #1E2022
        private readonly Color colHoverPill = Color.FromArgb(30, 32, 36); // #1E2024
        private readonly Color colText = Color.FromArgb(196, 199, 204);   // #C4C7CC
        private readonly Color colTextHover = Color.White;                // #FFFFFF
        private readonly Color colHeader = Color.White;
        private readonly Color colRed = Color.FromArgb(255, 70, 85);      // Valorant Red #FF4655

        private readonly Font fontRegular;
        private readonly Font fontBold;
        private readonly Font fontHeader;
        private readonly Font fontChevron;

        private const int CornerRadius = 16;
        private const int PillRadius = 6;
        private const int ItemHeight = 30;
        private const int HeaderHeight = 42;
        private const int DividerHeight = 9;

        public VanguardMenuPopup(List<MenuItemDef> menuItems, VanguardMenuPopup parent = null) {
            this.items = menuItems ?? new List<MenuItemDef>();
            this.parentMenu = parent;

            this.FormBorderStyle = FormBorderStyle.None;
            this.StartPosition = FormStartPosition.Manual;
            this.ShowInTaskbar = false;
            this.TopMost = true;
            this.DoubleBuffered = true;
            this.BackColor = colBg;
            this.Text = "ValorantAlertTrayMenu";

            this.fontRegular = new Font("Segoe UI", 9.5f, FontStyle.Regular, GraphicsUnit.Point);
            this.fontBold = new Font("Segoe UI", 9.5f, FontStyle.Bold, GraphicsUnit.Point);
            this.fontHeader = new Font("Segoe UI", 10.5f, FontStyle.Bold, GraphicsUnit.Point);
            this.fontChevron = new Font("Segoe UI", 10.0f, FontStyle.Bold, GraphicsUnit.Point);

            this.hoverTimer = new Timer();
            this.hoverTimer.Interval = 120;
            this.hoverTimer.Tick += HoverTimer_Tick;

            CalculateDimensions();
        }

        protected override CreateParams CreateParams {
            get {
                CreateParams cp = base.CreateParams;
                cp.Style |= unchecked((int)0x80000000); // WS_POPUP
                cp.ExStyle |= 0x00000080 | 0x00000008; // WS_EX_TOOLWINDOW | WS_EX_TOPMOST
                return cp;
            }
        }

        private void CalculateDimensions() {
            int totalHeight = 12; // top and bottom padding
            int maxWidth = 190;

            using (Bitmap bmp = new Bitmap(1, 1))
            using (Graphics g = Graphics.FromImage(bmp)) {
                foreach (var it in items) {
                    if (it.IsHeader) {
                        totalHeight += HeaderHeight;
                        var sz = g.MeasureString(it.Text, fontHeader);
                        int w = (int)sz.Width + (it.Icon != null ? 52 : 32);
                        if (w > maxWidth) maxWidth = w;
                    } else if (it.IsDivider) {
                        totalHeight += DividerHeight;
                    } else {
                        totalHeight += ItemHeight;
                        var sz = g.MeasureString(it.Text, fontRegular);
                        int w = (int)sz.Width + (it.HasSubmenu ? 50 : 36);
                        if (w > maxWidth) maxWidth = w;
                    }
                }
            }

            this.Size = new Size(maxWidth + 16, totalHeight);
        }

        protected override void OnHandleCreated(EventArgs e) {
            base.OnHandleCreated(e);
            ApplyRoundedRegion();
        }

        protected override void OnSizeChanged(EventArgs e) {
            base.OnSizeChanged(e);
            ApplyRoundedRegion();
        }

        private void ApplyRoundedRegion() {
            if (IsHandleCreated && Width > 0 && Height > 0) {
                IntPtr rgn = CreateRoundRectRgn(0, 0, Width + 1, Height + 1, CornerRadius, CornerRadius);
                SetWindowRgn(Handle, rgn, true);
                DeleteObject(rgn);
            }
        }

        private GraphicsPath GetRoundRectPath(Rectangle rect, int radius) {
            GraphicsPath path = new GraphicsPath();
            int d = radius * 2;
            path.AddArc(rect.X, rect.Y, d, d, 180, 90);
            path.AddArc(rect.Right - d, rect.Y, d, d, 270, 90);
            path.AddArc(rect.Right - d, rect.Bottom - d, d, d, 0, 90);
            path.AddArc(rect.X, rect.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }

        protected override void OnPaint(PaintEventArgs e) {
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;

            // 1. Fill solid background #0F1012
            using (SolidBrush bgBrush = new SolidBrush(colBg)) {
                g.FillRectangle(bgBrush, ClientRectangle);
            }

            // 2. Draw Items
            int curY = 6;
            for (int i = 0; i < items.Count; i++) {
                var it = items[i];
                if (it.IsHeader) {
                    if (it.Icon != null) {
                        g.DrawImage(it.Icon, new Rectangle(14, curY + (HeaderHeight - 20) / 2, 20, 20));
                    }
                    using (SolidBrush b = new SolidBrush(colHeader)) {
                        int textX = it.Icon != null ? 42 : 16;
                        g.DrawString(it.Text, fontHeader, b, new PointF(textX, curY + (HeaderHeight - 18) / 2));
                    }
                    curY += HeaderHeight;
                } else if (it.IsDivider) {
                    using (Pen pen = new Pen(colDivider, 1)) {
                        g.DrawLine(pen, 12, curY + 4, Width - 12, curY + 4);
                    }
                    curY += DividerHeight;
                } else {
                    Rectangle itemRect = new Rectangle(0, curY, Width, ItemHeight);
                    Rectangle pillRect = new Rectangle(6, curY + 1, Width - 12, ItemHeight - 2);

                    bool isHovered = (i == hoverIndex);
                    if (isHovered) {
                        using (GraphicsPath pillPath = GetRoundRectPath(pillRect, PillRadius))
                        using (SolidBrush pillBrush = new SolidBrush(colHoverPill)) {
                            g.FillPath(pillBrush, pillPath);
                        }
                    }

                    Color textColor = isHovered ? colTextHover : (it.CustomColor != Color.Empty ? it.CustomColor : colText);
                    using (SolidBrush b = new SolidBrush(textColor)) {
                        g.DrawString(it.Text, fontRegular, b, new PointF(16, curY + (ItemHeight - 16) / 2));

                        if (it.HasSubmenu) {
                            g.DrawString(">", fontChevron, b, new PointF(Width - 24, curY + (ItemHeight - 18) / 2));
                        }
                    }
                    curY += ItemHeight;
                }
            }

            // 3. Draw 1px Border #26282E
            using (GraphicsPath borderPath = GetRoundRectPath(new Rectangle(0, 0, Width - 1, Height - 1), CornerRadius))
            using (Pen borderPen = new Pen(colBorder, 1)) {
                g.DrawPath(borderPen, borderPath);
            }
        }

        private int GetItemIndexAt(Point pt) {
            int curY = 6;
            for (int i = 0; i < items.Count; i++) {
                var it = items[i];
                int h = it.IsHeader ? HeaderHeight : (it.IsDivider ? DividerHeight : ItemHeight);
                if (pt.Y >= curY && pt.Y < curY + h) {
                    return (it.IsHeader || it.IsDivider) ? -1 : i;
                }
                curY += h;
            }
            return -1;
        }

        private Rectangle GetItemRect(int index) {
            int curY = 6;
            for (int i = 0; i < items.Count; i++) {
                var it = items[i];
                int h = it.IsHeader ? HeaderHeight : (it.IsDivider ? DividerHeight : ItemHeight);
                if (i == index) {
                    return new Rectangle(0, curY, Width, h);
                }
                curY += h;
            }
            return Rectangle.Empty;
        }

        protected override void OnMouseMove(MouseEventArgs e) {
            base.OnMouseMove(e);
            int idx = GetItemIndexAt(e.Location);
            if (idx != hoverIndex) {
                hoverIndex = idx;
                Invalidate();

                if (idx >= 0 && items[idx].HasSubmenu) {
                    pendingSubmenuIndex = idx;
                    hoverTimer.Stop();
                    hoverTimer.Start();
                } else {
                    pendingSubmenuIndex = -1;
                    if (submenuPopup != null && !submenuPopup.Bounds.Contains(Cursor.Position)) {
                        hoverTimer.Stop();
                        CloseSubmenu();
                    }
                }
            }
        }

        private void HoverTimer_Tick(object sender, EventArgs e) {
            hoverTimer.Stop();
            if (pendingSubmenuIndex >= 0 && pendingSubmenuIndex < items.Count && items[pendingSubmenuIndex].HasSubmenu) {
                ShowSubmenu(pendingSubmenuIndex);
            }
        }

        protected override void OnMouseLeave(EventArgs e) {
            base.OnMouseLeave(e);
            Point screenPt = Cursor.Position;
            if (!this.Bounds.Contains(screenPt)) {
                if (submenuPopup != null && submenuPopup.Bounds.Contains(screenPt)) {
                    // Mouse moved into submenu
                } else {
                    hoverIndex = -1;
                    Invalidate();
                }
            }
        }

        protected override void OnMouseClick(MouseEventArgs e) {
            base.OnMouseClick(e);
            if (e.Button == MouseButtons.Left) {
                int idx = GetItemIndexAt(e.Location);
                if (idx >= 0 && idx < items.Count) {
                    var it = items[idx];
                    if (it.HasSubmenu) {
                        ShowSubmenu(idx);
                    } else if (it.Action != null) {
                        Action act = it.Action;
                        CloseAll();
                        act.Invoke();
                    }
                }
            }
        }

        public void ShowSubmenu(int index) {
            if (submenuPopup != null) {
                submenuPopup.Close();
                submenuPopup.Dispose();
                submenuPopup = null;
            }

            var it = items[index];
            if (it.SubItems == null || it.SubItems.Count == 0) return;

            submenuPopup = new VanguardMenuPopup(it.SubItems, this);

            Rectangle itemRect = GetItemRect(index);
            Point itemScreenPt = this.PointToScreen(new Point(0, itemRect.Y));

            Screen currentScreen = Screen.FromPoint(this.Location);
            Rectangle workArea = currentScreen.WorkingArea;

            int subX = this.Right + 4;
            if (subX + submenuPopup.Width > workArea.Right) {
                subX = this.Left - submenuPopup.Width - 4;
            }

            int subY = itemScreenPt.Y - 6;
            if (subY + submenuPopup.Height > workArea.Bottom) {
                subY = workArea.Bottom - submenuPopup.Height - 4;
            }
            if (subY < workArea.Top) subY = workArea.Top + 4;

            submenuPopup.Location = new Point(subX, subY);
            submenuPopup.Show();
        }

        public void CloseSubmenu() {
            if (submenuPopup != null) {
                submenuPopup.Close();
                submenuPopup.Dispose();
                submenuPopup = null;
            }
        }

        public void CloseAll() {
            CloseSubmenu();
            if (parentMenu != null) {
                parentMenu.CloseAll();
            } else {
                this.Close();
            }
        }

        private bool IsDescendantOrSelf(IntPtr hWnd) {
            if (this.Handle == hWnd) return true;
            if (submenuPopup != null && submenuPopup.Handle == hWnd) return true;
            if (parentMenu != null && parentMenu.IsDescendantOrSelf(hWnd)) return true;
            return false;
        }

        private const int WM_ACTIVATE = 0x0006;
        private const int WA_INACTIVE = 0;

        protected override void WndProc(ref Message m) {
            if (m.Msg == WM_ACTIVATE) {
                int state = (int)m.WParam & 0xFFFF;
                if (state == WA_INACTIVE) {
                    IntPtr otherHwnd = m.LParam;
                    if (!IsDescendantOrSelf(otherHwnd)) {
                        CloseAll();
                    }
                }
            }
            base.WndProc(ref m);
        }

        protected override bool ProcessCmdKey(ref Message msg, Keys keyData) {
            if (keyData == Keys.Escape) {
                CloseAll();
                return true;
            }
            return base.ProcessCmdKey(ref msg, keyData);
        }

        public void ShowAt(Point screenPos) {
            Screen currentScreen = Screen.FromPoint(screenPos);
            Rectangle workArea = currentScreen.WorkingArea;

            int x = screenPos.X - this.Width / 2;
            int y = screenPos.Y - this.Height - 8;

            if (x + this.Width > workArea.Right) x = workArea.Right - this.Width - 8;
            if (x < workArea.Left) x = workArea.Left + 8;
            if (y < workArea.Top) y = screenPos.Y + 8;
            if (y + this.Height > workArea.Bottom) y = workArea.Bottom - this.Height - 8;

            this.Location = new Point(x, y);
            this.Show();
            this.Activate();
        }
    }
}
"@

if (-not ([System.Management.Automation.PSTypeName]'ValorantAlert.Tray.VanguardMenuPopup').Type) {
    Add-Type -TypeDefinition $csharpVanguardMenu -ReferencedAssemblies System.Windows.Forms, System.Drawing
}

# Load Icon Image
$iconPath = Join-Path $rootDir "assets\icon.ico"
$iconImg = if (Test-Path $iconPath) {
    try { [System.Drawing.Icon]::ExtractAssociatedIcon((Resolve-Path $iconPath)) } catch { $null }
} else { $null }

# Create System Tray NotifyIcon
$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$notifyIcon.Icon = if ($iconImg) { $iconImg } else { [System.Drawing.SystemIcons]::Application }
$notifyIcon.Text = "Valorant Score Alert (v1.0.10)"
$notifyIcon.Visible = $true

# Show confirmation balloon tip on startup
try {
    $notifyIcon.BalloonTipTitle = "Valorant Score Alert"
    $notifyIcon.BalloonTipText = "Dang chay ngam! Nhap chuot phai de mo menu Vanguard."
    $notifyIcon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
    $notifyIcon.ShowBalloonTip(3000)
} catch {}

# Instant Open Dashboard Function with Multi-Browser Support
function Open-Dashboard {
    $targetUrl = if ($global:dashboardUrl) { $global:dashboardUrl } else { "http://localhost:$configPort/dashboard.html" }
    
    $progFiles = ${env:ProgramFiles}
    $progFilesX86 = ${env:ProgramFiles(x86)}
    $localApp = $env:LOCALAPPDATA

    $browserPaths = @(
        (Join-Path $progFiles "Google\Chrome\Application\chrome.exe"),
        (Join-Path $progFilesX86 "Google\Chrome\Application\chrome.exe"),
        (Join-Path $localApp "Google\Chrome\Application\chrome.exe"),
        (Join-Path $progFilesX86 "Microsoft\Edge\Application\msedge.exe"),
        (Join-Path $progFiles "Microsoft\Edge\Application\msedge.exe"),
        (Join-Path $localApp "Microsoft\Edge\Application\msedge.exe"),
        (Join-Path $progFiles "BraveSoftware\Brave-Browser\Application\brave.exe"),
        (Join-Path $localApp "BraveSoftware\Brave-Browser\Application\brave.exe")
    )

    $foundBrowser = $null
    foreach ($b in $browserPaths) {
        if ($b -and (Test-Path $b)) {
            $foundBrowser = $b
            break
        }
    }

    if ($foundBrowser) {
        try {
            $global:browserProcess = Start-Process -FilePath $foundBrowser -ArgumentList "--app=`"$targetUrl`"" -PassThru -ErrorAction Stop
        } catch {
            Start-Process "explorer.exe" -ArgumentList "`"$targetUrl`""
        }
    } else {
        Start-Process "explorer.exe" -ArgumentList "`"$targetUrl`""
    }
}

# Left Double Click -> Instant Open Dashboard
$notifyIcon.add_DoubleClick({
    Open-Dashboard
})

# Exit Application Function
function Exit-Application {
    $notifyIcon.Visible = $false
    $notifyIcon.Dispose()

    if ($global:browserProcess) {
        try { Stop-Process -Id $global:browserProcess.Id -Force -ErrorAction SilentlyContinue } catch {}
    }
    try {
        Get-Process -Name chrome, msedge, brave, firefox, opera -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like "*VALORANT SCORE ALERT*" } | Stop-Process -Force -ErrorAction SilentlyContinue
    } catch {}
    try {
        Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
            $_.CommandLine -like "*dashboard.html*" -or $_.CommandLine -like "*:$configPort*"
        } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    } catch {}

    Get-Process -Name node, ValorantScoreAlert -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

    [System.Windows.Forms.Application]::Exit()
    [System.Environment]::Exit(0)
}

# Vanguard Tray Menu Display Logic
$global:activePopup = $null

function Show-VanguardTrayMenu {
    if ($global:activePopup -and -not $global:activePopup.IsDisposed) {
        $global:activePopup.CloseAll()
        $global:activePopup = $null
        return
    }

    # 1. Advanced Submenu Items
    $subItems = [System.Collections.Generic.List[ValorantAlert.Tray.MenuItemDef]]::new()
    $subItems.Add([ValorantAlert.Tray.MenuItemDef]::Item("Test Match Point Alarm", {
        Invoke-RestMethod -Uri "http://localhost:$configPort/api/simulator" -Method Post -Body (@{ alliedScore = 12; enemyScore = 11; inGame = $true; status = "MATCH_POINT" } | ConvertTo-Json) -ContentType "application/json" -ErrorAction SilentlyContinue | Out-Null
    }))
    $subItems.Add([ValorantAlert.Tray.MenuItemDef]::Item("Test Round Win Sound", {
        Invoke-RestMethod -Uri "http://localhost:$configPort/api/simulator" -Method Post -Body (@{ alliedScore = 1; enemyScore = 0; inGame = $true; status = "IN_MATCH" } | ConvertTo-Json) -ContentType "application/json" -ErrorAction SilentlyContinue | Out-Null
    }))
    $subItems.Add([ValorantAlert.Tray.MenuItemDef]::Item("Create Desktop Shortcut", {
        $vbsPath = Join-Path $rootDir "Create-Desktop-Shortcut.vbs"
        Start-Process "cscript" -ArgumentList "//nologo `"$vbsPath`"" -NoNewWindow
        $notifyIcon.BalloonTipTitle = "Valorant Score Alert"
        $notifyIcon.BalloonTipText = "Da tao shortcut ngoai Desktop!"
        $notifyIcon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
        $notifyIcon.ShowBalloonTip(2000)
    }))
    $subItems.Add([ValorantAlert.Tray.MenuItemDef]::Item("Edit config.json", {
        $cfgPath = Join-Path $rootDir "config.json"
        Start-Process "notepad.exe" -ArgumentList "`"$cfgPath`""
    }))
    $subItems.Add([ValorantAlert.Tray.MenuItemDef]::Item("Open Logs Folder", {
        $logDir = Join-Path $rootDir "logs"
        if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
        Start-Process "explorer.exe" -ArgumentList "`"$logDir`""
    }))

    # 2. Main Menu Items
    $headerIcon = if ($iconImg) { $iconImg.ToBitmap() } else { $null }
    $menuItems = [System.Collections.Generic.List[ValorantAlert.Tray.MenuItemDef]]::new()
    $menuItems.Add([ValorantAlert.Tray.MenuItemDef]::Header("Valorant Score Alert", $headerIcon))
    $menuItems.Add([ValorantAlert.Tray.MenuItemDef]::Divider())
    $menuItems.Add([ValorantAlert.Tray.MenuItemDef]::Item("Open Dashboard", { Open-Dashboard }))
    $menuItems.Add([ValorantAlert.Tray.MenuItemDef]::Item("Copy Mobile Link (LAN)", {
        Probe-Server-Info | Out-Null
        $copyUrl = if ($global:lanUrl) { $global:lanUrl } else { "http://localhost:$configPort" }
        [System.Windows.Forms.Clipboard]::SetText($copyUrl)
        $notifyIcon.BalloonTipTitle = "Valorant Score Alert"
        $notifyIcon.BalloonTipText = "Da copy link: $copyUrl"
        $notifyIcon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
        $notifyIcon.ShowBalloonTip(2000)
    }))
    $menuItems.Add([ValorantAlert.Tray.MenuItemDef]::Submenu("Advanced", $subItems))
    $menuItems.Add([ValorantAlert.Tray.MenuItemDef]::Divider())
    $menuItems.Add([ValorantAlert.Tray.MenuItemDef]::Item("Exit", { Exit-Application }, [System.Drawing.Color]::FromArgb(255, 70, 85)))

    $popup = [ValorantAlert.Tray.VanguardMenuPopup]::new($menuItems)
    $global:activePopup = $popup
    $popup.ShowAt([System.Windows.Forms.Cursor]::Position)
}

# Right Click -> Custom Vanguard Popup Menu
$notifyIcon.add_MouseClick({
    param($sender, $e)
    if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Right) {
        Show-VanguardTrayMenu
    }
})

# Non-blocking Background Health Probe Timer (Checks every 10s without UI freeze)
$global:healthFailCount = 0
$healthTimer = New-Object System.Windows.Forms.Timer
$healthTimer.Interval = 10000
$healthTimer.add_Tick({
    $alive = Probe-Server-Info
    if ($alive) {
        $global:healthFailCount = 0
    } else {
        $runningProc = Get-Process -Name ValorantScoreAlert, node -ErrorAction SilentlyContinue
        if (-not $runningProc) {
            $global:healthFailCount++
            if ($global:healthFailCount -ge 3) {
                $global:healthFailCount = 0
                if (Test-Path "$rootDir\ValorantScoreAlert.exe") {
                    Start-Process -FilePath "$rootDir\ValorantScoreAlert.exe" -WorkingDirectory $rootDir -WindowStyle Hidden
                } else {
                    Start-Process -FilePath "node" -ArgumentList "server/index.js" -WorkingDirectory $rootDir -WindowStyle Hidden
                }
            }
        } else {
            $global:healthFailCount = 0
        }
    }
})
$healthTimer.Start()

# Keep Windows Forms Message Loop running
[System.Windows.Forms.Application]::Run()
