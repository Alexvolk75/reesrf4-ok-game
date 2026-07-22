/* global VKMini */
(() => {
  const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("game"));
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));

  const ui = {
    score: document.getElementById("score"),
    best: document.getElementById("best"),
    overlay: document.getElementById("overlay"),
    overlayTitle: document.getElementById("overlayTitle"),
    overlayText: document.getElementById("overlayText"),
    btnStart: document.getElementById("btnStart"),
    btnResume: document.getElementById("btnResume"),
    btnContinueAd: document.getElementById("btnContinueAd"),
    btnRestart: document.getElementById("btnRestart"),
    btnShare: document.getElementById("btnShare"),
    btnPause: document.getElementById("btnPause"),
    btnSound: document.getElementById("btnSound"),
    btnSpeed: document.getElementById("btnSpeed"),
    adStatus: document.getElementById("adStatus"),
    adLog: document.getElementById("adLog"),
    btnAdInterstitial: document.getElementById("btnAdInterstitial"),
    btnAdBanner: document.getElementById("btnAdBanner"),
  };

  const GRID = 24;
  const BASE_TPS = 10; // ticks per second
  const SPEEDS = [1, 1.25, 1.5, 1.75, 2];

  const COLORS = {
    bg0: "#070a14",
    bg1: "#0b1020",
    grid: "rgba(255,255,255,.06)",
    vignette: "rgba(0,0,0,.65)",
    snakeBody0: "#20e3b2",
    snakeBody1: "#70a1ff",
    snakeEdge: "rgba(255,255,255,.16)",
    snakeShadow: "rgba(0,0,0,.35)",
    headGlow: "rgba(124,247,212,.35)",
    food0: "#ff4d6d",
    food1: "#a78bfa",
    foodGlow: "rgba(255,77,109,.28)",
    text: "rgba(234,242,255,.92)",
    danger: "#ff4d6d",
  };

  const storage = {
    getBest() {
      const v = Number(localStorage.getItem("zmei_best") || "0");
      return Number.isFinite(v) ? v : 0;
    },
    setBest(v) {
      localStorage.setItem("zmei_best", String(v));
    },
    getSound() {
      const v = localStorage.getItem("zmei_sound");
      return v === null ? true : v === "1";
    },
    setSound(on) {
      localStorage.setItem("zmei_sound", on ? "1" : "0");
    },
    getSpeedIdx() {
      const v = Number(localStorage.getItem("zmei_speed") || "0");
      if (!Number.isFinite(v)) return 0;
      return Math.max(0, Math.min(SPEEDS.length - 1, Math.floor(v)));
    },
    setSpeedIdx(i) {
      localStorage.setItem("zmei_speed", String(i));
    },
  };

  function fitCanvas() {
    // Keep internal resolution square and crisp.
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = Math.floor(Math.min(rect.width, rect.height || rect.width) * dpr);
    if (size <= 0) return;
    if (canvas.width !== size || canvas.height !== size) {
      canvas.width = size;
      canvas.height = size;
    }
  }

  function randInt(min, max) {
    return (Math.random() * (max - min + 1) + min) | 0;
  }

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function keyToDir(key) {
    switch (key) {
      case "ArrowUp":
      case "w":
      case "W":
        return { x: 0, y: -1 };
      case "ArrowDown":
      case "s":
      case "S":
        return { x: 0, y: 1 };
      case "ArrowLeft":
      case "a":
      case "A":
        return { x: -1, y: 0 };
      case "ArrowRight":
      case "d":
      case "D":
        return { x: 1, y: 0 };
      default:
        return null;
    }
  }

  function isOpposite(a, b) {
    return a.x === -b.x && a.y === -b.y;
  }

  function cellToPx(cell, cellSize) {
    return { x: cell.x * cellSize, y: cell.y * cellSize };
  }

  function makePattern(name) {
    const off = document.createElement("canvas");
    off.width = 64;
    off.height = 64;
    const g = off.getContext("2d");
    if (!g) return null;

    g.clearRect(0, 0, 64, 64);

    if (name === "bg") {
      const grd = g.createLinearGradient(0, 0, 64, 64);
      grd.addColorStop(0, "rgba(124,247,212,.05)");
      grd.addColorStop(0.5, "rgba(167,139,250,.05)");
      grd.addColorStop(1, "rgba(255,77,109,.04)");
      g.fillStyle = grd;
      g.fillRect(0, 0, 64, 64);

      // soft dots
      for (let i = 0; i < 20; i++) {
        const x = randInt(0, 63);
        const y = randInt(0, 63);
        const r = randInt(1, 3);
        g.beginPath();
        g.fillStyle = `rgba(255,255,255,${Math.random() * 0.06})`;
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
      }

      // diagonal strokes
      g.strokeStyle = "rgba(255,255,255,.05)";
      g.lineWidth = 2;
      for (let i = -64; i <= 128; i += 16) {
        g.beginPath();
        g.moveTo(i, 0);
        g.lineTo(i + 64, 64);
        g.stroke();
      }
    }

    if (name === "scales") {
      g.translate(0.5, 0.5);
      for (let y = 0; y < 64; y += 12) {
        for (let x = 0; x < 64; x += 12) {
          const ox = (y / 12) % 2 ? 6 : 0;
          const cx = x + ox;
          const cy = y;
          g.beginPath();
          g.strokeStyle = "rgba(255,255,255,.10)";
          g.lineWidth = 1;
          g.arc(cx, cy, 7, Math.PI, 0);
          g.stroke();
        }
      }
      g.setTransform(1, 0, 0, 1, 0, 0);
    }

    return ctx.createPattern(off, "repeat");
  }

  const patterns = {
    bg: null,
    scales: null,
  };

  const audio = (() => {
    let enabled = storage.getSound();
    let ac = null;

    function ensure() {
      if (!enabled) return null;
      if (ac) return ac;
      try {
        ac = new (window.AudioContext || window.webkitAudioContext)();
        return ac;
      } catch {
        return null;
      }
    }

    function beep(type = "eat") {
      const a = ensure();
      if (!a) return;
      const t = a.currentTime;
      const o = a.createOscillator();
      const g = a.createGain();
      o.type = "triangle";
      o.frequency.setValueAtTime(type === "die" ? 140 : type === "turn" ? 260 : 520, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (type === "die" ? 0.18 : 0.10));
      o.connect(g);
      g.connect(a.destination);
      o.start(t);
      o.stop(t + (type === "die" ? 0.20 : 0.12));
    }

    function setEnabled(on) {
      enabled = on;
      storage.setSound(on);
      if (!enabled && ac) {
        try {
          ac.close();
        } catch {}
        ac = null;
      }
    }

    function isEnabled() {
      return enabled;
    }

    return { beep, setEnabled, isEnabled };
  })();

  const game = (() => {
    const state = {
      running: false,
      paused: false,
      over: false,
      score: 0,
      best: storage.getBest(),
      speedIdx: storage.getSpeedIdx(),
      pendingDir: null,
      dir: { x: 1, y: 0 },
      snake: [],
      food: { x: 0, y: 0 },
      tickAcc: 0,
      lastTs: 0,
      justAte: 0,
      continueUsed: false,
    };

    function reset() {
      state.score = 0;
      state.over = false;
      state.paused = false;
      state.pendingDir = null;
      state.dir = { x: 1, y: 0 };
      state.justAte = 0;
      state.continueUsed = false;

      // Старт вдоль верхней границы (рядом со «стеной» y=0): тело у пола, движение вправо.
      const y = 1;
      const x0 = 2;
      state.snake = [
        { x: x0, y },
        { x: x0 + 1, y },
        { x: x0 + 2, y },
      ];
      placeFood();
      syncUI();
    }

    function placeFood() {
      const occupied = new Set(state.snake.map((c) => `${c.x},${c.y}`));
      for (let i = 0; i < 2000; i++) {
        const x = randInt(1, GRID - 2);
        const y = randInt(1, GRID - 2);
        if (!occupied.has(`${x},${y}`)) {
          state.food = { x, y };
          return;
        }
      }
      state.food = { x: 1, y: 1 };
    }

    function setDir(next) {
      if (!next) return;
      const head = state.snake[state.snake.length - 1];
      if (!head) return;
      // prevent 180° turn
      if (isOpposite(state.dir, next)) return;
      state.pendingDir = next;
    }

    function togglePause(force) {
      if (!state.running) return;
      state.paused = typeof force === "boolean" ? force : !state.paused;
      if (state.paused) {
        showOverlay("Пауза", "Нажми «Продолжить» или пробел/Р.", { resume: true, restart: true });
      } else {
        hideOverlay();
      }
      syncUI();
    }

    function speedLabel() {
      const v = SPEEDS[state.speedIdx] || 1;
      return `${v.toFixed(v % 1 ? 2 : 0).replace(/\.0+$/, "")}×`;
    }

    function cycleSpeed() {
      state.speedIdx = (state.speedIdx + 1) % SPEEDS.length;
      storage.setSpeedIdx(state.speedIdx);
      ui.btnSpeed.textContent = `Скорость: ${speedLabel()}`;
    }

    function start() {
      reset();
      state.running = true;
      state.paused = false;
      hideOverlay();
      syncUI();
      state.lastTs = performance.now();
      requestAnimationFrame(frame);
    }

    function resume() {
      if (!state.running) return start();
      if (!state.paused) return;
      state.paused = false;
      hideOverlay();
      state.lastTs = performance.now();
      syncUI();
      requestAnimationFrame(frame);
    }

    function gameOver() {
      state.over = true;
      state.running = true;
      state.paused = true;
      audio.beep("die");
      if (state.score > state.best) {
        state.best = state.score;
        storage.setBest(state.best);
      }
      const text = state.score === state.best ? "Новый рекорд." : "Попробуй ещё раз.";

      showOverlay("Конец игры", `Счёт: ${state.score}. ${text}`, {
        resume: false,
        restart: true,
        continueAd: !state.continueUsed && typeof getAds()?.showInterstitial === "function",
      });
      syncUI();
      showAdsQuietly();
    }

    function tick() {
      if (state.paused) return;

      if (state.pendingDir) {
        state.dir = state.pendingDir;
        state.pendingDir = null;
        audio.beep("turn");
      }

      const head = state.snake[state.snake.length - 1];
      const nx = head.x + state.dir.x;
      const ny = head.y + state.dir.y;

      // walls
      if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) return gameOver();

      // self
      for (let i = 0; i < state.snake.length; i++) {
        const c = state.snake[i];
        if (c.x === nx && c.y === ny) return gameOver();
      }

      state.snake.push({ x: nx, y: ny });

      // eat
      if (nx === state.food.x && ny === state.food.y) {
        state.score += 1;
        state.justAte = 10;
        audio.beep("eat");
        placeFood();
        if (state.score > 0 && state.score % AD_SCORE_STEP === 0) {
          void getAds()?.showInterstitial?.().catch(() => {});
        }
      } else {
        state.snake.shift();
      }

      syncUI();
    }

    function frame(ts) {
      if (!state.running) return;
      const dt = clamp((ts - state.lastTs) / 1000, 0, 0.25);
      state.lastTs = ts;

      draw(ts);

      const tps = BASE_TPS * (SPEEDS[state.speedIdx] || 1);
      state.tickAcc += dt * tps;
      while (state.tickAcc >= 1) {
        tick();
        state.tickAcc -= 1;
      }

      if (state.justAte > 0) state.justAte--;
      requestAnimationFrame(frame);
    }

    function syncUI() {
      ui.score.textContent = String(state.score);
      ui.best.textContent = String(state.best);
      ui.btnSound.textContent = `Звук: ${audio.isEnabled() ? "вкл" : "выкл"}`;
      ui.btnSpeed.textContent = `Скорость: ${speedLabel()}`;
      ui.btnPause.textContent = state.paused ? "Продолжить" : "Пауза";
    }

    function showOverlay(title, text, opts) {
      ui.overlay.hidden = false;
      ui.overlayTitle.textContent = title;
      ui.overlayText.textContent = text;
      ui.btnStart.hidden = !!opts?.resume || !!opts?.restart;
      ui.btnResume.hidden = !opts?.resume;
      ui.btnRestart.hidden = !opts?.restart;
      ui.btnContinueAd.hidden = !opts?.continueAd;
    }

    function hideOverlay() {
      ui.overlay.hidden = true;
    }

    function draw(ts) {
      fitCanvas();

      const w = canvas.width;
      const h = canvas.height;
      const cs = w / GRID;

      if (!patterns.bg) patterns.bg = makePattern("bg");
      if (!patterns.scales) patterns.scales = makePattern("scales");

      // background fill + pattern
      const bg = ctx.createLinearGradient(0, 0, w, h);
      bg.addColorStop(0, COLORS.bg0);
      bg.addColorStop(1, COLORS.bg1);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      if (patterns.bg) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = patterns.bg;
        ctx.fillRect(0, 0, w, h);
      }

      // grid
      ctx.strokeStyle = COLORS.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i <= GRID; i++) {
        const p = i * cs;
        ctx.moveTo(p, 0);
        ctx.lineTo(p, h);
        ctx.moveTo(0, p);
        ctx.lineTo(w, p);
      }
      ctx.stroke();

      // food (glowing spark)
      const foodPx = cellToPx(state.food, cs);
      const fx = foodPx.x + cs / 2;
      const fy = foodPx.y + cs / 2;
      const pulse = 0.5 + 0.5 * Math.sin(ts / 180);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = COLORS.foodGlow;
      ctx.beginPath();
      ctx.arc(fx, fy, cs * (0.52 + pulse * 0.16), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      const fg = ctx.createRadialGradient(fx - cs * 0.12, fy - cs * 0.12, cs * 0.05, fx, fy, cs * 0.55);
      fg.addColorStop(0, COLORS.food1);
      fg.addColorStop(0.55, COLORS.food0);
      fg.addColorStop(1, "rgba(255,77,109,.05)");
      ctx.fillStyle = fg;
      roundRect(ctx, foodPx.x + cs * 0.18, foodPx.y + cs * 0.18, cs * 0.64, cs * 0.64, cs * 0.22);
      ctx.fill();

      // snake
      const len = state.snake.length;
      for (let i = 0; i < len; i++) {
        const c = state.snake[i];
        const p = cellToPx(c, cs);
        const t = i / Math.max(1, len - 1);
        const isHead = i === len - 1;

        // shadow
        ctx.fillStyle = COLORS.snakeShadow;
        roundRect(ctx, p.x + cs * 0.10, p.y + cs * 0.14, cs * 0.82, cs * 0.82, cs * 0.22);
        ctx.fill();

        // body gradient
        const gx = p.x + cs / 2;
        const gy = p.y + cs / 2;
        const body = ctx.createLinearGradient(gx - cs, gy - cs, gx + cs, gy + cs);
        body.addColorStop(0, mix(COLORS.snakeBody0, COLORS.snakeBody1, t * 0.6));
        body.addColorStop(1, mix(COLORS.snakeBody1, COLORS.snakeBody0, t * 0.3));
        ctx.fillStyle = body;
        roundRect(ctx, p.x + cs * 0.12, p.y + cs * 0.12, cs * 0.80, cs * 0.80, cs * 0.22);
        ctx.fill();

        // scales texture overlay
        if (patterns.scales) {
          ctx.save();
          ctx.globalAlpha = isHead ? 0.18 : 0.12;
          ctx.translate(p.x, p.y);
          ctx.fillStyle = patterns.scales;
          ctx.fillRect(0, 0, cs, cs);
          ctx.restore();
        }

        // outline
        ctx.strokeStyle = COLORS.snakeEdge;
        ctx.lineWidth = Math.max(1, cs * 0.05);
        roundRect(ctx, p.x + cs * 0.12, p.y + cs * 0.12, cs * 0.80, cs * 0.80, cs * 0.22);
        ctx.stroke();

        if (isHead) {
          // head glow
          ctx.save();
          ctx.globalCompositeOperation = "lighter";
          ctx.fillStyle = COLORS.headGlow;
          ctx.beginPath();
          ctx.arc(gx, gy, cs * 0.62, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();

          // eyes
          const ex = gx + state.dir.x * cs * 0.10;
          const ey = gy + state.dir.y * cs * 0.10;
          const perp = { x: -state.dir.y, y: state.dir.x };
          const e1 = { x: ex + perp.x * cs * 0.16, y: ey + perp.y * cs * 0.16 };
          const e2 = { x: ex - perp.x * cs * 0.16, y: ey - perp.y * cs * 0.16 };
          ctx.fillStyle = "rgba(255,255,255,.92)";
          ctx.beginPath();
          ctx.arc(e1.x, e1.y, cs * 0.07, 0, Math.PI * 2);
          ctx.arc(e2.x, e2.y, cs * 0.07, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "rgba(0,0,0,.55)";
          ctx.beginPath();
          ctx.arc(e1.x + state.dir.x * cs * 0.025, e1.y + state.dir.y * cs * 0.025, cs * 0.033, 0, Math.PI * 2);
          ctx.arc(e2.x + state.dir.x * cs * 0.025, e2.y + state.dir.y * cs * 0.025, cs * 0.033, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // subtle vignette
      const vg = ctx.createRadialGradient(w * 0.5, h * 0.5, w * 0.12, w * 0.5, h * 0.5, w * 0.78);
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, COLORS.vignette);
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, w, h);

      // paused label
      if (state.paused && !ui.overlay.hidden) return;
      if (state.paused) {
        ctx.fillStyle = "rgba(0,0,0,.35)";
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = COLORS.text;
        ctx.font = `800 ${Math.max(18, (w / 26) | 0)}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("Пауза", w / 2, h / 2);
      }
    }

    return {
      state,
      start,
      resume,
      reset,
      togglePause,
      setDir,
      cycleSpeed,
      showOverlay,
      hideOverlay,
      syncUI,
    };
  })();

  const AD_SCORE_STEP = 5;

  function getAds() {
    return window.__vkAds || null;
  }

  function showAdsQuietly() {
    const ads = getAds();
    if (!ads) return;
    void ads.showInterstitial?.().catch(() => {});
    void ads.showBanner?.().catch(() => {});
  }

  function setAdStatusUi(text, kind) {
    if (!ui.adStatus) return;
    ui.adStatus.textContent = text;
    ui.adStatus.className = "adStatus adStatus--" + (kind || "wait");
  }

  async function runAdAction(fn, label) {
    const ads = getAds();
    if (!ads || typeof fn !== "function") {
      setAdStatusUi("Реклама: bridge не готов", "fail");
      return;
    }
    setAdStatusUi(label + "…", "wait");
    try {
      await fn.call(ads);
      setAdStatusUi(label + ": OK", "ok");
    } catch (e) {
      const pe = window.__vkAdLog && window.__vkAdLog[0];
      setAdStatusUi(label + ": " + (pe?.detail || e?.message || "ошибка"), "fail");
    }
  }

  function setupAdButtons() {
    ui.btnAdInterstitial?.addEventListener("click", () => {
      void runAdAction(getAds()?.showInterstitial, "Межстраничная");
    });
    ui.btnAdBanner?.addEventListener("click", () => {
      void runAdAction(getAds()?.showBanner, "Баннер");
    });
  }

  function waitVkAdsReady() {
    if (!document.body.classList.contains("vk-ads-pending")) return Promise.resolve();
    return new Promise((resolve) => {
      window.addEventListener("vk-ads-done", () => resolve(), { once: true });
    });
  }

  /** Старт из меню / «Заново» — реклама уже была при открытии. */
  function beginPlay() {
    game.start();
  }

  function roundRect(c, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y, x + w, y + h, rr);
    c.arcTo(x + w, y + h, x, y + h, rr);
    c.arcTo(x, y + h, x, y, rr);
    c.arcTo(x, y, x + w, y, rr);
    c.closePath();
  }

  function mix(a, b, t) {
    const ca = hexToRgb(a);
    const cb = hexToRgb(b);
    if (!ca || !cb) return a;
    const x = (v) => Math.round(v);
    const r = x(ca.r + (cb.r - ca.r) * t);
    const g = x(ca.g + (cb.g - ca.g) * t);
    const b2 = x(ca.b + (cb.b - ca.b) * t);
    return `rgb(${r} ${g} ${b2})`;
  }

  function hexToRgb(hex) {
    const h = hex.replace("#", "").trim();
    if (h.length !== 6) return null;
    const n = parseInt(h, 16);
    if (!Number.isFinite(n)) return null;
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function setupInput() {
    window.addEventListener("keydown", (e) => {
      if (e.key === " " || e.key === "p" || e.key === "P" || e.key === "Pause") {
        e.preventDefault();
        if (game.state.paused && !game.state.over) game.resume();
        else game.togglePause();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (!ui.btnStart?.hidden) {
          void beginPlay();
        } else if (game.state.over && !ui.btnRestart?.hidden) {
          void beginPlay();
        } else if (game.state.paused && !game.state.over) {
          game.resume();
        }
        return;
      }
      const d = keyToDir(e.key);
      if (d) {
        e.preventDefault();
        game.setDir(d);
      }
    });

    // D-pad
    document.querySelectorAll("[data-dir]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const dir = btn.getAttribute("data-dir");
        if (dir === "up") game.setDir({ x: 0, y: -1 });
        if (dir === "down") game.setDir({ x: 0, y: 1 });
        if (dir === "left") game.setDir({ x: -1, y: 0 });
        if (dir === "right") game.setDir({ x: 1, y: 0 });
      });
    });

    // Swipe
    let touchStart = null;
    canvas.addEventListener(
      "pointerdown",
      (e) => {
        if (e.pointerType === "mouse" && e.buttons !== 1) return;
        canvas.setPointerCapture(e.pointerId);
        touchStart = { x: e.clientX, y: e.clientY, t: performance.now() };
      },
      { passive: true }
    );
    canvas.addEventListener(
      "pointerup",
      (e) => {
        if (!touchStart) return;
        const dx = e.clientX - touchStart.x;
        const dy = e.clientY - touchStart.y;
        const dt = performance.now() - touchStart.t;
        touchStart = null;

        if (dt < 500 && (Math.abs(dx) > 18 || Math.abs(dy) > 18)) {
          if (Math.abs(dx) > Math.abs(dy)) game.setDir({ x: dx > 0 ? 1 : -1, y: 0 });
          else game.setDir({ x: 0, y: dy > 0 ? 1 : -1 });
        }
      },
      { passive: true }
    );

    // UI buttons
    ui.btnStart.addEventListener("click", () => void beginPlay());
    ui.btnResume.addEventListener("click", () => game.resume());
    ui.btnRestart.addEventListener("click", () => void beginPlay());
    ui.btnContinueAd.addEventListener("click", async () => {
      if (!getAds()?.showInterstitial) return;
      ui.btnContinueAd.disabled = true;
      ui.btnContinueAd.textContent = "Загрузка…";
      try {
        await getAds().showInterstitial();
        game.state.over = false;
        game.state.paused = false;
        game.state.continueUsed = true;
        game.state.snake.pop();
        game.hideOverlay();
        game.syncUI();
      } catch {
        alert("Реклама сейчас недоступна. Попробуй позже.");
      } finally {
        ui.btnContinueAd.disabled = false;
        ui.btnContinueAd.textContent = "Продолжить за рекламу";
      }
    });

    ui.btnPause.addEventListener("click", () => {
      if (game.state.paused && !game.state.over) game.resume();
      else game.togglePause();
    });

    ui.btnSound.addEventListener("click", async () => {
      const next = !storage.getSound();
      storage.setSound(next);
      // unlock audio context on first gesture
      if (next) {
        try {
          const a = new (window.AudioContext || window.webkitAudioContext)();
          await a.resume();
          await a.close();
        } catch {}
      }
      // update via audio module
      const on = storage.getSound();
      // audio module keeps its own flag
      // eslint-disable-next-line no-use-before-define
      audio.setEnabled(on);
      game.syncUI();
    });

    ui.btnSpeed.addEventListener("click", () => game.cycleSpeed());

    setupAdButtons();

    ui.btnShare.addEventListener("click", async () => {
      const best = storage.getBest();
      const text = `Мой рекорд в игре «Змей»: ${best}. Попробуешь побить?`;
      if (typeof VKMini?.share === "function") {
        const r = await VKMini.share(text);
        if (r?.ok) return;
      }
      try {
        await navigator.clipboard.writeText(text);
        alert("Скопировано в буфер обмена:\n\n" + text);
      } catch {
        alert("Текст для sharing:\n\n" + text);
      }
    });
  }

  async function boot() {
    game.syncUI();
    if (ui.overlay) ui.overlay.hidden = true;
    setupInput();
    window.addEventListener("resize", () => {
      fitCanvas();
    });
    fitCanvas();

    await waitVkAdsReady();
    game.start();
  }

  // init
  boot();
})();

