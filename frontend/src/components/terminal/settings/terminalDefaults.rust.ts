/**
 * `TerminalConfig::default()`, as serde writes it - the Rust half of the
 * defaults contract (ticket #39).
 *
 * **Generated, not written.** Two tests keep it honest and neither of them
 * will let it rot in silence:
 *
 * - `models.rs :: the_default_settings_snapshot_the_frontend_reads_is_current`
 *   serialises `TerminalConfig::default()`, `include_str!`s this very file,
 *   slices the object literal out of it and asserts the two are equal. When a
 *   Rust default changes, that test fails and **prints the JSON to paste in
 *   here** - that is the regeneration procedure, in full.
 * - `terminalDefaults.test.ts` then asserts every key below matches
 *   `TERMINAL_SETTINGS` in `terminalDefaults.ts`, so the TS table cannot drift
 *   from it either.
 *
 * It is a `.ts` file rather than a `.json` one so both ends can read it
 * without help: Rust takes the text between the first `{` after the `=` and
 * the last `}`, and TypeScript imports it like any other module (the app's
 * tsconfig has no `resolveJsonModule`, and a `src/` test cannot reach for
 * `node:fs` - the app's types deliberately exclude Node's).
 *
 * **Keep the object literal plain JSON**: quoted keys, no comments, no
 * trailing commas, no expressions. The Rust side parses it with `serde_json`.
 *
 * The keys **missing** from it are not an oversight: they are the `Option`
 * fields, which serde skips when they are `None`. Rust writes nothing for
 * them, so their effective default is the frontend's business and lives only
 * in `terminalDefaults.ts`.
 */
export const RUST_TERMINAL_DEFAULTS = {
  "bell": "visual",
  "blockActions": true,
  "blockCards": true,
  "blockDividers": true,
  "blockFailedWash": true,
  "blockGutter": true,
  "blockJumpToBottom": true,
  "blockSpacing": "comfortable",
  "blockStickyHeader": true,
  "blocks": true,
  "chromeBlur": 20,
  "chromeOpacity": 72,
  "completionContext": true,
  "completionMenu": "ctrlSpace",
  "completionSpecs": true,
  "confirmCloseRunning": true,
  "copyOnSelect": true,
  "ctrlTabBehavior": "sequential",
  "cursorBlink": true,
  "cursorInactiveStyle": "outline",
  "cursorStyle": "bar",
  "customArgs": [],
  "customPath": "",
  "dockUsesTerminalTheme": false,
  "filePathLinks": true,
  "historyMaxMb": 10,
  "inlineSuggestions": true,
  "inputEditor": false,
  "inputEditorHandoff": true,
  "inputPosition": "bottom",
  "keybindings": {},
  "kittyGraphics": true,
  "ligatures": false,
  "linkTooltip": true,
  "longCommandSeconds": 10,
  "macOptionAsMeta": "wordKeys",
  "minimumContrastRatio": 1.0,
  "notifyOnLongCommand": true,
  "notifyOnlyWhenHidden": true,
  "openDevSessionsIn": "window",
  "openProcessesIn": "dock",
  "osc52": "deny",
  "padding": 8,
  "preset": "cortxterminal",
  "redactSecrets": true,
  "renderer": "canvas",
  "restoreScrollback": true,
  "restoreScrollbackLines": 200,
  "restoreSessions": true,
  "screenReaderMode": false,
  "scrollbackLines": 25000,
  "shellIntegration": true,
  "shiftEnter": "escape-enter",
  "smoothScrollDuration": 100,
  "suggestionConfidence": "balanced",
  "suggestionsFromOutput": true,
  "tabDisplay": {
    "agent": true,
    "colorBar": false,
    "command": true,
    "cwd": true,
    "index": "ctrl",
    "status": true
  },
  "tabsPlacement": "sidebar",
  "themeFollowsApp": true,
  "wallpaperDim": 0,
  "windowEffect": "none",
  "windowOpacity": 100
};
