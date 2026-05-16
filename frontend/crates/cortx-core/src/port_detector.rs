//! Cross-platform OS-level listening-port lookup by PID.
//!
//! Replaces the old log-regex scraping with ground truth from the OS kernel:
//! - Linux / macOS / Windows all expose listening TCP sockets with the owning PID.
//! - We walk the process tree (the service's PID is usually a shell wrapper that
//!   spawns the actual server as a child), collect all descendants, and return
//!   the set of TCP ports those PIDs have in LISTEN state.
//!
//! Implementation:
//! - `sysinfo` enumerates processes + parent relationships → process-tree walk.
//! - `netstat2` enumerates TCP sockets with their associated PIDs.

use netstat2::{
    iterate_sockets_info, AddressFamilyFlags, ProtocolFlags, ProtocolSocketInfo,
};
use std::collections::HashSet;
use sysinfo::{ProcessRefreshKind, System};

/// Collect all PIDs that descend from `root_pid` (inclusive). Returns the set
/// of PIDs including the root itself.
fn collect_pid_tree(root_pid: u32) -> HashSet<u32> {
    let mut sys = System::new();
    // Refresh just process listing + parent IDs — no need for CPU / memory metrics.
    sys.refresh_processes_specifics(
        sysinfo::ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::new(),
    );

    // Build parent → children map
    let mut children: std::collections::HashMap<u32, Vec<u32>> = std::collections::HashMap::new();
    for (pid, process) in sys.processes() {
        if let Some(parent) = process.parent() {
            children
                .entry(parent.as_u32())
                .or_default()
                .push(pid.as_u32());
        }
    }

    // BFS from root
    let mut result = HashSet::new();
    let mut stack = vec![root_pid];
    while let Some(pid) = stack.pop() {
        if !result.insert(pid) {
            continue;
        }
        if let Some(kids) = children.get(&pid) {
            stack.extend(kids.iter().copied());
        }
    }
    result
}

/// Return the sorted, deduplicated list of TCP ports in LISTEN state that are
/// owned by `root_pid` or any of its descendants.
///
/// Returns an empty `Vec` on success with no listeners, or `Err` if the OS
/// query itself failed. Permission errors silently skip those sockets — the
/// caller treats "no ports found" the same way regardless of cause.
pub fn get_listening_ports_for_pid_tree(root_pid: u32) -> Result<Vec<u16>, String> {
    let pids = collect_pid_tree(root_pid);
    if pids.is_empty() {
        return Ok(Vec::new());
    }

    let af = AddressFamilyFlags::IPV4 | AddressFamilyFlags::IPV6;
    let proto = ProtocolFlags::TCP;

    let iter = iterate_sockets_info(af, proto).map_err(|e| e.to_string())?;
    let mut ports = HashSet::<u16>::new();
    for socket in iter.flatten() {
        // Only LISTEN sockets; for each, the SocketInfo carries one or more PIDs.
        if let ProtocolSocketInfo::Tcp(tcp) = &socket.protocol_socket_info {
            if !matches!(tcp.state, netstat2::TcpState::Listen) {
                continue;
            }
            // associated_pids is Vec<u32>; if any of them is in our tree, count this port
            if socket.associated_pids.iter().any(|p| pids.contains(p)) {
                ports.insert(tcp.local_port);
            }
        }
    }

    let mut out: Vec<u16> = ports.into_iter().collect();
    out.sort_unstable();
    Ok(out)
}
