// The Skeld's assignments, each played the way the real task is played.
//
// Every minigame gets a context and builds its own DOM inside the task modal:
//
//   ctx.root       element to build into
//   ctx.challenge  whatever the server decided (Simon pattern, wire pairing, ...)
//   ctx.steps      how many steps this console takes
//   ctx.step       which step is outstanding
//   ctx.complete() claim the current step; resolves when the server accepts it
//   ctx.status(t)  set the line of feedback under the console
//
// A minigame returns a teardown function, or nothing if it has nothing to undo.
// The server holds the shape of the work - steps in order, one at a time, rate
// limited - but it cannot referee a drag, so the gesture itself is judged here.

const NS = "http://www.w3.org/2000/svg";
const svg = (name, attrs = {}) => {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
};
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

// Wire colours, in the game's order.
const WIRE_COLOURS = ["#e8483f", "#3f6ee8", "#e8c53f", "#ec4bd0"];

// Pointer drag helper: reports movement in the element's own pixel space.
function onDrag(surface, { start, move, end }) {
  let active = false;
  const point = (event) => {
    const box = surface.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top, box };
  };
  const down = (event) => {
    active = true;
    surface.setPointerCapture?.(event.pointerId);
    start?.(point(event), event);
  };
  const drag = (event) => { if (active) move?.(point(event), event); };
  const up = (event) => {
    if (!active) return;
    active = false;
    end?.(point(event), event);
  };
  surface.addEventListener("pointerdown", down);
  surface.addEventListener("pointermove", drag);
  surface.addEventListener("pointerup", up);
  surface.addEventListener("pointercancel", up);
  surface.addEventListener("pointerleave", up);
  return () => {
    surface.removeEventListener("pointerdown", down);
    surface.removeEventListener("pointermove", drag);
    surface.removeEventListener("pointerup", up);
    surface.removeEventListener("pointercancel", up);
    surface.removeEventListener("pointerleave", up);
  };
}

// A press you have to keep held; releasing early loses the fill.
function holdToFill(button, { seconds = 2.5, onProgress, onFull, decay = 2 }) {
  let held = false;
  let fill = 0;
  let last = performance.now();
  let raf = 0;
  const tick = (now) => {
    const delta = Math.min(0.1, (now - last) / 1000);
    last = now;
    fill = clamp(fill + (held ? delta / seconds : -delta * decay / seconds), 0, 1);
    onProgress?.(fill);
    if (fill >= 1) { onFull?.(); return; }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  const down = () => { held = true; };
  const up = () => { held = false; };
  button.addEventListener("pointerdown", down);
  window.addEventListener("pointerup", up);
  button.addEventListener("pointerleave", up);
  return () => {
    cancelAnimationFrame(raf);
    button.removeEventListener("pointerdown", down);
    window.removeEventListener("pointerup", up);
    button.removeEventListener("pointerleave", up);
  };
}

// ---------------------------------------------------------------------------

export const MINIGAMES = {
  // Join each wire on the left to the terminal of the same colour on the right.
  wiring: {
    label: "Fix Wiring",
    instruction: "Drag each wire to the terminal of the same colour.",
    build(ctx) {
      const board = el("div", "tg-wiring");
      const canvas = svg("svg", { class: "tg-wires", viewBox: "0 0 400 260", preserveAspectRatio: "none" });
      const left = el("div", "tg-wiring-side is-left");
      const right = el("div", "tg-wiring-side is-right");
      // challenge[i] is which right-hand terminal the i-th left wire belongs to.
      const pairing = Array.isArray(ctx.challenge) && ctx.challenge.length === 4
        ? ctx.challenge : [0, 1, 2, 3];
      const nodes = { left: [], right: [] };
      for (let i = 0; i < 4; i++) {
        const l = el("button", "tg-wire-node");
        l.type = "button";
        l.style.background = WIRE_COLOURS[i];
        l.dataset.index = String(i);
        left.append(l);
        nodes.left.push(l);

        const r = el("button", "tg-wire-node");
        r.type = "button";
        // The right column is colour-shuffled by the pairing, as on the real panel.
        r.style.background = WIRE_COLOURS[pairing.indexOf(i)];
        r.dataset.index = String(i);
        right.append(r);
        nodes.right.push(r);
      }
      board.append(left, canvas, right);
      ctx.root.append(board);

      const joined = new Set();
      let from = null;
      const centreOf = (node) => {
        const b = node.getBoundingClientRect();
        const box = canvas.getBoundingClientRect();
        return {
          x: ((b.left + b.width / 2) - box.left) / box.width * 400,
          y: ((b.top + b.height / 2) - box.top) / box.height * 260
        };
      };
      const live = svg("line", { class: "tg-wire-live", "stroke-width": 7, "stroke-linecap": "round" });
      canvas.append(live);
      const drawJoin = (li, ri) => {
        const a = centreOf(nodes.left[li]);
        const b = centreOf(nodes.right[ri]);
        const line = svg("line", {
          x1: 0, y1: a.y, x2: 400, y2: b.y,
          stroke: WIRE_COLOURS[li], "stroke-width": 7, "stroke-linecap": "round"
        });
        canvas.insertBefore(line, live);
      };
      const pick = (event) => {
        const node = event.target.closest(".tg-wire-node");
        if (!node) return;
        const side = node.parentElement === left ? "left" : "right";
        const index = Number(node.dataset.index);
        if (side === "left") {
          if (joined.has(index)) return;
          from = index;
          node.classList.add("is-live");
          const a = centreOf(node);
          live.setAttribute("stroke", WIRE_COLOURS[index]);
          live.setAttribute("x1", "0"); live.setAttribute("y1", String(a.y));
          live.setAttribute("x2", "0"); live.setAttribute("y2", String(a.y));
          return;
        }
        if (from === null) return;
        if (pairing[from] === index) {
          joined.add(from);
          drawJoin(from, index);
          nodes.left[from].classList.add("is-done");
          node.classList.add("is-done");
          ctx.status(`${joined.size} of 4 joined.`);
          if (joined.size === 4) ctx.complete();
        } else {
          ctx.status("That terminal is the wrong colour.");
        }
        nodes.left[from]?.classList.remove("is-live");
        from = null;
        live.setAttribute("x2", "0"); live.setAttribute("y2", "0");
      };
      const track = (event) => {
        if (from === null) return;
        const box = canvas.getBoundingClientRect();
        live.setAttribute("x2", String(clamp((event.clientX - box.left) / box.width * 400, 0, 400)));
        live.setAttribute("y2", String(clamp((event.clientY - box.top) / box.height * 260, 0, 260)));
      };
      board.addEventListener("pointerdown", pick);
      board.addEventListener("pointermove", track);
      ctx.status("Drag a wire across.");
      return () => {
        board.removeEventListener("pointerdown", pick);
        board.removeEventListener("pointermove", track);
      };
    }
  },

  // Swipe the card through at a steady speed - too fast or too slow is rejected.
  card: {
    label: "Swipe Card",
    instruction: "Drag the card through the reader at a steady speed.",
    build(ctx) {
      const rig = el("div", "tg-card-rig");
      const slot = el("div", "tg-card-slot");
      const card = el("div", "tg-card", "CREW ID");
      const readout = el("div", "tg-card-readout", "READY");
      slot.append(card);
      rig.append(slot, readout);
      ctx.root.append(rig);

      let startX = 0, startAt = 0, dragging = false;
      const stop = onDrag(slot, {
        start: (p) => {
          if (p.x > 130) return;
          dragging = true; startX = p.x; startAt = performance.now();
          card.style.transition = "none";
        },
        move: (p) => {
          if (!dragging) return;
          card.style.transform = `translateX(${clamp(p.x - startX, 0, p.box.width - 110)}px)`;
        },
        end: (p) => {
          if (!dragging) return;
          dragging = false;
          const travel = p.x - startX;
          const seconds = (performance.now() - startAt) / 1000;
          card.style.transition = "transform .35s ease";
          card.style.transform = "translateX(0)";
          if (travel < p.box.width * 0.55) {
            readout.textContent = "INCOMPLETE";
            ctx.status("Swipe all the way through.");
            return;
          }
          const speed = travel / Math.max(0.001, seconds);   // px per second
          if (speed > 900) { readout.textContent = "TOO FAST"; ctx.status("Too fast — try again."); }
          else if (speed < 190) { readout.textContent = "TOO SLOW"; ctx.status("Too slow — try again."); }
          else { readout.textContent = "ACCEPTED"; ctx.complete(); }
        }
      });
      ctx.status("Drag the card from the left.");
      return stop;
    }
  },

  // Start the transfer, then let the bar run.
  upload: {
    label: "Transfer Data",
    instruction: "Start the transfer and wait for it to finish.",
    build(ctx) {
      const downloading = ctx.site === 0;
      const rig = el("div", "tg-upload");
      const title = el("p", "tg-upload-title", downloading ? "DOWNLOAD" : "UPLOAD");
      const bar = el("div", "tg-bar");
      const fill = el("i");
      bar.append(fill);
      const button = el("button", "tg-button", downloading ? "Download" : "Upload");
      button.type = "button";
      rig.append(title, bar, button);
      ctx.root.append(rig);

      let raf = 0;
      button.addEventListener("click", () => {
        button.disabled = true;
        const started = performance.now();
        const run = (now) => {
          const ratio = clamp((now - started) / 4200, 0, 1);
          fill.style.width = `${ratio * 100}%`;
          ctx.status(`${Math.round(ratio * 100)}%`);
          if (ratio >= 1) { ctx.complete(); return; }
          raf = requestAnimationFrame(run);
        };
        raf = requestAnimationFrame(run);
      });
      ctx.status(downloading ? "Ready to download." : "Ready to upload.");
      return () => cancelAnimationFrame(raf);
    }
  },

  // Pull the lever down and hold it until the chute is clear.
  garbage: {
    label: "Empty Garbage",
    instruction: "Pull the lever down and hold it until the chute empties.",
    build(ctx) {
      const rig = el("div", "tg-garbage");
      const chute = el("div", "tg-chute");
      const trash = el("i", "tg-trash");
      chute.append(trash);
      const lever = el("button", "tg-lever");
      lever.type = "button";
      lever.append(el("span", null, "PULL"));
      rig.append(chute, lever);
      ctx.root.append(rig);

      const stop = holdToFill(lever, {
        seconds: 2.6, decay: 1.6,
        onProgress: (fill) => {
          trash.style.transform = `translateY(${fill * 130}%)`;
          trash.style.opacity = String(1 - fill * 0.7);
          lever.style.setProperty("--pull", String(fill));
          ctx.status(fill > 0.02 ? `Chute ${Math.round(fill * 100)}% clear.` : "Hold the lever down.");
        },
        onFull: () => ctx.complete()
      });
      ctx.status("Hold the lever down.");
      return stop;
    }
  },

  // Fill the can at Storage, then pump it into the engine.
  fuel: {
    label: "Fuel Engines",
    instruction: "Hold the nozzle until the gauge is full.",
    build(ctx) {
      const filling = ctx.site % 2 === 0;
      const rig = el("div", "tg-fuel");
      const gauge = el("div", "tg-gauge");
      const fill = el("i");
      gauge.append(fill);
      const label = el("p", "tg-fuel-label", filling ? "FILL CANISTER" : "PUMP INTO ENGINE");
      const button = el("button", "tg-button is-hold", "Hold");
      button.type = "button";
      rig.append(label, gauge, button);
      ctx.root.append(rig);

      const stop = holdToFill(button, {
        seconds: 3, decay: 1.4,
        onProgress: (value) => {
          fill.style.height = `${value * 100}%`;
          ctx.status(`${Math.round(value * 100)}%`);
        },
        onFull: () => ctx.complete()
      });
      ctx.status("Press and hold.");
      return stop;
    }
  },

  // Throw the breaker up.
  power: {
    label: "Divert Power",
    instruction: "Flip the switch up.",
    build(ctx) {
      const diverting = ctx.site === 0;
      const rig = el("div", "tg-power");
      const label = el("p", "tg-fuel-label", diverting ? "DIVERT TO WEAPONS" : "ACCEPT POWER");
      const track = el("div", "tg-switch");
      const knob = el("i");
      track.append(knob);
      rig.append(label, track);
      ctx.root.append(rig);

      let done = false;
      // The knob is 58px tall in a 210px track, so it can travel 72% of the way
      // up before its own top would leave the track.
      const TRAVEL = 72;
      const throwUp = () => {
        done = true;
        knob.style.bottom = `${TRAVEL}%`;
        track.classList.add("is-on");
        ctx.complete();
      };
      const stop = onDrag(track, {
        move: (p) => {
          if (done) return;
          const ratio = 1 - clamp(p.y / p.box.height, 0, 1);
          knob.style.bottom = `${ratio * TRAVEL}%`;
          if (ratio > 0.86) throwUp();
        },
        end: () => { if (!done) knob.style.bottom = "0%"; }
      });
      // Clicking the top of the track works too, for anyone not dragging.
      const click = (event) => {
        if (done) return;
        const box = track.getBoundingClientRect();
        if ((event.clientY - box.top) / box.height < 0.3) throwUp();
      };
      track.addEventListener("click", click);
      ctx.status("Push the switch up.");
      return () => { stop(); track.removeEventListener("click", click); };
    }
  },

  // Simon says: watch the pattern, then repeat it. Five rounds, growing by one.
  reactor: {
    label: "Start Reactor",
    instruction: "Watch the pattern, then repeat it on the keypad.",
    build(ctx) {
      const rig = el("div", "tg-reactor");
      const show = el("div", "tg-pad is-display");
      const pad = el("div", "tg-pad is-input");
      const showCells = [], padCells = [];
      for (let i = 0; i < 4; i++) {
        const a = el("i", "tg-cell");
        show.append(a); showCells.push(a);
        const b = el("button", "tg-cell");
        b.type = "button"; b.dataset.index = String(i);
        pad.append(b); padCells.push(b);
      }
      rig.append(show, pad);
      ctx.root.append(rig);

      // challenge[round] is the sequence for that round.
      const rounds = Array.isArray(ctx.challenge?.[0]) ? ctx.challenge : [[0], [0, 1], [0, 1, 2]];
      const sequence = rounds[ctx.step] ?? rounds[rounds.length - 1];
      let expect = 0;
      let accepting = false;
      const timers = [];

      const play = () => {
        accepting = false;
        ctx.status(`Round ${ctx.step + 1} of ${ctx.steps} — watch.`);
        sequence.forEach((cell, i) => {
          timers.push(setTimeout(() => {
            showCells[cell].classList.add("is-lit");
            timers.push(setTimeout(() => showCells[cell].classList.remove("is-lit"), 380));
          }, 520 * i + 400));
        });
        timers.push(setTimeout(() => {
          accepting = true;
          ctx.status("Your turn.");
        }, 520 * sequence.length + 500));
      };

      const press = (event) => {
        const cell = event.target.closest(".tg-cell");
        if (!cell || !accepting) return;
        const index = Number(cell.dataset.index);
        cell.classList.add("is-lit");
        setTimeout(() => cell.classList.remove("is-lit"), 180);
        if (index !== sequence[expect]) {
          expect = 0;
          accepting = false;
          ctx.status("Wrong square — watch again.");
          timers.push(setTimeout(play, 800));
          return;
        }
        expect += 1;
        if (expect >= sequence.length) {
          accepting = false;
          ctx.complete();
        }
      };
      pad.addEventListener("click", press);
      play();
      return () => {
        pad.removeEventListener("click", press);
        for (const timer of timers) clearTimeout(timer);
      };
    }
  },

  // Press 1 to 10 in order, as fast as you can.
  manifolds: {
    label: "Unlock Manifolds",
    instruction: "Press the numbers 1 to 10 in order.",
    build(ctx) {
      const grid = el("div", "tg-manifolds");
      // Scattered, as on the real panel, so it is a search and not a row.
      const order = [...Array(10).keys()].sort(() => Math.random() - 0.5);
      for (const value of order) {
        const button = el("button", "tg-manifold", String(value + 1));
        button.type = "button";
        button.dataset.value = String(value);
        grid.append(button);
      }
      ctx.root.append(grid);

      let next = 0;
      const press = (event) => {
        const button = event.target.closest(".tg-manifold");
        if (!button || button.disabled) return;
        if (Number(button.dataset.value) !== next) {
          ctx.status(`Out of order — ${next + 1} is next.`);
          return;
        }
        button.disabled = true;
        button.classList.add("is-done");
        next += 1;
        ctx.status(`${next} of 10.`);
        if (next >= 10) ctx.complete();
      };
      grid.addEventListener("click", press);
      ctx.status("Start at 1.");
      return () => grid.removeEventListener("click", press);
    }
  },

  // Slide the output onto the centre line and hold it there.
  align: {
    label: "Align Engine Output",
    instruction: "Drag the engine onto the centre line and hold it there.",
    build(ctx) {
      const rig = el("div", "tg-align");
      const line = el("div", "tg-align-line");
      const slider = el("div", "tg-align-slider");
      rig.append(line, slider);
      ctx.root.append(rig);

      let y = 0.24;             // 0..1 down the track
      let settled = 0;
      let raf = 0;
      let done = false;
      const draw = () => { slider.style.top = `${y * 100}%`; };
      draw();

      const stop = onDrag(rig, {
        move: (p) => { y = clamp(p.y / p.box.height, 0, 1); draw(); }
      });
      let last = performance.now();
      const tick = (now) => {
        const delta = (now - last) / 1000; last = now;
        const off = Math.abs(y - 0.5);
        if (off < 0.045) {
          settled += delta;
          rig.classList.add("is-aligned");
          ctx.status(`Holding… ${Math.min(1, settled / 0.9).toFixed(1)}`);
          if (settled >= 0.9 && !done) { done = true; ctx.complete(); return; }
        } else {
          settled = 0;
          rig.classList.remove("is-aligned");
          ctx.status(off > 0.2 ? "Well off centre." : "Nearly — a little more.");
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => { stop(); cancelAnimationFrame(raf); };
    }
  },

  // Shoot down twenty asteroids.
  asteroids: {
    label: "Clear Asteroids",
    instruction: "Click the asteroids before they reach the hull.",
    build(ctx) {
      const TARGET = 20;
      const field = el("div", "tg-asteroids");
      const count = el("p", "tg-asteroid-count", `0 / ${TARGET}`);
      const sky = el("div", "tg-sky");
      field.append(sky, count);
      ctx.root.append(field);

      let hit = 0;
      let raf = 0;
      let spawnAt = 0;
      const rocks = [];
      const spawn = () => {
        const rock = el("i", "tg-rock");
        const size = 20 + Math.random() * 22;
        rock.style.width = `${size}px`;
        rock.style.height = `${size}px`;
        const from = Math.random();
        rock.dataset.x = String(from * 92);
        rock.dataset.y = "-12";
        rock.dataset.vx = String((0.5 - from) * 8);
        rock.dataset.vy = String(11 + Math.random() * 9);
        sky.append(rock);
        rocks.push(rock);
      };
      let last = performance.now();
      const tick = (now) => {
        const delta = Math.min(0.06, (now - last) / 1000); last = now;
        spawnAt -= delta;
        if (spawnAt <= 0 && rocks.length < 9) { spawn(); spawnAt = 0.42; }
        for (const rock of [...rocks]) {
          const y = Number(rock.dataset.y) + Number(rock.dataset.vy) * delta;
          const x = Number(rock.dataset.x) + Number(rock.dataset.vx) * delta;
          rock.dataset.y = String(y); rock.dataset.x = String(x);
          rock.style.top = `${y}%`;
          rock.style.left = `${x}%`;
          rock.style.transform = `rotate(${y * 6}deg)`;
          if (y > 104) { rock.remove(); rocks.splice(rocks.indexOf(rock), 1); }
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);

      const shoot = (event) => {
        const rock = event.target.closest(".tg-rock");
        if (!rock) return;
        rock.classList.add("is-hit");
        rocks.splice(rocks.indexOf(rock), 1);
        setTimeout(() => rock.remove(), 180);
        hit += 1;
        count.textContent = `${hit} / ${TARGET}`;
        ctx.status(`${hit} destroyed.`);
        if (hit >= TARGET) ctx.complete();
      };
      sky.addEventListener("pointerdown", shoot);
      ctx.status("Fire at will.");
      return () => { cancelAnimationFrame(raf); sky.removeEventListener("pointerdown", shoot); };
    }
  },

  // Press the red panels until every one is lit.
  shields: {
    label: "Prime Shields",
    instruction: "Press the red panels until all seven are lit.",
    build(ctx) {
      const rig = el("div", "tg-shields");
      // Seven hexagons round a hub, as on the real console.
      const OFFSETS = [
        [50, 50], [50, 14], [82, 32], [82, 68], [50, 86], [18, 68], [18, 32]
      ];
      const dead = new Set(Array.isArray(ctx.challenge) ? ctx.challenge : [0, 2, 4]);
      const cells = [];
      OFFSETS.forEach(([x, y], index) => {
        const cell = el("button", "tg-hex");
        cell.type = "button";
        cell.style.left = `${x}%`;
        cell.style.top = `${y}%`;
        cell.dataset.index = String(index);
        // Anything the server did not flag starts already lit.
        if (!dead.has(index)) cell.classList.add("is-lit");
        rig.append(cell);
        cells.push(cell);
      });
      ctx.root.append(rig);

      const remaining = () => cells.filter((cell) => !cell.classList.contains("is-lit")).length;
      const press = (event) => {
        const cell = event.target.closest(".tg-hex");
        if (!cell || cell.classList.contains("is-lit")) return;
        cell.classList.add("is-lit");
        const left = remaining();
        ctx.status(left ? `${left} panel${left === 1 ? "" : "s"} still down.` : "Shields primed.");
        if (left === 0) ctx.complete();
      };
      rig.addEventListener("click", press);
      ctx.status(`${remaining()} panels down.`);
      if (remaining() === 0) ctx.complete();
      return () => rig.removeEventListener("click", press);
    }
  },

  // Trace the course through every checkpoint.
  course: {
    label: "Chart Course",
    instruction: "Drag the ship along the dotted line through every marker.",
    build(ctx) {
      const rig = el("div", "tg-course");
      const canvas = svg("svg", { class: "tg-course-svg", viewBox: "0 0 400 240" });
      const PATH = [[28, 196], [110, 150], [186, 178], [258, 96], [330, 44]];
      const d = PATH.map((p, i) => `${i ? "L" : "M"}${p[0]} ${p[1]}`).join(" ");
      canvas.append(svg("path", { d, class: "tg-course-line" }));
      const marks = PATH.map(([x, y], index) => {
        const mark = svg("circle", { cx: x, cy: y, r: 13, class: "tg-course-mark" });
        mark.dataset.index = String(index);
        canvas.append(mark);
        return mark;
      });
      const ship = svg("circle", { cx: PATH[0][0], cy: PATH[0][1], r: 9, class: "tg-course-ship" });
      canvas.append(ship);
      rig.append(canvas);
      ctx.root.append(rig);

      let reached = 0;
      let dragging = false;
      marks[0].classList.add("is-done");
      reached = 1;
      const stop = onDrag(rig, {
        start: () => { dragging = true; },
        move: (p) => {
          if (!dragging) return;
          const x = p.x / p.box.width * 400;
          const y = p.y / p.box.height * 240;
          ship.setAttribute("cx", String(x));
          ship.setAttribute("cy", String(y));
          const next = PATH[reached];
          if (next && Math.hypot(x - next[0], y - next[1]) < 22) {
            marks[reached].classList.add("is-done");
            reached += 1;
            ctx.status(`${reached} of ${PATH.length} markers.`);
            if (reached >= PATH.length) { dragging = false; ctx.complete(); }
          }
        },
        end: () => {
          dragging = false;
          // Slipping off the line sends the ship back to the last marker reached.
          const at = PATH[Math.max(0, reached - 1)];
          ship.setAttribute("cx", String(at[0]));
          ship.setAttribute("cy", String(at[1]));
        }
      });
      ctx.status("Drag from the first marker.");
      return stop;
    }
  },

  // Hold the crosshair inside the box while the ship drifts.
  steering: {
    label: "Stabilize Steering",
    instruction: "Drag the crosshair into the box and hold it steady.",
    build(ctx) {
      const rig = el("div", "tg-steering");
      const target = el("div", "tg-steer-target");
      const cross = el("div", "tg-steer-cross");
      rig.append(target, cross);
      ctx.root.append(rig);

      let x = 0.22, y = 0.74;
      let settled = 0, raf = 0, done = false;
      let driftX = 0.06, driftY = -0.05;
      const draw = () => {
        cross.style.left = `${x * 100}%`;
        cross.style.top = `${y * 100}%`;
      };
      draw();
      let holding = false;
      const stop = onDrag(rig, {
        start: (p) => { holding = true; x = clamp(p.x / p.box.width, 0, 1); y = clamp(p.y / p.box.height, 0, 1); draw(); },
        move: (p) => { if (holding) { x = clamp(p.x / p.box.width, 0, 1); y = clamp(p.y / p.box.height, 0, 1); draw(); } },
        end: () => { holding = false; }
      });
      let last = performance.now();
      const tick = (now) => {
        const delta = Math.min(0.06, (now - last) / 1000); last = now;
        if (!holding) {
          // The ship wanders when you let go, so it has to be actively held.
          x = clamp(x + driftX * delta, 0, 1);
          y = clamp(y + driftY * delta, 0, 1);
          if (x <= 0 || x >= 1) driftX *= -1;
          if (y <= 0 || y >= 1) driftY *= -1;
          draw();
        }
        const inBox = Math.abs(x - 0.5) < 0.1 && Math.abs(y - 0.5) < 0.1;
        if (inBox) {
          settled += delta;
          target.classList.add("is-locked");
          ctx.status(`Holding… ${Math.min(1.4, settled).toFixed(1)}s`);
          if (settled >= 1.4 && !done) { done = true; ctx.complete(); return; }
        } else {
          settled = 0;
          target.classList.remove("is-locked");
          ctx.status("Bring it into the box.");
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => { stop(); cancelAnimationFrame(raf); };
    }
  },

  // Stand on the pad and stay still.
  scan: {
    label: "Submit Scan",
    instruction: "Stand on the pad and hold still while the scan runs.",
    build(ctx) {
      const rig = el("div", "tg-scan");
      const body = el("div", "tg-scan-body");
      const beam = el("i", "tg-scan-beam");
      const readout = el("p", "tg-scan-readout", "AWAITING SUBJECT");
      rig.append(body, beam, readout);
      ctx.root.append(rig);

      const SECONDS = 10;
      const started = performance.now();
      let raf = 0;
      const tick = (now) => {
        const elapsed = (now - started) / 1000;
        const ratio = clamp(elapsed / SECONDS, 0, 1);
        beam.style.top = `${(Math.sin(elapsed * 2.2) * 0.5 + 0.5) * 82}%`;
        readout.textContent = `SCANNING ${Math.round(ratio * 100)}%`;
        ctx.status(`${(SECONDS - elapsed).toFixed(1)}s remaining`);
        if (ratio >= 1) { readout.textContent = "SCAN COMPLETE"; ctx.complete(); return; }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }
  },

  // Start the analyser, wait, then pick out the odd sample.
  sample: {
    label: "Inspect Sample",
    instruction: "Start the analyser, wait for it, then take the sample that differs.",
    build(ctx) {
      const SECONDS = 60;
      const rig = el("div", "tg-sample");
      const rack = el("div", "tg-rack");
      const vials = [];
      // The server picks which vial is the odd one out.
      const odd = clamp(Number(ctx.challenge?.[0] ?? 0), 0, 5);
      for (let i = 0; i < 6; i++) {
        const vial = el("button", "tg-vial");
        vial.type = "button";
        vial.dataset.index = String(i);
        vial.append(el("i"));
        rack.append(vial);
        vials.push(vial);
      }
      const button = el("button", "tg-button", "Start analyser");
      button.type = "button";
      rig.append(rack, button);
      ctx.root.append(rig);

      let raf = 0;
      // Kept across closing the modal, so you can start it and walk away as in
      // the real task rather than being made to stand and watch a minute pass.
      const key = `${ctx.taskId}:${ctx.site}`;
      const reveal = () => {
        rack.classList.add("is-ready");
        vials[odd].classList.add("is-odd");
        button.remove();
        ctx.status("Take the sample that differs.");
      };
      const run = () => {
        const startedAt = SAMPLE_TIMERS.get(key);
        const tick = () => {
          const left = SECONDS - (Date.now() - startedAt) / 1000;
          if (left <= 0) { reveal(); return; }
          button.disabled = true;
          button.textContent = `Analysing… ${Math.ceil(left)}s`;
          ctx.status("You can leave and come back.");
          raf = requestAnimationFrame(tick);
        };
        tick();
      };
      if (SAMPLE_TIMERS.has(key)) run();
      else {
        ctx.status("Press start.");
        button.addEventListener("click", () => {
          SAMPLE_TIMERS.set(key, Date.now());
          run();
        });
      }
      rack.addEventListener("click", (event) => {
        const vial = event.target.closest(".tg-vial");
        if (!vial || !rack.classList.contains("is-ready")) return;
        if (Number(vial.dataset.index) === odd) {
          SAMPLE_TIMERS.delete(key);
          ctx.complete();
        } else {
          ctx.status("That one matches the others.");
        }
      });
      return () => cancelAnimationFrame(raf);
    }
  },

  // Drag the debris out of the filter.
  o2filter: {
    label: "Clean O2 Filter",
    instruction: "Drag the leaves out through the opening at the bottom.",
    build(ctx) {
      const TOTAL = 7;
      const rig = el("div", "tg-o2");
      const chamber = el("div", "tg-chamber");
      const chute = el("div", "tg-chute-mouth", "OUT");
      rig.append(chamber, chute);
      ctx.root.append(rig);

      const leaves = [];
      for (let i = 0; i < TOTAL; i++) {
        const leaf = el("i", "tg-leaf");
        leaf.style.left = `${12 + Math.random() * 68}%`;
        leaf.style.top = `${10 + Math.random() * 60}%`;
        leaf.style.transform = `rotate(${Math.random() * 360}deg)`;
        chamber.append(leaf);
        leaves.push(leaf);
      }
      let cleared = 0;
      let held = null;
      const stop = onDrag(rig, {
        start: (p, event) => {
          held = event.target.closest(".tg-leaf");
          if (held) held.classList.add("is-held");
        },
        move: (p) => {
          if (!held) return;
          const box = chamber.getBoundingClientRect();
          const rigBox = rig.getBoundingClientRect();
          held.style.left = `${clamp((p.x - (box.left - rigBox.left)) / box.width * 100, -8, 108)}%`;
          held.style.top = `${clamp((p.y - (box.top - rigBox.top)) / box.height * 100, -8, 118)}%`;
        },
        end: () => {
          if (!held) return;
          // Anything dragged past the bottom of the chamber is out.
          if (parseFloat(held.style.top) > 92) {
            held.remove();
            cleared += 1;
            ctx.status(`${cleared} of ${TOTAL} cleared.`);
            if (cleared >= TOTAL) ctx.complete();
          } else {
            held.classList.remove("is-held");
          }
          held = null;
        }
      });
      ctx.status(`${TOTAL} pieces of debris.`);
      return stop;
    }
  },

  // Stop the node as it crosses the target, three times.
  calibrate: {
    label: "Calibrate Distributor",
    instruction: "Press when the node crosses the marker on the right.",
    build(ctx) {
      const rig = el("div", "tg-calibrate");
      const ring = el("div", "tg-ring");
      const marker = el("i", "tg-ring-target");
      const node = el("i", "tg-ring-node");
      ring.append(marker, node);
      const button = el("button", "tg-button", "Stop");
      button.type = "button";
      rig.append(ring, button);
      ctx.root.append(rig);

      let angle = Math.PI;
      let raf = 0;
      let armed = true;
      // Each round runs faster than the last.
      const speed = 2.1 + ctx.step * 0.55;
      let last = performance.now();
      const tick = (now) => {
        const delta = Math.min(0.06, (now - last) / 1000); last = now;
        angle = (angle + speed * delta) % (Math.PI * 2);
        node.style.left = `${50 + Math.cos(angle) * 41}%`;
        node.style.top = `${50 + Math.sin(angle) * 41}%`;
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);

      const press = () => {
        if (!armed) return;
        // The marker sits at angle 0, on the right.
        const off = Math.min(angle, Math.PI * 2 - angle);
        if (off < 0.34) {
          armed = false;
          ring.classList.add("is-hit");
          ctx.complete();
        } else {
          ctx.status("Missed — go round again.");
          ring.classList.add("is-miss");
          setTimeout(() => ring.classList.remove("is-miss"), 260);
        }
      };
      button.addEventListener("click", press);
      const key = (event) => { if (event.code === "Space") { event.preventDefault(); press(); } };
      window.addEventListener("keydown", key);
      ctx.status(`Round ${ctx.step + 1} of ${ctx.steps}.`);
      return () => {
        cancelAnimationFrame(raf);
        button.removeEventListener("click", press);
        window.removeEventListener("keydown", key);
      };
    }
  }
};

// Sample analyser start times, so the minute runs whether or not the modal is open.
const SAMPLE_TIMERS = new Map();

export function resetMinigameState(timers = SAMPLE_TIMERS) {
  const cleared = timers.size;
  timers.clear();
  return cleared;
}

export function minigameFor(kind) {
  return MINIGAMES[kind] ?? null;
}
