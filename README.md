# RIDGELINE

RIDGELINE is a native-feeling macOS route builder for trail running and mountain biking. Plot checkpoints on a live map, snap them to real trails, inspect distance and elevation, then export a standards-compliant GPX 1.1 track for Strava, Garmin, Wahoo, or another route system.

## What works

- Browse live OpenStreetMap tiles with visible source attribution
- Locate yourself on demand and start a route from your current position
- Click anywhere on the map to add route checkpoints
- Snap the full route to OpenStreetMap paths with BRouter's hiking or MTB profile
- Rename, reorder, remove, undo, redo, or reverse route segments
- Switch between trail-run and mountain-bike effort estimates
- Scrub the elevation profile to locate the matching point on the map
- Persist the current draft locally between launches
- Export through a native macOS save dialog in the Tauri app
- Download a GPX file directly when using the browser preview
- Use keyboard shortcuts for every primary route action

GPX export includes BRouter's WGS 84 trail geometry and elevation values. RIDGELINE does not upload directly to Strava; import the exported `.gpx` file into the service or device of your choice.

An internet connection is required for map tiles and trail routing. RIDGELINE shows a dashed direct-line preview if routing is unavailable, but deliberately disables GPX export until a real routed track is ready.

## Requirements

- macOS 13 or newer
- [rustup](https://rustup.rs)
- Xcode Command Line Tools (`xcode-select --install`)

The repository pins Rust 1.95.0 and Tauri CLI 2.11.4. The setup script installs both Apple architectures so universal builds are available.

## Run it

```bash
./scripts/setup.sh
./scripts/doctor.sh
./scripts/dev.sh
```

The Tauri dev server watches both `ui/` and the Rust crate. For a browser preview, serve `ui/` from localhost so the browser can use the secure-context Geolocation API; in that mode GPX export uses the browser download flow.

## Check and package

```bash
./scripts/check.sh
./scripts/build_macos_app.sh
open "dist/RIDGELINE.app"
```

`check.sh` validates shell and JavaScript syntax, checks Rust formatting, runs Clippy with warnings denied, and executes all tests.

The build script regenerates platform icons when the source icon changes, builds the release bundle, copies it to `dist/`, applies an ad-hoc signature when needed, and verifies the resulting app metadata and signature.

## Keyboard map

| Shortcut | Action |
| --- | --- |
| <kbd>⌘E</kbd> | Export GPX |
| <kbd>⌘N</kbd> | Start a new route |
| <kbd>⌘R</kbd> | Reverse the route |
| <kbd>⌘L</kbd> | Locate me and center the map |
| <kbd>⌘P</kbd> | Add a checkpoint at map center |
| <kbd>⌘Z</kbd> / <kbd>⌘⇧Z</kbd> | Undo / redo checkpoint |
| <kbd>⌘1</kbd> / <kbd>⌘2</kbd> | Trail run / mountain bike mode |
| <kbd>⌘/</kbd> | Toggle the shortcut panel |

These shortcuts are window-scoped and do not register system-wide hotkeys.

## Project map

```text
ui/                          Static HTML, CSS, JS, and vendored Leaflet map engine
src-tauri/src/               Rust GPX validation, generation, and export
src-tauri/tauri.conf.json    Window, security, and bundle configuration
src-tauri/capabilities/      Tauri permission grants
assets/icons/                RIDGELINE app icon source and generated icons
scripts/                     Setup, checks, development, icons, packaging
AGENTS.md                    Coding-agent instructions
FEEDBACK.md                  Persistent project-specific corrections
```

## GPX details

The Rust backend validates route names, activity types, coordinate ranges, elevation ranges, track-point counts, and export file names before writing a file. Exported documents use GPX 1.1 with a single track segment and an activity type of `Trail Running` or `Mountain Biking`.

Browser-preview GPX files are built with the same structure in JavaScript so the main workflow remains testable without Tauri IPC.

## Live data and privacy

- Base-map tiles come from OpenStreetMap and remain subject to the [OpenStreetMap tile usage policy](https://operations.osmfoundation.org/policies/tiles/).
- Trail routing comes from the public [BRouter](https://brouter.de/brouter-web/) service using OpenStreetMap data, the `hiking-mountain` profile for trail running, and the `mtb` profile for mountain biking. No API key is required, and the public service has no uptime guarantee.
- Location access is requested only after you choose **Locate Me** or press <kbd>⌘L</kbd>. macOS controls the permission, and RIDGELINE does not continuously track you.
- Your draft is stored locally. When a route has two or more checkpoints, their coordinates are sent to BRouter to calculate the route; map tile requests go to OpenStreetMap.

## License

[MIT](LICENSE)
