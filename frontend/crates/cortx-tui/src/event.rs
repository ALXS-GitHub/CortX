use crossterm::event::{self, Event as CEvent, KeyEvent, KeyEventKind};
use std::sync::mpsc;
use std::time::Duration;

use crate::app::ProcessEvent;

/// Events that the TUI handles
pub enum Event {
    /// Keyboard/mouse input
    Key(KeyEvent),
    /// Process event from the emitter channel
    Process(ProcessEvent),
    /// Tick (for refreshing UI)
    Tick,
}

/// Runs the event loop, combining terminal events and process events
pub fn event_loop(
    process_rx: mpsc::Receiver<ProcessEvent>,
    event_tx: mpsc::Sender<Event>,
) {
    let tick_rate = Duration::from_millis(50);

    loop {
        // Drain all pending process events first
        loop {
            match process_rx.try_recv() {
                Ok(pe) => {
                    if event_tx.send(Event::Process(pe)).is_err() {
                        return;
                    }
                }
                Err(mpsc::TryRecvError::Empty) => break,
                Err(mpsc::TryRecvError::Disconnected) => return,
            }
        }

        // Poll for terminal events with timeout
        if crossterm::event::poll(tick_rate).unwrap_or(false) {
            match event::read() {
                Ok(CEvent::Key(key)) => {
                    // Only handle key press events, ignore release/repeat
                    // (Windows sends both Press and Release, which causes
                    //  modes like Help/Search to open and close instantly)
                    if key.kind == KeyEventKind::Press {
                        if event_tx.send(Event::Key(key)).is_err() {
                            return;
                        }
                    }
                }
                Ok(CEvent::Resize(_, _)) => {
                    // Terminal auto-handles resize on next draw
                }
                _ => {}
            }
        } else {
            // Tick event for periodic UI refresh
            if event_tx.send(Event::Tick).is_err() {
                return;
            }
        }
    }
}
