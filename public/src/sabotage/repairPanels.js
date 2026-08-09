// How each sabotage is put right. They are deliberately four different jobs - the
// handprint scanners belong to the reactor and nothing else.
//
//   switches   Fix Lights   throw every breaker back up
//   keypad     O2 Depleted  type the code off the sticky note, at both panels
//   radio      Comms        turn the dial until the carrier comes back into phase
//   handprint  Reactor      two scanners held in the same moment, so two people
//
// A panel gets a context and builds its own DOM:
//
//   ctx.root      element to build into
//   ctx.panel     the shared state the server rolled for this outage
//   ctx.station   which of the sabotage's panels this one is
//   ctx.act(v)    send an interaction; resolves to the panel as it now stands
//   ctx.status(t) set the line of feedback
//
// The state that matters is the server's, not this file's: the breakers are one
// shared set every player toggles, and the reactor genuinely needs two people.

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export const REPAIR_PANELS = {
  // Five breakers, one to five of them thrown. All players share the set, so one
  // can be flipped back down behind you.
  switches: {
    title: "Electrical — breaker panel",
    instruction: "Throw every breaker back up.",
    build(ctx) {
      const rig = el("div", "rp-switches");
      const rows = [];
      for (let i = 0; i < 5; i++) {
        const cell = el("div", "rp-breaker");
        const track = el("button", "rp-breaker-track");
        track.type = "button";
        track.dataset.index = String(i);
        track.append(el("i"));
        const lamp = el("span", "rp-breaker-lamp");
        cell.append(track, lamp);
        rig.append(cell);
        rows.push({ track, lamp });
      }
      ctx.root.append(rig);

      const paint = (state) => {
        const on = state?.switches ?? [];
        rows.forEach((row, i) => {
          row.track.classList.toggle("is-on", Boolean(on[i]));
          row.lamp.classList.toggle("is-on", Boolean(on[i]));
        });
        const down = on.filter((value) => !value).length;
        ctx.status(down ? `${down} breaker${down === 1 ? "" : "s"} still down.` : "All breakers up.");
      };
      paint(ctx.panel);

      const flip = (event) => {
        const track = event.target.closest(".rp-breaker-track");
        if (!track) return;
        ctx.act({ value: Number(track.dataset.index) }).then((result) => {
          if (result?.panel) paint(result.panel);
        }).catch((error) => ctx.status(error.message));
      };
      rig.addEventListener("click", flip);
      return { teardown: () => rig.removeEventListener("click", flip), paint };
    }
  },

  // The code is on the note beside the keypad - it is not meant to be a secret,
  // it is meant to make you stand at two panels on opposite sides of the ship.
  keypad: {
    title: "Oxygen — code entry",
    instruction: "Type the code from the note, then Enter.",
    build(ctx) {
      const rig = el("div", "rp-keypad");
      const note = el("div", "rp-note");
      note.append(el("small", null, "SECURITY CODE"), el("b", null, ctx.panel?.code ?? "------"));
      const side = el("div", "rp-keypad-side");
      const readout = el("div", "rp-readout", "------");
      const pad = el("div", "rp-pad");
      side.append(readout, pad);
      rig.append(note, side);
      ctx.root.append(rig);

      let entry = "";
      const draw = () => { readout.textContent = entry.padEnd(6, "-"); };
      const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "⏎"];
      for (const key of keys) {
        const button = el("button", "rp-key", key);
        button.type = "button";
        button.dataset.key = key;
        pad.append(button);
      }
      const press = (event) => {
        const button = event.target.closest(".rp-key");
        if (!button) return;
        const key = button.dataset.key;
        if (key === "⌫") { entry = entry.slice(0, -1); draw(); return; }
        if (key === "⏎") {
          ctx.act({ value: entry }).then((result) => {
            if (result?.solved) return;
            if (result?.rejected) {
              readout.classList.add("is-bad");
              ctx.status("BAD — check the note and try again.");
              setTimeout(() => readout.classList.remove("is-bad"), 700);
              entry = ""; draw();
            }
          }).catch((error) => ctx.status(error.message));
          return;
        }
        if (entry.length >= 6) return;
        entry += key;
        draw();
        if (entry.length === 6) ctx.status("Press Enter.");
      };
      pad.addEventListener("click", press);
      draw();
      ctx.status(ctx.panel?.repaired?.includes(ctx.station) ? "This panel is already signed off." : "Enter the code.");
      return {
        teardown: () => pad.removeEventListener("click", press),
        paint: (state) => {
          if (state?.repaired?.includes(ctx.station)) ctx.status("Signed off — the other panel still needs the code.");
        }
      };
    }
  },

  // Turn until the carrier comes back into phase. The wave is the readout: it
  // settles into a clean sine as the dial closes on the frequency.
  radio: {
    title: "Communications — carrier alignment",
    instruction: "Turn the dial until the wave steadies, then hold it.",
    build(ctx) {
      const rig = el("div", "rp-radio");
      const scope = el("div", "rp-scope");
      const canvas = document.createElement("canvas");
      canvas.width = 420; canvas.height = 150;
      scope.append(canvas);
      const lamps = el("div", "rp-lamps");
      const bad = el("i", "rp-lamp is-bad is-lit");
      const good = el("i", "rp-lamp is-good");
      lamps.append(bad, good);
      const dialWrap = el("div", "rp-dial-wrap");
      const dial = el("div", "rp-dial");
      dial.append(el("i"));
      dialWrap.append(dial);
      rig.append(scope, lamps, dialWrap);
      ctx.root.append(rig);

      const target = Number(ctx.panel?.target ?? 0.5);
      const tolerance = Number(ctx.panel?.tolerance ?? 0.045);
      let value = 0.02;
      let raf = 0;
      let solved = false;
      const context = canvas.getContext("2d");

      const draw = (time) => {
        const off = Math.abs(value - target);
        // Noise falls away as the dial closes, so the wave itself is the feedback.
        const noise = clamp(off / 0.35, 0, 1);
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.strokeStyle = off <= tolerance ? "#69efb2" : "#74e5ff";
        context.lineWidth = 2.5;
        context.beginPath();
        for (let x = 0; x <= canvas.width; x += 2) {
          const phase = (x / canvas.width) * Math.PI * 6 + time / 260;
          const jitter = (Math.sin(phase * 5.3) + Math.sin(phase * 11.7)) * 0.5 * noise;
          const y = canvas.height / 2 + (Math.sin(phase) * (1 - noise * 0.55) + jitter) * 42;
          if (x === 0) context.moveTo(x, y); else context.lineTo(x, y);
        }
        context.stroke();
        dial.style.setProperty("--turn", `${value * 300 - 150}deg`);
        bad.classList.toggle("is-lit", off > tolerance);
        good.classList.toggle("is-lit", off <= tolerance);
        raf = requestAnimationFrame(draw);
      };
      raf = requestAnimationFrame(draw);

      // Only tell the server when the dial actually looks right; it re-checks.
      let pending = false;
      const settle = () => {
        if (solved || pending || Math.abs(value - target) > tolerance) return;
        pending = true;
        ctx.act({ value }).then((result) => {
          pending = false;
          if (result?.solved) solved = true;
        }).catch((error) => { pending = false; ctx.status(error.message); });
      };
      const setFromPointer = (event) => {
        const box = dial.getBoundingClientRect();
        const dx = event.clientX - (box.left + box.width / 2);
        const dy = event.clientY - (box.top + box.height / 2);
        // -150deg..150deg maps onto the band.
        const deg = clamp(Math.atan2(dx, -dy) * 180 / Math.PI, -150, 150);
        value = (deg + 150) / 300;
        ctx.status(Math.abs(value - target) <= tolerance ? "Locked on." : "Keep turning.");
        settle();
      };
      let dragging = false;
      const down = (event) => { dragging = true; dial.setPointerCapture?.(event.pointerId); setFromPointer(event); };
      const move = (event) => { if (dragging) setFromPointer(event); };
      const up = () => { dragging = false; };
      dial.addEventListener("pointerdown", down);
      dial.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      ctx.status("Turn the dial.");
      return {
        teardown: () => {
          cancelAnimationFrame(raf);
          dial.removeEventListener("pointerdown", down);
          dial.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        }
      };
    }
  },

  // Two scanners, held at the same moment. One player cannot do it alone, which
  // is the whole point of the meltdown.
  handprint: {
    title: "Reactor — hand scanner",
    instruction: "Hold the scanner. Someone must hold the other one at the same time.",
    build(ctx) {
      const rig = el("div", "rp-hand");
      const pad = el("button", "rp-handpad");
      pad.type = "button";
      pad.append(el("span", "rp-handmark", "✋"));
      const readout = el("p", "rp-hand-readout", "HOLD TO STOP MELTDOWN");
      rig.append(pad, readout);
      ctx.root.append(rig);

      let holding = false;
      let timer = 0;
      const ping = (release = false) => {
        ctx.act({ value: release ? "release" : "hold" }).then((result) => {
          if (result?.solved) { readout.textContent = "REACTOR NOMINAL"; return; }
          const held = result?.panel?.held ?? [];
          const others = held.filter((id) => id !== ctx.station).length;
          if (!holding) return;
          readout.textContent = others ? "REACTOR NOMINAL" : "WAITING FOR SECOND USER";
          rig.classList.toggle("is-paired", others > 0);
        }).catch((error) => ctx.status(error.message));
      };
      const start = () => {
        if (holding) return;
        holding = true;
        pad.classList.add("is-held");
        readout.textContent = "WAITING FOR SECOND USER";
        ping();
        // The hold expires server-side, so it has to be renewed while pressed.
        timer = setInterval(ping, 400);
      };
      const stop = () => {
        if (!holding) return;
        holding = false;
        pad.classList.remove("is-held");
        rig.classList.remove("is-paired");
        readout.textContent = "HOLD TO STOP MELTDOWN";
        clearInterval(timer);
        ping(true);
      };
      pad.addEventListener("pointerdown", start);
      window.addEventListener("pointerup", stop);
      pad.addEventListener("pointerleave", stop);
      ctx.status("Both scanners at once.");
      return {
        teardown: () => {
          clearInterval(timer);
          pad.removeEventListener("pointerdown", start);
          window.removeEventListener("pointerup", stop);
          pad.removeEventListener("pointerleave", stop);
        },
        paint: (state) => {
          const others = (state?.held ?? []).filter((id) => id !== ctx.station).length;
          if (holding) readout.textContent = others ? "REACTOR NOMINAL" : "WAITING FOR SECOND USER";
          rig.classList.toggle("is-paired", holding && others > 0);
        }
      };
    }
  }
};

export function repairPanelFor(kind) {
  return REPAIR_PANELS[kind] ?? null;
}
