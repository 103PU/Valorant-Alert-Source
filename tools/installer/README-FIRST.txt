Valorant Score Alert — bộ cài
=============================

Cài đặt (cách nên dùng)
-----------------------
1. Giải nén TOÀN BỘ file ZIP này ra một thư mục bình thường
   (ví dụ Desktop). Chạy trực tiếp bên trong ZIP sẽ không thấy payload.
2. Chạy Install-ValorantAlert.cmd (bấm đúp).
3. Mở "Valorant Score Alert" từ shortcut Desktop hoặc Start Menu.
4. Icon hình khiên xuất hiện ở khay hệ thống (system tray), cạnh đồng hồ.
   Bấm chuột phải vào icon đó để mở Dashboard, xem trạng thái license, hoặc thoát.

Dashboard chạy ở http://127.0.0.1:3000 trên chính máy này.
Muốn xem trên điện thoại thì quét QR trong Dashboard — điện thoại phải cùng Wi-Fi.

Lệnh tuỳ chọn
-------------
Cài mà không tạo shortcut Desktop:
  powershell -NoProfile -ExecutionPolicy Bypass -File .\Install-ValorantAlert.ps1 -NoDesktopShortcut

Cài mà không tạo shortcut Start Menu:
  powershell -NoProfile -ExecutionPolicy Bypass -File .\Install-ValorantAlert.ps1 -NoStartMenuShortcut

Cài rồi chạy luôn:
  powershell -NoProfile -ExecutionPolicy Bypass -File .\Install-ValorantAlert.ps1 -Launch

Cài vào thư mục khác:
  powershell -NoProfile -ExecutionPolicy Bypass -File .\Install-ValorantAlert.ps1 -InstallDir "D:\Apps\ValorantAlert"

Gỡ cài đặt:
  powershell -NoProfile -ExecutionPolicy Bypass -File .\Uninstall-ValorantAlert.ps1

Gỡ và xoá luôn dữ liệu người dùng:
  powershell -NoProfile -ExecutionPolicy Bypass -File .\Uninstall-ValorantAlert.ps1 -PurgeUserData

Ghi chú
-------
- Cài cho riêng user đang đăng nhập, vào %LOCALAPPDATA%\Programs\ValorantAlert.
  Không cần quyền admin, không có cửa sổ UAC.
- Dữ liệu người dùng nằm ở %APPDATA%\ValorantAlert: session đăng nhập KLD,
  license entitlement và device id. Gỡ cài đặt KHÔNG xoá thư mục này, nên cài
  lại là không phải đăng nhập lại và không tốn thêm một slot thiết bị.
  Chỉ -PurgeUserData mới xoá.
- Cài lại/nâng cấp: chạy lại Install-ValorantAlert.cmd. Nó tự dừng bản đang
  chạy, thay toàn bộ thư mục cài, rồi tạo lại shortcut.
- Nếu SmartScreen hiện ra: chọn "More info" → "Run anyway".
- Nếu bấm đúp mà không thấy gì: kiểm tra icon ở khay hệ thống trước.
  App khởi động ẩn, không có cửa sổ console.
