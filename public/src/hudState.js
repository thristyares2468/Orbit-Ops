// Pure presentation rules shared by the HUD and its tests. Keeping them free of the
// DOM means the mode-dependent behaviour can be asserted directly.

// The server deliberately never spends finite role uses in practice, so practice must
// not advertise a countable number. Cooldowns stay real in every mode.
export function roleAbilityStatus({ mode, roleState = {}, now = Date.now() }) {
  const cooldownSeconds = Math.max(0, Math.ceil(((roleState.cooldownEndsAt ?? 0) - now) / 1000));
  const activeSeconds = Math.max(0, Math.ceil(((roleState.activeUntil ?? 0) - now) / 1000));
  const practice = mode === "practice";
  const finite = roleState.usesLeft !== null && roleState.usesLeft !== undefined;
  const exhausted = !practice && finite && roleState.usesLeft <= 0;
  const disabled = cooldownSeconds > 0 || exhausted;

  if (activeSeconds > 0) return { label: `ACTIVE ${activeSeconds}s`, ariaLabel: null, disabled };
  if (cooldownSeconds > 0) return { label: `${cooldownSeconds}s`, ariaLabel: null, disabled };
  if (practice && finite) {
    return { label: "∞ practice", ariaLabel: "Unlimited uses in practice", disabled };
  }
  if (finite) {
    const left = Math.max(0, roleState.usesLeft);
    return { label: `${left} use${left === 1 ? "" : "s"}`, ariaLabel: null, disabled };
  }
  return { label: "Ready", ariaLabel: null, disabled };
}

// Escape opens a menu, not a pause: the authoritative server keeps simulating.
export function pauseCopy(mode) {
  if (mode === "practice") {
    return {
      eyebrow: "SYSTEM MENU — SIMULATION CONTINUES",
      note: "Practice runs on the same authoritative server. Training operatives keep moving and sabotage countdowns keep ticking while this menu is open."
    };
  }
  return {
    eyebrow: "SYSTEM MENU — MATCH CONTINUES",
    note: "The match is server-authoritative. Sabotage countdowns, meetings and other players keep running while this menu is open."
  };
}

// The shared meter counts every crew member, bots included, so it can move while the
// player stands still. The personal line makes that legible.
export function progressLabels(sharedProgress = { completed: 0, total: 0 }, tasks = [], completedTaskIds = []) {
  const done = new Set(completedTaskIds);
  const mine = tasks.filter((task) => done.has(task.id)).length;
  return {
    crew: `Crew assignments ${sharedProgress.completed ?? 0} / ${sharedProgress.total ?? 0}`,
    personal: `Your assignments ${mine} / ${tasks.length}`
  };
}
