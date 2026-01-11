import "./style.css";

// get the current theme from the URL
const searchParams = new URLSearchParams(window.location.search);
document.body.dataset.theme = searchParams.get("theme") ?? "light";

// WebSocket connection management
let ws: WebSocket | null = null;
let reconnectAttempts = 0;
let maxReconnectAttempts = Infinity; // Reconectar indefinidamente
let reconnectDelay = 1000; // Empezar con 1 segundo
let maxReconnectDelay = 30000; // Máximo 30 segundos
let pingInterval: number | null = null;
let pongTimeout: number | null = null;
const PING_INTERVAL = 30000; // Ping cada 30 segundos
const PONG_TIMEOUT = 10000; // Timeout de 10 segundos para pong
const statusElement = document.getElementById("connection-status");

/**
 * Updates the connection status display element.
 */
function updateConnectionStatus(status: string, isConnectedState: boolean): void {
    if (statusElement) {
        statusElement.textContent = status;
        statusElement.style.color = isConnectedState ? "var(--accent-primary)" : "var(--error-700)";
    }
}

/**
 * Sends a task response back to the MCP server via WebSocket.
 *
 * @param response - The response containing task ID and result
 */
function sendTaskResponse(response: any): void {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(response));
        console.log("Sent response to MCP server:", response);
    } else {
        console.error("WebSocket not connected, cannot send response");
    }
}

/**
 * Sends a ping message to keep the connection alive.
 */
function sendPing(): void {
    if (ws && ws.readyState === WebSocket.OPEN) {
        try {
            ws.send(JSON.stringify({ type: "ping", timestamp: Date.now() }));
            console.log("Sent ping to MCP server");
            
            // Set timeout for pong response
            if (pongTimeout) {
                clearTimeout(pongTimeout);
            }
            pongTimeout = window.setTimeout(() => {
                console.warn("Pong timeout, reconnecting...");
                if (ws) {
                    ws.close();
                }
            }, PONG_TIMEOUT);
        } catch (error) {
            console.error("Failed to send ping:", error);
        }
    }
}

/**
 * Starts the ping interval to keep the connection alive.
 */
function startPingInterval(): void {
    stopPingInterval();
    pingInterval = window.setInterval(() => {
        sendPing();
    }, PING_INTERVAL);
}

/**
 * Stops the ping interval.
 */
function stopPingInterval(): void {
    if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
    }
    if (pongTimeout) {
        clearTimeout(pongTimeout);
        pongTimeout = null;
    }
}

/**
 * Handles reconnection with exponential backoff.
 */
function scheduleReconnect(): void {
    if (reconnectAttempts >= maxReconnectAttempts) {
        console.error("Max reconnection attempts reached");
        updateConnectionStatus("Connection failed", false);
        return;
    }

    const delay = Math.min(reconnectDelay * Math.pow(2, reconnectAttempts), maxReconnectDelay);
    reconnectAttempts++;
    
    console.log(`Scheduling reconnect attempt ${reconnectAttempts} in ${delay}ms`);
    updateConnectionStatus(`Reconnecting in ${Math.round(delay / 1000)}s...`, false);
    
    setTimeout(() => {
        connectToMcpServer();
    }, delay);
}

/**
 * Establishes a WebSocket connection to the MCP server.
 */
function connectToMcpServer(): void {
    if (ws?.readyState === WebSocket.OPEN) {
        updateConnectionStatus("Already connected", true);
        return;
    }

    // Close existing connection if any
    if (ws) {
        try {
            ws.close();
        } catch (error) {
            console.error("Error closing existing connection:", error);
        }
        ws = null;
    }

    try {
        // Use environment variable for MCP WebSocket URL, fallback to localhost for local development
        const mcpWsUrl = import.meta.env.VITE_MCP_WS_URL || "ws://localhost:4402";
        ws = new WebSocket(mcpWsUrl);
        updateConnectionStatus("Connecting...", false);

        ws.onopen = () => {
            console.log("Connected to MCP server");
            updateConnectionStatus("Connected to MCP server", true);
            reconnectAttempts = 0; // Reset reconnect attempts on successful connection
            reconnectDelay = 1000; // Reset delay
            startPingInterval(); // Start ping/pong to keep connection alive
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                
                // Handle pong response
                if (data.type === "pong") {
                    console.log("Received pong from MCP server");
                    if (pongTimeout) {
                        clearTimeout(pongTimeout);
                        pongTimeout = null;
                    }
                    return;
                }
                
                // Handle ping from server (respond with pong)
                if (data.type === "ping") {
                    console.log("Received ping from MCP server, sending pong");
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: "pong", timestamp: data.timestamp }));
                    }
                    return;
                }
                
                // Handle regular task requests
                console.log("Received from MCP server:", event.data);
                const request = data;
                // Forward the task request to the plugin for execution
                parent.postMessage(request, "*");
            } catch (error) {
                console.error("Failed to parse WebSocket message:", error);
            }
        };

        ws.onclose = (event) => {
            console.log("Disconnected from MCP server", event.code, event.reason);
            updateConnectionStatus("Disconnected", false);
            stopPingInterval();
            ws = null;
            
            // Only reconnect if it wasn't a manual close (code 1000)
            if (event.code !== 1000) {
                scheduleReconnect();
            }
        };

        ws.onerror = (error) => {
            console.error("WebSocket error:", error);
            updateConnectionStatus("Connection error", false);
            stopPingInterval();
        };
    } catch (error) {
        console.error("Failed to connect to MCP server:", error);
        updateConnectionStatus("Connection failed", false);
        scheduleReconnect();
    }
}

document.querySelector("[data-handler='connect-mcp']")?.addEventListener("click", () => {
    reconnectAttempts = 0; // Reset attempts on manual connect
    connectToMcpServer();
});

// Auto-connect on load
connectToMcpServer();

// Listen plugin.ts messages
window.addEventListener("message", (event) => {
    if (event.data.source === "penpot") {
        document.body.dataset.theme = event.data.theme;
    } else if (event.data.type === "task-response") {
        // Forward task response back to MCP server
        sendTaskResponse(event.data.response);
    }
});

// Cleanup on page unload
window.addEventListener("beforeunload", () => {
    stopPingInterval();
    if (ws) {
        ws.close(1000, "Page unloading");
    }
});
