// Render serves the client and server from one origin, so these defaults keep
// the existing deployment unchanged. The Cloudflare build replaces this file
// with its public Render endpoint and its static /tips/ destination.
window.ORBIT_OPS_CLIENT_CONFIG = Object.freeze({
  backendUrl: "",
  subdivisionUrl: "/easter-egg/jims-launch"
});
