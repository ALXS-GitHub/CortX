//! What "Open" does with a path clicked in the terminal.
//!
//! The link panel (`lib/terminalLinks.ts`) used to send every file to VS Code.
//! That is right for `src/main.rs:42:7` and wrong for `assets/logo/new.png`,
//! which then opened as bytes in an editor instead of in the image viewer
//! Windows has set up. The rule is now:
//!
//! - **A position** (`:42`) goes to the editor, at that line — a default
//!   application cannot take one, and it is the reason the link was clicked.
//! - **Text** goes to the editor as well. Deciding by extension would get
//!   `.ts` wrong (Windows maps it to MPEG transport streams) and every
//!   project-specific extension besides, so the first bytes are read instead.
//! - **Anything else** opens with the program the OS associates with it.
//! - **Except an executable**, which a click on a line of output should never
//!   run: its folder is shown instead, with the file selected.

use std::io::Read;
use std::path::Path;

/// How much of a file is read to tell text from binary.
const SNIFF_BYTES: usize = 8192;

/// Extensions that run something when opened. Scripts are text and go to the
/// editor before this list is consulted.
const EXECUTABLE_EXTENSIONS: &[&str] = &[
    "exe", "com", "scr", "msi", "msix", "appx", "lnk", "pif", "cpl", "app", "dmg", "pkg",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpenAction {
    /// Open in the file manager.
    Directory,
    /// Open in the editor (at the line, when there is one).
    Editor,
    /// Open with the application the OS associates with the file.
    DefaultApp,
    /// Show the containing folder with the file selected.
    Reveal,
}

/// The path with the platform's own separators. On Windows a path joined
/// from a `\` cwd and a `/` relative path (`C:\repo\assets/logo.png`) is
/// accepted by the filesystem but not by `explorer.exe`, which shows the
/// user's Documents folder instead.
pub fn native_path(path: &str) -> String {
    if cfg!(windows) {
        path.replace('/', "\\")
    } else {
        path.to_string()
    }
}

/// No NUL byte and valid UTF-8 (a multi-byte character cut by the end of the
/// sample is fine). UTF-16 text counts as binary, which only means it opens
/// in Notepad rather than VS Code.
pub fn looks_like_text(sample: &[u8]) -> bool {
    if sample.contains(&0) {
        return false;
    }
    match std::str::from_utf8(sample) {
        Ok(_) => true,
        Err(e) => e.error_len().is_none(),
    }
}

fn is_executable(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| EXECUTABLE_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// Decide what "Open" does. Reads at most [`SNIFF_BYTES`] of the file.
pub fn open_action(path: &Path, has_position: bool) -> OpenAction {
    if path.is_dir() {
        return OpenAction::Directory;
    }
    if has_position {
        return OpenAction::Editor;
    }
    let mut sample = Vec::with_capacity(SNIFF_BYTES);
    let read =
        std::fs::File::open(path).and_then(|f| f.take(SNIFF_BYTES as u64).read_to_end(&mut sample));
    // Unreadable: the editor reports why better than a silent shell verb.
    if read.is_err() || looks_like_text(&sample) {
        return OpenAction::Editor;
    }
    if is_executable(path) {
        OpenAction::Reveal
    } else {
        OpenAction::DefaultApp
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_file(name: &str, bytes: &[u8]) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("cortx-open-path-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        std::fs::write(&path, bytes).unwrap();
        path
    }

    #[test]
    fn text_is_utf8_without_nul() {
        assert!(looks_like_text(b"fn main() {}\n"));
        assert!(looks_like_text("é à ü".as_bytes()));
        assert!(looks_like_text(b""));
        // `é` cut in half by the end of the sample.
        assert!(looks_like_text(&"aé".as_bytes()[..2]));
        assert!(!looks_like_text(b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR"));
        assert!(!looks_like_text(b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n"));
    }

    #[test]
    fn a_position_always_goes_to_the_editor() {
        let png = temp_file("logo.png", b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR");
        assert_eq!(open_action(&png, true), OpenAction::Editor);
    }

    #[test]
    fn binary_opens_with_the_default_app_and_text_in_the_editor() {
        let png = temp_file("image.png", b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR");
        assert_eq!(open_action(&png, false), OpenAction::DefaultApp);
        let ts = temp_file("main.ts", b"export const x = 1;\n");
        assert_eq!(open_action(&ts, false), OpenAction::Editor);
    }

    #[test]
    fn an_executable_is_revealed_never_run() {
        let exe = temp_file("tool.EXE", b"MZ\x90\0\x03\0\0\0");
        assert_eq!(open_action(&exe, false), OpenAction::Reveal);
    }

    #[test]
    fn a_directory_opens_in_the_file_manager() {
        assert_eq!(
            open_action(&std::env::temp_dir(), false),
            OpenAction::Directory
        );
    }

    #[test]
    fn native_path_uses_the_platform_separator() {
        let mixed = r"C:\repo\assets/logo/new.png";
        if cfg!(windows) {
            assert_eq!(native_path(mixed), r"C:\repo\assets\logo\new.png");
        } else {
            assert_eq!(
                native_path("/repo/assets/logo.png"),
                "/repo/assets/logo.png"
            );
        }
    }
}
