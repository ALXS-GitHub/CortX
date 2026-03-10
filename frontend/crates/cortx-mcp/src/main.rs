mod mcp_emitter;
mod params;
mod process_state;
mod server;

use rmcp::transport::stdio;
use rmcp::ServiceExt;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Log to stderr — stdout is reserved for MCP protocol
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_ansi(false)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    tracing::info!("Starting CortX MCP server...");

    let server = server::CortxMcp::new()?;
    let service = server.serve(stdio()).await?;

    tracing::info!("CortX MCP server running, waiting for requests...");

    service.waiting().await?;

    tracing::info!("CortX MCP server shutting down");
    Ok(())
}
