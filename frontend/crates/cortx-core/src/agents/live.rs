//! A session's transcript followed live (ticket CORT-62, the agent view).
//!
//! The agent view shows a Claude Code session as a conversation while it
//! runs. Re-reading the whole JSONL on every change (what the session list
//! does, through the debounced watcher) is neither live nor cheap on a
//! transcript of a few megabytes. A [`TranscriptTail`] keeps the parsed
//! messages and the byte offset it has read up to; [`TranscriptTail::advance`]
//! parses only the lines appended since — a line the agent is still writing
//! is left for the next call — and says from which message index things
//! changed, so only those are sent to the view.
//!
//! The file watching itself (an OS watcher on that one file, no debounce)
//! lives with the app (`src-tauri/src/agent_live.rs`); this is the part that
//! can be tested.

use super::claude_code::TranscriptParser;
use super::jsonl;
use super::AgentMessage;
use std::io;
use std::path::{Path, PathBuf};

#[derive(Debug)]
pub struct TranscriptTail {
    path: PathBuf,
    offset: u64,
    parser: TranscriptParser,
}

impl TranscriptTail {
    /// Read the whole transcript once.
    pub fn open(path: &Path) -> io::Result<Self> {
        let mut tail = Self {
            path: path.to_path_buf(),
            offset: 0,
            parser: TranscriptParser::default(),
        };
        tail.read_from_start()?;
        Ok(tail)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn messages(&self) -> &[AgentMessage] {
        &self.parser.messages
    }

    fn read_from_start(&mut self) -> io::Result<()> {
        self.parser = TranscriptParser::default();
        let parser = &mut self.parser;
        self.offset = jsonl::scan_from(&self.path, 0, |line| parser.feed_line(line))?;
        self.parser.take_changed_from();
        Ok(())
    }

    /// Parse what was appended since the last call. `Some(i)`: the messages
    /// from index `i` on are new or changed. `None`: nothing new (or only a
    /// line still being written).
    ///
    /// A file shorter than what was read (rewritten, truncated) is read
    /// again from the start, and reported as changed from 0.
    pub fn advance(&mut self) -> io::Result<Option<usize>> {
        let len = std::fs::metadata(&self.path)?.len();
        if len < self.offset {
            self.read_from_start()?;
            return Ok(Some(0));
        }
        if len == self.offset {
            return Ok(None);
        }
        let parser = &mut self.parser;
        self.offset = jsonl::scan_from(&self.path, self.offset, |line| parser.feed_line(line))?;
        Ok(self.parser.take_changed_from())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::{AgentPart, AgentRole};
    use std::io::Write;

    fn user(uuid: &str, text: &str) -> String {
        format!(
            r#"{{"type":"user","uuid":"{uuid}","timestamp":"2026-11-26T10:00:00Z","message":{{"role":"user","content":"{text}"}}}}"#
        )
    }

    fn assistant(uuid: &str, mid: &str, block: &str) -> String {
        format!(
            r#"{{"type":"assistant","uuid":"{uuid}","timestamp":"2026-11-26T10:00:01Z","message":{{"id":"{mid}","role":"assistant","content":[{block}]}}}}"#
        )
    }

    fn append(path: &Path, text: &str) {
        let mut f = std::fs::OpenOptions::new().append(true).open(path).unwrap();
        f.write_all(text.as_bytes()).unwrap();
    }

    #[test]
    fn follows_appended_lines_and_merged_messages() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("s.jsonl");
        std::fs::write(&p, format!("{}\n", user("u1", "hello"))).unwrap();

        let mut tail = TranscriptTail::open(&p).unwrap();
        assert_eq!(tail.messages().len(), 1);
        assert_eq!(tail.advance().unwrap(), None);

        // The agent's answer: one text block…
        append(&p, &format!("{}\n", assistant("a1", "msg_1", r#"{"type":"text","text":"Looking"}"#)));
        assert_eq!(tail.advance().unwrap(), Some(1));
        assert_eq!(tail.messages().len(), 2);

        // …then a tool call of the same API message, written as its own line:
        // the same message changes, nothing is added.
        append(
            &p,
            &format!("{}\n", assistant("a2", "msg_1", r#"{"type":"tool_use","id":"t1","name":"Read","input":{}}"#)),
        );
        assert_eq!(tail.advance().unwrap(), Some(1));
        assert_eq!(tail.messages().len(), 2);
        assert_eq!(tail.messages()[1].parts.len(), 2);
        assert_eq!(tail.messages()[1].role, AgentRole::Assistant);
    }

    #[test]
    fn a_line_being_written_waits_for_its_end() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("s.jsonl");
        std::fs::write(&p, "").unwrap();
        let mut tail = TranscriptTail::open(&p).unwrap();

        let line = user("u1", "hello");
        let (head, rest) = line.split_at(20);
        append(&p, head);
        assert_eq!(tail.advance().unwrap(), None);
        append(&p, &format!("{rest}\n"));
        assert_eq!(tail.advance().unwrap(), Some(0));
        assert!(matches!(&tail.messages()[0].parts[0], AgentPart::Text { text } if text == "hello"));
    }

    #[test]
    fn a_rewritten_file_is_read_again() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("s.jsonl");
        std::fs::write(&p, format!("{}\n{}\n", user("u1", "one"), user("u2", "two"))).unwrap();
        let mut tail = TranscriptTail::open(&p).unwrap();
        assert_eq!(tail.messages().len(), 2);

        std::fs::write(&p, format!("{}\n", user("u3", "x"))).unwrap();
        assert_eq!(tail.advance().unwrap(), Some(0));
        assert_eq!(tail.messages().len(), 1);
    }
}
