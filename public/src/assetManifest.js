export const ASSET_MANIFEST = Object.freeze({
  stars: {
    path: "/assets/art/Background/Stars-sharedassets0.assets-56.png",
    type: "texture", category: "environment", required: true,
    colourSpace: "srgb", wrap: "repeat", repeat: [8, 5]
  },
  anomalyLayer1: {
    path: "/assets/art/Background/Paralax1-sharedassets0.assets-115.png",
    type: "image", category: "environment", required: true
  },
  anomalyLayer2: {
    path: "/assets/art/Background/paralax2-sharedassets0.assets-149.png",
    type: "image", category: "environment", required: false
  },
  anomalyLayer3: {
    path: "/assets/art/Background/paralax3-sharedassets0.assets-69.png",
    type: "image", category: "environment", required: false
  },
  hologramGrid: {
    path: "/assets/art/Tasks/grid-sharedassets0.assets-156.png",
    type: "texture", category: "ui", required: true,
    colourSpace: "srgb", wrap: "repeat", repeat: [10, 10]
  },
  hologramGlow: {
    path: "/assets/art/Tasks/glow-sharedassets0.assets-191.png",
    type: "texture", category: "effects", required: false
  },
  meetingBackdrop: {
    path: "/assets/art/Voting/VotingScreen-sharedassets0.assets-158.png",
    type: "image", category: "meeting", required: false
  },
  discussionBackdrop: {
    path: "/assets/art/DISCUSS!/yes_bg-sharedassets2.assets-15.png",
    type: "image", category: "meeting", required: false
  },
  roleRevealBackdrop: {
    path: "/assets/art/SHHHHH!/no_bg-sharedassets2.assets-10.png",
    type: "image", category: "role-reveal", required: false
  },
  playerReference: {
    path: "/assets/player-models/base/idle/idle.png",
    type: "image", category: "character", required: false
  }
});

export const ASSET_GROUPS = Object.freeze({
  essential: Object.entries(ASSET_MANIFEST).filter(([, asset]) => asset.required).map(([key]) => key),
  optional: Object.entries(ASSET_MANIFEST).filter(([, asset]) => !asset.required).map(([key]) => key)
});
