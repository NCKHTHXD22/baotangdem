/*
 * scenes.js — Dữ liệu các phòng trưng bày.
 *
 * Quy ước tọa độ (tỉ lệ 0–1 so với khung cảnh 4:5):
 *   x = tâm ngang của vật thể, y = ĐÁY (chân) vật thể, w = bề rộng so với bề rộng khung.
 *   Chiều cao tự tính theo tỉ lệ ảnh thật; nếu chưa có ảnh thì dùng `aspect` (cao/rộng).
 *   Neo ở đáy giúp vật "đứng trên sàn" và khi phóng to (scale) không bị lơ lửng.
 *
 * Trường chỉ dùng khi CHƯA có ảnh (placeholder):
 *   room.placeholderBg: "lobby" | "gallery"  — nền vẽ bằng code
 *   object.ph: { shape, color }              — hình khối vẽ thay ảnh
 *   object.label                             — nhãn hiện trên hình khối
 *
 * Các loại anomaly:
 *   hide    { target }                 ẩn vật
 *   move    { target, dx, dy }         dời vật (tỉ lệ khung)
 *   flip    { target }                 lật ngang
 *   scale   { target, factor }         to/nhỏ hơn (neo ở đáy)
 *   add     { object: {...} }          thêm vật lạ (có thể có opacity)
 *   recolor { target, filter, tint }   đổi màu bằng CSS filter; `tint` là màu phủ dự phòng
 *                                      cho trình duyệt không hỗ trợ ctx.filter (Safari cũ)
 *   swap    { target, target2 }        đổi chỗ hai vật
 */
window.SCENES = {
  rooms: [
    {
      id: "phong1",
      name: "Sảnh chính",
      camera: "CAM 01",
      background: "assets/phong1/bg.png",
      placeholderBg: "lobby",
      objects: [
        { id: "cay",   label: "Chậu cây", src: "assets/phong1/cay.png",   x: 0.09, y: 0.90, w: 0.12, aspect: 1.8,  ph: { shape: "plant",  color: "#3f7d4a" } },
        { id: "tuong", label: "Tượng",    src: "assets/phong1/tuong.png", x: 0.27, y: 0.80, w: 0.16, aspect: 2.4,  ph: { shape: "statue", color: "#cdb98e" } },
        { id: "binh",  label: "Bình",     src: "assets/phong1/binh.png",  x: 0.70, y: 0.78, w: 0.09, aspect: 1.6,  ph: { shape: "vase",   color: "#3d8193" } },
        { id: "bang",  label: "Bảng L1",  src: "assets/phong1/bang.png",  x: 0.88, y: 0.90, w: 0.14, aspect: 2.3,  ph: { shape: "sign",   color: "#d9d3c4" } },
        { id: "ghe",   label: "Ghế dài",  src: "assets/phong1/ghe.png",   x: 0.52, y: 0.96, w: 0.26, aspect: 0.32, ph: { shape: "bench",  color: "#9a6435" } }
      ],
      anomalies: [
        { id: "tuong_quay", difficulty: 1, type: "flip",    target: "tuong", explain: "Bức tượng đã quay sang hướng khác." },
        { id: "binh_mat",   difficulty: 1, type: "hide",    target: "binh",  explain: "Chiếc bình đã biến mất. Ai mượn mà không hỏi?" },
        { id: "binh_doi",   difficulty: 2, type: "move",    target: "binh", dx: -0.22, explain: "Chiếc bình đã tự đổi chỗ." },
        { id: "ghe_la",     difficulty: 2, type: "add",     object: { id: "ghe_la", label: "Ghế", src: "assets/shared/ghe.png", x: 0.62, y: 0.88, w: 0.10, aspect: 1.5, ph: { shape: "chair", color: "#7a5a3a" } }, explain: "Có một chiếc ghế lạ giữa phòng." },
        { id: "bang_mau",   difficulty: 2, type: "recolor", target: "bang", filter: "hue-rotate(150deg) saturate(2)", tint: "rgba(60,200,170,0.45)", explain: "Màn hình bảng chỉ dẫn đã đổi màu." },
        { id: "doi_cho",    difficulty: 2, type: "swap",    target: "binh", target2: "cay", explain: "Chiếc bình và chậu cây đã đổi chỗ cho nhau." },
        { id: "tuong_to",   difficulty: 3, type: "scale",   target: "tuong", factor: 1.15, explain: "Bức tượng to hơn một chút. Chắc dạo này ăn uống tốt." },
        { id: "cay_quay",   difficulty: 3, type: "flip",    target: "cay",   explain: "Chậu cây đang nghiêng về phía ngược lại." },
        { id: "binh_nho",   difficulty: 3, type: "scale",   target: "binh", factor: 0.8, explain: "Chiếc bình nhỏ đi một chút." },
        { id: "bang_xich",  difficulty: 4, type: "move",    target: "bang", dx: -0.05, explain: "Bảng chỉ dẫn bị dời sang trái một chút." },
        { id: "bong_nguoi", difficulty: 4, type: "add",     object: { id: "bong", label: "Bóng", src: "assets/shared/bong.png", x: 0.41, y: 0.62, w: 0.06, aspect: 2.6, opacity: 0.3, ph: { shape: "ghost", color: "#dfe7f3" } }, explain: "Có một bóng người mờ đứng trên cầu thang." }
      ]
    },
    {
      id: "phong2",
      name: "Hành lang ảnh",
      camera: "CAM 02",
      background: "assets/phong2/bg.png",
      placeholderBg: "gallery",
      objects: [
        { id: "khung",   label: "Tranh",          src: "assets/phong2/khung.png",   x: 0.30, y: 0.62, w: 0.34, aspect: 0.72, ph: { shape: "frame",   color: "#b8913f" } },
        { id: "bang",    label: "Bảng giới thiệu", src: "assets/phong2/bang.png",   x: 0.62, y: 0.52, w: 0.08, aspect: 1.3,  ph: { shape: "plaque",  color: "#d8cdb4" } },
        { id: "tu_kinh", label: "Tủ kính",        src: "assets/phong2/tu_kinh.png", x: 0.75, y: 0.90, w: 0.26, aspect: 1.15, ph: { shape: "case",    color: "#ffcf7a" } },
        { id: "binh_gom",label: "Bình gốm",       src: "assets/phong2/binh_gom.png",x: 0.10, y: 0.86, w: 0.10, aspect: 1.6,  ph: { shape: "vase",    color: "#a8643a" } },
        { id: "tuong_ban",label: "Tượng bán thân", src: "assets/phong2/tuong_ban.png", x: 0.46, y: 0.88, w: 0.11, aspect: 2.0, ph: { shape: "bust", color: "#c7c1b4" } },
        { id: "ghe",     label: "Ghế dài",        src: "assets/phong2/ghe.png",     x: 0.27, y: 0.97, w: 0.24, aspect: 0.32, ph: { shape: "bench",   color: "#8a5a30" } }
      ],
      anomalies: [
        { id: "tu_tat",     difficulty: 1, type: "recolor", target: "tu_kinh", filter: "brightness(0.3)", tint: "rgba(0,0,0,0.7)", explain: "Đèn trong tủ kính đã tắt." },
        { id: "binh_mat",   difficulty: 1, type: "hide",    target: "binh_gom", explain: "Bình gốm đã biến mất khỏi bệ." },
        { id: "khung_lat",  difficulty: 2, type: "flip",    target: "khung", explain: "Bức tranh bị treo ngược chiều." },
        { id: "hop_la",     difficulty: 2, type: "add",     object: { id: "hop", label: "Thùng", src: "assets/shared/hop.png", x: 0.58, y: 0.97, w: 0.11, aspect: 0.8, ph: { shape: "box", color: "#a87b4a" } }, explain: "Ai đó bỏ quên một thùng các-tông giữa hành lang." },
        { id: "doi_cho",    difficulty: 2, type: "swap",    target: "binh_gom", target2: "tuong_ban", explain: "Bình gốm và tượng bán thân đã đổi chỗ cho nhau." },
        { id: "khung_to",   difficulty: 3, type: "scale",   target: "khung", factor: 1.12, explain: "Bức tranh to hơn một chút." },
        { id: "bang_cao",   difficulty: 3, type: "move",    target: "bang", dy: -0.07, explain: "Bảng giới thiệu được treo cao hơn." },
        { id: "tuong_mau",  difficulty: 3, type: "recolor", target: "tuong_ban", filter: "hue-rotate(180deg) saturate(3)", tint: "rgba(70,150,220,0.5)", explain: "Tượng bán thân đã đổi màu." },
        { id: "ghe_lech",   difficulty: 4, type: "move",    target: "ghe", dx: 0.06, explain: "Chiếc ghế dài bị xê dịch một chút." },
        { id: "doi_mat",    difficulty: 4, type: "add",     object: { id: "mat", label: "Mắt", src: "assets/shared/mat.png", x: 0.78, y: 0.47, w: 0.07, aspect: 0.4, opacity: 0.6, ph: { shape: "eyes", color: "#ffd36b" } }, explain: "Có một đôi mắt nhìn ra từ ô cửa tối." }
      ]
    }
  ]
};
