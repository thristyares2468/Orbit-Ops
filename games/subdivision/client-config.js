// Hosted clients use the current origin by default. Canopy replaces this file
// at build time with its remote multiplayer endpoint and client credential.
window.JIMS_CLIENT_CONFIG = Object.freeze({
  multiplayerUrl: '',
  apiKey: '',
  serviceWorkerEnabled: true,
  orbitReturnUrl: ''
});
