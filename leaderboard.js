/*
 * leaderboard.js — Bảng xếp hạng.
 *
 * Bản này dùng dữ liệu giả + localStorage. Phần còn lại của game CHỈ gọi các hàm
 * bất đồng bộ dưới đây, nên khi có server chỉ cần viết lại ruột của chúng
 * (fetch tới API) mà không phải sửa game.js:
 *
 *   submitScore(name, score, streak) -> Promise<{ week: number|null, all: number|null }>  (thứ hạng sau khi nộp)
 *   getTop(period, limit = 20)       -> Promise<Array<{ rank, name, score, streak }>>     period: "week" | "all"
 *   getRank(name, period)            -> Promise<{ rank, name, score, streak } | null>
 */
window.Leaderboard = (function () {
  "use strict";

  const STORAGE_KEY = "pbt_scores_v1";
  const MAX_STORED = 500;
  const FAKE_DELAY_MS = 120; // giả lập độ trễ mạng

  const FAKE_NAMES = [
    "Cú Đêm", "Mắt Diều Hâu", "Bảo Vệ Số 8", "Tí Hon Tinh Mắt", "Minh Pin Yếu",
    "Lan Ca Ba", "Huy Không Ngủ", "Thảo Soi Kỹ", "Long Camera", "Ngọc Mất Ngủ",
    "Tuấn Tuần Tra", "Vy Trực Đêm", "Khoa Cú Mèo", "Hà Hành Lang", "Phúc Chìa Khóa",
    "Mai Mắt Mèo", "Đạt Đi Tuần", "Quân Quan Sát", "Linh Lanh Lợi", "Nam Nửa Đêm",
    "Trang Trực Ca", "Bình Bình Tĩnh", "Sơn Soi Góc", "An Toàn", "Kiệt Kính Lúp",
    "Yến Yên Lặng", "Dũng Dũng Cảm", "Hải Hồ Nghi", "Châu Chớp Mắt", "Tâm Tỉnh Táo"
  ];

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (name) => String(name || "").trim().toLowerCase();

  // Bộ sinh số ngẫu nhiên có hạt giống: dữ liệu giả ổn định giữa các lần mở trang.
  function seeded(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Thứ Hai 00:00 (giờ máy) của tuần hiện tại
  function weekStart(ts = Date.now()) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.getTime();
  }

  function fakeEntry(name, rnd, maxScore, ts) {
    const score = Math.round((200 + Math.pow(rnd(), 1.7) * maxScore) / 10) * 10;
    const streak = Math.max(1, Math.round(score / 230 + (rnd() * 4 - 2)));
    return { name, score, streak, ts };
  }

  function fakeEntries() {
    const ws = weekStart();
    const old = ws - 9 * 864e5;
    const rndAll = seeded(2026);
    const all = FAKE_NAMES.map((n) => fakeEntry(n, rndAll, 7200, old));
    // Bảng tuần: tập con đổi theo từng tuần
    const rndWeek = seeded(Math.floor(ws / 864e5));
    const week = FAKE_NAMES.filter(() => rndWeek() < 0.5).map((n, i) => fakeEntry(n, rndWeek, 4200, ws + 60000 * (i + 1)));
    return all.concat(week);
  }

  function loadStored() {
    try {
      const arr = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function saveStored(arr) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(arr.slice(-MAX_STORED)));
    } catch (e) { /* hết bộ nhớ hoặc chế độ riêng tư: bỏ qua */ }
  }

  // Mỗi người chỉ giữ điểm cao nhất, xếp: điểm ↓, chuỗi ↓, ai đạt trước xếp trên
  function ranked(period) {
    const from = period === "week" ? weekStart() : 0;
    const best = new Map();
    for (const e of fakeEntries().concat(loadStored())) {
      if (e.ts < from) continue;
      const k = norm(e.name);
      const cur = best.get(k);
      if (!cur || e.score > cur.score || (e.score === cur.score && e.streak > cur.streak)) best.set(k, e);
    }
    return [...best.values()]
      .sort((a, b) => b.score - a.score || b.streak - a.streak || a.ts - b.ts)
      .map((e, i) => ({ rank: i + 1, name: e.name, score: e.score, streak: e.streak }));
  }

  async function submitScore(name, score, streak) {
    await wait(FAKE_DELAY_MS);
    const stored = loadStored();
    stored.push({ name: String(name), score: Math.max(0, Math.floor(score)), streak: Math.max(0, Math.floor(streak)), ts: Date.now() });
    saveStored(stored);
    const find = (p) => (ranked(p).find((e) => norm(e.name) === norm(name)) || {}).rank || null;
    return { week: find("week"), all: find("all") };
  }

  async function getTop(period = "week", limit = 20) {
    await wait(FAKE_DELAY_MS);
    return ranked(period).slice(0, limit);
  }

  async function getRank(name, period = "week") {
    await wait(FAKE_DELAY_MS);
    return ranked(period).find((e) => norm(e.name) === norm(name)) || null;
  }

  return { submitScore, getTop, getRank, sameName: (a, b) => norm(a) === norm(b) };
})();
