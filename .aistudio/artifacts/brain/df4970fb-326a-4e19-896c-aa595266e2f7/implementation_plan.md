# Tương tác Click & Kéo Xoay Góc Phương Vị Trên Bản Đồ Vệ Tinh 100m

Nâng cấp trải nghiệm tương tác trên tab Bản đồ Vệ tinh (Leaflet 100m) đồng bộ hoàn toàn với màn hình Radar SVG: cho phép chạm/click trực tiếp vào các cánh quạt Sector để tự động tính toán toạ độ, góc phương vị, cự ly về trạm; đồng thời cung cấp chốt xoay / vòng xoay tương tác 360° mượt mà không bị kẹt panning bản đồ.

## Quyết Định Cốt Lõi Từ Người Dùng (Đã Xác Nhận)

> [!IMPORTANT]
> - **Tương tác click trên sector vệ tinh**: Chạm vào bất kỳ điểm nào trên cánh quạt sector sẽ kích hoạt ngay việc lấy toạ độ GPS, tính toán góc phương vị (° Bắc) và khoảng cách (m) tới chân cột trạm anten, đồng thời gán vào form khảo sát/CTCN thay vì bị chặn bởi popup tĩnh của Leaflet.
> - **Cơ chế xoay vòng 360° trên vệ tinh**: Trang bị chốt quét / tay nắm xoay hướng phương vị trực quan trên tia định hướng (Dynamic Guideline). Khi người dùng giữ và kéo xoay xung quanh tâm trạm, bản đồ tự động khoá trượt (panning lock) để người dùng quay góc 0°–360° và thay đổi cự ly 0–100m mượt mà như trên Radar SVG.

---

### 1. Tổng Quan & Trải Nghiệm Người Dùng

```
┌────────────────────────────────────────────────────────────────────────┐
│ MÀN HÌNH BẢN ĐỒ VỆ TINH 100m (QCVN 08)                                │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│        Bắc (0°)                                                        │
│           ▲                                                            │
│           │                                                            │
│       ┌───┼───┐                                                        │
│     ／    │    ＼     [Sector 1: 60°]                                  │
│    │      │  ◢███     Click trực tiếp vào đây ──► Tự động bắt toạ độ,  │
│    │      │ ◢████                                 cự ly & góc phương vị│
│    │      🗼──────►   Tay nắm xoay (Rotate Handle)                     │
│    │      │           Giữ & kéo vòng quanh trạm ──► Quét góc 0-360°    │
│     ＼    │    ／                                 như trên Radar SVG   │
│       └───┼───┘                                                        │
│           ▼                                                            │
│        Nam (180°)                                                      │
│                                                                        │
│ [⚡ Góc hiện tại: 72° | Cự ly: 45m | Sector 1 (Trong búp sóng chính)]  │
└────────────────────────────────────────────────────────────────────────┘
```

- **Vấn đề hiện tại**:
  1. Trên bản đồ Leaflet vệ tinh, các `Polygon` của từng sector đang nhận sự kiện click độc quyền để mở `Popup` thông tin, làm nuốt mất sự kiện click của bản đồ (`onMapClick`), khiến người dùng không thể bấm chọn điểm bên trong vùng phủ sóng sector.
  2. Không có công cụ kéo xoay góc trực tiếp xung quanh tâm trạm trên ảnh vệ tinh: khi chạm kéo ngón tay/chuột thì Leaflet nhận diện là kéo di chuyển bản đồ (pan), không xoay được góc phương vị như màn hình Radar SVG.
- **Giải pháp mang lại**:
  - Gắn sự kiện click trực tiếp lên toàn bộ các `Polygon` sector và các vòng tròn cự ly để kích hoạt `handleSatelliteClick` tức thì.
  - Bổ sung `Interactive Guideline & Rotate Reticle Marker`: hiển thị tia quét động nối từ tâm trạm đến điểm ngắm với chốt tròn xoay (draggable). Khi kéo chốt xoay, hệ thống tạm tắt `map.dragging` để người dùng quay vòng 360° quanh trạm với tooltip hiển thị góc và cự ly thời gian thực.

---

### 2. Thiết Kế Chi Tiết & Luồng Tương Tác

1. **Click trên cánh quạt Sector**:
   - Khi người khảo sát nhấp vào bất kỳ vị trí nào trên polygon của Sector 1, 2, 3:
     - Tính toạ độ GPS chính xác tại vị trí nhấp.
     - Tính góc phương vị `azimuth` (độ so với hướng Bắc) và khoảng cách `distance` (mét tới chân trụ, clamp tối đa 100m).
     - Phân tích vị trí nằm trong hay ngoài búp sóng chính (`isInMainLobe`, `offsetAngle`).
     - Tự động điền vào Form khảo sát (Mục công trình cao nhất hoặc vị trí quan sát).
2. **Kéo xoay góc phương vị (Azimuth Rotation)**:
   - Một chốt xoay màu nổi bật (xanh dương sáng viền trắng) nằm ở đầu tia định hướng 100m.
   - Khi bắt đầu kéo (`dragstart`): Leaflet tạm thời tắt panning bản đồ, bật chế độ đo góc thời gian thực.
   - Khi đang xoay (`drag`): Tính toán góc phương vị mới liên tục theo vị trí con trỏ chuột/chạm so với toạ độ tâm trạm. Badge góc hiển thị nhảy số mượt mà `0° -> 360°`.
   - Khi nhả tay (`dragend`): Cập nhật toạ độ cuối cùng vào điểm khảo sát và kích hoạt lại panning bản đồ.
3. **Thanh công cụ bổ trợ trên bản đồ vệ tinh**:
   - Nút bật/tắt nhanh chế độ "Kéo xoay góc phương vị" / "Di chuyển bản đồ" để người dùng trên thiết bị di động thao tác tiện lợi mà không bị nhầm lẫn.

---

### 3. Kiến Trúc Kỹ Thuật

```
                    ┌────────────────────────────┐
                    │   SectorRadar100m.tsx      │
                    └─────────────┬──────────────┘
                                  │
          ┌───────────────────────┴───────────────────────┐
          ▼                                               ▼
┌───────────────────────────────┐           ┌───────────────────────────────┐
│     Radar SVG View            │           │  Leaflet Satellite View       │
│  - PointerDown / Move / Up    │           │  - SatelliteMapEvents         │
│  - svgToPolar(x, y)           │           │  - Sector Polygon OnClick     │
│  - Realtime Guideline 360°    │           │  - Rotate Reticle (Draggable) │
│  - Distance: 0-100m           │           │  - Azimuth/Distance Sync      │
└───────────────────────────────┘           └───────────────────────────────┘
                                  │
                                  ▼
                    ┌────────────────────────────┐
                    │  telecomGeo.ts             │
                    │  - computeDistanceBearing  │
                    │  - computeDestinationPoint │
                    │  - analyzeCtcnSectorAndRisk│
                    └────────────────────────────┘
```

- **Tệp nguồn tác động chính**:
  - `src/components/SectorRadar100m.tsx`: Cập nhật cấu hình polygon click handlers, bổ sung Reticle Marker xoay phương vị 360° trên Leaflet, xử lý lock dragging mượt mà.
  - `src/components/StationSectorModal.tsx`: Đồng bộ giá trị góc phương vị và cự ly cập nhật từ bản đồ vệ tinh sang các ô nhập liệu của Form khảo sát hiện hành.

---

### 4. Kế Hoạch Kiểm Thử & Nghiệm Thu

1. **Kiểm tra click trên Sector**:
   - Chuyển sang tab Vệ tinh trên modal trạm bất kỳ.
   - Click chuột vào giữa vùng quạt Sector 1, Sector 2, Sector 3.
   - Xác nhận: Hệ thống lập tức đặt điểm ghim, tính đúng khoảng cách (m) và góc phương vị (°), form tự nhận dữ liệu.
2. **Kiểm tra kéo xoay vòng 360°**:
   - Dùng chuột/ngón tay chạm giữ chốt xoay trên tia quét và quay vòng tròn quanh cột trạm.
   - Xác nhận: Tia quét xoay theo trơn tru từ 0° đến 360°, cự ly co giãn theo vị trí kéo, badge hiển thị số góc tức thời, bản đồ không bị giật hay vô tình kéo lệch tâm.
3. **Kiểm tra tính nhất quán**:
   - Khi chuyển đổi qua lại giữa tab Radar SVG và Bản đồ vệ tinh, góc phương vị và vị trí điểm khảo sát đồng bộ chính xác 100%.
