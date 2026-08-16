import { timingSafeEqual } from "node:crypto";
import { isDatabaseConfigured } from "../database/database.js";
import {
  createRestriction, findAccountByDisplayName, listRestrictions, revokeRestrictions, setAccountRole
} from "../database/repositories/moderationRepository.js";
import { cleanText } from "./validation.js";

// A break-glass moderation route, separate from the in-game panel so a broken
// client or a locked-out owner is not the end of moderation. It is guarded by
// its own token rather than by an account, precisely because the account route
// is the one that might be unavailable.
//
// Absent ORBIT_ADMIN_TOKEN the whole router 404s: an unset secret must not mean
// an open door.

function tokenMatches(presented, expected) {
  const a = Buffer.from(String(presented ?? ""));
  const b = Buffer.from(String(expected ?? ""));
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

function bearerToken(request) {
  const header = String(request.headers.authorization ?? "");
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

function expiryFrom(body) {
  const hours = Number(body?.hours);
  if (!Number.isFinite(hours) || hours <= 0) return null;
  return new Date(Date.now() + Math.min(hours, 24 * 365) * 3_600_000);
}

export function createAdminRouter({ token = process.env.ORBIT_ADMIN_TOKEN, onRestrictionChanged = null } = {}) {
  const configured = String(token ?? "").trim();

  return async function adminRoute(request, response) {
    // An unconfigured token is not a 404 with a tell-tale header - it should look
    // exactly like a route that was never mounted.
    if (!configured || configured.length < 16) return response.status(404).send("Not found");
    // Every response past this point is moderation state; none of it may be cached.
    response.setHeader("Cache-Control", "no-store");
    if (!tokenMatches(bearerToken(request), configured)) return response.status(404).send("Not found");
    if (!isDatabaseConfigured()) return response.status(503).json({ error: "Database is not configured." });

    const action = String(request.params?.action ?? "");
    const body = request.body ?? {};
    try {
      if (action === "bans" || action === "mutes") {
        return response.json({ ok: true, entries: await listRestrictions(action, { limit: body.limit }) });
      }

      const restrict = ["ban", "mute"].includes(action);
      const lift = ["unban", "unmute"].includes(action);
      if (restrict || lift || action === "role") {
        const displayName = cleanText(body.displayName, 22);
        if (!displayName) return response.status(400).json({ error: "displayName is required." });
        const account = await findAccountByDisplayName(displayName);
        if (!account) return response.status(404).json({ error: "No such account." });

        if (action === "role") {
          const updated = await setAccountRole(account.id, String(body.role ?? "player"));
          return response.json({ ok: true, account: { displayName: updated.display_name, role: updated.role } });
        }
        const table = action.endsWith("ban") ? "bans" : "mutes";
        if (restrict) {
          const entry = await createRestriction(table, {
            accountId: account.id,
            reason: cleanText(body.reason, 500) || "No reason recorded.",
            issuedBy: null,
            expiresAt: expiryFrom(body)
          });
          onRestrictionChanged?.({ table, accountId: account.id, active: true });
          return response.json({ ok: true, entry });
        }
        const lifted = await revokeRestrictions(table, account.id);
        onRestrictionChanged?.({ table, accountId: account.id, active: false });
        return response.json({ ok: true, lifted });
      }
      return response.status(404).json({ error: "Unknown admin action." });
    } catch (error) {
      console.error(`[admin] ${action} failed:`, error.message);
      return response.status(400).json({ error: cleanText(error.message, 200) });
    }
  };
}
