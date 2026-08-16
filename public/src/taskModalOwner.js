// Tasks and sabotage repairs share one DOM shell. This tiny lease prevents one
// interface from clearing or closing the other interface's live controls.
let owner = null;

export function claimTaskModal(candidate) {
  if (owner && owner !== candidate) return false;
  owner = candidate;
  return true;
}

export function ownsTaskModal(candidate) {
  return owner === candidate;
}

export function releaseTaskModal(candidate) {
  if (owner !== candidate) return false;
  owner = null;
  return true;
}
