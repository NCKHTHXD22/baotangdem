# PHÁT HIỆN BẤT THƯỜNG

Web game casual (mobile-first): bạn là bảo vệ ca đêm của bảo tàng, xem từng phòng qua camera và báo **Bình thường** hay **Có gì đó sai sai**. HTML + CSS + JS thuần, không framework, không bước build.

## Cấu trúc thư mục

```
index.html        Khung các màn hình
style.css         Giao diện (tông xanh đen + vàng ấm, film grain, vignette)
scenes.js         Dữ liệu phòng + vật thể + anomaly (window.SCENES)
leaderboard.js    Bảng xếp hạng: submitScore / getTop / getRank (hiện là dữ liệu giả + localStorage)
game.js           CONFIG, GameCore (state machine), Assets, Renderer (canvas), âm thanh, ảnh khoe điểm, UI
assets/
  phong1/         bg.png + ảnh vật thể của phòng 1 (hiện trống → vẽ placeholder)
  phong2/
  shared/         vật lạ dùng chung (ghe.png, bong.png, hop.png, mat.png…)
  sounds/         correct.mp3, wrong.mp3, tick.mp3, start.mp3 (thiếu thì im lặng)
```

## Cách chạy

- Mở thẳng `index.html` bằng trình duyệt, **hoặc**
- `npx serve .` rồi mở địa chỉ được in ra (nên dùng cách này để test trên điện thoại cùng mạng Wi-Fi).
- Trên máy tính: phím ← / `1` = Bình thường, → / `2` = Sai sai.
- `index.html?dev=1` → hiện nút **🛠 Xem thử bất thường**: duyệt lần lượt bản gốc và từng anomaly của mọi phòng, có khoanh vùng. Dùng để căn tọa độ khi thay ảnh thật.

## Thêm một phòng mới

Thêm một phần tử vào `SCENES.rooms` trong `scenes.js`:

```js
{
  id: "phong3",                 // duy nhất
  name: "Phòng gốm",
  camera: "CAM 03",
  background: "assets/phong3/bg.png",
  placeholderBg: "plain",       // "lobby" | "gallery" | "plain" — chỉ dùng khi chưa có bg.png
  objects: [
    { id: "binh", label: "Bình", src: "assets/phong3/binh.png", x: 0.5, y: 0.8, w: 0.12, aspect: 1.5, ph: { shape: "vase", color: "#8a5a30" } }
  ],
  anomalies: [ /* xem bên dưới */ ]
}
```

Tọa độ là tỉ lệ 0–1 của khung 4:5: `x` = tâm ngang, `y` = **đáy** vật, `w` = bề rộng. Chiều cao tự tính theo ảnh (hoặc theo `aspect` = cao/rộng khi chưa có ảnh). Thêm `z` nếu cần ép thứ tự vẽ (mặc định vật có `y` lớn hơn nằm trước).

## Thêm một anomaly mới

Thêm vào `anomalies` của phòng:

```js
{ id: "binh_xanh", difficulty: 2, type: "recolor", target: "binh",
  filter: "hue-rotate(120deg)", tint: "rgba(60,160,220,0.45)",
  explain: "Chiếc bình đổi sang màu xanh." }
```

| type | Trường | Ý nghĩa |
|---|---|---|
| `hide` | `target` | Vật biến mất |
| `move` | `target`, `dx`, `dy` | Dời vật (tỉ lệ khung) |
| `flip` | `target` | Lật ngang |
| `scale` | `target`, `factor` | To/nhỏ hơn, neo ở đáy |
| `add` | `object: {src, x, y, w, aspect, opacity, ph}` | Thêm vật lạ |
| `recolor` | `target`, `filter`, `tint` | CSS filter; `tint` là màu phủ dự phòng khi trình duyệt không hỗ trợ `ctx.filter` |
| `swap` | `target`, `target2` | Đổi chỗ hai vật |

`difficulty` 1–4 khớp các giai đoạn trong `CONFIG.STAGES`. Vùng khoanh đáp án tự tính từ hộp bao của vật bị tác động (vị trí cũ vẽ nét đứt). Anomaly sai `target` sẽ bị bỏ qua và báo trên console.

## Luật & tinh chỉnh

Mọi con số nằm trong `CONFIG` đầu `game.js`: điểm, hệ số chuỗi, thời gian/độ khó/tỉ lệ lỗi theo giai đoạn, luật xáo trộn, danh hiệu, thời lượng hiệu ứng, file âm thanh, ảnh khoe điểm.

Ghi chú: `FIRST_VISIT_NORMAL` (mặc định bật) — lần đầu gặp một phòng trong mỗi lượt luôn là bản gốc, để người chơi có cái mà so sánh. Luật "không lặp cảnh trong 5 cảnh gần nhất" tự nới lỏng khi không còn lựa chọn (với 2 phòng, bản gốc buộc phải lặp); có từ 6 phòng trở lên thì luật được giữ chặt.

## Danh sách việc cần làm khi có ảnh thật

1. **Ảnh nền**: chụp cố định chân máy, xuất đúng tỉ lệ **4:5** (ví dụ 1080×1350), dưới ~300 KB, đặt tại `assets/<phòng>/bg.png` (hoặc sửa `background`). Ảnh khác 4:5 sẽ bị cắt (cover) và lệch tọa độ.
2. **Ảnh nền phải là phòng KHÔNG có các vật trong `objects`** (vật được tách thành PNG trong suốt và đặt lên trên). Nếu chỉ có ảnh chụp nguyên phòng: xóa vật khỏi nền bằng Photoshop/AI, rồi cắt vật thành PNG.
3. **PNG vật thể**: cắt sát mép (không thừa viền trong suốt), vì hộp bao = kích thước ảnh. Chiều cao tự lấy từ ảnh; `aspect` và `ph` bỏ qua được.
4. **Căn tọa độ** `x`, `y`, `w` cho từng vật bằng `?dev=1` cho tới khi khớp với nền.
5. **Kiểm tra lại từng anomaly**: `dx/dy`, `factor`, `filter` có còn hợp lý trên ảnh thật; `flip` chỉ dùng cho vật nhìn ra được là bị lật; `tint` dự phòng cho Safari cũ.
6. Ảnh vật lạ dùng chung (`assets/shared/…`): ghế, bóng người, thùng, đôi mắt.
7. Tắt nhãn placeholder: `CONFIG.PLACEHOLDER_LABELS = false` (nhãn chỉ hiện khi thiếu ảnh, nhưng nên tắt khi phát hành).
8. Âm thanh: thêm 4 file vào `assets/sounds/` (hoặc sửa `CONFIG.SOUNDS`).
9. Ảnh khoe điểm: điền `CONFIG.SHARE.url`, `CONFIG.SHARE.logoSrc` (logo phải cùng domain, nếu không canvas sẽ không xuất được ảnh).
10. Phát hành: `CONFIG.DEV_TOOLS = false`.
11. Bảng xếp hạng thật: viết lại ruột 3 hàm trong `leaderboard.js` bằng `fetch` tới server (Supabase/Firebase…). Để chống gian lận thật sự thì server nên phát cảnh và chấm đáp án; hiện đáp án nằm trong JS phía trình duyệt (không có trong DOM, nhưng người rành kỹ thuật vẫn đọc được `scenes.js`).
