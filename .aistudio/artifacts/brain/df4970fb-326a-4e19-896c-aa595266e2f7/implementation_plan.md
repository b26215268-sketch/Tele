# Kế hoạch Tối ưu Thông minh: Xác định CTCN Cao nhất & Tự động Phân vùng Cảnh quan QCVN 08

Giải pháp giao diện tối giản, trực quan và thông minh nhất: Người dùng chỉ cần **chạm 1 điểm trên bản đồ** để xác định công trình cao nhất, hệ thống **tự động tính Góc phương vị & Cự ly**, cung cấp **nút bấm 1 chạm chọn số tầng (loại bỏ hoàn toàn dropdown)**; toàn bộ thông tin cảnh quan và 6 hướng xung quanh sẽ được **hệ thống tự động phân vùng theo Sector** mà không cần nhập thủ công.

---

### User Review & Critical Decisions

> [!IMPORTANT]
> **Các quyết định đã được xác nhận cùng người dùng:**
> 1. **Thao tác cốt lõi duy nhất**: Khảo sát thực địa theo QCVN 08 thực chất chỉ cần xác định **Công trình xây dựng có người (CTCN) cao nhất** có khả năng bị ảnh hưởng búp sóng. Người dùng chỉ cần chạm 1 điểm trên bản đồ (Radar 100m hoặc Vệ tinh).
> 2. **Loại bỏ hoàn toàn Dropdown**: Thay thế toàn bộ menu chọn tầng/loại hình phức tạp bằng **các nút bấm 1 chạm nhanh** (`1 tầng ~3.5m`, `2 tầng ~7m`, `3 tầng ~10.5m`, `4 tầng ~14m`, `5 tầng ~17.5m`, `>5 tầng`) kết hợp stepper tăng giảm số tầng và ô nhập độ cao trực tiếp.
> 3. **Tự động phân vùng cảnh quan thông minh**: Toàn bộ cảnh quan, góc lệch so với búp sóng chính của các Sector anten, và khoảng cách an toàn phơi nhiễm sẽ do thuật toán tự động nhận diện từ cấu hình trạm. Người dùng không phải nhập 6 hướng hay phân loại thủ công từng cảnh quan.
> 4. **Hộp thoại tối giản (Compact Quick-Input Modal)**: Xuất hiện tinh gọn, nổi bật ngay trên bản đồ, tự động điền sẵn cự ly, góc phương vị, tên mặc định và tự tích chọn "CTCN cao nhất" để lưu ngay chỉ sau 2 lần chạm.

---

### 1. Overview & Core Concept

- **Mục tiêu sản phẩm**: Giúp kỹ sư đo kiểm trạm viễn thông hoàn thành việc định vị và đo vẽ công trình cao nhất trong bán kính 100m chỉ trong **vài giây**, chuẩn hóa biên bản khảo sát theo QCVN 08:2022/BTTTT mà không tốn công nhập liệu thủ công rườm rà.
- **Đối tượng sử dụng**: Kỹ sư trắc địa, cán bộ kiểm định vô tuyến điện, quản lý vận hành trạm BTS trên hiện trường hoặc qua máy tính/tablet.
- **Giá trị cốt lõi**:
  - Tối ưu thao tác từ 8 bước phức tạp xuống còn **2 chạm**: Chạm vị trí trên bản đồ $\rightarrow$ Bấm chọn số tầng $\rightarrow$ Lưu xong!
  - Thuật toán thông minh tự động kết nối góc phương vị của điểm chọn với búp sóng Sector tương ứng để phân tích rủi ro phơi nhiễm.

---

### 2. User Experience & Visual Design

#### A. Quy trình tương tác người dùng (User Flow)

```
[Bản đồ Radar 100m / Vệ tinh]
         │
         ▼  (Người dùng chạm 1 điểm vào vị trí công trình cao nhất)
┌─────────────────────────────────────────────────────────────┐
│ 📍 Hộp thoại Nhập liệu Siêu Tốc (Quick Modal)               │
│                                                             │
│ • Tọa độ tự nhận: Cự ly: 42m · Góc: 115° · Thuộc Sector 1   │
│ • Trạng thái: [✔ Đặt làm CTCN cao nhất khảo sát]           │
│                                                             │
│ 🏢 Chọn nhanh Số tầng (1-Tap Buttons - KHÔNG DROPDOWN):    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│  │ 1T (3.5m)│ │ 2T (7.0m)│ │ 3T (10.5)│ │ 4T (14m) │        │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘        │
│  ┌──────────┐ ┌────────────────────────────────────┐        │
│  │ 5T (17.5)│ │ [ - ] Số tầng: 3 [ + ]   [10.5m]   │        │
│  └──────────┘ └────────────────────────────────────┘        │
│                                                             │
│ [ Hủy ]                                 [ 💾 Lưu CTCN Ngay ]│
└─────────────────────────────────────────────────────────────┘
         │
         ▼
[Cập nhật ngay lập tức vào Bản đồ, Bảng Mục 2 & Báo cáo QCVN 08]
```

#### B. Ngôn ngữ thiết kế & Trực quan hóa

- **Phong cách**: Kỹ thuật chuyên nghiệp, tinh gọn, độ tương phản cao, tối ưu cho cả thao tác chuột trên máy tính và chạm ngón tay trên máy tính bảng/điện thoại ngoài hiện trường.
- **Màu sắc chủ đạo**:
  - Nền hộp thoại: Trắng sạch / Slate cao cấp (`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800`).
  - Điểm nhấn CTCN cao nhất: Màu đỏ cam nổi bật (`bg-rose-500` / `bg-amber-500`) phân biệt rõ với tâm trạm (`bg-blue-600`).
  - Nút bấm số tầng: Nền nhã nhặn, khi chọn sẽ active với viền đậm và nền xanh biển kỹ thuật (`bg-blue-600 text-white shadow-sm`).
- **Typography & Font**:
  - Số liệu góc, cự ly và chiều cao luôn hiển thị dạng Monospace Tabular (`tabular-nums font-mono text-sm font-semibold`) giúp mắt kỹ sư dễ quét số đo.
  - Nhãn hiển thị bằng tiếng Việt rõ ràng, ngắn gọn, không lạm dụng thuật ngữ trừu tượng.

---

### 3. Key Product Decisions & Trade-Offs

#### Quyết định 1: Loại bỏ 100% Dropdown chọn số tầng & phân loại
- **Giải pháp**: Dùng thanh nút bấm chọn nhanh trực quan (`1T`, `2T`, `3T`, `4T`, `5T`, `Khác`) kèm bộ nút bấm cộng/trừ `[ - ] [ + ]` và ô số để người dùng nhập chiều cao lẻ nếu muốn (ví dụ 11.2m).
- **Lý do**: Dropdown trên màn hình cảm ứng hoặc bản đồ rất khó bấm, dễ nhảy menu và mất nhiều thao tác cuộn tìm. Nút bấm 1 chạm giúp hoàn tất chỉ trong 0.5 giây.
- **Phương án bị loại bỏ**: Các thẻ select menu dài danh sách từ 1 đến 20 tầng.

#### Quyết định 2: Tự động phân vùng cảnh quan thông minh theo Sector
- **Giải pháp**: Phần mềm tự động tính toán góc phủ của từng Sector (ví dụ: Sector 1 hướng 60°, Sector 2 hướng 180°, Sector 3 hướng 300°). Bất kỳ điểm nào người dùng chọn sẽ tự động được gán vào Sector tương ứng và xác định góc lệch so với búp sóng chính.
- **Lý do**: Bản chất địa hình và cảnh quan xung quanh đã cố định theo tọa độ trạm và bán kính 100m. Người dùng chỉ cần chỉ định công trình cao nhất là đủ điều kiện tính toán phơi nhiễm theo QCVN 08. Việc bắt người dùng phân loại cảnh quan từng góc gây ức chế và không cần thiết.

#### Quyết định 3: Hộp thoại Nhập liệu Nổi Tinh gọn (Compact Floating Dialog)
- **Giải pháp**: Khi click bản đồ, hiển thị hộp thoại nổi dạng Modal ở trung tâm hoặc góc bản đồ với kích thước vừa phải (dưới 420px), không che mất tầm nhìn tổng thể của anten và các búp sóng.
- **Lý do**: Giúp người dùng vừa nhìn thấy vị trí tương quan của anten vừa xác nhận số tầng nhanh chóng.

---

### 4. Technical Architecture & Data Strategy

#### Sơ đồ Kiến trúc & Luồng Dữ liệu (Component & Data Flow)

```
┌────────────────────────────────────────────────────────┐
│                   Hồ sơ Trạm BTS                       │
│    Tọa độ GPS Trạm · Cấu hình Anten Sector (Azimuth/Tilt)│
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│      Bản đồ Tương tác 100m (SectorRadar100m.tsx)       │
│  - Radar SVG 100m / Bản đồ Leaflet Vệ tinh             │
│  - Thuật toán chuyển đổi Pixel/GPS -> Cự ly & Góc      │
└──────────────────────────┬─────────────────────────────┘
                           │  Sự kiện Click (X, Y) hoặc (Lat, Lng)
                           ▼
┌────────────────────────────────────────────────────────┐
│    Hộp thoại Nhập liệu Tối giản (Quick Ctcn Modal)     │
│  - Tự động điền: Distance (m), Azimuth (°)             │
│  - Nút bấm nhanh Số tầng: 1T (3.5m) ... 5T (17.5m)     │
│  - Stepper điều chỉnh số tầng & Chiều cao lẻ (m)       │
│  - Tự động nhận diện Sector búp sóng tương ứng         │
└──────────────────────────┬─────────────────────────────┘
                           │  Lưu (Save)
                           ▼
┌────────────────────────────────────────────────────────┐
│       Danh sách CTCN & Bảng Mục 2 (QCVN 08)            │
│  - Tự động đồng bộ vào `station.tallestObstacle`       │
│  - Tự động cập nhật Bảng khảo sát thực địa Mục 2       │
│  - Xuất báo cáo tính toán phơi nhiễm tự động           │
└────────────────────────────────────────────────────────┘
```

#### Công thức & Quy tắc Tính toán:
1. **Khoảng cách ($d$) & Góc phương vị ($\theta$)**:
   $$\Delta x = x_{\text{click}} - x_{\text{station}}, \quad \Delta y = y_{\text{click}} - y_{\text{station}}$$
   $$d = \sqrt{\Delta x^2 + \Delta y^2} \times \text{Scale}$$
   $$\theta = (\text{atan2}(\Delta x, -\Delta y) \times \frac{180}{\pi} + 360) \pmod{360}$$
2. **Quy đổi Số tầng ra Chiều cao đề xuất**:
   $$h_{\text{gợi ý}} = N_{\text{tầng}} \times 3.5\text{m}$$ (người dùng có thể chỉnh sửa tự do).
3. **Phân vùng Cảnh quan & Sector tự động**:
   Hệ thống so sánh góc $\theta$ với góc phương vị của từng Sector:
   $$\Delta \theta_i = |\theta - \text{Azimuth}_{\text{Sector } i}|$$
   Sector có $\Delta \theta_i$ nhỏ nhất sẽ tự động nhận diện điểm này thuộc búp sóng Sector đó.

---

### 5. Kế hoạch Thực hiện Cụ thể

1. **Cập nhật `src/components/SectorRadar100m.tsx`**:
   - Tinh gọn giao diện Hộp thoại nhập liệu: Thay toàn bộ các trường dropdown rườm rà bằng dãy nút bấm 1 chạm số tầng (`1T`, `2T`, `3T`, `4T`, `5T`), nút `[ - ]` và `[ + ]`, cùng ô hiển thị mét trực tiếp.
   - Thêm nút check mặc định: "Đánh dấu là CTCN cao nhất".
   - Tự động gán nhãn Sector và vùng ảnh hưởng dựa trên góc phương vị mà không bắt người dùng chọn thủ công.
2. **Cập nhật Bảng Mục 2 trong `src/components/StationSectorModal.tsx`**:
   - Hiển thị danh sách khảo sát gọn gàng với cột Số tầng, Chiều cao (m), Cự ly, Góc phương vị và Sector phụ trách.
   - Nút "Chấm trên bản đồ" mở trực tiếp chế độ định vị nhanh.
3. **Kiểm thử và xác minh**:
   - Thao tác chấm điểm trên cả Radar SVG và Bản đồ vệ tinh: modal mở lập tức, góc và khoảng cách tính chuẩn xác, chọn tầng 1 chạm mượt mà.
   - Kiểm tra tính toán phân tích phơi nhiễm tự động đối chiếu QCVN 08.
