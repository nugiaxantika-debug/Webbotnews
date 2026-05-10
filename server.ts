import express from "express";
import { createServer as createViteServer } from "vite";
import http from "http";
import path from "path";
import fs from "fs";
import { Server as SocketIOServer } from "socket.io";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { WhatsAppBot } from "./src/services/whatsapp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

process.on('uncaughtException', (err) => {
  console.error("Uncaught Exception:", err);
});

process.on('unhandledRejection', (reason, p) => {
  console.error("Unhandled Rejection:", reason);
});

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const io = new SocketIOServer(server, {
    cors: { origin: "*" },
  });
  const PORT = 3000;

  let publicUrl = "";

  app.use((req, res, next) => {
    if (!publicUrl && req.headers.host) {
      if (req.headers.host.includes("run.app") || req.headers.host.includes("aistudio")) {
         publicUrl = `https://${req.headers.host}`;
         console.log(`Discovered public URL for keep-alive: ${publicUrl}`);
      }
    }
    next();
  });

  app.use(express.json());

  // Initialize WhatsApp Bot Manager
  const waBot = new WhatsAppBot(io);

  // Auto-start if session exists
  const sessionPath = path.join(process.cwd(), "auth_info_baileys", "creds.json");
  if (fs.existsSync(sessionPath)) {
    console.log("Found existing session. Auto-starting WhatsApp Bot...");
    setTimeout(() => { waBot.start(); }, 1000); // 1s delay to let server boot up
  }

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/whatsapp/status", (req, res) => {
    res.json(waBot.getStatus());
  });

  app.post("/api/whatsapp/start", async (req, res) => {
    const { phoneNumber } = req.body;
    await waBot.start(phoneNumber);
    res.json({ success: true, message: "Start initiated" });
  });

  app.post("/api/whatsapp/stop", async (req, res) => {
    await waBot.stop();
    res.json({ success: true, message: "Stop initiated" });
  });

  app.post("/api/whatsapp/restart", async (req, res) => {
    await waBot.restart();
    res.json({ success: true, message: "Restart initiated" });
  });

  app.post("/api/whatsapp/delete-session", async (req, res) => {
    await waBot.deleteSession();
    res.json({ success: true, message: "Session deleted" });
  });

  app.get("/api/whatsapp/groups", async (req, res) => {
    try {
      const groups = await waBot.getGroups();
      res.json({ success: true, groups });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/whatsapp/mass-add-members", async (req, res) => {
    const { groupId, numbers } = req.body;
    if (!groupId || !numbers || !Array.isArray(numbers)) {
      return res.status(400).json({ error: "Invalid parameters. Require groupId and a numbers array." });
    }
    try {
      waBot.massAddGroupMembers(groupId, numbers).catch(err => console.error("Mass add background error:", err));
      res.json({ success: true, message: `Memulai proses mass add untuk ${numbers.length} anggota di background.` });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  io.on("connection", (socket) => {
    console.log("Client connected via WebSocket");
    socket.emit("status", waBot.getStatus());

    socket.on("disconnect", () => {
      console.log("Client disconnected");
    });
  });

  // Vite middleware for development or Serve Static files
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    
    // Attempt to prevent container from sleeping by self-pinging every 25 seconds
    // We ping the public URL so it routes through the external load balancer, keeping the instance active
    setInterval(async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        if (publicUrl) {
           const publicController = new AbortController();
           const publicTimeoutId = setTimeout(() => publicController.abort(), 5000);
           await fetch(`${publicUrl}/api/health`, { signal: publicController.signal });
           clearTimeout(publicTimeoutId);
        }
      } catch (e) {
        // ignore timeout errors
      }
    }, 25000);
  });
}

startServer();
