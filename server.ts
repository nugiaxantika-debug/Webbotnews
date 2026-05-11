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

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  

  const userBots = new Map<string, WhatsAppBot>();
  let activeBots: string[] = [];
  try {
    if (fs.existsSync("active_bots.json")) {
      activeBots = JSON.parse(fs.readFileSync("active_bots.json", "utf-8"));
    }
  } catch (e) {}

  for (const email of activeBots) {
    if (!userBots.has(email)) {
      const waBot = new WhatsAppBot(io, email);
      userBots.set(email, waBot);
      setTimeout(() => { waBot.start(); }, 1000); // 1s delay
    }
  }

  function getWaBot(req: express.Request): WhatsAppBot {
    let email = req.headers["x-user-email"] as string;
    if (!email) email = "default";
    if (!userBots.has(email)) {
      userBots.set(email, new WhatsAppBot(io, email));
      if (!activeBots.includes(email)) {
        activeBots.push(email);
        fs.writeFileSync("active_bots.json", JSON.stringify(activeBots));
        
      }
    }
    return userBots.get(email)!;
  }

  // API Routes
  // Auth endpoints
  app.post("/api/auth/register", async (req, res) => {
    const { email, password } = req.body;
    let users: any[] = [];
    try {
      if (fs.existsSync("auth.json")) {
        users = JSON.parse(fs.readFileSync("auth.json", "utf-8"));
      }
    } catch(e){}
    if (users.find(u => u.email === email)) {
      return res.status(400).json({ error: "Email sudah terdaftar" });
    }
    users.push({ email, password });
    fs.writeFileSync("auth.json", JSON.stringify(users, null, 2));
    
    res.json({ success: true, email });
  });

  app.post("/api/auth/login", (req, res) => {
    const { email, password } = req.body;
    let users: any[] = [];
    try {
      if (fs.existsSync("auth.json")) {
        users = JSON.parse(fs.readFileSync("auth.json", "utf-8"));
      }
    } catch(e){}
    const user = users.find(u => u.email === email && u.password === password);
    if (!user) {
      return res.status(401).json({ error: "Email atau password salah." });
    }
    res.json({ success: true, email });
  });

  app.get("/api/users/count", (req, res) => {
    let users: any[] = [];
    try {
      if (fs.existsSync("auth.json")) {
        users = JSON.parse(fs.readFileSync("auth.json", "utf-8"));
      }
    } catch(e){}
    res.json({ count: users.length });
  });

  app.get("/api/config", async (req, res) => {
    let config = {};
    try {
      if (fs.existsSync("web_config.json")) {
        config = JSON.parse(fs.readFileSync("web_config.json", "utf-8"));
      }
    } catch(e){}
    res.json({ config });
  });

  app.post("/api/config", async (req, res) => {
    try {
      fs.writeFileSync("web_config.json", JSON.stringify(req.body.config, null, 2));
      res.json({ success: true });
    } catch(e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/whatsapp/status", (req, res) => {
    res.json(getWaBot(req).getStatus());
  });

  app.post("/api/whatsapp/start", async (req, res) => {
    const { phoneNumber } = req.body;
    await getWaBot(req).start(phoneNumber);
    res.json({ success: true, message: "Start initiated" });
  });

  app.post("/api/whatsapp/stop", async (req, res) => {
    await getWaBot(req).stop();
    res.json({ success: true, message: "Stop initiated" });
  });

  app.post("/api/whatsapp/restart", async (req, res) => {
    await getWaBot(req).restart();
    res.json({ success: true, message: "Restart initiated" });
  });

  app.post("/api/whatsapp/delete-session", async (req, res) => {
    await getWaBot(req).deleteSession();
    res.json({ success: true, message: "Session deleted" });
  });

  app.get("/api/whatsapp/groups", async (req, res) => {
    try {
      const groups = await getWaBot(req).getGroups();
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
      getWaBot(req).massAddGroupMembers(groupId, numbers).catch(err => console.error("Mass add background error:", err));
      res.json({ success: true, message: `Memulai proses mass add untuk ${numbers.length} anggota di background.` });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  io.on("connection", (socket) => {
    const userEmail = typeof socket.handshake.query.userEmail === "string" ? socket.handshake.query.userEmail : "default";
    socket.join(userEmail);
    console.log(`Client connected via WebSocket: ${userEmail}`);
    
    // Ensure bot exists for this user
    if (!userBots.has(userEmail)) {
      userBots.set(userEmail, new WhatsAppBot(io, userEmail));
      if (!activeBots.includes(userEmail)) {
        activeBots.push(userEmail);
        fs.writeFileSync("active_bots.json", JSON.stringify(activeBots));
        
      }
    }
    
    socket.emit("status", userBots.get(userEmail)!.getStatus());

    socket.on("disconnect", () => {
      console.log(`Client disconnected: ${userEmail}`);
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
