//! Terminal themes (DEV-13 P3), stored in Warp's YAML format.
//!
//! One file per theme under `data/terminal/themes/<key>.yaml`, its wallpaper
//! (when any) copied next to it so the whole folder syncs with the git
//! backup. The format is Warp's — a theme file from Warp's repository drops
//! in unchanged:
//!
//! ```yaml
//! name: aespa_wda            # optional; the file stem when missing
//! background: "#713d39"      # or a gradient: { top: …, bottom: … }
//! accent: "#0c161f"          # or a gradient: { left: …, right: … }
//! foreground: "#ffffff"
//! details: darker            # darker | lighter — drives the chrome's light/dark mode
//! background_image:          # optional wallpaper
//!   path: aespa_wda.jpeg     # absolute, or relative to the yaml (or Warp's themes root)
//!   opacity: 30              # percent
//! terminal_colors:
//!   normal: { black, red, green, yellow, blue, magenta, cyan, white }
//!   bright: { … }
//! cortx:                     # CortX extensions (ignored by Warp)
//!   cursor: "#2dd4bf"
//!   selection: "#ffffff40"
//!   blur: 6                  # px, on the wallpaper
//!   imageFit: cover          # cover | contain | tile | center
//! ```
//!
//! A theme's **key** is its file stem (`gruvbox-dark`); the settings refer to
//! keys. Bundled themes are compiled in and materialised into the folder the
//! first time it is listed, so they sync (and can be edited) like the others.
//!
//! **Gradients.** Warp lets `background` and `accent` be a map of stops
//! (`{top, bottom}` for the background, `{left, right}` for the accent;
//! `blue_monday` even sets both pairs on the background). Those files parse
//! here too: the map is kept verbatim in `background_gradient` /
//! `accent_gradient` (so the YAML round-trips unchanged) and `background` /
//! `accent` carry a *solid representative* — the 50/50 blend of the two
//! stops — for everything that can only take one colour (xterm's canvas, the
//! acrylic tint, the derived chrome tokens).

use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ThemeDetails {
    #[default]
    Darker,
    Lighter,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ImageFit {
    #[default]
    Cover,
    Contain,
    Tile,
    Center,
}

/// A Warp gradient: the stops of `background` (`top` / `bottom`) or of
/// `accent` (`left` / `right`). Every field is optional because Warp files
/// use whichever pair they please — and `blue_monday` sets all four.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct Gradient {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub top: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bottom: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub left: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub right: Option<String>,
}

impl Gradient {
    /// `(from, to, vertical)` — the vertical pair wins when both are set.
    pub fn stops(&self) -> Option<(&str, &str, bool)> {
        match (self.top.as_deref(), self.bottom.as_deref()) {
            (Some(a), Some(b)) => Some((a, b, true)),
            _ => match (self.left.as_deref(), self.right.as_deref()) {
                (Some(a), Some(b)) => Some((a, b, false)),
                _ => None,
            },
        }
    }

    fn any(&self) -> Option<&str> {
        self.top
            .as_deref()
            .or(self.bottom.as_deref())
            .or(self.left.as_deref())
            .or(self.right.as_deref())
    }

    fn colors(&self) -> impl Iterator<Item = &String> {
        [&self.top, &self.bottom, &self.left, &self.right].into_iter().flatten()
    }
}

/// A theme colour in the YAML: one hex string, or a map of gradient stops.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ColorSpec {
    Solid(String),
    Gradient(Gradient),
}

impl ColorSpec {
    /// Split into `(solid representative, gradient)`. A gradient with a
    /// single stop degrades to that colour (no gradient to paint).
    fn split(self, what: &str) -> Result<(String, Option<Gradient>), String> {
        match self {
            ColorSpec::Solid(s) => Ok((s, None)),
            ColorSpec::Gradient(g) => match g.stops() {
                Some((a, b, _)) => Ok((mix_hex(a, b), Some(g))),
                None => match g.any() {
                    Some(one) => Ok((one.to_string(), None)),
                    None => Err(format!("`{}` is a map with no colour in it", what)),
                },
            },
        }
    }

    fn join(solid: &str, gradient: &Option<Gradient>) -> ColorSpec {
        match gradient {
            Some(g) => ColorSpec::Gradient(g.clone()),
            None => ColorSpec::Solid(solid.to_string()),
        }
    }
}

/// Midpoint of two hex colours, `#rrggbb`. Falls back to `a` when either
/// side is not a colour (`validate` reports the real error).
fn mix_hex(a: &str, b: &str) -> String {
    let (Some(ca), Some(cb)) = (parse_rgb(a), parse_rgb(b)) else {
        return a.to_string();
    };
    let mid = |i: usize| ((u16::from(ca[i]) + u16::from(cb[i])) / 2) as u8;
    format!("#{:02x}{:02x}{:02x}", mid(0), mid(1), mid(2))
}

/// `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` → RGB (alpha dropped).
fn parse_rgb(s: &str) -> Option<[u8; 3]> {
    let hex = s.trim().strip_prefix('#')?;
    let expand = |c: char| -> Option<u8> { c.to_digit(16).map(|d| (d * 17) as u8) };
    let mut cs = hex.chars();
    match hex.len() {
        3 | 4 => Some([expand(cs.next()?)?, expand(cs.next()?)?, expand(cs.next()?)?]),
        6 | 8 => {
            let byte = |i: usize| u8::from_str_radix(hex.get(i..i + 2)?, 16).ok();
            Some([byte(0)?, byte(2)?, byte(4)?])
        }
        _ => None,
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AnsiColors {
    pub black: String,
    pub red: String,
    pub green: String,
    pub yellow: String,
    pub blue: String,
    pub magenta: String,
    pub cyan: String,
    pub white: String,
}

impl AnsiColors {
    fn all(&self) -> [&str; 8] {
        [
            &self.black,
            &self.red,
            &self.green,
            &self.yellow,
            &self.blue,
            &self.magenta,
            &self.cyan,
            &self.white,
        ]
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TerminalColors {
    pub normal: AnsiColors,
    pub bright: AnsiColors,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BackgroundImage {
    pub path: String,
    /// Percent (Warp semantics). Missing = 100.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opacity: Option<f64>,
}

/// CortX-only knobs, under a `cortx:` key so Warp ignores them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CortxThemeExt {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selection: Option<String>,
    /// Blur radius applied to the wallpaper, in px.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blur: Option<u16>,
    #[serde(default, alias = "image_fit", skip_serializing_if = "Option::is_none")]
    pub image_fit: Option<ImageFit>,
}

impl CortxThemeExt {
    fn is_empty(&self) -> bool {
        self.cursor.is_none() && self.selection.is_none() && self.blur.is_none() && self.image_fit.is_none()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TerminalTheme {
    /// File stem; never written to the yaml (the file name carries it).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub key: String,
    /// Display name. Missing in many Warp files: prettified stem then.
    #[serde(default)]
    pub name: String,
    /// Always a single colour: the blend of the stops when the file has a
    /// gradient (see `background_gradient`).
    pub background: String,
    /// The gradient stops, when the file gave a map instead of a colour.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background_gradient: Option<Gradient>,
    pub accent: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accent_gradient: Option<Gradient>,
    pub foreground: String,
    #[serde(default)]
    pub details: ThemeDetails,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background_image: Option<BackgroundImage>,
    pub terminal_colors: TerminalColors,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cortx: Option<CortxThemeExt>,
}

/// One row of the picker.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeSummary {
    pub key: String,
    pub name: String,
    pub background: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background_gradient: Option<Gradient>,
    pub accent: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accent_gradient: Option<Gradient>,
    pub foreground: String,
    pub details: ThemeDetails,
    pub has_image: bool,
    /// Wallpaper opacity in percent, so a card can preview it faithfully.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_opacity: Option<f64>,
    pub source: ThemeSource,
    /// The 8 normal ANSI colours (swatch strip).
    pub swatches: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ThemeSource {
    Bundled,
    User,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub imported: usize,
    pub skipped: usize,
    pub keys: Vec<String>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`.
pub fn is_hex_color(s: &str) -> bool {
    let Some(hex) = s.trim().strip_prefix('#') else {
        return false;
    };
    matches!(hex.len(), 3 | 4 | 6 | 8) && hex.chars().all(|c| c.is_ascii_hexdigit())
}

/// File-name-safe key: lowercase ASCII letters/digits, runs of anything else
/// collapsed to `-`.
pub fn slugify(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut dash = false;
    for c in name.trim().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
            dash = false;
        } else if !dash && !out.is_empty() {
            out.push('-');
            dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    out
}

/// `gruvbox_dark` → `Gruvbox Dark`.
fn prettify(stem: &str) -> String {
    stem.split(|c: char| c == '_' || c == '-' || c == ' ')
        .filter(|w| !w.is_empty())
        .map(|w| {
            let mut cs = w.chars();
            match cs.next() {
                Some(f) => f.to_uppercase().collect::<String>() + cs.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"];

fn image_mime(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "bmp" => Some("image/bmp"),
        "svg" => Some("image/svg+xml"),
        "avif" => Some("image/avif"),
        _ => None,
    }
}

/// Largest wallpaper shipped to the webview as a data URL.
const MAX_IMAGE_BYTES: u64 = 24 * 1024 * 1024;

impl TerminalTheme {
    pub fn validate(&self) -> Result<(), String> {
        for (what, value) in [
            ("background", &self.background),
            ("accent", &self.accent),
            ("foreground", &self.foreground),
        ] {
            if !is_hex_color(value) {
                return Err(format!("`{}` must be a hex colour, got '{}'", what, value));
            }
        }
        for (what, gradient) in [
            ("background", &self.background_gradient),
            ("accent", &self.accent_gradient),
        ] {
            let Some(g) = gradient else { continue };
            for c in g.colors() {
                if !is_hex_color(c) {
                    return Err(format!("`{}`: '{}' is not a hex colour", what, c));
                }
            }
        }
        for (set, colors) in [
            ("normal", &self.terminal_colors.normal),
            ("bright", &self.terminal_colors.bright),
        ] {
            for c in colors.all() {
                if !is_hex_color(c) {
                    return Err(format!("terminal_colors.{}: '{}' is not a hex colour", set, c));
                }
            }
        }
        if let Some(ext) = &self.cortx {
            for (what, value) in [("cursor", &ext.cursor), ("selection", &ext.selection)] {
                if let Some(v) = value {
                    if !is_hex_color(v) {
                        return Err(format!("cortx.{} must be a hex colour, got '{}'", what, v));
                    }
                }
            }
        }
        if let Some(img) = &self.background_image {
            if img.path.trim().is_empty() {
                return Err("background_image.path is empty".into());
            }
        }
        Ok(())
    }

    /// Parse Warp YAML. `stem` fills the key / name when the file has none.
    pub fn from_yaml(text: &str, stem: &str) -> Result<Self, String> {
        let wire: WireTheme = serde_yaml::from_str(text).map_err(|e| e.to_string())?;
        let mut theme = wire.into_theme()?;
        theme.validate()?;
        if theme.name.trim().is_empty() {
            theme.name = prettify(stem);
        }
        if theme.key.is_empty() {
            theme.key = slugify(stem);
        }
        if theme.key.is_empty() {
            theme.key = slugify(&theme.name);
        }
        if theme.key.is_empty() {
            return Err("theme has no usable name".into());
        }
        if let Some(ext) = &theme.cortx {
            if ext.is_empty() {
                theme.cortx = None;
            }
        }
        Ok(theme)
    }

    /// Warp-compatible YAML (the key is carried by the file name).
    pub fn to_yaml(&self) -> Result<String, String> {
        serde_yaml::to_string(&WireTheme::from_theme(self)).map_err(|e| e.to_string())
    }

    fn summary(&self, source: ThemeSource, has_image: bool) -> ThemeSummary {
        ThemeSummary {
            key: self.key.clone(),
            name: self.name.clone(),
            background: self.background.clone(),
            background_gradient: self.background_gradient.clone(),
            accent: self.accent.clone(),
            accent_gradient: self.accent_gradient.clone(),
            foreground: self.foreground.clone(),
            details: self.details,
            has_image,
            image_opacity: has_image.then(|| self.background_image.as_ref().and_then(|i| i.opacity)).flatten(),
            source,
            swatches: self.terminal_colors.normal.all().iter().map(|s| s.to_string()).collect(),
        }
    }
}

// ---------------------------------------------------------------------------
// YAML shape
// ---------------------------------------------------------------------------

/// The theme as it is written on disk: `background` and `accent` may be a
/// colour *or* a map of gradient stops. `TerminalTheme` splits them into a
/// solid representative plus the stops; this type puts them back together so
/// a Warp file round-trips byte-for-byte in meaning.
///
/// Field order = the order Warp writes them (serde_yaml keeps it).
#[derive(Debug, Clone, Serialize, Deserialize)]
struct WireTheme {
    #[serde(default, skip_serializing_if = "String::is_empty")]
    key: String,
    #[serde(default)]
    name: String,
    background: ColorSpec,
    accent: ColorSpec,
    foreground: String,
    #[serde(default)]
    details: ThemeDetails,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    background_image: Option<BackgroundImage>,
    terminal_colors: TerminalColors,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    cortx: Option<CortxThemeExt>,
}

impl WireTheme {
    fn into_theme(self) -> Result<TerminalTheme, String> {
        let (background, background_gradient) = self.background.split("background")?;
        let (accent, accent_gradient) = self.accent.split("accent")?;
        Ok(TerminalTheme {
            key: self.key,
            name: self.name,
            background,
            background_gradient,
            accent,
            accent_gradient,
            foreground: self.foreground,
            details: self.details,
            background_image: self.background_image,
            terminal_colors: self.terminal_colors,
            cortx: self.cortx,
        })
    }

    fn from_theme(theme: &TerminalTheme) -> Self {
        Self {
            // The key is carried by the file name.
            key: String::new(),
            name: theme.name.clone(),
            background: ColorSpec::join(&theme.background, &theme.background_gradient),
            accent: ColorSpec::join(&theme.accent, &theme.accent_gradient),
            foreground: theme.foreground.clone(),
            details: theme.details,
            background_image: theme.background_image.clone(),
            terminal_colors: theme.terminal_colors.clone(),
            cortx: theme.cortx.clone(),
        }
    }
}

// ---------------------------------------------------------------------------
// Bundled themes
// ---------------------------------------------------------------------------

const BUNDLED: &[(&str, &str)] = &[
    ("dark-modern", include_str!("../../resources/themes/dark-modern.yaml")),
    ("light-modern", include_str!("../../resources/themes/light-modern.yaml")),
    ("halcyon-dark", include_str!("../../resources/themes/halcyon-dark.yaml")),
    ("halcyon-light", include_str!("../../resources/themes/halcyon-light.yaml")),
    ("dracula", include_str!("../../resources/themes/dracula.yaml")),
    ("nord", include_str!("../../resources/themes/nord.yaml")),
    ("solarized-dark", include_str!("../../resources/themes/solarized-dark.yaml")),
    ("gruvbox-dark", include_str!("../../resources/themes/gruvbox-dark.yaml")),
];

/// Keys of the compiled-in themes (never deletable, flagged `bundled`).
pub fn bundled_keys() -> Vec<&'static str> {
    BUNDLED.iter().map(|(k, _)| *k).collect()
}

pub fn is_bundled(key: &str) -> bool {
    BUNDLED.iter().any(|(k, _)| *k == key)
}

/// A bundled theme parsed from its compiled-in YAML (no disk access).
pub fn bundled_theme(key: &str) -> Option<TerminalTheme> {
    BUNDLED
        .iter()
        .find(|(k, _)| *k == key)
        .and_then(|(k, text)| TerminalTheme::from_yaml(text, k).ok())
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/// Filesystem store for `data/terminal/themes/`.
#[derive(Debug, Clone)]
pub struct ThemeStore {
    dir: PathBuf,
}

impl ThemeStore {
    pub fn new(terminal_dir: &Path) -> Self {
        Self {
            dir: terminal_dir.join("themes"),
        }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    fn path_for(&self, key: &str) -> Result<PathBuf, String> {
        if key.is_empty() || key != slugify(key) {
            return Err(format!("invalid theme key '{}'", key));
        }
        Ok(self.dir.join(format!("{}.yaml", key)))
    }

    /// The file whose *slugified* stem is `key`, for the cases where the two
    /// do not already agree.
    ///
    /// [`Self::import_file`] always writes `<slug>.yaml`, so a theme that came
    /// through the importer is found by [`Self::path_for`] alone. But the
    /// themes folder is a plain directory, and copying a Warp `.yaml` straight
    /// into it is the obvious thing to do — `aespa_wda.yaml` then slugifies to
    /// `aespa-wda`, the listing shows it (it reads every file and slugifies
    /// each stem) and every load of it fails, silently, because
    /// `aespa-wda.yaml` does not exist. Scanning is the fallback, never the
    /// rule: it only runs when the direct path is missing.
    fn path_by_slug(&self, key: &str) -> Option<PathBuf> {
        for entry in fs::read_dir(&self.dir).ok()?.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("yaml") {
                continue;
            }
            let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            if slugify(stem) == key {
                return Some(path);
            }
        }
        None
    }

    /// The file a key names, whether or not the stem was already a slug.
    fn resolve_path(&self, key: &str) -> Option<PathBuf> {
        let direct = self.path_for(key).ok()?;
        if direct.exists() {
            return Some(direct);
        }
        self.path_by_slug(key)
    }

    /// Write the compiled-in themes that are missing on disk.
    fn materialize_bundled(&self) -> Result<(), String> {
        fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        for (key, text) in BUNDLED {
            let path = self.dir.join(format!("{}.yaml", key));
            if !path.exists() {
                fs::write(&path, text).map_err(|e| format!("{}: {}", path.display(), e))?;
            }
        }
        Ok(())
    }

    fn read_file(&self, path: &Path) -> Result<TerminalTheme, String> {
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or_default();
        let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
        let mut theme = TerminalTheme::from_yaml(&text, stem)?;
        // The file name is the key, whatever the yaml says.
        theme.key = slugify(stem);
        Ok(theme)
    }

    /// Absolute path of a theme's wallpaper, when the file exists.
    fn resolve_image(&self, theme: &TerminalTheme) -> Option<PathBuf> {
        let raw = theme.background_image.as_ref()?.path.trim();
        if raw.is_empty() {
            return None;
        }
        let p = Path::new(raw);
        if p.is_absolute() {
            return p.is_file().then(|| p.to_path_buf());
        }
        let local = self.dir.join(p);
        local.is_file().then_some(local)
    }

    /// Every theme, bundled first then by name. Broken files are skipped.
    pub fn list(&self) -> Vec<ThemeSummary> {
        if let Err(e) = self.materialize_bundled() {
            log::warn!("Could not materialise the bundled terminal themes: {}", e);
        }
        let Ok(entries) = fs::read_dir(&self.dir) else {
            return Vec::new();
        };
        let mut out: Vec<ThemeSummary> = entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| matches!(p.extension().and_then(|x| x.to_str()), Some("yaml") | Some("yml")))
            .filter_map(|p| match self.read_file(&p) {
                Ok(theme) => {
                    let source = if is_bundled(&theme.key) {
                        ThemeSource::Bundled
                    } else {
                        ThemeSource::User
                    };
                    let has_image = self.resolve_image(&theme).is_some();
                    Some(theme.summary(source, has_image))
                }
                Err(err) => {
                    log::warn!("Skipping terminal theme {}: {}", p.display(), err);
                    None
                }
            })
            .collect();
        out.sort_by(|a, b| {
            (a.source != ThemeSource::Bundled)
                .cmp(&(b.source != ThemeSource::Bundled))
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        out
    }

    /// Full theme, image path resolved to an absolute path (or dropped when
    /// the file is missing). Falls back to the compiled-in copy for bundled
    /// keys whose file is unreadable.
    pub fn get(&self, key: &str) -> Option<TerminalTheme> {
        let path = self.resolve_path(key).or_else(|| self.path_for(key).ok())?;
        let mut theme = match self.read_file(&path) {
            Ok(t) => t,
            Err(_) => bundled_theme(key)?,
        };
        match self.resolve_image(&theme) {
            Some(abs) => {
                if let Some(img) = theme.background_image.as_mut() {
                    img.path = abs.to_string_lossy().into_owned();
                }
            }
            None => theme.background_image = None,
        }
        Some(theme)
    }

    /// The wallpaper as a `data:` URL (the webview cannot load local files).
    pub fn read_image(&self, key: &str) -> Result<Option<String>, String> {
        use base64::Engine;
        let Some(theme) = self.get(key) else {
            return Ok(None);
        };
        let Some(path) = self.resolve_image(&theme) else {
            return Ok(None);
        };
        let Some(mime) = image_mime(&path) else {
            return Err(format!("unsupported image type: {}", path.display()));
        };
        let size = fs::metadata(&path).map_err(|e| e.to_string())?.len();
        if size > MAX_IMAGE_BYTES {
            return Err(format!("wallpaper is too large ({} MB, max 24)", size / (1024 * 1024)));
        }
        let bytes = fs::read(&path).map_err(|e| e.to_string())?;
        let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
        Ok(Some(format!("data:{};base64,{}", mime, b64)))
    }

    /// Where a Warp theme's relative image path may point: next to the yaml,
    /// then up the tree (Warp resolves against its themes root, e.g.
    /// `special_edition/foo.jpg` from `special_edition/foo.yaml`).
    fn locate_source_image(yaml_path: &Path, raw: &str) -> Option<PathBuf> {
        let p = Path::new(raw);
        if p.is_absolute() {
            return p.is_file().then(|| p.to_path_buf());
        }
        let mut base = yaml_path.parent();
        for _ in 0..4 {
            let dir = base?;
            let candidate = dir.join(p);
            if candidate.is_file() {
                return Some(candidate);
            }
            base = dir.parent();
        }
        None
    }

    /// Copy `theme`'s wallpaper (if any, and if it lives outside the store)
    /// next to the yaml as `<key>.<ext>` and rewrite the path to that name.
    fn adopt_image(&self, theme: &mut TerminalTheme, source: Option<PathBuf>) -> Result<(), String> {
        let Some(src) = source else {
            theme.background_image = None;
            return Ok(());
        };
        let ext = src
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase())
            .unwrap_or_default();
        if !IMAGE_EXTENSIONS.contains(&ext.as_str()) {
            return Err(format!("unsupported wallpaper type: {}", src.display()));
        }
        let file_name = format!("{}.{}", theme.key, ext);
        let dest = self.dir.join(&file_name);
        if src != dest {
            fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
            fs::copy(&src, &dest).map_err(|e| format!("copying {}: {}", src.display(), e))?;
        }
        if let Some(img) = theme.background_image.as_mut() {
            img.path = file_name;
        }
        Ok(())
    }

    fn write(&self, theme: &TerminalTheme) -> Result<(), String> {
        let path = self.path_for(&theme.key)?;
        fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        let text = theme.to_yaml()?;
        let tmp = path.with_extension("yaml.tmp");
        fs::write(&tmp, text).map_err(|e| e.to_string())?;
        fs::rename(&tmp, &path).map_err(|e| e.to_string())
    }

    /// Import one Warp theme file (and its wallpaper). A key colliding with a
    /// bundled theme gets an `-imported` suffix so the bundled one stays put.
    pub fn import_file(&self, path: &Path) -> Result<TerminalTheme, String> {
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or_default();
        let text = fs::read_to_string(path).map_err(|e| format!("{}: {}", path.display(), e))?;
        let mut theme = TerminalTheme::from_yaml(&text, stem)?;
        theme.key = slugify(stem);
        if theme.key.is_empty() {
            theme.key = slugify(&theme.name);
        }
        if is_bundled(&theme.key) {
            theme.key = format!("{}-imported", theme.key);
        }
        let image = theme
            .background_image
            .as_ref()
            .and_then(|img| Self::locate_source_image(path, &img.path));
        // Keep the original opacity/fit even when the file is missing… but a
        // missing file means no wallpaper.
        self.adopt_image(&mut theme, image)?;
        self.write(&theme)?;
        Ok(theme)
    }

    /// Import every `*.yaml` / `*.yml` under `dir` that parses as a Warp
    /// theme (recursively). Non-theme YAML is skipped silently.
    pub fn import_folder(&self, dir: &Path) -> Result<ImportReport, String> {
        if !dir.is_dir() {
            return Err(format!("{} is not a folder", dir.display()));
        }
        let mut report = ImportReport {
            imported: 0,
            skipped: 0,
            keys: Vec::new(),
        };
        let mut seen = BTreeSet::new();
        for entry in walkdir::WalkDir::new(dir)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| {
                // Skip VCS folders and the like.
                !e.file_name().to_str().map(|n| n.starts_with('.')).unwrap_or(false)
            })
            .flatten()
        {
            let path = entry.path();
            if !entry.file_type().is_file() {
                continue;
            }
            if !matches!(path.extension().and_then(|x| x.to_str()), Some("yaml") | Some("yml")) {
                continue;
            }
            match self.import_file(path) {
                Ok(theme) => {
                    if seen.insert(theme.key.clone()) {
                        report.imported += 1;
                        report.keys.push(theme.key);
                    }
                }
                Err(err) => {
                    log::debug!("Not a Warp theme, skipped {}: {}", path.display(), err);
                    report.skipped += 1;
                }
            }
        }
        Ok(report)
    }

    /// Store a theme edited in the app. An absolute wallpaper path outside
    /// the store is copied in; a bare file name is kept as-is.
    pub fn save(&self, mut theme: TerminalTheme) -> Result<TerminalTheme, String> {
        theme.validate()?;
        if theme.key.is_empty() {
            theme.key = slugify(&theme.name);
        }
        if theme.name.trim().is_empty() {
            theme.name = prettify(&theme.key);
        }
        self.path_for(&theme.key)?;
        if let Some(img) = theme.background_image.clone() {
            let p = Path::new(&img.path);
            if p.is_absolute() {
                if p.parent() == Some(self.dir.as_path()) {
                    // Already ours: store the bare name so the folder stays portable.
                    if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
                        theme.background_image.as_mut().unwrap().path = name.to_string();
                    }
                } else {
                    let src = p.is_file().then(|| p.to_path_buf());
                    self.adopt_image(&mut theme, src)?;
                }
            }
        }
        self.write(&theme)?;
        Ok(theme)
    }

    /// Remove a user theme and its wallpaper. Bundled keys are refused.
    pub fn delete(&self, key: &str) -> Result<(), String> {
        if is_bundled(key) {
            return Err(format!("'{}' is a bundled theme and cannot be deleted", key));
        }
        // Same reason as in `get`: a hand-copied file may not be named after
        // its own key, and a delete that silently removed nothing would leave
        // the theme in the list.
        let path = self.resolve_path(key).map_or_else(|| self.path_for(key), Ok)?;
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(key)
            .to_string();
        match fs::remove_file(&path) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
        for ext in IMAGE_EXTENSIONS {
            // The wallpaper sits next to the yaml and is named after it, so it
            // follows the file's stem rather than the key.
            let img = self.dir.join(format!("{}.{}", stem, ext));
            if img.exists() {
                let _ = fs::remove_file(img);
            }
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Watcher (DEV-13 — themes appear without restarting)
// ---------------------------------------------------------------------------

/// Handle returned by [`watch`]. Drop it to stop watching.
pub struct ThemeWatcherHandle {
    _debouncer: notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>,
    _thread: std::thread::JoinHandle<()>,
}

/// Watch `data/terminal/themes/` and report the **keys** touched (yaml files
/// and wallpapers alike, so replacing a picture refreshes too). Same shape as
/// `file_watcher::start_watching`: 300 ms debounce, one thread, drop to stop.
///
/// The folder is created first: `notify` cannot watch a missing path, and a
/// fresh profile has no themes folder until the bundled ones are written.
pub fn watch<F>(dir: PathBuf, on_change: F) -> Result<ThemeWatcherHandle, notify::Error>
where
    F: Fn(Vec<String>) + Send + 'static,
{
    use notify_debouncer_mini::{new_debouncer, DebounceEventResult};
    use std::sync::mpsc;
    use std::time::Duration;

    if let Err(e) = fs::create_dir_all(&dir) {
        return Err(notify::Error::generic(&format!("{}: {}", dir.display(), e)));
    }
    let (tx, rx) = mpsc::channel::<DebounceEventResult>();
    let mut debouncer = new_debouncer(Duration::from_millis(300), tx)?;
    debouncer.watcher().watch(&dir, notify::RecursiveMode::NonRecursive)?;

    let thread = std::thread::Builder::new()
        .name("cortx-theme-watcher".into())
        .spawn(move || {
            while let Ok(result) = rx.recv() {
                let events = match result {
                    Ok(events) => events,
                    Err(err) => {
                        log::warn!("Terminal theme watcher error: {:?}", err);
                        continue;
                    }
                };
                let mut keys: Vec<String> = Vec::new();
                for event in events {
                    let ext = event
                        .path
                        .extension()
                        .and_then(|e| e.to_str())
                        .map(|e| e.to_ascii_lowercase())
                        .unwrap_or_default();
                    let interesting = matches!(ext.as_str(), "yaml" | "yml") || IMAGE_EXTENSIONS.contains(&ext.as_str());
                    if !interesting {
                        continue; // .yaml.tmp of our own atomic writes, and the rest
                    }
                    let Some(stem) = event.path.file_stem().and_then(|s| s.to_str()) else {
                        continue;
                    };
                    let key = slugify(stem);
                    if !key.is_empty() && !keys.contains(&key) {
                        keys.push(key);
                    }
                }
                if !keys.is_empty() {
                    on_change(keys);
                }
            }
        })
        .map_err(|e| notify::Error::generic(&e.to_string()))?;

    Ok(ThemeWatcherHandle {
        _debouncer: debouncer,
        _thread: thread,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The owner's own Warp theme (path rewritten to a fixture).
    const AESPA: &str = r##"---
background: "#713d39"
accent: "#0c161f"
foreground: "#ffffff"
background_image:
  path: "aespa_wda.jpeg"
  opacity: 30
details: darker
terminal_colors:
  normal:
    black: "#616161"
    red: "#ff8272"
    green: "#b4fa72"
    yellow: "#fefdc2"
    blue: "#a5d5fe"
    magenta: "#ff8ffd"
    cyan: "#d0d1fe"
    white: "#f1f1f1"
  bright:
    black: "#8e8e8e"
    red: "#ffc4bd"
    green: "#d6fcb9"
    yellow: "#fefdd5"
    blue: "#c1e3fe"
    magenta: "#ffb1fe"
    cyan: "#e5e6fe"
    white: "#feffff"
name: aespa_wda
"##;

    /// Warp's own files: no `name`, keys in any order, single quotes.
    const DRACULA_WARP: &str = r##"accent: '#bd93f9'
background: '#282a36'
details: darker
foreground: '#f8f8f2'
terminal_colors:
  bright:
    black: '#555555'
    blue: '#caa9fa'
    cyan: '#8be9fd'
    green: '#50fa7b'
    magenta: '#ff79c6'
    red: '#ff5555'
    white: '#ffffff'
    yellow: '#f1fa8c'
  normal:
    black: '#000000'
    blue: '#bd93f9'
    cyan: '#8be9fd'
    green: '#50fa7b'
    magenta: '#ff79c6'
    red: '#ff5555'
    white: '#bbbbbb'
    yellow: '#f1fa8c'
"##;

    // 1×1 PNG.
    const PNG: &[u8] = &[
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, 0x00,
        0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00,
        0x00, 0x00, 0x0A, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01,
        0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
    ];

    #[test]
    fn parses_the_owners_warp_theme() {
        let t = TerminalTheme::from_yaml(AESPA, "aespa_wda").unwrap();
        assert_eq!(t.key, "aespa-wda");
        assert_eq!(t.name, "aespa_wda");
        assert_eq!(t.background, "#713d39");
        assert_eq!(t.accent, "#0c161f");
        assert_eq!(t.details, ThemeDetails::Darker);
        let img = t.background_image.as_ref().unwrap();
        assert_eq!(img.path, "aespa_wda.jpeg");
        assert_eq!(img.opacity, Some(30.0));
        assert_eq!(t.terminal_colors.normal.red, "#ff8272");
        assert_eq!(t.terminal_colors.bright.white, "#feffff");
        assert!(t.cortx.is_none());
    }

    #[test]
    fn warp_repository_file_without_name_gets_pretty_name_and_key() {
        let t = TerminalTheme::from_yaml(DRACULA_WARP, "fancy_dracula").unwrap();
        assert_eq!(t.key, "fancy-dracula");
        assert_eq!(t.name, "Fancy Dracula");
        assert_eq!(t.terminal_colors.bright.blue, "#caa9fa");
    }

    #[test]
    fn round_trips_through_yaml_including_cortx_extensions() {
        let mut t = TerminalTheme::from_yaml(AESPA, "aespa_wda").unwrap();
        t.cortx = Some(CortxThemeExt {
            cursor: Some("#ff8272".into()),
            selection: None,
            blur: Some(6),
            image_fit: Some(ImageFit::Tile),
        });
        let yaml = t.to_yaml().unwrap();
        assert!(!yaml.contains("key:"), "the key is carried by the file name:\n{yaml}");
        assert!(yaml.contains("imageFit: tile"));
        let back = TerminalTheme::from_yaml(&yaml, "aespa_wda").unwrap();
        assert_eq!(back, t);
        // `image_fit` (snake_case) is accepted too.
        let alt = yaml.replace("imageFit: tile", "image_fit: center");
        let back = TerminalTheme::from_yaml(&alt, "aespa_wda").unwrap();
        assert_eq!(back.cortx.unwrap().image_fit, Some(ImageFit::Center));
    }

    /// Warp's `snowy`: a `{top, bottom}` background. `synthwave_84` adds a
    /// `{left, right}` accent, `blue_monday` a background with all four.
    const SNOWY: &str = r##"background:
  top: "#ffffff"
  bottom: "#dee6eb"
accent: "#647e90"
foreground: "#000000"
details: lighter
terminal_colors:
  normal: { black: "#212121", red: "#c30771", green: "#10a778", yellow: "#a89c14", blue: "#008ec4", magenta: "#523c79", cyan: "#20a5ba", white: "#e0e0e0" }
  bright: { black: "#212121", red: "#fb007a", green: "#5fd7af", yellow: "#f3e430", blue: "#20bbfc", magenta: "#6855de", cyan: "#4fb8cc", white: "#f1f1f1" }
"##;

    #[test]
    fn parses_warps_gradient_background_and_accent() {
        let t = TerminalTheme::from_yaml(SNOWY, "snowy").unwrap();
        let g = t.background_gradient.as_ref().unwrap();
        assert_eq!(g.stops(), Some(("#ffffff", "#dee6eb", true)));
        // Solid representative = the blend of the two stops.
        assert_eq!(t.background, "#eef2f5");
        assert_eq!(t.accent, "#647e90");
        assert!(t.accent_gradient.is_none());
        assert_eq!(t.details, ThemeDetails::Lighter);

        // A `{left, right}` accent (synthwave_84).
        let t = TerminalTheme::from_yaml(
            &SNOWY.replace("accent: \"#647e90\"", "accent:\n  left: \"#f92aad\"\n  right: \"#848bbd\""),
            "synthwave",
        )
        .unwrap();
        assert_eq!(t.accent_gradient.as_ref().unwrap().stops(), Some(("#f92aad", "#848bbd", false)));
        assert_eq!(t.accent, "#be5ab5");

        // blue_monday: both pairs on the background — vertical wins, all four kept.
        let t = TerminalTheme::from_yaml(
            &SNOWY.replace(
                "  bottom: \"#dee6eb\"",
                "  bottom: \"#dee6eb\"\n  left: \"#000000\"\n  right: \"#00081e\"",
            ),
            "blue-monday",
        )
        .unwrap();
        let g = t.background_gradient.as_ref().unwrap();
        assert_eq!(g.stops(), Some(("#ffffff", "#dee6eb", true)));
        assert_eq!(g.left.as_deref(), Some("#000000"));
        assert_eq!(g.right.as_deref(), Some("#00081e"));
    }

    #[test]
    fn gradients_round_trip_and_solid_backgrounds_are_untouched() {
        let t = TerminalTheme::from_yaml(SNOWY, "snowy").unwrap();
        let yaml = t.to_yaml().unwrap();
        assert!(yaml.contains("top: '#ffffff'") || yaml.contains("top: \"#ffffff\""), "{yaml}");
        assert_eq!(TerminalTheme::from_yaml(&yaml, "snowy").unwrap(), t);

        // A plain string background still writes back as a plain string.
        let solid = TerminalTheme::from_yaml(DRACULA_WARP, "dracula").unwrap();
        let yaml = solid.to_yaml().unwrap();
        assert!(yaml.contains("background: '#282a36'"), "{yaml}");
        assert!(!yaml.contains("background_gradient"), "{yaml}");
        assert_eq!(TerminalTheme::from_yaml(&yaml, "dracula").unwrap(), solid);

        // A one-stop map degrades to that colour rather than failing.
        let one = TerminalTheme::from_yaml(&SNOWY.replace("  bottom: \"#dee6eb\"\n", ""), "one").unwrap();
        assert_eq!(one.background, "#ffffff");
        assert!(one.background_gradient.is_none());
    }

    #[test]
    fn gradient_stops_are_validated_like_plain_colours() {
        assert!(TerminalTheme::from_yaml(&SNOWY.replace("#dee6eb", "steel"), "snowy").is_err());
        assert!(TerminalTheme::from_yaml(&SNOWY.replace("  top: \"#ffffff\"\n  bottom: \"#dee6eb\"", "  hue: 4"), "x").is_err());
        assert_eq!(mix_hex("#000000", "#ffffff"), "#7f7f7f");
        assert_eq!(mix_hex("#fff", "#000"), "#7f7f7f");
        assert_eq!(mix_hex("#ffffffcc", "#000000"), "#7f7f7f");
    }

    #[test]
    fn watcher_reports_the_keys_that_changed() {
        use std::sync::mpsc;
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("themes");
        let (tx, rx) = mpsc::channel();
        let _handle = watch(dir.clone(), move |keys| {
            let _ = tx.send(keys);
        })
        .unwrap();
        fs::write(dir.join("my_theme.yaml"), SNOWY).unwrap();
        // Our own atomic writes go through a .yaml.tmp: it must stay quiet.
        fs::write(dir.join("scratch.yaml.tmp"), "x").unwrap();
        let keys = rx
            .recv_timeout(std::time::Duration::from_secs(10))
            .expect("the watcher should report the new theme");
        assert!(keys.contains(&"my-theme".to_string()), "{keys:?}");
        assert!(!keys.iter().any(|k| k.starts_with("scratch")), "{keys:?}");
    }

    #[test]
    fn rejects_bad_colours_and_non_themes() {
        assert!(TerminalTheme::from_yaml(&AESPA.replace("#713d39", "brown"), "x").is_err());
        assert!(TerminalTheme::from_yaml("id: zorg\nname: Zorg dev\ntabs: []\n", "launch").is_err());
        assert!(is_hex_color("#abc"));
        assert!(is_hex_color("#AABBCC80"));
        assert!(!is_hex_color("abc"));
        assert!(!is_hex_color("#12345"));
    }

    #[test]
    fn slugs_are_file_safe() {
        assert_eq!(slugify("Gruvbox Dark"), "gruvbox-dark");
        assert_eq!(slugify("aespa_wda"), "aespa-wda");
        assert_eq!(slugify("  ../weird::name!! "), "weird-name");
        assert_eq!(prettify("solarized_dark"), "Solarized Dark");
    }

    #[test]
    fn a_theme_file_copied_in_by_hand_loads_even_when_its_name_is_not_a_slug() {
        // The themes folder is a plain directory and copying a Warp `.yaml`
        // straight into it is the obvious thing to do. `aespa_wda.yaml`
        // slugifies to `aespa-wda`, so the listing showed it and every load
        // failed silently: the settings pointed at a key no file was named
        // after.
        let tmp = tempfile::tempdir().unwrap();
        let store = ThemeStore::new(tmp.path());
        let yaml = "\
name: aespa_wda
background: \"#713d39\"
accent: \"#0c161f\"
foreground: \"#ffffff\"
details: darker
terminal_colors:
  normal:
    black: \"#616161\"
    red: \"#ff8272\"
    green: \"#b4fa72\"
    yellow: \"#fefdc2\"
    blue: \"#a5d5fe\"
    magenta: \"#ff8ffd\"
    cyan: \"#d0d1fe\"
    white: \"#f1f1f1\"
  bright:
    black: \"#8e8e8e\"
    red: \"#ffc4bd\"
    green: \"#d6fcb9\"
    yellow: \"#fefdd5\"
    blue: \"#c1e3fe\"
    magenta: \"#ffb1fe\"
    cyan: \"#e5e6fe\"
    white: \"#feffff\"
";
        // `list` is what creates the folder (it materialises the bundled
        // themes), so drop the file in afterwards, where the store looks.
        store.list();
        std::fs::write(store.dir().join("aespa_wda.yaml"), yaml).unwrap();

        let listed = store.list();
        let summary = listed
            .iter()
            .find(|t| t.key == "aespa-wda")
            .expect("the listing slugifies the stem, so it is there");
        assert_eq!(summary.name, "aespa_wda");

        let theme = store
            .get("aespa-wda")
            .expect("and the key the listing gave must load");
        assert_eq!(theme.background, "#713d39");

        // A key that matches nothing still resolves to nothing.
        assert!(store.get("no-such-theme").is_none());
    }

    #[test]
    fn all_bundled_themes_parse() {
        for (key, _) in BUNDLED {
            let t = bundled_theme(key).unwrap_or_else(|| panic!("bundled theme {} does not parse", key));
            assert_eq!(&t.key, key);
            assert!(!t.name.is_empty());
        }
        assert!(bundled_keys().contains(&"halcyon-dark"));
    }

    #[test]
    fn list_materialises_bundled_themes_and_flags_them() {
        let tmp = tempfile::tempdir().unwrap();
        let store = ThemeStore::new(tmp.path());
        let list = store.list();
        assert_eq!(list.len(), BUNDLED.len());
        assert!(list.iter().all(|s| s.source == ThemeSource::Bundled));
        assert!(list.iter().all(|s| s.swatches.len() == 8));
        assert!(store.dir().join("dracula.yaml").is_file());
        assert!(store.delete("dracula").is_err(), "bundled themes cannot be deleted");
        let t = store.get("halcyon-dark").unwrap();
        assert_eq!(t.accent, "#2dd4bf");
    }

    #[test]
    fn import_file_copies_the_wallpaper_and_rewrites_the_path() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("warp");
        fs::create_dir_all(&src).unwrap();
        fs::write(src.join("aespa_wda.yaml"), AESPA).unwrap();
        fs::write(src.join("aespa_wda.jpeg"), PNG).unwrap();
        let store = ThemeStore::new(&tmp.path().join("data"));

        let theme = store.import_file(&src.join("aespa_wda.yaml")).unwrap();
        assert_eq!(theme.key, "aespa-wda");
        assert_eq!(theme.background_image.as_ref().unwrap().path, "aespa-wda.jpeg");
        assert!(store.dir().join("aespa-wda.yaml").is_file());
        assert!(store.dir().join("aespa-wda.jpeg").is_file());

        // get() resolves the wallpaper to an absolute path; read_image inlines it.
        let got = store.get("aespa-wda").unwrap();
        let p = PathBuf::from(&got.background_image.as_ref().unwrap().path);
        assert!(p.is_absolute() && p.is_file());
        let data = store.read_image("aespa-wda").unwrap().unwrap();
        assert!(data.starts_with("data:image/jpeg;base64,"));

        let listed = store.list();
        let row = listed.iter().find(|s| s.key == "aespa-wda").unwrap();
        assert_eq!(row.source, ThemeSource::User);
        assert!(row.has_image);

        store.delete("aespa-wda").unwrap();
        assert!(!store.dir().join("aespa-wda.yaml").exists());
        assert!(!store.dir().join("aespa-wda.jpeg").exists());
    }

    #[test]
    fn import_folder_skips_non_theme_yaml_and_resolves_warp_root_relative_images() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("themes");
        fs::create_dir_all(root.join("special_edition")).unwrap();
        fs::create_dir_all(root.join("standard")).unwrap();
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::write(root.join("standard/dracula.yaml"), DRACULA_WARP).unwrap();
        // Warp's special editions reference the image from the themes root.
        fs::write(
            root.join("special_edition/asteroid_city.yaml"),
            AESPA.replace("path: \"aespa_wda.jpeg\"", "path: special_edition/asteroid_city_wallpaper.png"),
        )
        .unwrap();
        fs::write(root.join("special_edition/asteroid_city_wallpaper.png"), PNG).unwrap();
        fs::write(root.join("launch.yaml"), "id: zorg\nname: Zorg dev\ntabs: []\n").unwrap();
        fs::write(root.join("README.md"), "# not yaml").unwrap();
        fs::write(root.join(".git/config.yaml"), AESPA).unwrap();

        let store = ThemeStore::new(&tmp.path().join("data"));
        let report = store.import_folder(&root).unwrap();
        assert_eq!(report.imported, 2, "{:?}", report);
        assert_eq!(report.skipped, 1);
        assert!(report.keys.contains(&"asteroid-city".to_string()));
        // Same key as a bundled theme → suffixed, bundled left intact.
        assert!(report.keys.contains(&"dracula-imported".to_string()));
        assert!(store.dir().join("asteroid-city.png").is_file());
        let t = store.get("asteroid-city").unwrap();
        assert!(t.background_image.is_some());
        assert_eq!(store.get("dracula").unwrap().terminal_colors.normal.black, "#21222c");
    }

    #[test]
    fn save_validates_and_keeps_local_wallpaper_names_bare() {
        let tmp = tempfile::tempdir().unwrap();
        let store = ThemeStore::new(tmp.path());
        let mut t = TerminalTheme::from_yaml(DRACULA_WARP, "mine").unwrap();
        t.name = "My Dracula".into();
        t.key.clear();
        let saved = store.save(t.clone()).unwrap();
        assert_eq!(saved.key, "my-dracula");
        assert!(store.dir().join("my-dracula.yaml").is_file());

        // A wallpaper path that already lives in the store is stored bare.
        fs::write(store.dir().join("my-dracula.png"), PNG).unwrap();
        let mut with_img = saved.clone();
        with_img.background_image = Some(BackgroundImage {
            path: store.dir().join("my-dracula.png").to_string_lossy().into_owned(),
            opacity: Some(40.0),
        });
        let saved = store.save(with_img).unwrap();
        assert_eq!(saved.background_image.as_ref().unwrap().path, "my-dracula.png");

        let mut bad = saved.clone();
        bad.accent = "purple".into();
        assert!(store.save(bad).is_err());
    }
}
