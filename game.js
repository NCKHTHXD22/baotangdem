/*
 * game.js — PHÁT HIỆN BẤT THƯỜNG
 *
 * Bố cục file:
 *   1. CONFIG            — mọi hằng số chỉnh game
 *   2. Tiện ích
 *   3. Mô hình cảnh      — áp "bản vá" anomaly lên phòng gốc (thuần dữ liệu)
 *   4. GameCore          — state machine + luật chơi, KHÔNG đụng tới DOM
 *   5. Assets            — tải trước ảnh, ảnh thiếu thì trả null
 *   6. Renderer          — vẽ cảnh lên <canvas> (ảnh thật hoặc placeholder)
 *   7. Âm thanh          — playSound(name)
 *   8. Ảnh khoe điểm
 *   9. UI                — nối GameCore với giao diện
 *
 * Đáp án chỉ nằm trong biến JS (closure); DOM chỉ chứa pixel trên canvas.
 */
(function () {
  "use strict";

  // ======================================================================
  // 1. CONFIG
  // ======================================================================
  const CONFIG = {
    BASE_POINTS: 100,
    SPEED_BONUS: 50,               // trả lời trong nửa đầu thời gian
    SPEED_BONUS_FRACTION: 0.5,

    // Hệ số nhân theo chuỗi (tính theo chuỗi SAU khi trả lời đúng)
    STREAK_MULTIPLIERS: [
      { min: 1, x: 1 },
      { min: 5, x: 1.5 },
      { min: 10, x: 2 },
      { min: 20, x: 3 }
    ],

    // Giai đoạn theo "cảnh thứ mấy trong chuỗi" (level = chuỗi hiện tại + 1)
    STAGES: [
      { minLevel: 1, seconds: 8, difficulty: 1, anomalyRate: 0.5 },
      { minLevel: 4, seconds: 6, difficulty: 2, anomalyRate: 0.5 },
      { minLevel: 10, seconds: 4, difficulty: 3, anomalyRate: 0.6 },
      { minLevel: 20, seconds: 3, difficulty: 4, anomalyRate: 0.6 }
    ],

    // Trọng số chọn anomaly: đúng độ khó giai đoạn / thấp hơn 1 bậc (cho đa dạng)
    DIFFICULTY_WEIGHTS: { exact: 3, lower: 1 },
    MAX_SAME_KIND: 3,              // không quá 3 cảnh liên tiếp cùng loại
    RECENT_WINDOW: 5,              // không lặp đúng cảnh trong 5 cảnh gần nhất
    FIRST_VISIT_NORMAL: true,      // lần đầu gặp một phòng trong lượt luôn là bản gốc (để người chơi "ghi nhớ")

    TITLES: [
      { min: 0, name: "Thực tập sinh ca đêm" },
      { min: 3, name: "Bảo vệ tập sự" },
      { min: 7, name: "Bảo vệ tinh mắt" },
      { min: 12, name: "Bảo vệ chính hiệu" },
      { min: 20, name: "Huyền thoại ca đêm" }
    ],

    TIMER_LOW_FRACTION: 0.3,
    FADE_MS: 150,
    CORRECT_FLASH_MS: 380,
    WRONG_REVEAL_MS: 2000,
    VIBRATE_WRONG: [70, 40, 110],

    SCENE_ASPECT: 4 / 5,           // rộng / cao của khung cảnh
    MAX_DPR: 2,
    PLACEHOLDER_LABELS: true,      // hiện nhãn tên trên hình khối placeholder

    SOUNDS: {
      correct: "assets/sounds/correct.mp3",
      wrong: "assets/sounds/wrong.mp3",
      tick: "assets/sounds/tick.mp3",
      start: "assets/sounds/start.mp3"
    },
    SYNTH_FALLBACK: false,         // true: thiếu file thì phát tiếng "bíp" tổng hợp để test

    NICKNAME_MIN: 2,
    NICKNAME_MAX: 16,
    NIGHT_CLOCK_START: 22 * 60,    // đồng hồ camera bắt đầu 22:00
    MINUTES_PER_SCENE: 7,

    STORAGE: { name: "pbt_name", muted: "pbt_muted", best: "pbt_best" },

    SHARE: {
      width: 1080,
      height: 1920,
      footer: "Bạn có tinh mắt hơn tôi không?",
      url: "",                     // điền link game khi có, ví dụ "baotang.vn/game"
      logoSrc: null                // ví dụ "assets/logo.png" (phải cùng domain để xuất ảnh)
    },

    DEV_TOOLS: true,               // mở ?dev=1 để xem thử từng anomaly. Đặt false khi phát hành.

    TEXT: {
      correct: ["Ổn.", "Chuẩn!", "Mắt tốt đấy.", "Tiếp tục tuần tra.", "Không qua mắt bạn được."],
      missedTitle: "Bỏ sót rồi!",
      falseAlarmTitle: "Báo nhầm!",
      falseAlarmText: "Phòng này hoàn toàn bình thường. Báo nhầm là bị trừ lương đó.",
      timeoutTitle: "Hết giờ!",
      timeoutNormalText: "Phòng này bình thường… nhưng bạn đã ngủ gật."
    }
  };

  // ======================================================================
  // 2. Tiện ích
  // ======================================================================
  const $ = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const pickOne = (arr, rng = Math.random) => arr[Math.floor(rng() * arr.length)];

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* bỏ qua */ } }
  };

  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  }

  function seeded(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Làm sáng/tối màu hex: amt trong [-1, 1]
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const f = (c) => Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt);
    return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
  }

  function roundRectPath(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  // ======================================================================
  // 3. Mô hình cảnh: phòng gốc + bản vá anomaly → danh sách vật thể để vẽ
  // ======================================================================
  function baseObject(o) {
    return Object.assign({ flip: false, scale: 1, opacity: 1, hidden: false, filter: null, tint: null }, o);
  }

  /**
   * Trả về { objects, marks }.
   * marks: các vật cần khoanh khi lộ đáp án; ghost = vị trí CŨ (vẽ nét đứt).
   */
  function buildLayout(room, anomaly) {
    const objects = room.objects.map(baseObject);
    const marks = [];
    if (!anomaly) return { objects, marks };

    const find = (id) => objects.find((o) => o.id === id);
    const snapshot = (o) => Object.assign({}, o);
    const t = anomaly.target ? find(anomaly.target) : null;

    switch (anomaly.type) {
      case "hide":
        marks.push({ obj: snapshot(t), ghost: true });
        t.hidden = true;
        break;
      case "move":
        marks.push({ obj: snapshot(t), ghost: true });
        t.x += anomaly.dx || 0;
        t.y += anomaly.dy || 0;
        marks.push({ obj: t });
        break;
      case "flip":
        t.flip = !t.flip;
        marks.push({ obj: t });
        break;
      case "scale":
        t.scale *= anomaly.factor || 1;
        marks.push({ obj: t });
        break;
      case "recolor":
        t.filter = anomaly.filter || null;
        t.tint = anomaly.tint || null;
        marks.push({ obj: t });
        break;
      case "swap": {
        const b = find(anomaly.target2);
        [t.x, b.x] = [b.x, t.x];
        [t.y, b.y] = [b.y, t.y];
        marks.push({ obj: t }, { obj: b });
        break;
      }
      case "add": {
        const added = baseObject(Object.assign({ id: "__add_" + anomaly.id }, anomaly.object));
        objects.push(added);
        marks.push({ obj: added });
        break;
      }
    }
    return { objects, marks };
  }

  // Kiểm tra dữ liệu scenes.js, cảnh báo ra console và loại anomaly hỏng
  function validateScenes(data) {
    const TYPES = ["hide", "move", "flip", "scale", "add", "recolor", "swap"];
    for (const room of data.rooms) {
      const ids = new Set(room.objects.map((o) => o.id));
      room.anomalies = (room.anomalies || []).filter((a) => {
        const bad =
          !TYPES.includes(a.type) ? "type không hợp lệ" :
          a.type === "add" ? (!a.object ? "thiếu object" : null) :
          !ids.has(a.target) ? `không có vật "${a.target}"` :
          a.type === "swap" && !ids.has(a.target2) ? `không có vật "${a.target2}"` : null;
        if (bad) console.warn(`[scenes] ${room.id}/${a.id}: ${bad} — bỏ qua anomaly này`);
        return !bad;
      });
    }
    return data;
  }

  // ======================================================================
  // 4. GameCore — state machine: menu → playing → feedback → (playing | result)
  // ======================================================================
  function createGameCore(data, cfg, rng = Math.random) {
    const normals = data.rooms.map((room) => ({ key: room.id + ":normal", room, anomaly: null, hasAnomaly: false }));
    const anomalous = data.rooms.flatMap((room) =>
      room.anomalies.map((a) => ({ key: room.id + ":" + a.id, room, anomaly: a, hasAnomaly: true })));

    let s = fresh("menu");

    function fresh(state) {
      return {
        state, score: 0, streak: 0, bestStreak: 0, sceneIndex: 0,
        kinds: [], recent: [], seenRooms: new Set(),
        current: null, next: null, sceneStart: 0, limitMs: 0
      };
    }

    const stageFor = (level) => cfg.STAGES.reduce((acc, st) => (level >= st.minLevel ? st : acc), cfg.STAGES[0]);
    const multiplierFor = (streak) => cfg.STREAK_MULTIPLIERS.reduce((acc, m) => (streak >= m.min ? m.x : acc), 1);
    const titleFor = (best) => cfg.TITLES.reduce((acc, t) => (best >= t.min ? t.name : acc), cfg.TITLES[0].name);
    const level = () => s.streak + 1;

    // Loại các cảnh vừa xem; nếu không còn gì thì nới dần cửa sổ
    function avoidRecent(pool) {
      for (const win of [cfg.RECENT_WINDOW, 2, 1]) {
        const recent = s.recent.slice(-win);
        const left = pool.filter((c) => !recent.includes(c.key));
        if (left.length) return left;
      }
      return pool;
    }

    function pickAnomaly(pool, targetDiff) {
      const W = cfg.DIFFICULTY_WEIGHTS;
      const weightFns = [
        (d) => (d === targetDiff ? W.exact : d === targetDiff - 1 ? W.lower : 0),
        (d) => (d <= targetDiff ? 1 : 0),
        () => 1
      ];
      for (const wf of weightFns) {
        const weights = pool.map((c) => wf(c.anomaly.difficulty));
        const total = weights.reduce((a, b) => a + b, 0);
        if (!total) continue;
        let r = rng() * total;
        for (let i = 0; i < pool.length; i++) if ((r -= weights[i]) < 0) return pool[i];
        return pool[pool.length - 1];
      }
      return null;
    }

    function pickScene(lv) {
      const stage = stageFor(lv);
      let wantAnomaly = rng() < stage.anomalyRate;
      if (lv === 1 && cfg.FIRST_VISIT_NORMAL) wantAnomaly = false;
      const tail = s.kinds.slice(-cfg.MAX_SAME_KIND);
      if (tail.length === cfg.MAX_SAME_KIND && tail.every((k) => k === tail[0])) wantAnomaly = !tail[0];

      let scene = null;
      if (wantAnomaly) {
        const pool = anomalous.filter((c) => !cfg.FIRST_VISIT_NORMAL || s.seenRooms.has(c.room.id));
        if (pool.length) scene = pickAnomaly(avoidRecent(pool), stage.difficulty);
      }
      if (!scene) {
        const unseen = normals.filter((c) => !s.seenRooms.has(c.room.id));
        const pool = cfg.FIRST_VISIT_NORMAL && unseen.length ? unseen : normals;
        scene = pickOne(avoidRecent(pool), rng);
      }

      s.kinds.push(scene.hasAnomaly);
      s.recent.push(scene.key);
      s.seenRooms.add(scene.room.id);
      if (s.kinds.length > 20) { s.kinds.shift(); s.recent.shift(); }
      return scene;
    }

    function resolve(correct, reason, elapsed) {
      s.state = "feedback";
      if (!correct) return { correct: false, reason, scene: s.current };
      s.streak++;
      s.bestStreak = Math.max(s.bestStreak, s.streak);
      const mult = multiplierFor(s.streak);
      const fast = elapsed <= s.limitMs * cfg.SPEED_BONUS_FRACTION;
      const points = Math.round(cfg.BASE_POINTS * mult) + (fast ? cfg.SPEED_BONUS : 0);
      s.score += points;
      return { correct: true, points, mult, fast, streak: s.streak };
    }

    return {
      get state() { return s.state; },
      get current() { return s.current; },
      get next() { return s.next; },

      start() {
        s = fresh("loading");
        s.current = pickScene(1);
        s.next = pickScene(2); // chọn trước để tải trước ảnh (giả định trả lời đúng)
        return s.current;
      },

      // Gọi khi cảnh đã hiện trên màn hình: bắt đầu tính giờ
      beginScene(now) {
        s.state = "playing";
        s.sceneStart = now;
        s.limitMs = stageFor(level()).seconds * 1000;
      },

      remainingFraction(now) {
        if (s.state !== "playing") return 0;
        return Math.max(0, 1 - (now - s.sceneStart) / s.limitMs);
      },

      remainingMs(now) {
        return s.state === "playing" ? Math.max(0, s.limitMs - (now - s.sceneStart)) : 0;
      },

      answer(saidAnomaly, now) {
        if (s.state !== "playing") return null;
        const elapsed = now - s.sceneStart;
        if (elapsed > s.limitMs) return this.timeout();
        const correct = saidAnomaly === s.current.hasAnomaly;
        return resolve(correct, saidAnomaly ? "false_alarm" : "missed", elapsed);
      },

      timeout() {
        if (s.state !== "playing") return null;
        return resolve(false, "timeout", s.limitMs);
      },

      advance() {
        s.sceneIndex++;
        s.current = s.next;
        s.next = pickScene(level() + 1);
        s.state = "loading";
        return s.current;
      },

      finish() {
        s.state = "result";
        return { score: s.score, bestStreak: s.bestStreak, title: titleFor(s.bestStreak) };
      },

      toMenu() { s = fresh("menu"); },

      hud() {
        return { score: s.score, streak: s.streak, nextMultiplier: multiplierFor(s.streak + 1), sceneIndex: s.sceneIndex };
      }
    };
  }

  // ======================================================================
  // 5. Assets — tải ảnh; ảnh lỗi/thiếu → null để renderer vẽ placeholder
  // ======================================================================
  const Assets = {
    pending: new Map(),
    loaded: new Map(),

    load(src) {
      if (!src) return Promise.resolve(null);
      if (!this.pending.has(src)) {
        this.pending.set(src, new Promise((resolve) => {
          const img = new Image();
          img.decoding = "async";
          img.onload = () => { this.loaded.set(src, img); resolve(img); };
          img.onerror = () => { this.loaded.set(src, null); resolve(null); };
          img.src = src;
        }));
      }
      return this.pending.get(src);
    },

    peek(src) { return (src && this.loaded.get(src)) || null; },

    sourcesOfRoom(room) {
      const list = [room.background, ...room.objects.map((o) => o.src)];
      for (const a of room.anomalies) if (a.object) list.push(a.object.src);
      return list.filter(Boolean);
    },

    // Tải cả phòng (kể cả ảnh vật lạ) nên việc tải không tiết lộ cảnh có lỗi hay không
    loadRoom(room) { return Promise.all(this.sourcesOfRoom(room).map((s) => this.load(s))); }
  };

  // ======================================================================
  // 6. Renderer — vẽ cảnh lên canvas
  // ======================================================================
  const FILTER_OK = (() => {
    try {
      const c = document.createElement("canvas").getContext("2d");
      c.filter = "blur(2px)";
      return c.filter === "blur(2px)";
    } catch (e) { return false; }
  })();

  // Hình khối placeholder: vẽ trong hộp (0,0,w,h). Cố tình KHÔNG đối xứng để thấy được khi lật.
  const SHAPES = {
    statue(c, w, h, col) {
      c.fillStyle = "#4f4940"; c.fillRect(w * 0.12, h * 0.74, w * 0.76, h * 0.26);
      c.fillStyle = "#666053"; c.fillRect(w * 0.06, h * 0.71, w * 0.88, h * 0.04);
      c.fillStyle = col;
      c.beginPath(); c.moveTo(w * 0.3, h * 0.71); c.lineTo(w * 0.36, h * 0.34); c.lineTo(w * 0.62, h * 0.34); c.lineTo(w * 0.7, h * 0.71); c.closePath(); c.fill();
      c.beginPath(); c.arc(w * 0.56, h * 0.24, w * 0.14, 0, Math.PI * 2); c.fill();
      c.strokeStyle = col; c.lineWidth = w * 0.1; c.lineCap = "round";
      c.beginPath(); c.moveTo(w * 0.58, h * 0.4); c.lineTo(w * 0.9, h * 0.25); c.stroke();
      c.fillStyle = "rgba(0,0,0,0.22)";
      c.beginPath(); c.moveTo(w * 0.3, h * 0.71); c.lineTo(w * 0.36, h * 0.34); c.lineTo(w * 0.45, h * 0.34); c.lineTo(w * 0.44, h * 0.71); c.closePath(); c.fill();
    },
    vase(c, w, h, col) {
      c.fillStyle = col;
      c.beginPath();
      c.moveTo(w * 0.36, 0); c.lineTo(w * 0.64, 0);
      c.quadraticCurveTo(w * 0.6, h * 0.2, w * 0.92, h * 0.55);
      c.quadraticCurveTo(w * 0.95, h * 0.95, w * 0.65, h);
      c.lineTo(w * 0.35, h);
      c.quadraticCurveTo(w * 0.05, h * 0.95, w * 0.08, h * 0.55);
      c.quadraticCurveTo(w * 0.4, h * 0.2, w * 0.36, 0);
      c.fill();
      c.fillStyle = shade(col, 0.35); c.fillRect(w * 0.14, h * 0.5, w * 0.72, h * 0.07);
      c.strokeStyle = shade(col, -0.3); c.lineWidth = w * 0.07;
      c.beginPath(); c.arc(w * 0.82, h * 0.3, w * 0.14, -Math.PI / 2, Math.PI / 2); c.stroke();
    },
    frame(c, w, h, col) {
      c.fillStyle = col; c.fillRect(0, 0, w, h);
      c.fillStyle = shade(col, -0.35); c.fillRect(w * 0.06, h * 0.06, w * 0.88, h * 0.88);
      const g = c.createLinearGradient(0, h * 0.1, 0, h * 0.9);
      g.addColorStop(0, "#2d3f5c"); g.addColorStop(1, "#7a4f35");
      c.fillStyle = g; c.fillRect(w * 0.1, h * 0.1, w * 0.8, h * 0.8);
      c.fillStyle = "#ffd36b"; c.beginPath(); c.arc(w * 0.28, h * 0.3, w * 0.08, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#26324a";
      c.beginPath(); c.moveTo(w * 0.1, h * 0.9); c.lineTo(w * 0.72, h * 0.36); c.lineTo(w * 0.9, h * 0.55); c.lineTo(w * 0.9, h * 0.9); c.closePath(); c.fill();
    },
    sign(c, w, h, col) {
      c.fillStyle = "#34373d"; c.fillRect(0, 0, w, h);
      c.fillStyle = "#e8e3d6"; c.font = `900 ${w * 0.26}px ${"system-ui, sans-serif"}`;
      c.textBaseline = "top"; c.textAlign = "left"; c.fillText("L1", w * 0.1, h * 0.04);
      c.fillStyle = col; c.fillRect(w * 0.12, h * 0.25, w * 0.76, h * 0.6);
      const bars = ["#e05b78", "#f2b84b", "#4fb3e8", "#9a6be0", "#5bd18e"];
      bars.forEach((b, i) => { c.fillStyle = b; c.fillRect(w * 0.2, h * (0.4 + i * 0.07), w * (0.35 + (i % 3) * 0.12), h * 0.035); });
    },
    bench(c, w, h, col) {
      c.fillStyle = shade(col, -0.35); c.fillRect(w * 0.06, h * 0.45, w * 0.08, h * 0.55); c.fillRect(w * 0.86, h * 0.45, w * 0.08, h * 0.55);
      c.fillStyle = col; c.fillRect(0, 0, w, h * 0.5);
      c.fillStyle = shade(col, 0.2); c.fillRect(0, 0, w, h * 0.12);
    },
    plant(c, w, h, col) {
      c.fillStyle = "#8a4a2a";
      c.beginPath(); c.moveTo(w * 0.2, h * 0.65); c.lineTo(w * 0.8, h * 0.65); c.lineTo(w * 0.7, h); c.lineTo(w * 0.3, h); c.closePath(); c.fill();
      c.fillStyle = col;
      const leaves = [[0.5, 0.35, 0.18, 0.32, 0.3], [0.7, 0.3, 0.14, 0.3, 0.8], [0.32, 0.45, 0.13, 0.25, -0.5], [0.82, 0.12, 0.12, 0.22, 0.9]];
      for (const [x, y, rx, ry, rot] of leaves) { c.beginPath(); c.ellipse(w * x, h * y, w * rx, h * ry, rot, 0, Math.PI * 2); c.fill(); }
      c.fillStyle = shade(col, -0.3); c.beginPath(); c.ellipse(w * 0.6, h * 0.42, w * 0.1, h * 0.2, 0.5, 0, Math.PI * 2); c.fill();
    },
    chair(c, w, h, col) {
      c.fillStyle = col;
      c.fillRect(w * 0.1, 0, w * 0.14, h * 0.62);
      c.fillRect(w * 0.1, h * 0.5, w * 0.8, h * 0.1);
      c.fillStyle = shade(col, -0.3);
      c.fillRect(w * 0.12, h * 0.6, w * 0.08, h * 0.4); c.fillRect(w * 0.8, h * 0.6, w * 0.08, h * 0.4);
    },
    ghost(c, w, h, col) {
      c.fillStyle = col;
      c.beginPath(); c.arc(w * 0.5, h * 0.12, w * 0.22, 0, Math.PI * 2); c.fill();
      c.beginPath();
      c.moveTo(w * 0.15, h); c.quadraticCurveTo(w * 0.1, h * 0.3, w * 0.5, h * 0.25);
      c.quadraticCurveTo(w * 0.9, h * 0.3, w * 0.85, h); c.closePath(); c.fill();
    },
    case(c, w, h, col) {
      c.fillStyle = "#3a2615"; c.fillRect(0, h * 0.72, w, h * 0.28);
      const g = c.createRadialGradient(w * 0.5, h * 0.2, 0, w * 0.5, h * 0.35, w * 0.6);
      g.addColorStop(0, col); g.addColorStop(1, "rgba(255,200,120,0.05)");
      c.fillStyle = g; c.fillRect(w * 0.04, 0, w * 0.92, h * 0.72);
      c.strokeStyle = "rgba(220,235,255,0.6)"; c.lineWidth = Math.max(1, w * 0.015); c.strokeRect(w * 0.04, 0, w * 0.92, h * 0.72);
      c.fillStyle = "#6b4b2a"; c.fillRect(w * 0.3, h * 0.56, w * 0.4, h * 0.16);
      c.fillStyle = "#e9c46a"; c.beginPath(); c.arc(w * 0.45, h * 0.45, w * 0.1, 0, Math.PI * 2); c.fill();
    },
    plaque(c, w, h, col) {
      c.fillStyle = col; c.fillRect(0, 0, w, h);
      c.fillStyle = "rgba(0,0,0,0.55)"; c.fillRect(w * 0.12, h * 0.12, w * 0.6, h * 0.1);
      for (let i = 0; i < 5; i++) c.fillRect(w * 0.12, h * (0.32 + i * 0.12), w * (0.76 - (i % 2) * 0.2), h * 0.05);
    },
    bust(c, w, h, col) {
      c.fillStyle = "#4b4339"; c.fillRect(w * 0.15, h * 0.55, w * 0.7, h * 0.45);
      c.fillStyle = col;
      c.beginPath(); c.ellipse(w * 0.5, h * 0.52, w * 0.42, h * 0.09, 0, Math.PI, 0); c.fill();
      c.fillRect(w * 0.4, h * 0.32, w * 0.2, h * 0.14);
      c.beginPath(); c.arc(w * 0.5, h * 0.22, w * 0.24, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.moveTo(w * 0.7, h * 0.18); c.lineTo(w * 0.84, h * 0.25); c.lineTo(w * 0.7, h * 0.27); c.fill();
    },
    box(c, w, h, col) {
      c.fillStyle = col; c.fillRect(0, h * 0.15, w, h * 0.85);
      c.fillStyle = shade(col, 0.2); c.beginPath(); c.moveTo(0, h * 0.15); c.lineTo(w * 0.15, 0); c.lineTo(w * 0.6, 0); c.lineTo(w * 0.5, h * 0.15); c.fill();
      c.fillStyle = "#d9c79a"; c.fillRect(w * 0.42, h * 0.15, w * 0.16, h * 0.85);
    },
    eyes(c, w, h, col) {
      c.shadowColor = col; c.shadowBlur = w * 0.3;
      c.fillStyle = col;
      c.beginPath(); c.ellipse(w * 0.25, h * 0.5, w * 0.17, h * 0.3, 0, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.ellipse(w * 0.75, h * 0.5, w * 0.17, h * 0.3, 0, 0, Math.PI * 2); c.fill();
      c.shadowBlur = 0; c.fillStyle = "#111";
      c.beginPath(); c.arc(w * 0.29, h * 0.52, w * 0.06, 0, Math.PI * 2); c.arc(w * 0.79, h * 0.52, w * 0.06, 0, Math.PI * 2); c.fill();
    },
    rect(c, w, h, col) { c.fillStyle = col; c.fillRect(0, 0, w, h); }
  };

  // Nền placeholder (vẽ bằng code, có hạt giống theo phòng → luôn giống hệt nhau)
  const BACKGROUNDS = {
    lobby(c, W, H, rnd) {
      // Vách kính bên trái
      let g = c.createLinearGradient(0, 0, W * 0.3, 0);
      g.addColorStop(0, "#0b1524"); g.addColorStop(1, "#18283d");
      c.fillStyle = g; c.fillRect(0, 0, W * 0.3, H * 0.7);
      c.fillStyle = "rgba(150,190,230,0.12)";
      for (let i = 0; i < 5; i++) c.fillRect(W * (0.02 + i * 0.058), H * 0.06, W * 0.007, H * 0.63);
      // Mặt tiền màu kem phía sau
      c.fillStyle = "#4b4436"; c.fillRect(W * 0.28, H * 0.12, W * 0.46, H * 0.44);
      c.strokeStyle = "#625946"; c.lineWidth = W * 0.004;
      for (const x of [0.33, 0.45, 0.6]) {
        c.fillStyle = "#2c271e"; c.fillRect(W * x, H * 0.19, W * 0.075, H * 0.11); c.strokeRect(W * x, H * 0.19, W * 0.075, H * 0.11);
      }
      c.fillStyle = "#24190f"; c.fillRect(W * 0.465, H * 0.38, W * 0.075, H * 0.16);
      c.fillStyle = "rgba(255,190,100,0.22)"; c.fillRect(W * 0.475, H * 0.4, W * 0.055, H * 0.14);
      // Cầu thang
      for (let i = 0; i < 9; i++) {
        c.fillStyle = i % 2 ? "#4a2a1b" : "#5b3423";
        c.fillRect(W * 0.28, H * (0.54 + i * 0.017), W * 0.46, H * 0.018);
      }
      // Tường gỗ cam bên phải + vách lam
      g = c.createLinearGradient(0, 0, 0, H * 0.72);
      g.addColorStop(0, "#6c3d18"); g.addColorStop(1, "#3c230f");
      c.fillStyle = g; c.fillRect(W * 0.72, 0, W * 0.28, H * 0.72);
      const px = W * 0.76, py = H * 0.08, pw = W * 0.18, ph = H * 0.34, cols = 7, rows = 14;
      c.fillStyle = "#8c7b5c"; c.fillRect(px, py, pw, ph);
      c.fillStyle = "#2b1d10";
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
        const cw = pw / cols, ch = ph / rows;
        c.fillRect(px + i * cw + cw * 0.2, py + j * ch + ch * 0.2, cw * (0.35 + 0.3 * rnd()), ch * 0.6);
      }
      // Trần lưới gỗ + đèn
      c.fillStyle = "#16100a"; c.fillRect(0, 0, W, H * 0.1);
      c.strokeStyle = "rgba(150,110,60,0.35)"; c.lineWidth = 1;
      for (let i = 0; i <= 24; i++) { c.beginPath(); c.moveTo(W * i / 24, 0); c.lineTo(W * i / 24, H * 0.1); c.stroke(); }
      for (let j = 0; j <= 4; j++) { c.beginPath(); c.moveTo(0, H * 0.025 * j); c.lineTo(W, H * 0.025 * j); c.stroke(); }
      for (let i = 0; i < 6; i++) spot(c, W * (0.33 + i * 0.075), H * 0.135, W * 0.05);
      // Sàn gỗ
      floor(c, W, H, 0.68, "#3b2414", "#6b4325", W * 0.5, H * 0.45);
      // Thảm đỏ
      c.fillStyle = "#6a1414";
      c.beginPath(); c.moveTo(W * 0.45, H * 0.68); c.lineTo(W * 0.55, H * 0.68); c.lineTo(W * 0.72, H); c.lineTo(W * 0.28, H); c.closePath(); c.fill();
      c.fillStyle = "rgba(255,255,255,0.05)";
      c.beginPath(); c.moveTo(W * 0.45, H * 0.68); c.lineTo(W * 0.47, H * 0.68); c.lineTo(W * 0.33, H); c.lineTo(W * 0.28, H); c.closePath(); c.fill();
    },

    gallery(c, W, H, rnd) {
      c.fillStyle = "#221c13"; c.fillRect(0, 0, W, H);
      // Vùng sáng đèn rọi trên tường
      for (const [x, y, r] of [[0.3, 0.32, 0.4], [0.62, 0.45, 0.22], [0.12, 0.6, 0.2]]) {
        const g = c.createRadialGradient(W * x, H * y, 0, W * x, H * y, W * r);
        g.addColorStop(0, "rgba(255,190,110,0.22)"); g.addColorStop(1, "rgba(255,190,110,0)");
        c.fillStyle = g; c.fillRect(0, 0, W, H);
      }
      // Trần + ray đèn
      c.fillStyle = "#0d0b08"; c.fillRect(0, 0, W, H * 0.12);
      c.fillStyle = "#000"; c.fillRect(W * 0.04, H * 0.095, W * 0.92, H * 0.008);
      for (let i = 0; i < 8; i++) { c.fillStyle = "#1a1a1a"; c.fillRect(W * (0.08 + i * 0.11), H * 0.1, W * 0.025, H * 0.02); }
      // Dải ảnh tư liệu (cố định, thuộc nền)
      const palette = ["#b5653a", "#d9a441", "#5b7fa6", "#8c3b3b", "#c9b48a", "#3e6b55", "#6e5aa0", "#a8a29a", "#101010"];
      const gx = W * 0.05, gy = H * 0.15, gw = W * 0.54, gh = H * 0.23, cols = 7, rows = 3;
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
        const cw = gw / cols, ch = gh / rows;
        const col = palette[Math.floor(rnd() * palette.length)];
        c.fillStyle = col; c.fillRect(gx + i * cw + 2, gy + j * ch + 2, cw - 4, ch - 4);
        c.fillStyle = "rgba(255,255,255,0.12)"; c.fillRect(gx + i * cw + 2, gy + j * ch + ch * 0.55, cw - 4, ch * 0.12);
      }
      // Ô cửa tối + chữ
      c.fillStyle = "#090807"; c.fillRect(W * 0.68, H * 0.29, W * 0.2, H * 0.41);
      c.fillStyle = "rgba(230,220,200,0.55)"; c.textAlign = "left"; c.textBaseline = "alphabetic";
      c.font = `700 ${W * 0.028}px system-ui, sans-serif`; c.fillText("KHU TRƯNG BÀY CHÍNH", W * 0.62, H * 0.255);
      c.font = `500 ${W * 0.022}px system-ui, sans-serif`; c.fillText("← LỐI VÀO", W * 0.62, H * 0.275);
      floor(c, W, H, 0.7, "#4a2e17", "#7a4c26", W * 0.62, H * 0.5);
    },

    plain(c, W, H) {
      c.fillStyle = "#1d2433"; c.fillRect(0, 0, W, H);
      floor(c, W, H, 0.7, "#2b2118", "#4a3524", W * 0.5, H * 0.5);
    }
  };

  function spot(c, x, y, r) {
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(255,235,180,0.95)"); g.addColorStop(0.15, "rgba(255,220,150,0.5)"); g.addColorStop(1, "rgba(255,200,120,0)");
    c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  }

  // Sàn gỗ phối cảnh: các đường hội tụ về điểm (vx, vy)
  function floor(c, W, H, top, c1, c2, vx, vy) {
    const y0 = H * top;
    const g = c.createLinearGradient(0, y0, 0, H);
    g.addColorStop(0, c1); g.addColorStop(1, c2);
    c.fillStyle = g; c.fillRect(0, y0, W, H - y0);
    c.strokeStyle = "rgba(0,0,0,0.25)"; c.lineWidth = 1;
    const k = (y0 - vy) / (H - vy);
    for (let i = -14; i <= 14; i++) {
      const bx = vx + i * W * 0.12;
      c.beginPath(); c.moveTo(vx + (bx - vx) * k, y0); c.lineTo(bx, H); c.stroke();
    }
    c.strokeStyle = "rgba(0,0,0,0.14)";
    for (let j = 1; j <= 8; j++) { const y = y0 + (H - y0) * Math.pow(j / 8, 1.7); c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
    const sheen = c.createRadialGradient(W * 0.5, H * 0.85, 0, W * 0.5, H * 0.85, W * 0.6);
    sheen.addColorStop(0, "rgba(255,210,150,0.10)"); sheen.addColorStop(1, "rgba(255,210,150,0)");
    c.fillStyle = sheen; c.fillRect(0, y0, W, H - y0);
  }

  const Renderer = {
    canvas: null, ctx: null, W: 0, H: 0, bgCache: new Map(),

    init(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
    },

    resize(cssW, cssH) {
      const dpr = Math.min(window.devicePixelRatio || 1, CONFIG.MAX_DPR);
      const W = Math.round(cssW * dpr), H = Math.round(cssH * dpr);
      if (W === this.W && H === this.H) return false;
      this.canvas.width = this.W = W;
      this.canvas.height = this.H = H;
      this.bgCache.clear();
      return true;
    },

    // Hộp bao (tỉ lệ 0–1) của vật thể: x là tâm, y là đáy
    boxOf(o) {
      const img = Assets.peek(o.src);
      const aspect = img ? img.naturalHeight / img.naturalWidth : (o.aspect || 1);
      const w = o.w * o.scale;
      const h = w * aspect * CONFIG.SCENE_ASPECT;
      return { x: o.x - w / 2, y: o.y - h, w, h };
    },

    background(room) {
      const key = room.id + "|" + this.W + "x" + this.H;
      if (this.bgCache.has(key)) return this.bgCache.get(key);
      const off = document.createElement("canvas");
      off.width = this.W; off.height = this.H;
      const c = off.getContext("2d");
      const img = Assets.peek(room.background);
      if (img) {
        // Phủ kín (cover). Nên xuất ảnh đúng 4:5 để không bị cắt.
        const s = Math.max(this.W / img.naturalWidth, this.H / img.naturalHeight);
        const iw = img.naturalWidth * s, ih = img.naturalHeight * s;
        c.drawImage(img, (this.W - iw) / 2, (this.H - ih) / 2, iw, ih);
      } else {
        const draw = BACKGROUNDS[room.placeholderBg] || BACKGROUNDS.plain;
        draw(c, this.W, this.H, seeded(hashStr(room.id)));
        c.fillStyle = "rgba(4,8,22,0.28)"; // phủ tối "ban đêm"
        c.fillRect(0, 0, this.W, this.H);
      }
      this.bgCache.set(key, off);
      return off;
    },

    drawObject(c, o) {
      if (o.hidden) return;
      const b = this.boxOf(o);
      const px = b.x * this.W, py = b.y * this.H, pw = b.w * this.W, ph = b.h * this.H;
      const img = Assets.peek(o.src);
      // Trình duyệt không có ctx.filter: vẽ ra canvas phụ rồi phủ màu `tint`
      const useTint = o.filter && !FILTER_OK && o.tint;
      let t = c, ox = px, oy = py, off = null;
      if (useTint) {
        off = document.createElement("canvas");
        off.width = Math.max(1, Math.ceil(pw)); off.height = Math.max(1, Math.ceil(ph));
        t = off.getContext("2d"); ox = 0; oy = 0;
      }
      t.save();
      if (!useTint) t.globalAlpha = o.opacity;
      if (o.filter && FILTER_OK) t.filter = o.filter;
      t.translate(ox + (o.flip ? pw : 0), oy);
      t.scale(o.flip ? -1 : 1, 1);
      if (img) t.drawImage(img, 0, 0, pw, ph);
      else (SHAPES[(o.ph && o.ph.shape) || "rect"] || SHAPES.rect)(t, pw, ph, (o.ph && o.ph.color) || "#888888");
      t.restore();
      if (useTint) {
        t.globalCompositeOperation = "source-atop";
        t.fillStyle = o.tint; t.fillRect(0, 0, off.width, off.height);
        c.save(); c.globalAlpha = o.opacity; c.drawImage(off, px, py); c.restore();
      }
      if (!img && CONFIG.PLACEHOLDER_LABELS) this.drawLabel(c, o.label || o.id, px + pw / 2, py, o.opacity);
    },

    drawLabel(c, text, cx, top, alpha) {
      const fs = Math.max(10, this.W * 0.026);
      c.save();
      c.globalAlpha = alpha * 0.85;
      c.font = `600 ${fs}px system-ui, sans-serif`;
      const tw = c.measureText(text).width + fs * 0.8;
      const y = Math.max(2, top - fs * 1.5);
      c.fillStyle = "rgba(0,0,0,0.55)";
      roundRectPath(c, cx - tw / 2, y, tw, fs * 1.35, fs * 0.4); c.fill();
      c.fillStyle = "#f3eee2"; c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText(text, cx, y + fs * 0.7);
      c.restore();
    },

    draw(room, layout) {
      const c = this.ctx;
      c.clearRect(0, 0, this.W, this.H);
      c.drawImage(this.background(room), 0, 0);
      // Vẽ theo z rồi theo đáy (vật ở thấp hơn nằm trước)
      const order = layout.objects.slice().sort((a, b) => (a.z || 0) - (b.z || 0) || a.y - b.y);
      for (const o of order) this.drawObject(c, o);
    },

    // Lộ đáp án: làm tối cảnh, chừa "lỗ" sáng quanh vật bị tác động
    drawMarks(marks) {
      if (!marks.length) return;
      const c = this.ctx, W = this.W, H = this.H, pad = 0.018;
      const rects = marks.map((m) => {
        const b = this.boxOf(m.obj);
        return { ghost: m.ghost, x: (b.x - pad) * W, y: (b.y - pad) * H, w: (b.w + pad * 2) * W, h: (b.h + pad * 2) * H };
      });
      c.save();
      c.beginPath();
      c.rect(0, 0, W, H);
      for (const r of rects) c.rect(r.x, r.y, r.w, r.h);
      c.fillStyle = "rgba(0,0,0,0.5)";
      c.fill("evenodd");
      for (const r of rects) {
        c.lineWidth = Math.max(2, W * 0.008);
        c.setLineDash(r.ghost ? [W * 0.02, W * 0.014] : []);
        c.strokeStyle = r.ghost ? "rgba(255,255,255,0.8)" : "#ffcc4d";
        c.shadowColor = r.ghost ? "transparent" : "rgba(255,204,77,0.8)";
        c.shadowBlur = r.ghost ? 0 : W * 0.03;
        roundRectPath(c, r.x, r.y, r.w, r.h, W * 0.02);
        c.stroke();
        if (r.ghost) {
          c.shadowBlur = 0;
          c.setLineDash([]);
          c.font = `600 ${Math.max(10, W * 0.026)}px system-ui, sans-serif`;
          c.fillStyle = "rgba(255,255,255,0.85)"; c.textAlign = "center"; c.textBaseline = "top";
          c.fillText("trước đây", r.x + r.w / 2, r.y + r.h + W * 0.008);
        }
      }
      c.restore();
    }
  };

  // ======================================================================
  // 7. Âm thanh — playSound("correct" | "wrong" | "tick" | "start")
  // ======================================================================
  const Sound = {
    muted: store.get(CONFIG.STORAGE.muted) === "1",
    audios: {},
    ctx: null,

    init() {
      for (const [name, src] of Object.entries(CONFIG.SOUNDS)) {
        const a = new Audio();
        a.preload = "auto";
        a.addEventListener("canplaythrough", () => { this.audios[name] = a; }, { once: true });
        a.addEventListener("error", () => { this.audios[name] = null; }, { once: true });
        a.src = src;
      }
    },

    play(name) {
      if (this.muted) return;
      const a = this.audios[name];
      if (a) {
        try {
          const node = a.cloneNode();
          node.play().catch(() => {});
        } catch (e) { /* bỏ qua êm */ }
      } else if (CONFIG.SYNTH_FALLBACK) {
        this.beep(name);
      }
    },

    beep(name) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = this.ctx || new AC();
        const tones = { correct: [660, 0.08], wrong: [140, 0.3], tick: [1000, 0.03], start: [440, 0.15] };
        const [f, d] = tones[name] || [500, 0.05];
        const o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.frequency.value = f; o.type = name === "wrong" ? "sawtooth" : "sine";
        g.gain.setValueAtTime(0.08, this.ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + d);
        o.connect(g).connect(this.ctx.destination);
        o.start(); o.stop(this.ctx.currentTime + d);
      } catch (e) { /* bỏ qua */ }
    },

    toggle() {
      this.muted = !this.muted;
      store.set(CONFIG.STORAGE.muted, this.muted ? "1" : "0");
      return this.muted;
    }
  };

  function playSound(name) { Sound.play(name); }

  // ======================================================================
  // 8. Ảnh khoe điểm (canvas 9:16 cho story)
  // ======================================================================
  async function makeShareImage(r) {
    const { width: W, height: H } = CONFIG.SHARE;
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const c = cv.getContext("2d");
    const font = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

    let g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#16243f"); g.addColorStop(0.55, "#0a1120"); g.addColorStop(1, "#04070d");
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    const rnd = seeded(r.score + 7);
    for (let i = 0; i < 4000; i++) { c.fillStyle = `rgba(255,255,255,${rnd() * 0.06})`; c.fillRect(rnd() * W, rnd() * H, 2, 2); }
    g = c.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.7);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0.7)");
    c.fillStyle = g; c.fillRect(0, 0, W, H);

    // Khung camera
    c.strokeStyle = "rgba(242,184,75,0.5)"; c.lineWidth = 6;
    const m = 70, L = 90;
    for (const [x, y, dx, dy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]]) {
      c.beginPath(); c.moveTo(x, y + dy * L); c.lineTo(x, y); c.lineTo(x + dx * L, y); c.stroke();
    }
    c.fillStyle = "#ff5a5f"; c.beginPath(); c.arc(130, 150, 14, 0, Math.PI * 2); c.fill();
    c.fillStyle = "rgba(236,230,214,0.8)"; c.font = `600 34px ui-monospace, Menlo, monospace`;
    c.textAlign = "left"; c.textBaseline = "middle"; c.fillText("REC · CA ĐÊM", 160, 152);

    c.textAlign = "center"; c.textBaseline = "alphabetic";
    c.fillStyle = "#ece6d6"; c.font = `900 120px ${font}`; c.fillText("PHÁT HIỆN", W / 2, 420);
    c.fillStyle = "#f2b84b"; c.fillText("BẤT THƯỜNG", W / 2, 550);

    c.fillStyle = "#8f98ad"; c.font = `600 40px ${font}`; c.fillText("DANH HIỆU", W / 2, 760);
    c.fillStyle = "#ffd98a"; c.font = `800 84px ${font}`; c.fillText(r.title, W / 2, 860, W - 160);

    c.fillStyle = "#8f98ad"; c.font = `600 40px ${font}`; c.fillText("ĐIỂM", W / 2, 1040);
    c.fillStyle = "#ece6d6"; c.font = `900 230px ${font}`; c.fillText(r.score.toLocaleString("vi-VN"), W / 2, 1250, W - 160);

    c.font = `700 52px ${font}`; c.fillStyle = "#ece6d6";
    const rankText = r.rankWeek ? `  ·  Hạng tuần #${r.rankWeek}` : "";
    c.fillText(`Chuỗi dài nhất: ${r.bestStreak}${rankText}`, W / 2, 1380, W - 160);
    c.fillStyle = "#8f98ad"; c.font = `500 44px ${font}`;
    c.fillText(`Bảo vệ: ${r.name}`, W / 2, 1460, W - 160);

    c.fillStyle = "#ffd98a"; c.font = `italic 600 48px ${font}`;
    c.fillText(CONFIG.SHARE.footer, W / 2, 1650, W - 160);
    if (CONFIG.SHARE.url) { c.fillStyle = "#8f98ad"; c.font = `500 40px ${font}`; c.fillText(CONFIG.SHARE.url, W / 2, 1720); }

    if (CONFIG.SHARE.logoSrc) {
      const logo = await Assets.load(CONFIG.SHARE.logoSrc);
      if (logo) {
        const lw = 220, lh = lw * logo.naturalHeight / logo.naturalWidth;
        c.drawImage(logo, (W - lw) / 2, 1760 - lh, lw, lh);
      }
    }

    return new Promise((resolve, reject) => {
      try { cv.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/png"); }
      catch (e) { reject(e); } // ví dụ canvas bị "tainted" khi logo khác nguồn
    });
  }

  // ======================================================================
  // 9. UI — nối GameCore với giao diện
  // ======================================================================
  const data = validateScenes(window.SCENES);
  const game = createGameCore(data, CONFIG);

  const ui = {
    mode: "game",          // "game" | "preview"
    room: null,
    layout: null,
    revealed: false,       // đang hiện khoanh đáp án
    rafId: 0,
    lastTickSecond: null,
    afterName: null,       // hành động sau khi nhập tên
    boardReturn: "menu",
    lastResult: null,
    preview: null,
    shareUrl: null
  };

  const el = {
    screens: document.querySelectorAll(".screen"),
    frame: $("frame"), stage: $("stage"), canvas: $("scene-canvas"),
    timer: $("timer-fill"), score: $("hud-score"), streak: $("hud-streak"), mult: $("hud-mult"),
    camLabel: $("cam-label"), camClock: $("cam-clock"),
    flash: $("flash"), pop: $("pop"),
    verdict: $("verdict"), verdictTitle: $("verdict-title"), verdictText: $("verdict-text"),
    btnNormal: $("btn-normal"), btnAnomaly: $("btn-anomaly"), btnQuit: $("btn-quit"),
    nameInput: $("name-input"), nameError: $("name-error"),
    boardList: $("board-list"), soundBtn: $("btn-sound")
  };

  const playerName = () => store.get(CONFIG.STORAGE.name) || "";

  function show(id) {
    el.screens.forEach((s) => s.classList.toggle("active", s.id === "screen-" + id));
    if (id === "play") requestAnimationFrame(fitFrame);
    if (id === "menu") refreshMenu();
  }

  function refreshMenu() {
    const name = playerName();
    const best = Number(store.get(CONFIG.STORAGE.best) || 0);
    $("menu-player").textContent = name ? `Bảo vệ: ${name}${best ? ` · Kỷ lục ${best.toLocaleString("vi-VN")}` : ""} · ` : "";
    $("btn-rename").textContent = name ? "Đổi biệt danh" : "Đặt biệt danh";
  }

  // Giữ khung cảnh đúng 4:5 và vừa khít vùng stage
  function fitFrame() {
    const r = el.stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    let w = r.width, h = w / CONFIG.SCENE_ASPECT;
    if (h > r.height) { h = r.height; w = h * CONFIG.SCENE_ASPECT; }
    el.frame.style.width = Math.floor(w) + "px";
    el.frame.style.height = Math.floor(h) + "px";
    if (Renderer.resize(Math.floor(w), Math.floor(h)) && ui.layout) redraw();
  }

  function redraw() {
    Renderer.draw(ui.room, ui.layout);
    if (ui.revealed) Renderer.drawMarks(ui.layout.marks);
  }

  function setAnswerEnabled(on) {
    el.btnNormal.disabled = !on;
    el.btnAnomaly.disabled = !on;
  }

  function updateHud() {
    const h = game.hud();
    el.score.textContent = h.score.toLocaleString("vi-VN");
    el.streak.textContent = h.streak;
    el.mult.textContent = "x" + h.nextMultiplier;
    const mins = (CONFIG.NIGHT_CLOCK_START + h.sceneIndex * CONFIG.MINUTES_PER_SCENE) % (24 * 60);
    el.camClock.textContent = String(Math.floor(mins / 60)).padStart(2, "0") + ":" + String(mins % 60).padStart(2, "0");
  }

  function restartAnim(node, cls) {
    node.classList.remove(cls);
    void node.offsetWidth; // ép trình duyệt chạy lại animation
    node.classList.add(cls);
  }

  function showVerdict(title, text, info = false) {
    el.verdictTitle.textContent = title;
    el.verdictText.textContent = text;
    el.verdict.classList.toggle("info", info);
    el.verdict.classList.add("show");
  }
  const hideVerdict = () => el.verdict.classList.remove("show");

  // Chuyển cảnh kiểu chớp camera: tắt → vẽ cảnh mới → bật
  async function presentScene(room, layout, label) {
    await Assets.loadRoom(room); // thường đã có sẵn nhờ tải trước
    el.frame.classList.add("switching");
    await wait(CONFIG.FADE_MS);
    ui.room = room;
    ui.layout = layout;
    ui.revealed = false;
    fitFrame();
    redraw();
    el.camLabel.textContent = label;
    el.frame.classList.remove("switching");
  }

  // ---- Vòng chơi ----
  function requireName(then) {
    if (playerName()) return then();
    ui.afterName = then;
    openNameScreen();
  }

  async function startRun() {
    ui.mode = "game";
    $("screen-play").classList.remove("preview");
    el.btnQuit.classList.add("hidden");
    el.btnNormal.textContent = "Bình thường";
    el.btnAnomaly.textContent = "Có gì đó sai sai";
    hideVerdict();
    setAnswerEnabled(false);
    el.timer.style.transform = "scaleX(1)";
    el.timer.classList.remove("low");

    const first = game.start();
    // Tải trước toàn bộ phòng ở nền; chỉ chờ phòng đầu tiên
    data.rooms.forEach((r) => Assets.loadRoom(r));
    updateHud();
    show("play");
    playSound("start");
    await showGameScene(first);
  }

  async function showGameScene(scene) {
    setAnswerEnabled(false);
    await presentScene(scene.room, buildLayout(scene.room, scene.anomaly), `${scene.room.camera || "CAM"} · ${scene.room.name}`);
    if (ui.mode !== "game") return;
    game.beginScene(performance.now());
    setAnswerEnabled(true);
    ui.lastTickSecond = null;
    loop();
    if (game.next) Assets.loadRoom(game.next.room); // tải trước cảnh kế tiếp
  }

  function loop() {
    cancelAnimationFrame(ui.rafId);
    const step = () => {
      if (game.state !== "playing") return;
      const now = performance.now();
      const frac = game.remainingFraction(now);
      el.timer.style.transform = `scaleX(${frac})`;
      const low = frac < CONFIG.TIMER_LOW_FRACTION;
      el.timer.classList.toggle("low", low);
      if (low) {
        // tíc mỗi giây khi thời gian sắp hết
        const sec = Math.ceil(game.remainingMs(now) / 1000);
        if (sec !== ui.lastTickSecond) { ui.lastTickSecond = sec; playSound("tick"); }
      }
      if (frac <= 0) return handleOutcome(game.timeout());
      ui.rafId = requestAnimationFrame(step);
    };
    ui.rafId = requestAnimationFrame(step);
  }

  function onAnswer(saidAnomaly) {
    if (ui.mode === "preview") return stepPreview(saidAnomaly ? 1 : -1);
    handleOutcome(game.answer(saidAnomaly, performance.now()));
  }

  async function handleOutcome(res) {
    if (!res) return; // đã xử lý (bấm 2 lần / vừa hết giờ)
    cancelAnimationFrame(ui.rafId);
    setAnswerEnabled(false);

    if (res.correct) {
      playSound("correct");
      restartAnim(el.flash, "ok");
      el.pop.textContent = `+${res.points}${res.fast ? " ⚡" : ""}`;
      restartAnim(el.pop, "show");
      updateHud();
      await wait(CONFIG.CORRECT_FLASH_MS);
      if (ui.mode !== "game") return;
      return showGameScene(game.advance());
    }

    // Sai: khoanh đáp án + giải thích trong 2 giây
    playSound("wrong");
    try { navigator.vibrate && navigator.vibrate(CONFIG.VIBRATE_WRONG); } catch (e) { /* bỏ qua */ }
    restartAnim(el.flash, "bad");
    restartAnim(el.frame, "shake");
    const sc = res.scene;
    if (sc.hasAnomaly) {
      ui.revealed = true;
      redraw();
    }
    const T = CONFIG.TEXT;
    if (res.reason === "timeout") showVerdict(T.timeoutTitle, sc.hasAnomaly ? sc.anomaly.explain : T.timeoutNormalText);
    else if (res.reason === "false_alarm") showVerdict(T.falseAlarmTitle, T.falseAlarmText);
    else showVerdict(T.missedTitle, sc.anomaly.explain);

    await wait(CONFIG.WRONG_REVEAL_MS);
    if (ui.mode !== "game") return;
    showResult(game.finish());
  }

  async function showResult(r) {
    hideVerdict();
    const name = playerName();
    const prevBest = Number(store.get(CONFIG.STORAGE.best) || 0);
    if (r.score > prevBest) store.set(CONFIG.STORAGE.best, String(r.score));
    ui.lastResult = Object.assign({ name, rankWeek: null, rankAll: null }, r);

    $("result-title").textContent = r.title;
    $("result-score").textContent = r.score.toLocaleString("vi-VN");
    $("result-streak").textContent = r.bestStreak;
    $("result-rank-week").textContent = "…";
    $("result-rank-all").textContent = "…";
    $("result-best").textContent = r.score > prevBest && r.score > 0 ? "Kỷ lục mới của bạn!" : prevBest ? `Kỷ lục của bạn: ${prevBest.toLocaleString("vi-VN")}` : "";
    show("result");

    try {
      const rank = await Leaderboard.submitScore(name, r.score, r.bestStreak);
      ui.lastResult.rankWeek = rank.week;
      ui.lastResult.rankAll = rank.all;
      $("result-rank-week").textContent = rank.week ? "#" + rank.week : "–";
      $("result-rank-all").textContent = rank.all ? "#" + rank.all : "–";
    } catch (e) {
      $("result-rank-week").textContent = "–";
      $("result-rank-all").textContent = "–";
    }
  }

  // ---- Biệt danh ----
  function openNameScreen() {
    el.nameInput.value = playerName();
    el.nameInput.maxLength = CONFIG.NICKNAME_MAX;
    el.nameError.textContent = "";
    show("name");
    setTimeout(() => el.nameInput.focus(), 50);
  }

  function submitName(ev) {
    ev.preventDefault();
    const name = el.nameInput.value.replace(/[<>\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim();
    if (name.length < CONFIG.NICKNAME_MIN || name.length > CONFIG.NICKNAME_MAX) {
      el.nameError.textContent = `Biệt danh cần ${CONFIG.NICKNAME_MIN}–${CONFIG.NICKNAME_MAX} ký tự.`;
      return;
    }
    store.set(CONFIG.STORAGE.name, name);
    el.nameInput.blur();
    const next = ui.afterName;
    ui.afterName = null;
    if (next) next(); else show("menu");
  }

  // ---- Bảng xếp hạng ----
  function openBoard(from) {
    ui.boardReturn = from;
    show("board");
    loadBoard("week");
  }

  let boardReq = 0;
  async function loadBoard(period) {
    const req = ++boardReq;
    document.querySelectorAll(".tab").forEach((t) => {
      const on = t.dataset.period === period;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", on);
    });
    el.boardList.replaceChildren(msgRow("Đang mở sổ trực…"));
    try {
      const name = playerName();
      const [top, me] = await Promise.all([Leaderboard.getTop(period, 20), name ? Leaderboard.getRank(name, period) : null]);
      if (req !== boardReq) return; // người dùng đã đổi tab
      const rows = top.map((e) => boardRow(e, name && Leaderboard.sameName(e.name, name)));
      if (me && me.rank > top.length) {
        const gap = document.createElement("li");
        gap.className = "gap"; gap.textContent = "⋯";
        rows.push(gap, boardRow(me, true));
      }
      el.boardList.replaceChildren(...(rows.length ? rows : [msgRow("Chưa có ai trực ca này.")]));
    } catch (e) {
      el.boardList.replaceChildren(msgRow("Không tải được bảng xếp hạng."));
    }
  }

  function msgRow(text) {
    const li = document.createElement("li");
    li.className = "msg"; li.textContent = text;
    return li;
  }

  function boardRow(e, isMe) {
    const li = document.createElement("li");
    if (isMe) li.className = "me";
    const rank = document.createElement("span"); rank.className = "rank"; rank.textContent = e.rank;
    const name = document.createElement("span"); name.className = "name"; name.textContent = e.name;
    const sub = document.createElement("small"); sub.textContent = `Chuỗi ${e.streak}${isMe ? " · Bạn" : ""}`;
    name.appendChild(sub);
    const score = document.createElement("span"); score.className = "score"; score.textContent = e.score.toLocaleString("vi-VN");
    li.append(rank, name, score);
    return li;
  }

  // ---- Khoe điểm ----
  async function share() {
    const r = ui.lastResult;
    if (!r) return;
    const btn = $("btn-share");
    btn.disabled = true;
    try {
      const blob = await makeShareImage(r);
      const file = new File([blob], "ket-qua-ca-dem.png", { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: "Phát Hiện Bất Thường", text: `Mình được ${r.score} điểm – ${r.title}!` });
          return;
        } catch (e) {
          if (e && e.name === "AbortError") return; // người dùng tự hủy
        }
      }
      if (ui.shareUrl) URL.revokeObjectURL(ui.shareUrl);
      ui.shareUrl = URL.createObjectURL(blob);
      $("share-img").src = ui.shareUrl;
      $("share-download").href = ui.shareUrl;
      $("share-modal").classList.remove("hidden");
    } catch (e) {
      console.warn("Không tạo được ảnh khoe điểm:", e);
    } finally {
      btn.disabled = false;
    }
  }

  // ---- Xem thử anomaly (công cụ dev, ?dev=1) ----
  function openPreview() {
    ui.mode = "preview";
    cancelAnimationFrame(ui.rafId);
    game.toMenu();
    ui.preview = { list: data.rooms.flatMap((room) => [{ room, anomaly: null }, ...room.anomalies.map((a) => ({ room, anomaly: a }))]), i: 0 };
    data.rooms.forEach((r) => Assets.loadRoom(r));
    $("screen-play").classList.add("preview");
    el.btnQuit.classList.remove("hidden");
    el.btnNormal.textContent = "◀ Trước";
    el.btnAnomaly.textContent = "Sau ▶";
    setAnswerEnabled(true);
    show("play");
    stepPreview(0);
  }

  async function stepPreview(d) {
    const p = ui.preview;
    p.i = (p.i + d + p.list.length) % p.list.length;
    const { room, anomaly } = p.list[p.i];
    const layout = buildLayout(room, anomaly);
    await presentScene(room, layout, `${room.camera || "CAM"} · ${room.name}`);
    ui.revealed = true;
    redraw();
    showVerdict(
      anomaly ? `${p.i + 1}/${p.list.length} · ${anomaly.id} (${anomaly.type}, độ khó ${anomaly.difficulty})` : `${p.i + 1}/${p.list.length} · Bản gốc`,
      anomaly ? anomaly.explain : "Không có bất thường.",
      true
    );
  }

  function quitToMenu() {
    ui.mode = "game";
    cancelAnimationFrame(ui.rafId);
    game.toMenu();
    hideVerdict();
    show("menu");
  }

  // ---- Gắn sự kiện ----
  function bind() {
    $("btn-start").addEventListener("click", () => requireName(startRun));
    $("btn-board").addEventListener("click", () => openBoard("menu"));
    $("btn-rename").addEventListener("click", () => { ui.afterName = null; openNameScreen(); });
    $("name-form").addEventListener("submit", submitName);
    $("name-cancel").addEventListener("click", () => { ui.afterName = null; show("menu"); });

    el.btnNormal.addEventListener("click", () => onAnswer(false));
    el.btnAnomaly.addEventListener("click", () => onAnswer(true));
    el.btnQuit.addEventListener("click", quitToMenu);

    $("btn-replay").addEventListener("click", startRun);
    $("btn-share").addEventListener("click", share);
    $("btn-result-board").addEventListener("click", () => openBoard("result"));
    $("btn-result-menu").addEventListener("click", () => { game.toMenu(); show("menu"); });
    $("board-back").addEventListener("click", () => show(ui.boardReturn));
    document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => loadBoard(t.dataset.period)));
    $("share-close").addEventListener("click", () => $("share-modal").classList.add("hidden"));

    const syncSound = () => { el.soundBtn.textContent = Sound.muted ? "🔇" : "🔊"; };
    el.soundBtn.addEventListener("click", () => { Sound.toggle(); syncSound(); });
    syncSound();

    // Bàn phím (test trên máy tính): ← / 1 = Bình thường, → / 2 = Sai sai
    document.addEventListener("keydown", (e) => {
      if (!$("screen-play").classList.contains("active") || el.btnNormal.disabled) return;
      if (["ArrowLeft", "1", "a"].includes(e.key)) onAnswer(false);
      else if (["ArrowRight", "2", "d"].includes(e.key)) onAnswer(true);
    });

    // Gỡ class hiệu ứng khi chạy xong, tránh chạy lại khi màn hình hiện lại
    [[el.flash, ["ok", "bad"]], [el.pop, ["show"]], [el.frame, ["shake"]]].forEach(([node, cls]) =>
      node.addEventListener("animationend", () => node.classList.remove(...cls)));

    window.addEventListener("resize", () => requestAnimationFrame(fitFrame));
    window.addEventListener("orientationchange", () => setTimeout(fitFrame, 200));

    if (CONFIG.DEV_TOOLS && /[?&]dev=1/.test(location.search)) {
      $("btn-preview").classList.remove("hidden");
      $("btn-preview").addEventListener("click", openPreview);
    }
  }

  Renderer.init(el.canvas);
  Sound.init();
  bind();
  refreshMenu();
})();
