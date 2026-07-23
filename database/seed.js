import { closeDatabase, isDatabaseConfigured, query } from "./database.js";

if (!isDatabaseConfigured()) {
  console.error("DATABASE_URL is not configured; seed was not run.");
  process.exitCode = 1;
} else {
  const cosmetics = [
    ["helmet", "antenna", "Signal Antenna", "A compact deep-space signal antenna."],
    ["helmet", "scanner", "Survey Scanner", "A calibrated KX-71 survey scanner."],
    ["helmet", "crest", "Meridian Crest", "Formal Operations Crew insignia."],
    ["backpack", "standard", "Operations Pack", "Standard O.S.V. Meridian life-support pack."]
  ];
  try {
    for (const item of cosmetics) {
      await query(
        `INSERT INTO cosmetics (cosmetic_type, cosmetic_key, display_name, description, unlock_requirement)
         VALUES ($1, $2, $3, $4, 'starter') ON CONFLICT (cosmetic_key) DO NOTHING`,
        item
      );
    }
    console.log("Orbit Ops starter cosmetics seeded.");
  } catch (error) {
    console.error("Database seed failed:", error.message);
    process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
}
