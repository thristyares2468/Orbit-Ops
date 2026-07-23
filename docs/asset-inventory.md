# Supplied asset inventory

Generated from `public/assets/art/`. The source assets were preserved as PNG files; no destructive conversion was performed.

| Category | Files | Current integration status |
| --- | ---: | --- |
| Accessories & Pets | 16 | Lazy Asset Archive; reserved for authored cosmetics mapping |
| Background | 5 | Stars and anomaly layer used by loading/world asset loader; all archived |
| DISCUSS! | 5 | Archived and reserved for discussion transition adapter |
| Fonts | 6 | Archived as display-texture references |
| Gui | 8 | Archived; current UI is accessible HTML/CSS |
| Kill Stabs | 2 | Archived as elimination-effect references |
| Maps | 34 | Archived pending the owner's authored map code |
| Players | 4 | Archived pending the owner's authored character adapter |
| SHHHHH! | 5 | Archived and reserved for role-reveal transition adapter |
| Tasks | 84 | Ten task images and grid are used directly; full set archived |
| Unused | 1 | Preserved in the archive |
| Voting | 2 | Archived and reserved for final meeting presentation |
| **Total** | **172** | **Every non-logo file catalogued** |

Excluded category: `Logos`, at the owner's request.

`asset-inventory.json` is the canonical per-file list. Each entry records its source-relative path, URL-safe runtime path, dimensions, intended use, provisional status, and replacement boundary. `public/src/artCatalog.js` is the corresponding browser module.

To rebuild both generated files:

```bash
npm run assets:inventory
```
