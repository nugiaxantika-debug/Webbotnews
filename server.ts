import express from "express";
import { createServer as createViteServer } from "vite";
import http from "http";
import path from "path";
import fs from "fs";
import { Server as SocketIOServer } from "socket.io";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { WhatsAppBot } from "./src/services/whatsapp";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, doc, getDoc, setDoc, getDocs, getCountFromServer } from "firebase/firestore";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const firebaseConfig = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'firebase-applet-config.json'), 'utf8'));
const adminApp = initializeApp(firebaseConfig);
const adminDb = getFirestore(adminApp, firebaseConfig.firestoreDatabaseId);

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
      const snapshot = await getDocs(collection(adminDb, "users"));
      users.push(...snapshot.docs.map(doc => doc.data()));
    } catch(e){}
    
    if (users.find(u => u.email === email)) {
      return res.status(400).json({ error: "Email sudah terdaftar" });
    }
    
    const newUser = { email, password, name: "", photo: "" };
    
    try {
        await setDoc(doc(adminDb, "users", email), newUser);
    } catch (e) {}

    // keep local array sync for existing logic
    let localUsers: any[] = [];
    if (fs.existsSync("auth.json")) {
      localUsers = JSON.parse(fs.readFileSync("auth.json", "utf-8"));
    }
    localUsers.push(newUser);
    fs.writeFileSync("auth.json", JSON.stringify(localUsers, null, 2));
    
    res.json({ success: true, email });
  });

  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body;
    let user = null;
    try {
       const userDoc = await getDoc(doc(adminDb, "users", email));
       if (userDoc.exists()) {
         user = userDoc.data();
       }
    } catch(e) {}

    if (!user) {
      let users: any[] = [];
      try {
        if (fs.existsSync("auth.json")) {
          users = JSON.parse(fs.readFileSync("auth.json", "utf-8"));
        }
      } catch(e){}
      user = users.find(u => u.email === email);
    }

    if (!user || user.password !== password) {
      return res.status(401).json({ error: "Email atau password salah." });
    }
    res.json({ success: true, email });
  });

  app.get("/api/user/profile", async (req, res) => {
    const email = req.headers["x-user-email"] as string;
    if (!email) return res.status(401).json({ error: "Unauthorized" });

    let user = null;
    try {
       const userDoc = await getDoc(doc(adminDb, "users", email));
       if (userDoc.exists()) {
         user = userDoc.data();
       }
    } catch(e) {}

    if (!user) {
        let users: any[] = [];
        try {
          if (fs.existsSync("auth.json")) {
            users = JSON.parse(fs.readFileSync("auth.json", "utf-8"));
          }
        } catch(e){}
        user = users.find(u => u.email === email);
    }

    if (!user) return res.status(404).json({ error: "Not found" });

    res.json({ name: user.name || "", photo: user.photo || "" });
  });

  app.post("/api/user/profile", async (req, res) => {
    const email = req.headers["x-user-email"] as string;
    if (!email) return res.status(401).json({ error: "Unauthorized" });

    const { name, photo } = req.body;
    
    try {
        await setDoc(doc(adminDb, "users", email), { name, photo }, { merge: true });
    } catch (e) {}

    // keep local sync
    let users: any[] = [];
    try {
      if (fs.existsSync("auth.json")) {
        users = JSON.parse(fs.readFileSync("auth.json", "utf-8"));
      }
    } catch(e){}

    const userIdx = users.findIndex(u => u.email === email);
    if (userIdx > -1) {
      if (name !== undefined) users[userIdx].name = name;
      if (photo !== undefined) users[userIdx].photo = photo;
      fs.writeFileSync("auth.json", JSON.stringify(users, null, 2));
    }
    
    res.json({ success: true });
  });

  app.get("/api/users/count", async (req, res) => {
    try {
       const snapshot = await getCountFromServer(collection(adminDb, "users"));
       res.json({ count: snapshot.data().count });
    } catch (e) {
       let users: any[] = [];
       try {
         if (fs.existsSync("auth.json")) {
           users = JSON.parse(fs.readFileSync("auth.json", "utf-8"));
         }
       } catch(e){}
       res.json({ count: users.length });
    }
  });

  app.get("/api/bots/active", (req, res) => {
    let bots: string[] = [];
    try {
      if (fs.existsSync("active_bots.json")) {
        bots = JSON.parse(fs.readFileSync("active_bots.json", "utf-8"));
      }
    } catch(e) {}
    res.json({ count: bots.length, bots });
  });

  app.get("/api/config", async (req, res) => {
    // Disable caching for configuration completely
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    let config = {};
    try {
      const docSnap = await getDoc(doc(adminDb, "settings", "web_config"));
      if (docSnap.exists()) {
        config = docSnap.data() || {};
      } else if (fs.existsSync("web_config.json")) {
        // Fallback to local if not initialized
        config = JSON.parse(fs.readFileSync("web_config.json", "utf-8"));
      }
    } catch(e) {
      console.error("Error reading config:", e);
      // Fallback to local if Firebase fails
      if (fs.existsSync("web_config.json")) {
        try {
          config = JSON.parse(fs.readFileSync("web_config.json", "utf-8"));
        } catch(err) {}
      }
    }
    res.json({ config });
  });

  app.post("/api/config", async (req, res) => {
    try {
      if (req.body.config) {
        await setDoc(doc(adminDb, "settings", "web_config"), req.body.config, { merge: true });
        // Also write to local just in case
        fs.writeFileSync("web_config.json", JSON.stringify(req.body.config, null, 2));
      }
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

  app.post("/api/admin/delete-session", async (req, res) => {
    const { targetEmail } = req.body;
    let currentUser = req.headers["x-user-email"] as string;
    if (currentUser !== "nugiaxantika@gmail.com") {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (!targetEmail) return res.status(400).json({ error: "No target email provided" });
    
    if (userBots.has(targetEmail)) {
      await userBots.get(targetEmail)!.deleteSession();
    }
    res.json({ success: true, message: "Session deleted for " + targetEmail });
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
      appType: "custom",
    });
    app.use(vite.middlewares);
    
    app.get("*", async (req, res, next) => {
      try {
        const url = req.originalUrl;
        let template = fs.readFileSync(path.resolve(process.cwd(), "index.html"), "utf-8");
        template = await vite.transformIndexHtml(url, template);

        let config: any = {};
        try {
          const docSnap = await getDoc(doc(adminDb, "settings", "web_config"));
          if (docSnap.exists()) {
            config = docSnap.data() || {};
          } else if (fs.existsSync("web_config.json")) {
            config = JSON.parse(fs.readFileSync("web_config.json", "utf-8"));
          }
        } catch(e) {}

        if (config.title) {
          const fullTitle = `${config.title}${config.highlight ? ' ' + config.highlight : ''}`;
          template = template.replace(/<title>.*?<\/title>/, `<title>${fullTitle}</title>`);
          
          let headInject = `<meta name="description" content="${config.heroDesc || fullTitle}">\n  <meta property="og:title" content="${fullTitle}">\n  <meta property="og:description" content="${config.heroDesc || fullTitle}">`;
          if (config.favicon) {
            headInject += `\n  <link rel="icon" href="${config.favicon}">`;
          }
          template = template.replace('</head>', `${headInject}\n  </head>`);
        }

        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e: any) {
        vite.ssrFixStacktrace(e);
        next(e);
      }
    });
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath, { index: false }));
    app.get("*", async (req, res) => {
      try {
        let template = fs.readFileSync(path.join(distPath, "index.html"), "utf-8");
        
        let config: any = {};
        try {
          const docSnap = await getDoc(doc(adminDb, "settings", "web_config"));
          if (docSnap.exists()) {
            config = docSnap.data() || {};
          } else if (fs.existsSync("web_config.json")) {
            config = JSON.parse(fs.readFileSync("web_config.json", "utf-8"));
          }
        } catch(e) {}

        if (config.title) {
          const fullTitle = `${config.title}${config.highlight ? ' ' + config.highlight : ''}`;
          template = template.replace(/<title>.*?<\/title>/i, `<title>${fullTitle}</title>`);
          
          let headInject = `<meta name="description" content="${config.heroDesc || fullTitle}">\n  <meta property="og:title" content="${fullTitle}">\n  <meta property="og:description" content="${config.heroDesc || fullTitle}">`;
          if (config.favicon) {
            headInject += `\n  <link rel="icon" href="${config.favicon}">`;
          }
          template = template.replace('</head>', `${headInject}\n  </head>`);
        }
        res.status(200).set({ 'Content-Type': 'text/html' }).send(template);
      } catch (e) {
        res.sendFile(path.join(distPath, "index.html"));
      }
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
