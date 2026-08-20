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
//
// Two rules the consoles below all follow:
//
//   Every task is playable without a mouse. Five of these were pure drags, which
//   made them impossible on a keyboard - not awkward, impossible. Each drag
//   surface is focusable and answers the arrow keys, and the pointer and key
//   paths drive the same state so neither is a second-class way to play.
//
//   Difficulty never depends on the size of the window. A threshold in pixels is
//   a different task on a phone than on a desktop; anything measured across a
//   surface is measured as a fraction of that surface.

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

// Names for the colours, so the wiring panel can be described rather than seen.
const WIRE_NAMES = ["red", "blue", "yellow", "pink"];

// A status line that only touches the DOM when the words actually change. The
// held tasks report progress every frame; without this each of them wrote a
// fresh string sixty times a second for the whole hold.
function throttleStatus(ctx) {
  let last = null;
  return (text) => {
    if (text === last) return;
    last = text;
    ctx.status(text);
  };
}

// Unbiased shuffle. Array.sort with a random comparator is not one: the result
// is skewed by the sort implementation, so some layouts came up far more often
// than others.
//
// Exported for the tests. The minigames themselves need a document, so this and
// distanceToPath below are the only parts of this file a headless test can reach
// - which is exactly why the arithmetic worth checking lives in them.
export function shuffled(values) {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Make an element part of the tab order and describe it, so the console can be
// reached and understood without sight of it.
function makeFocusable(node, label) {
  node.tabIndex = 0;
  node.setAttribute("role", "application");
  node.setAttribute("aria-label", label);
  return node;
}

// Arrow keys as a second way to drive a drag. Returns a teardown.
//
// `onNudge` is handed a direction in the surface's own normalised space, already
// scaled by the step; holding a key repeats it, which is what makes a steady
// keyboard drag possible at all.
function onArrowKeys(surface, { step = 0.045, onNudge, onCommit, onRelease } = {}) {
  const DIRECTIONS = {
    ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]
  };
  const down = (event) => {
    if (event.key === "Enter" || event.key === " ") {
      if (!onCommit) return;
      event.preventDefault();
      onCommit();
      return;
    }
    const direction = DIRECTIONS[event.key];
    if (!direction) return;
    // Otherwise the arrows scroll the modal out from under the console.
    event.preventDefault();
    // Shift is the fine adjustment, for the tasks that ask you to settle on a
    // mark rather than just reach it.
    const scale = event.shiftKey ? 0.25 : 1;
    onNudge?.(direction[0] * step * scale, direction[1] * step * scale, event);
  };
  const up = (event) => {
    if (DIRECTIONS[event.key]) onRelease?.(event);
  };
  surface.addEventListener("keydown", down);
  surface.addEventListener("keyup", up);
  return () => {
    surface.removeEventListener("keydown", down);
    surface.removeEventListener("keyup", up);
  };
}

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
//
// The loop keeps running after the fill lands. It used to stop there, which left
// the board frozen at full if the server refused the step - the lever was up,
// nothing was moving, and there was no way to try again short of walking away
// from the console. Now letting go drains it and the next hold re-fires.
function holdToFill(button, { seconds = 2.5, onProgress, onFull, decay = 2 }) {
  let held = false;
  let fill = 0;
  let fired = false;
  let last = performance.now();
  let raf = 0;
  const tick = (now) => {
    const delta = Math.min(0.1, (now - last) / 1000);
    last = now;
    fill = clamp(fill + (held ? delta / seconds : -delta * decay / seconds), 0, 1);
    onProgress?.(fill);
    if (fill >= 1 && !fired) {
      fired = true;
      onFull?.();
    } else if (fill < 0.9) {
      // Re-arm once it has drained clear of the top, so a held button cannot
      // fire twice off one press.
      fired = false;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  const down = () => { held = true; };
  const up = () => { held = false; };
  const key = (event) => {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    if (event.type === "keydown") held = true; else held = false;
  };
  button.addEventListener("pointerdown", down);
  window.addEventListener("pointerup", up);
  button.addEventListener("pointerleave", up);
  button.addEventListener("keydown", key);
  button.addEventListener("keyup", key);
  button.addEventListener("blur", up);
  return () => {
    cancelAnimationFrame(raf);
    button.removeEventListener("pointerdown", down);
    window.removeEventListener("pointerup", up);
    button.removeEventListener("pointerleave", up);
    button.removeEventListener("keydown", key);
    button.removeEventListener("keyup", key);
    button.removeEventListener("blur", up);
  };
}

// Shortest distance from a point to a polyline, and which segment was nearest.
// The course task needs this to tell following the line from wandering off it.
export function distanceToPath(path, x, y) {
  let best = Infinity;
  let atSegment = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, ay] = path[i];
    const [bx, by] = path[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared ? clamp(((x - ax) * dx + (y - ay) * dy) / lengthSquared, 0, 1) : 0;
    const distance = Math.hypot(x - (ax + dx * t), y - (ay + dy * t));
    if (distance < best) { best = distance; atSegment = i; }
  }
  return { distance: best, segment: atSegment };
}

// ---------------------------------------------------------------------------

export const MINIGAMES = {
  // Join each wire on the left to the terminal of the same colour on the right.
  wiring: {
    label: "Fix Wiring",
    instruction: "Drag each wire to the terminal of the same colour, or tab to a wire and press Enter.",
    build(ctx) {
      const board = el("div", "tg-wiring");
      const canvas = svg("svg", { class: "tg-wires", viewBox: "0 0 400 260", preserveAspectRatio: "none" });
      canvas.setAttribute("aria-hidden", "true");
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
        l.setAttribute("aria-label", `${WIRE_NAMES[i]} wire, not connected`);
        left.append(l);
        nodes.left.push(l);

        const r = el("button", "tg-wire-node");
        r.type = "button";
        // The right column is colour-shuffled by the pairing, as on the real panel.
        const colour = pairing.indexOf(i);
        r.style.background = WIRE_COLOURS[colour];
        r.dataset.index = String(i);
        r.setAttribute("aria-label", `${WIRE_NAMES[colour]} terminal`);
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
      // Hidden rather than collapsed to a point. Collapsing it to (0,0) left a
      // stub of stroke pinned to the top-left corner after every join, because a
      // 7px round cap still paints when both ends sit on the same coordinate.
      live.style.display = "none";
      canvas.append(live);

      const clearLive = () => {
        live.style.display = "none";
        if (from !== null) nodes.left[from].classList.remove("is-live");
        from = null;
      };
      const drawJoin = (li, ri) => {
        const a = centreOf(nodes.left[li]);
        const b = centreOf(nodes.right[ri]);
        const line = svg("line", {
          x1: 0, y1: a.y, x2: 400, y2: b.y,
          stroke: WIRE_COLOURS[li], "stroke-width": 7, "stroke-linecap": "round"
        });
        canvas.insertBefore(line, live);
      };
      const join = (li, ri) => {
        joined.add(li);
        drawJoin(li, ri);
        nodes.left[li].classList.add("is-done");
        nodes.left[li].setAttribute("aria-label", `${WIRE_NAMES[li]} wire, connected`);
        nodes.right[ri].classList.add("is-done");
        nodes.right[ri].disabled = true;
        ctx.status(`${joined.size} of 4 joined.`);
        if (joined.size === 4) ctx.complete();
      };
      const pick = (event) => {
        const node = event.target.closest(".tg-wire-node");
        if (!node) return;
        const side = node.parentElement === left ? "left" : "right";
        const index = Number(node.dataset.index);
        if (side === "left") {
          if (joined.has(index)) return;
          // Picking the live wire again puts it down; picking a different one
          // switches to it. Previously a second press left two wires marked live.
          if (from === index) { clearLive(); ctx.status("Wire put down."); return; }
          if (from !== null) nodes.left[from].classList.remove("is-live");
          from = index;
          node.classList.add("is-live");
          const a = centreOf(node);
          live.style.display = "";
          live.setAttribute("stroke", WIRE_COLOURS[index]);
          live.setAttribute("x1", "0"); live.setAttribute("y1", String(a.y));
          live.setAttribute("x2", "0"); live.setAttribute("y2", String(a.y));
          ctx.status(`Holding the ${WIRE_NAMES[index]} wire.`);
          return;
        }
        if (from === null) { ctx.status("Take hold of a wire on the left first."); return; }
        if (pairing[from] === index) {
          const wire = from;
          clearLive();
          join(wire, index);
        } else {
          ctx.status("That terminal is the wrong colour.");
          clearLive();
        }
      };
      const track = (event) => {
        if (from === null) return;
        const box = canvas.getBoundingClientRect();
        live.setAttribute("x2", String(clamp((event.clientX - box.left) / box.width * 400, 0, 400)));
        live.setAttribute("y2", String(clamp((event.clientY - box.top) / box.height * 260, 0, 260)));
      };
      board.addEventListener("pointerdown", pick);
      board.addEventListener("pointermove", track);
      // The nodes are real buttons, so Enter and Space already reach `pick`
      // through the click event - keyboard play needs no separate path here.
      board.addEventListener("click", (event) => {
        if (event.detail === 0) pick(event);   // detail 0 means it came from a key
      });
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
    instruction: "Drag the card through the reader at a steady speed, or hold the right arrow key.",
    build(ctx) {
      const rig = el("div", "tg-card-rig");
      const slot = el("div", "tg-card-slot");
      const card = el("div", "tg-card", "CREW ID");
      const readout = el("div", "tg-card-readout", "READY");
      readout.setAttribute("role", "status");
      slot.append(card);
      rig.append(slot, readout);
      ctx.root.append(rig);
      makeFocusable(slot, "Card reader. Hold the right arrow key to draw the card through at a steady speed.");

      // Judged in slot-widths per second, not pixels per second. The old
      // thresholds were absolute, so the same swipe that read as steady on a
      // 420px desktop slot read as far too slow on a narrow phone - the task
      // was quietly harder on a small screen.
      const TOO_FAST = 2.15;
      const TOO_SLOW = 0.45;
      const NEEDED = 0.55;              // fraction of the slot to count as through
      const CARD_FRACTION = 0.26;       // the card's own share of the slot width

      let startX = 0, startAt = 0, dragging = false, offset = 0;
      const width = () => slot.getBoundingClientRect().width || 1;
      const draw = () => { card.style.transform = `translateX(${offset * width()}px)`; };
      const judge = (travelled, seconds) => {
        card.style.transition = "transform .35s ease";
        offset = 0;
        draw();
        if (travelled < NEEDED) {
          readout.textContent = "INCOMPLETE";
          ctx.status("Swipe all the way through.");
          return;
        }
        const speed = travelled / Math.max(0.001, seconds);   // slot widths per second
        if (speed > TOO_FAST) { readout.textContent = "TOO FAST"; ctx.status("Too fast — try again."); }
        else if (speed < TOO_SLOW) { readout.textContent = "TOO SLOW"; ctx.status("Too slow — try again."); }
        else { readout.textContent = "ACCEPTED"; ctx.complete(); }
      };

      const stopDrag = onDrag(slot, {
        start: (p) => {
          // Grab anywhere on the card itself, wherever the card happens to be.
          if (p.x / p.box.width > CARD_FRACTION + offset) {
            ctx.status("Take hold of the card on the left.");
            return;
          }
          dragging = true;
          startX = p.x / p.box.width;
          startAt = performance.now();
          card.style.transition = "none";
        },
        move: (p) => {
          if (!dragging) return;
          offset = clamp(p.x / p.box.width - startX, 0, 1 - CARD_FRACTION);
          draw();
        },
        end: (p) => {
          if (!dragging) return;
          dragging = false;
          judge(p.x / p.box.width - startX, (performance.now() - startAt) / 1000);
        }
      });

      // Key repeat is what makes this fair on a keyboard: holding the arrow
      // moves the card at whatever rate the player's repeat is set to, and the
      // same steadiness test applies to it.
      let keyStartedAt = 0;
      const stopKeys = onArrowKeys(slot, {
        step: 0.055,
        onNudge: (dx) => {
          if (dx <= 0) return;
          if (!keyStartedAt) { keyStartedAt = performance.now(); card.style.transition = "none"; }
          offset = clamp(offset + dx, 0, 1 - CARD_FRACTION);
          draw();
        },
        onRelease: () => {
          if (!keyStartedAt) return;
          const seconds = (performance.now() - keyStartedAt) / 1000;
          keyStartedAt = 0;
          judge(offset, seconds);
        }
      });

      ctx.status("Drag the card from the left.");
      return () => { stopDrag(); stopKeys(); };
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
      bar.setAttribute("role", "progressbar");
      bar.setAttribute("aria-valuemin", "0");
      bar.setAttribute("aria-valuemax", "100");
      bar.setAttribute("aria-valuenow", "0");
      const fill = el("i");
      bar.append(fill);
      const button = el("button", "tg-button", downloading ? "Download" : "Upload");
      button.type = "button";
      rig.append(title, bar, button);
      ctx.root.append(rig);

      const say = throttleStatus(ctx);
      let raf = 0;
      button.addEventListener("click", () => {
        button.disabled = true;
        const started = performance.now();
        const run = (now) => {
          const ratio = clamp((now - started) / 4200, 0, 1);
          const percent = Math.round(ratio * 100);
          fill.style.width = `${ratio * 100}%`;
          bar.setAttribute("aria-valuenow", String(percent));
          say(`${percent}%`);
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
      lever.setAttribute("aria-label", "Garbage lever. Hold to empty the chute.");
      lever.append(el("span", null, "PULL"));
      rig.append(chute, lever);
      ctx.root.append(rig);

      const say = throttleStatus(ctx);
      const stop = holdToFill(lever, {
        seconds: 2.6, decay: 1.6,
        onProgress: (fill) => {
          trash.style.transform = `translateY(${fill * 130}%)`;
          trash.style.opacity = String(1 - fill * 0.7);
          lever.style.setProperty("--pull", String(fill));
          say(fill > 0.02 ? `Chute ${Math.round(fill * 100)}% clear.` : "Hold the lever down.");
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
      button.setAttribute("aria-label", filling ? "Hold to fill the canister" : "Hold to pump fuel into the engine");
      rig.append(label, gauge, button);
      ctx.root.append(rig);

      const say = throttleStatus(ctx);
      const stop = holdToFill(button, {
        seconds: 3, decay: 1.4,
        onProgress: (value) => {
          fill.style.height = `${value * 100}%`;
          say(`${Math.round(value * 100)}%`);
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
      makeFocusable(track, `${diverting ? "Divert to weapons" : "Accept power"} breaker. Press the up arrow to throw it.`);

      let done = false;
      // The knob is 58px tall in a 210px track, so it can travel 72% of the way
      // up before its own top would leave the track.
      const TRAVEL = 72;
      let ratio = 0;
      const draw = () => { knob.style.bottom = `${ratio * TRAVEL}%`; };
      const throwUp = () => {
        if (done) return;
        done = true;
        ratio = 1;
        draw();
        track.classList.add("is-on");
        track.setAttribute("aria-label", "Breaker thrown");
        ctx.complete();
      };
      const stop = onDrag(track, {
        move: (p) => {
          if (done) return;
          ratio = 1 - clamp(p.y / p.box.height, 0, 1);
          draw();
          if (ratio > 0.86) throwUp();
        },
        end: () => { if (!done) { ratio = 0; draw(); } }
      });
      // Clicking the top of the track works too, for anyone not dragging.
      const click = (event) => {
        if (done || event.detail === 0) return;
        const box = track.getBoundingClientRect();
        if ((event.clientY - box.top) / box.height < 0.3) throwUp();
      };
      track.addEventListener("click", click);
      const stopKeys = onArrowKeys(track, {
        step: 0.12,
        onNudge: (dx, dy) => {
          if (done) return;
          ratio = clamp(ratio - dy, 0, 1);
          draw();
          if (ratio > 0.86) throwUp();
        },
        onCommit: throwUp,
        onRelease: () => { if (!done) { ratio = 0; draw(); } }
      });
      ctx.status("Push the switch up.");
      return () => { stop(); stopKeys(); track.removeEventListener("click", click); };
    }
  },

  // Simon says: watch the pattern, then repeat it. Five rounds, growing by one.
  reactor: {
    label: "Start Reactor",
    instruction: "Watch the pattern, then repeat it on the keypad.",
    build(ctx) {
      const rig = el("div", "tg-reactor");
      const show = el("div", "tg-pad is-display");
      show.setAttribute("aria-hidden", "true");
      const pad = el("div", "tg-pad is-input");
      const showCells = [], padCells = [];
      for (let i = 0; i < 4; i++) {
        const a = el("i", "tg-cell");
        show.append(a); showCells.push(a);
        const b = el("button", "tg-cell");
        b.type = "button"; b.dataset.index = String(i);
        b.setAttribute("aria-label", `Square ${i + 1}`);
        pad.append(b); padCells.push(b);
      }
      rig.append(show, pad);
      ctx.root.append(rig);

      // challenge[round] is the sequence for that round.
      const rounds = Array.isArray(ctx.challenge?.[0]) ? ctx.challenge : [[0], [0, 1], [0, 1, 2]];
      const sequence = rounds[ctx.step] ?? rounds[rounds.length - 1];
      let expect = 0;
      let accepting = false;
      const timers = new Set();
      // Every timeout goes through here. A press near the end of a round used to
      // schedule its own un-light with a bare setTimeout, which then fired into a
      // detached board after the stage was torn down and rebuilt.
      const later = (fn, ms) => {
        const id = setTimeout(() => { timers.delete(id); fn(); }, ms);
        timers.add(id);
        return id;
      };

      const play = () => {
        accepting = false;
        pad.setAttribute("aria-disabled", "true");
        ctx.status(`Round ${ctx.step + 1} of ${ctx.steps} — watch.`);
        sequence.forEach((cell, i) => {
          later(() => {
            showCells[cell].classList.add("is-lit");
            later(() => showCells[cell].classList.remove("is-lit"), 380);
          }, 520 * i + 400);
        });
        later(() => {
          accepting = true;
          pad.setAttribute("aria-disabled", "false");
          ctx.status("Your turn.");
        }, 520 * sequence.length + 500);
      };

      const press = (event) => {
        const cell = event.target.closest(".tg-cell");
        if (!cell || !accepting) return;
        const index = Number(cell.dataset.index);
        cell.classList.add("is-lit");
        later(() => cell.classList.remove("is-lit"), 180);
        if (index !== sequence[expect]) {
          expect = 0;
          accepting = false;
          pad.setAttribute("aria-disabled", "true");
          ctx.status("Wrong square — watch again.");
          later(play, 800);
          return;
        }
        expect += 1;
        ctx.status(`${expect} of ${sequence.length}.`);
        if (expect >= sequence.length) {
          accepting = false;
          pad.setAttribute("aria-disabled", "true");
          ctx.complete();
        }
      };
      pad.addEventListener("click", press);
      play();
      return () => {
        pad.removeEventListener("click", press);
        for (const timer of timers) clearTimeout(timer);
        timers.clear();
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
      for (const value of shuffled([...Array(10).keys()])) {
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
    instruction: "Drag the engine onto the centre line and hold it there. Arrow keys work too.",
    build(ctx) {
      const rig = el("div", "tg-align");
      const line = el("div", "tg-align-line");
      const slider = el("div", "tg-align-slider");
      rig.append(line, slider);
      ctx.root.append(rig);
      makeFocusable(rig, "Engine alignment. Use the up and down arrows to bring the engine onto the centre line, hold Shift for fine adjustment.");

      const HOLD_SECONDS = 0.9;
      const TOLERANCE = 0.045;
      let y = 0.24;             // 0..1 down the track
      let settled = 0;
      let raf = 0;
      let done = false;
      const say = throttleStatus(ctx);
      const draw = () => { slider.style.top = `${y * 100}%`; };
      draw();

      const stop = onDrag(rig, {
        move: (p) => { y = clamp(p.y / p.box.height, 0, 1); draw(); }
      });
      const stopKeys = onArrowKeys(rig, {
        step: 0.03,
        onNudge: (dx, dy) => { y = clamp(y + dy, 0, 1); draw(); }
      });
      let last = performance.now();
      const tick = (now) => {
        const delta = (now - last) / 1000; last = now;
        const off = Math.abs(y - 0.5);
        if (off < TOLERANCE) {
          settled += delta;
          rig.classList.add("is-aligned");
          say(`Holding… ${Math.min(HOLD_SECONDS, settled).toFixed(1)}s of ${HOLD_SECONDS.toFixed(1)}s`);
          if (settled >= HOLD_SECONDS && !done) { done = true; ctx.complete(); return; }
        } else {
          settled = 0;
          rig.classList.remove("is-aligned");
          say(off > 0.2 ? "Well off centre." : "Nearly — a little more.");
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => { stop(); stopKeys(); cancelAnimationFrame(raf); };
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
      count.setAttribute("role", "status");
      const sky = el("div", "tg-sky");
      field.append(sky, count);
      ctx.root.append(field);

      let hit = 0;
      let raf = 0;
      let spawnAt = 0;
      // Position lives on the object, not in dataset. Reading four numbers back
      // out of stringified attributes for every rock on every frame was the one
      // piece of per-frame work here that did real parsing.
      const rocks = [];
      const spawn = () => {
        const node = el("i", "tg-rock");
        const size = 20 + Math.random() * 22;
        node.style.width = `${size}px`;
        node.style.height = `${size}px`;
        const from = Math.random();
        const rock = { node, x: from * 92, y: -12, vx: (0.5 - from) * 8, vy: 11 + Math.random() * 9 };
        node.rock = rock;
        sky.append(node);
        rocks.push(rock);
      };
      const remove = (rock) => {
        const at = rocks.indexOf(rock);
        if (at >= 0) rocks.splice(at, 1);
      };
      let last = performance.now();
      const tick = (now) => {
        const delta = Math.min(0.06, (now - last) / 1000); last = now;
        spawnAt -= delta;
        if (spawnAt <= 0 && rocks.length < 9) { spawn(); spawnAt = 0.42; }
        for (let i = rocks.length - 1; i >= 0; i--) {
          const rock = rocks[i];
          rock.y += rock.vy * delta;
          rock.x += rock.vx * delta;
          rock.node.style.top = `${rock.y}%`;
          rock.node.style.left = `${rock.x}%`;
          rock.node.style.transform = `rotate(${rock.y * 6}deg)`;
          if (rock.y > 104) { rock.node.remove(); rocks.splice(i, 1); }
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);

      const say = throttleStatus(ctx);
      const shoot = (event) => {
        const node = event.target.closest(".tg-rock");
        if (!node?.rock) return;
        node.classList.add("is-hit");
        remove(node.rock);
        node.rock = null;
        setTimeout(() => node.remove(), 180);
        hit += 1;
        count.textContent = `${hit} / ${TARGET}`;
        say(`${hit} destroyed.`);
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
        const lit = !dead.has(index);
        if (lit) cell.classList.add("is-lit");
        cell.setAttribute("aria-label", `Shield panel ${index + 1}, ${lit ? "lit" : "down"}`);
        // A lit panel is not a control any more, so it should not be a tab stop.
        cell.disabled = lit;
        rig.append(cell);
        cells.push(cell);
      });
      ctx.root.append(rig);

      const remaining = () => cells.filter((cell) => !cell.classList.contains("is-lit")).length;
      const press = (event) => {
        const cell = event.target.closest(".tg-hex");
        if (!cell || cell.classList.contains("is-lit")) return;
        cell.classList.add("is-lit");
        cell.disabled = true;
        cell.setAttribute("aria-label", `Shield panel ${Number(cell.dataset.index) + 1}, lit`);
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
    instruction: "Drag the ship along the dotted line through every marker. Arrow keys work too.",
    build(ctx) {
      const rig = el("div", "tg-course");
      const canvas = svg("svg", { class: "tg-course-svg", viewBox: "0 0 400 240" });
      canvas.setAttribute("aria-hidden", "true");
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
      makeFocusable(rig, "Course plotter. Use the arrow keys to fly the ship along the dotted line through each marker.");

      // How far off the line the ship may stray before the course is lost.
      // Without it the ship could be walked anywhere on the panel between two
      // markers, so the dotted line was decoration rather than a route.
      //
      // This deliberately does not police how fast the line is followed. Between
      // two consecutive markers the straight line IS the path, so a player who
      // drags quickly from one to the next is tracing it correctly, not cutting
      // a corner - and a step limit strict enough to catch a tap would also
      // punish an honest fast drag on a slow frame.
      const CORRIDOR = 26;
      let reached = 1;
      let x = PATH[0][0];
      let y = PATH[0][1];
      const say = throttleStatus(ctx);
      marks[0].classList.add("is-done");

      const draw = () => {
        ship.setAttribute("cx", String(x));
        ship.setAttribute("cy", String(y));
      };
      const resetToLastMarker = (why) => {
        const at = PATH[Math.max(0, reached - 1)];
        x = at[0]; y = at[1];
        draw();
        rig.classList.remove("is-straying");
        if (why) ctx.status(why);
      };
      // Shared by the pointer and the arrow keys, so both are held to the corridor.
      const moveTo = (nx, ny) => {
        x = clamp(nx, 0, 400);
        y = clamp(ny, 0, 240);
        draw();
        const { distance } = distanceToPath(PATH, x, y);
        if (distance > CORRIDOR) {
          resetToLastMarker("Off course — back to the last marker.");
          return;
        }
        rig.classList.toggle("is-straying", distance > CORRIDOR * 0.6);
        const next = PATH[reached];
        if (next && Math.hypot(x - next[0], y - next[1]) < 22) {
          marks[reached].classList.add("is-done");
          reached += 1;
          ctx.status(`${reached} of ${PATH.length} markers.`);
          if (reached >= PATH.length) ctx.complete();
          return;
        }
        say(`Marker ${reached + 1} of ${PATH.length} ahead.`);
      };

      let dragging = false;
      const stop = onDrag(rig, {
        start: (p) => {
          // Only picking the ship up counts. Pressing straight onto a distant
          // marker used to teleport the ship there.
          const px = p.x / p.box.width * 400;
          const py = p.y / p.box.height * 240;
          dragging = Math.hypot(px - x, py - y) < 34;
          if (!dragging) ctx.status("Take hold of the ship first.");
        },
        move: (p) => {
          if (!dragging || reached >= PATH.length) return;
          moveTo(p.x / p.box.width * 400, p.y / p.box.height * 240);
        },
        end: () => {
          if (!dragging) return;
          dragging = false;
          // Letting go mid-leg drops back to the last marker reached, as before.
          if (reached < PATH.length) resetToLastMarker(null);
        }
      });
      const stopKeys = onArrowKeys(rig, {
        step: 1,
        onNudge: (dx, dy) => {
          if (reached >= PATH.length) return;
          moveTo(x + dx * 11, y + dy * 11);
        }
      });
      draw();
      ctx.status("Drag from the first marker.");
      return () => { stop(); stopKeys(); };
    }
  },

  // Hold the crosshair inside the box while the ship drifts.
  steering: {
    label: "Stabilize Steering",
    instruction: "Drag the crosshair into the box and hold it steady. Arrow keys work too.",
    build(ctx) {
      const rig = el("div", "tg-steering");
      const target = el("div", "tg-steer-target");
      const cross = el("div", "tg-steer-cross");
      rig.append(target, cross);
      ctx.root.append(rig);
      makeFocusable(rig, "Steering. Use the arrow keys to bring the crosshair into the box and hold it there; the ship drifts whenever you are not steering.");

      const HOLD_SECONDS = 1.4;
      let x = 0.22, y = 0.74;
      let settled = 0, raf = 0, done = false;
      let driftX = 0.06, driftY = -0.05;
      const say = throttleStatus(ctx);
      const draw = () => {
        cross.style.left = `${x * 100}%`;
        cross.style.top = `${y * 100}%`;
      };
      draw();
      let holding = false;
      // A key held down counts as steering, the same as a finger held down -
      // otherwise a keyboard player fought the drift between every key repeat
      // and the box could not be held at all.
      let keyHeldUntil = 0;
      const stop = onDrag(rig, {
        start: (p) => { holding = true; x = clamp(p.x / p.box.width, 0, 1); y = clamp(p.y / p.box.height, 0, 1); draw(); },
        move: (p) => { if (holding) { x = clamp(p.x / p.box.width, 0, 1); y = clamp(p.y / p.box.height, 0, 1); draw(); } },
        end: () => { holding = false; }
      });
      const stopKeys = onArrowKeys(rig, {
        step: 0.03,
        onNudge: (dx, dy) => {
          x = clamp(x + dx, 0, 1);
          y = clamp(y + dy, 0, 1);
          // Steering counts for a moment after the last repeat, so the gaps
          // between repeats do not read as letting go.
          keyHeldUntil = performance.now() + 260;
          draw();
        }
      });
      let last = performance.now();
      const tick = (now) => {
        const delta = Math.min(0.06, (now - last) / 1000); last = now;
        const steering = holding || now < keyHeldUntil;
        if (!steering) {
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
          say(`Holding… ${Math.min(HOLD_SECONDS, settled).toFixed(1)}s of ${HOLD_SECONDS.toFixed(1)}s`);
          if (settled >= HOLD_SECONDS && !done) { done = true; ctx.complete(); return; }
        } else {
          settled = 0;
          target.classList.remove("is-locked");
          say("Bring it into the box.");
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => { stop(); stopKeys(); cancelAnimationFrame(raf); };
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
      readout.setAttribute("role", "status");
      rig.append(body, beam, readout);
      ctx.root.append(rig);

      const SECONDS = 10;
      const started = performance.now();
      const say = throttleStatus(ctx);
      let raf = 0;
      const tick = (now) => {
        const elapsed = (now - started) / 1000;
        const ratio = clamp(elapsed / SECONDS, 0, 1);
        beam.style.top = `${(Math.sin(elapsed * 2.2) * 0.5 + 0.5) * 82}%`;
        readout.textContent = `SCANNING ${Math.round(ratio * 100)}%`;
        // A tenth-of-a-second countdown re-announced itself to a screen reader
        // ten times a second. Whole seconds say the same thing.
        say(`${Math.ceil(SECONDS - elapsed)}s remaining`);
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
        vial.disabled = true;
        vial.setAttribute("aria-label", `Sample ${i + 1}`);
        vial.append(el("i"));
        rack.append(vial);
        vials.push(vial);
      }
      const button = el("button", "tg-button", "Start analyser");
      button.type = "button";
      rig.append(rack, button);
      ctx.root.append(rig);

      // Kept across closing the modal, so you can start it and walk away as in
      // the real task rather than being made to stand and watch a minute pass.
      const key = `${ctx.taskId}:${ctx.site}`;
      let timer = 0;
      const reveal = () => {
        rack.classList.add("is-ready");
        vials[odd].classList.add("is-odd");
        // Only the odd vial is named as different; the others still have to be
        // told apart. Marking it up this way is what lets it be told apart at all
        // by anyone using a screen reader.
        vials.forEach((vial, index) => {
          vial.disabled = false;
          vial.setAttribute("aria-label", index === odd ? `Sample ${index + 1}, discoloured` : `Sample ${index + 1}, normal`);
        });
        button.remove();
        ctx.status("Take the sample that differs.");
      };
      const run = () => {
        // Once a second, not once a frame. This was a full sixty-per-second
        // animation loop whose only job was to rewrite a countdown in seconds.
        const paint = () => {
          const startedAt = SAMPLE_TIMERS.get(key);
          if (startedAt === undefined) return;
          const left = SECONDS - (Date.now() - startedAt) / 1000;
          if (left <= 0) { clearInterval(timer); reveal(); return; }
          button.disabled = true;
          button.textContent = `Analysing… ${Math.ceil(left)}s`;
          ctx.status("You can leave and come back.");
        };
        clearInterval(timer);
        timer = setInterval(paint, 250);
        paint();
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
      return () => clearInterval(timer);
    }
  },

  // Drag the debris out of the filter.
  o2filter: {
    label: "Clean O2 Filter",
    instruction: "Drag the leaves out through the opening at the bottom, or tab to one and use the arrow keys.",
    build(ctx) {
      const TOTAL = 7;
      const rig = el("div", "tg-o2");
      const chamber = el("div", "tg-chamber");
      const chute = el("div", "tg-chute-mouth", "OUT");
      rig.append(chamber, chute);
      ctx.root.append(rig);

      // Buttons rather than decoration, so each piece of debris is a real control
      // that can be tabbed to and moved. As bare <i> elements they could only ever
      // be dragged, which made this task impossible without a pointer.
      const leaves = [];
      for (let i = 0; i < TOTAL; i++) {
        const leaf = el("button", "tg-leaf");
        leaf.type = "button";
        leaf.setAttribute("aria-label", `Debris ${i + 1} of ${TOTAL}. Use the arrow keys to move it down and out.`);
        leaf.dataset.left = String(12 + Math.random() * 68);
        leaf.dataset.top = String(10 + Math.random() * 60);
        leaf.style.left = `${leaf.dataset.left}%`;
        leaf.style.top = `${leaf.dataset.top}%`;
        leaf.style.rotate = `${Math.random() * 360}deg`;
        chamber.append(leaf);
        leaves.push(leaf);
      }
      let cleared = 0;
      const OUT_BELOW = 92;
      const clear = (leaf) => {
        // Move focus on before the element goes, or the keyboard is dumped back
        // at the top of the document mid-task.
        const next = leaves.find((other) => other !== leaf && other.isConnected);
        leaf.remove();
        cleared += 1;
        ctx.status(`${cleared} of ${TOTAL} cleared.`);
        if (cleared >= TOTAL) { ctx.complete(); return; }
        next?.focus();
      };
      const place = (leaf, left, top) => {
        leaf.dataset.left = String(clamp(left, -8, 108));
        leaf.dataset.top = String(clamp(top, -8, 118));
        leaf.style.left = `${leaf.dataset.left}%`;
        leaf.style.top = `${leaf.dataset.top}%`;
      };

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
          place(held,
            (p.x - (box.left - rigBox.left)) / box.width * 100,
            (p.y - (box.top - rigBox.top)) / box.height * 100);
        },
        end: () => {
          if (!held) return;
          // Anything dragged past the bottom of the chamber is out.
          if (Number(held.dataset.top) > OUT_BELOW) clear(held);
          else held.classList.remove("is-held");
          held = null;
        }
      });
      const keys = (event) => {
        const leaf = event.target.closest(".tg-leaf");
        if (!leaf) return;
        const DIRECTIONS = { ArrowLeft: [-4, 0], ArrowRight: [4, 0], ArrowUp: [0, -4], ArrowDown: [0, 4] };
        const direction = DIRECTIONS[event.key];
        if (!direction) return;
        event.preventDefault();
        place(leaf, Number(leaf.dataset.left) + direction[0], Number(leaf.dataset.top) + direction[1]);
        if (Number(leaf.dataset.top) > OUT_BELOW) clear(leaf);
      };
      chamber.addEventListener("keydown", keys);
      ctx.status(`${TOTAL} pieces of debris.`);
      return () => { stop(); chamber.removeEventListener("keydown", keys); };
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
      const key = (event) => {
        if (event.code !== "Space") return;
        // The button already answers Space when it has focus; taking the key
        // again here would stop it twice on one press.
        if (event.target === button) return;
        event.preventDefault();
        press();
      };
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
