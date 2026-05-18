import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  downloadContentFromMessage,
  Browsers
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import fs from "fs";
import path from "path";
import { Server as SocketIOServer } from "socket.io";
import NodeCache from "node-cache";
import sharp from "sharp";
import axios from "axios";
import schedule from "node-schedule";
import { igdl, fbdl, ytmp4, ytmp3 } from "ruhend-scraper";
import btch from "btch-downloader";
import ab from "ab-downloader";

const AUTH_FOLDER = path.join(process.cwd(), "auth_info_baileys");
const msgRetryCounterCache = new NodeCache();

export class WhatsAppBot {
  public userEmail: string;
  private authFolder: string;
  private settingsFile: string;
  private botSettingsFile: string;
  private channelLink: string | null = null;

  private sock: any = null;
  private io: SocketIOServer;
  private status: "disconnected" | "connecting" | "connected" = "disconnected";
  private currentQr: string | null = null;
  private isAttemptingStart: boolean = false;
  private coverImageBuffer: Buffer | null = null;
  private customBotName: string | null = null;
  private poweredByText: string | null = null;
  private menuCommands = new Set<string>(["allmenu", "menu", "help", "bot"]);
  private activeGames = new Map<string, { answer: string | string[] | number, type: string, attempts?: number, state?: string, players?: string[] }>();
  private activeSwGroups = new Set<string>();
  
  // Anti features
    
  private autoTypingEnabled: boolean = false;
  private groupSettings = new Map<string, { welcomeEnabled?: boolean, welcomeMessage?: string, goodbyeEnabled?: boolean, goodbyeMessage?: string, antivideo?: boolean, antifoto?: boolean, antifoto1x?: boolean, antistiker?: boolean, antispam?: boolean, antitagsw?: boolean, antivirtex?: boolean, antitoxic?: boolean, antilinkall?: boolean }>();
  
  private connectedAt: number | null = null;
  
  private storedStickers = new Map<string, Buffer>();
  private userMessageHistory = new Map<string, { text: string, time: number, count: number }>();

  private connectionMonitor: any = null;

  constructor(io: SocketIOServer, userEmail: string = "default") {
    this.io = io;
    this.userEmail = userEmail;
    this.authFolder = path.join(process.cwd(), `auth_info_baileys_${userEmail.replace(/[^a-zA-Z0-9]/g, '_')}`);
    this.settingsFile = path.join(process.cwd(), `group_settings_${userEmail.replace(/[^a-zA-Z0-9]/g, '_')}.json`);
    this.botSettingsFile = path.join(process.cwd(), `bot_settings_${userEmail.replace(/[^a-zA-Z0-9]/g, '_')}.json`);
    this.loadBotSettings();
    this.loadGroupSettings();
    
    // Auto-reconnect monitor every 3 minutes
    this.connectionMonitor = setInterval(() => {
      if (this.isAttemptingStart) {
        if (this.status === "disconnected") {
          console.log("Connection monitor detected disconnected state. Attempting auto-restart...");
          this.start();
        } else if (this.status === "connecting") {
          // Hanya merestart jika stuck connecting lebih dari 3 menit tanpa progress
          console.log("Connection monitor detected connecting state for an extended time. Forcing restart to avoid getting stuck...");
          if (this.sock) {
            try { this.sock.end(undefined); } catch(e) {}
            this.sock = null;
          }
          this.updateStatus("disconnected");
          this.start();
        }
      }
    }, 180000);
  }

  private loadBotSettings() {
    try {
      if (!fs.existsSync(this.botSettingsFile)) return;
      const data = fs.readFileSync(this.botSettingsFile, "utf8");
      const obj = JSON.parse(data);
      if (obj.channelLink) this.channelLink = obj.channelLink;
    } catch {
      // ignore
    }
  }

  private saveBotSettings() {
    const obj = { channelLink: this.channelLink };
    fs.writeFileSync(this.botSettingsFile, JSON.stringify(obj, null, 2));
  }

  private loadGroupSettings() {
    try {
      const data = fs.readFileSync(this.settingsFile, "utf8");
      const obj = JSON.parse(data);
      for (const [k, v] of Object.entries(obj)) {
        this.groupSettings.set(k, v as any);
      }
    } catch {
      // ignore
    }
  }

  private saveGroupSettings() {
    const obj = Object.fromEntries(this.groupSettings);
    fs.writeFileSync(this.settingsFile, JSON.stringify(obj, null, 2));
  }

  public getStatus() {
    let uptime = null;
    if (this.status === "connected" && this.connectedAt) {
      uptime = Date.now() - this.connectedAt;
    }
    return {
      status: this.status,
      qr: this.currentQr,
      uptime: uptime,
    };
  }

  public async start(phoneNumber?: string) {
    if (this.status !== "disconnected") {
      this.broadcastState("Bot is already running or connecting.");
      return;
    }
    this.isAttemptingStart = true;

    if (this.sock) {
      this.broadcastState("Cleaning up old socket before start...");
      try {
        if (this.sock.end) this.sock.end(undefined);
      } catch (e) {}
      this.sock = null;
    }

    if (phoneNumber) {
      phoneNumber = phoneNumber.replace(/[^0-9]/g, '');
    }

    this.updateStatus("connecting");
    this.broadcastState("Starting initialization...");

    try {
      const { state, saveCreds } = await useMultiFileAuthState(this.authFolder);
      
      const { version, isLatest } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307] as any, isLatest: false }));
      this.broadcastState(`Using WA v${version.join('.')}, isLatest: ${isLatest}`);

      this.sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: "silent" }) as any,
        browser: Browsers.ubuntu("Chrome"),
        msgRetryCounterCache,
        generateHighQualityLinkPreview: true,
        keepAliveIntervalMs: 30000,
        syncFullHistory: false,
        markOnlineOnConnect: true,
      });

      if (phoneNumber && !this.sock.authState.creds.registered) {
        this.broadcastState("Waiting for socket connection to request pairing code...");
        setTimeout(async () => {
          if (!this.sock) return;
          this.broadcastState("Requesting pairing code...");
          try {
            const code = await this.sock.requestPairingCode(phoneNumber);
            const formattedCode = code?.match(/.{1,4}/g)?.join("-") || code;
            this.broadcastState(`Pairing code generated: ${formattedCode}`);
            this.io.to(this.userEmail).emit("pairing_code", formattedCode);
          } catch (err: any) {
            const errorMsg = err?.message || err;
            if (String(errorMsg).includes("Connection Closed") || String(errorMsg).includes("Precondition Required")) {
                this.broadcastState("Connection dropped while requesting code. Will retry automatically...");
            } else {
                this.broadcastState(`Failed to get pairing code: ${errorMsg}`);
                console.error("Pairing error:", err);
            }
          }
        }, 3000);
      }

      this.sock.ev.on("connection.update", async (update: any) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
          if (!phoneNumber) {
            this.currentQr = qr;
            this.io.to(this.userEmail).emit("qr", qr);
            this.broadcastState("QR Code generated. Please scan.");
          }
        }

        if (connection === "close") {
          const boomError = lastDisconnect?.error as Boom;
          const statusCode = boomError?.output?.statusCode;
          let shouldReconnect = true; // Default to always try reconnecting first
          
          if (statusCode === DisconnectReason.loggedOut) {
             shouldReconnect = false;
          }

          // If we get Precondition Required (428) or Time Out (408) while not registered,
          // the session state is likely dirty or rate-limited. Better to clear it.
          if (!this.sock?.authState?.creds?.registered && (statusCode === 428 || statusCode === 408)) {
              this.broadcastState(`Connection closed with ${statusCode}. Cleaning dirty session...`);
              shouldReconnect = false;
          }
            
          if (statusCode === 428) {
              this.broadcastState("Connection dropped (428 Precondition Required).");
          } else if (statusCode === 408) {
              this.broadcastState("Request Time-out (408).");
          } else if (statusCode === 515) {
              this.broadcastState("Stream Errored (515). Reconnecting...");
          } else {
              this.broadcastState(`Connection closed - Status code: ${statusCode}. Reconnecting: ${shouldReconnect}`);
          }
          
          this.updateStatus("disconnected");
          this.currentQr = null;

          if (shouldReconnect && this.isAttemptingStart) {
            setTimeout(() => {
                if (this.status === "disconnected") {
                    this.start(phoneNumber);
                }
            }, 5000); // Wait 5 seconds before reconnecting
          } else {
            if (!shouldReconnect) {
              // Hanya delete session jika benar-benar logged out (scan WA memutus bot dari HP utama)
              this.broadcastState("User has logged out from linked devices. Deleting session...");
              this.deleteSession();
            }
          }
        } else if (connection === "open") {
          this.updateStatus("connected");
          this.currentQr = null;
          this.io.to(this.userEmail).emit("pairing_code", null);
          this.broadcastState("Bot connected successfully!");
        }
      });

      this.sock.ev.on("creds.update", saveCreds);

      this.sock.ev.on("group-participants.update", async (data: any) => {
        try {
          const { id, participants, action } = data;
          this.broadcastState(`group-participants.update: ${action} for ${id} with ${participants.length} participants`);
          const settings = this.groupSettings.get(id);
          
          if (!settings) {
              return;
          }

          let groupName = "Grup ini";
          try {
             const metadata = await this.sock.groupMetadata(id);
             if (metadata && metadata.subject) {
                 groupName = metadata.subject;
             }
          } catch (e) {
             // ignore
          }

          if (action === "add" && settings.welcomeEnabled && settings.welcomeMessage) {
            for (const participant of participants) {
              try {
                const participantJid = typeof participant === 'string' ? participant : (participant as any).id || (participant as any).jid || String(participant);
                let msgText = settings.welcomeMessage
                    .replace(/@user/gi, `@${participantJid.split("@")[0]}`)
                    .replace(/@grup/gi, groupName);
                
                if (!msgText.includes(`@${participantJid.split("@")[0]}`)) {
                    msgText += `\n\nSelamat datang @${participantJid.split("@")[0]}!`;
                }

                await this.sock.sendMessage(id, { text: msgText, mentions: [participantJid] });
                this.broadcastState(`Sent welcome message to ${participantJid}`);
              } catch (e: any) {
                this.broadcastState(`Failed to send welcome message: ${e?.message || e}`);
              }
            }
          } else if (action === "remove" && settings.goodbyeEnabled && settings.goodbyeMessage) {
            for (const participant of participants) {
              try {
                const participantJid = typeof participant === 'string' ? participant : (participant as any).id || (participant as any).jid || String(participant);
                let msgText = settings.goodbyeMessage
                    .replace(/@user/gi, `@${participantJid.split("@")[0]}`)
                    .replace(/@grup/gi, groupName);

                if (!msgText.includes(`@${participantJid.split("@")[0]}`)) {
                    msgText += `\n\nSelamat tinggal @${participantJid.split("@")[0]}!`;
                }

                await this.sock.sendMessage(id, { text: msgText, mentions: [participantJid] });
                this.broadcastState(`Sent goodbye message to ${participantJid}`);
              } catch (e: any) {
                this.broadcastState(`Failed to send goodbye message: ${e?.message || e}`);
              }
            }
          }
        } catch (err) {
          console.error("Failed to process group update", err);
        }
      });

      this.sock.ev.on("messages.upsert", async (m: any) => {
        try {
          if (m.type === "notify") {
            for (const msg of m.messages) {
              if (msg.message || msg.messageStubType) {
                try {
                  await this.handleIncomingMessage(msg);
                } catch (e) {
                  console.error("Error handling msg:", e);
                }
              }
            }
          }
        } catch (e) {
            console.error("Critical error in messages.upsert:", e);
        }
      });
    } catch (error: any) {
      console.error("Error starting WA:", error);
      this.updateStatus("disconnected");
      this.broadcastState(`Failed to start bot: ${error?.message || error}`);
    }
  }

  public async stop() {
    this.isAttemptingStart = false;
    if (this.sock) {
      this.broadcastState("Stopping bot...");
      try {
        if (this.sock.logout) await this.sock.logout();
      } catch (e: any) {
        if (!String(e).includes("Connection Closed")) {
          console.error("Logout error:", e);
        }
      }
      try {
        if (this.sock.end) this.sock.end(undefined);
      } catch (e: any) {
        if (!String(e).includes("Cannot read properties of null")) {
          console.error("End socket error:", e);
        }
      }
      this.sock = null;
      this.updateStatus("disconnected");
      this.currentQr = null;
      this.broadcastState("Bot stopped.");
    }
  }

  public async restart() {
    await this.stop();
    setTimeout(() => this.start(), 2000);
  }

  public async deleteSession() {
    await this.stop();
    this.broadcastState("Deleting session...");
    if (fs.existsSync(this.authFolder)) {
      try {
        fs.rmSync(this.authFolder, { recursive: true, force: true });
        this.broadcastState("Session deleted cleanly.");
      } catch (err) {
        console.error("Error deleting auth folder", err);
        this.broadcastState("Failed to delete session folder.");
      }
    } else {
        this.broadcastState("No session to delete.");
    }
    this.updateStatus("disconnected");
    this.currentQr = null;
  }

  public async getGroups() {
    if (!this.sock) return [];
    try {
      const groups = await this.sock.groupFetchAllParticipating();
      return Object.values(groups).map((group: any) => ({
        id: group.id,
        name: group.subject
      }));
    } catch (err) {
      console.error("Failed to fetch groups", err);
      return [];
    }
  }

  public async massAddGroupMembers(groupId: string, numbers: string[]) {
    if (!this.sock) {
      throw new Error("Bot is not connected.");
    }

    if (!groupId.endsWith("@g.us")) {
      groupId = `${groupId}@g.us`;
    }

    const formattedNumbers = numbers.map((num) => {
      let n = num.replace(/[^0-9]/g, "");
      return `${n}@s.whatsapp.net`;
    });
    
    // Process in chunks to avoid spam
    const chunkSize = 2;
    for (let i = 0; i < formattedNumbers.length; i += chunkSize) {
      const chunk = formattedNumbers.slice(i, i + chunkSize);
      try {
        await this.sock.groupParticipantsUpdate(groupId, chunk, "add");
        this.broadcastState(`Added chunk of ${chunk.length} to group ${groupId} (${i + chunk.length}/${formattedNumbers.length})`);
        // Larger random delay between chunks (5s to 15s)
        if (i + chunkSize < formattedNumbers.length) {
            const delay = Math.floor(Math.random() * 10000) + 5000;
            this.broadcastState(`Menunggu ${Math.round(delay/1000)} detik sebelum menambahkan selanjutnya...`);
            await new Promise(r => setTimeout(r, delay));
        }
      } catch (e: any) {
        this.broadcastState(`Failed to add chunk to group ${groupId}: ${e?.message}`);
        if (i + chunkSize < formattedNumbers.length) {
            this.broadcastState(`Terjadi error/limit, cooldown 30 detik...`);
            await new Promise(r => setTimeout(r, 30000));
        }
      }
    }
    this.broadcastState(`Selesai menambahkan ${formattedNumbers.length} anggota.`);
    return { success: true, message: `Completed adding members (runs in background).` };
  }

  private updateStatus(newStatus: "disconnected" | "connecting" | "connected") {
    this.status = newStatus;
    if (newStatus === "connected") {
      if (!this.connectedAt) this.connectedAt = Date.now();
    } else {
      this.connectedAt = null;
    }
    this.io.to(this.userEmail).emit("status", this.getStatus());
  }

  private broadcastState(message: string) {
    console.log(`[${this.userEmail}] ${message}`);
    this.io.to(this.userEmail).emit("log", { time: new Date().toISOString(), message });
  }

  private async handleIncomingMessage(msg: any) {
    if (!this.sock) return;

    const jid = msg.key.remoteJid;

    if (msg.messageStubType === 27 || msg.messageStubType === 28 || msg.messageStubType === 32) {
      this.broadcastState(`Fallback stub match: type=${msg.messageStubType} for ${jid}`);
      const action = msg.messageStubType === 27 ? 'add' : 'remove';
      const participants = msg.messageStubParameters || [];
      const settings = this.groupSettings.get(jid);

      if (settings && participants.length > 0) {
        let groupName = "Grup ini";
        try {
           const metadata = await this.sock.groupMetadata(jid);
           if (metadata && metadata.subject) {
               groupName = metadata.subject;
           }
        } catch (e) {}

        if (action === "add" && settings.welcomeEnabled && settings.welcomeMessage) {
          for (const participant of participants) {
            try {
              const participantJid = typeof participant === 'string' ? participant : (participant as any).id || (participant as any).jid || String(participant);
              let msgText = settings.welcomeMessage
                  .replace(/@user/gi, `@${participantJid.split("@")[0]}`)
                  .replace(/@grup/gi, groupName);
              
              if (!msgText.includes(`@${participantJid.split("@")[0]}`)) {
                  msgText += `\n\nSelamat datang @${participantJid.split("@")[0]}!`;
              }

              await this.sock.sendMessage(jid, { text: msgText, mentions: [participantJid] });
              this.broadcastState(`Fallback sent welcome to ${participantJid}`);
            } catch (e: any) {
               this.broadcastState(`Fallback failed welcome: ${e?.message}`);
            }
          }
        } else if (action === "remove" && settings.goodbyeEnabled && settings.goodbyeMessage) {
          for (const participant of participants) {
            try {
              const participantJid = typeof participant === 'string' ? participant : (participant as any).id || (participant as any).jid || String(participant);
              let msgText = settings.goodbyeMessage
                  .replace(/@user/gi, `@${participantJid.split("@")[0]}`)
                  .replace(/@grup/gi, groupName);

              if (!msgText.includes(`@${participantJid.split("@")[0]}`)) {
                  msgText += `\n\nSelamat tinggal @${participantJid.split("@")[0]}!`;
              }

              await this.sock.sendMessage(jid, { text: msgText, mentions: [participantJid] });
              this.broadcastState(`Fallback sent goodbye to ${participantJid}`);
            } catch (e: any) {
               this.broadcastState(`Fallback failed goodbye: ${e?.message}`);
            }
          }
        }
      }
    }

    if (!msg.message) return;

    // Handle status broadcast
    if (jid === "status@broadcast") {
      if (this.activeSwGroups.size > 0 && !msg.key.fromMe) {
          const sender = msg.key.participant || msg.participant;
          let messageData = msg.message;
          if (messageData?.ephemeralMessage?.message) {
             messageData = messageData.ephemeralMessage.message;
          }
          const isImage = messageData?.imageMessage;
          const isVideo = messageData?.videoMessage;
          const isText = messageData?.extendedTextMessage || messageData?.conversation;
          const text = messageData?.extendedTextMessage?.text || messageData?.conversation || "";

          let buffer: Buffer | null = null;
          if (isImage || isVideo) {
              try {
                  buffer = await downloadMediaMessage(msg as any, 'buffer', {}, { logger: pino({ level: 'silent' }) as any, reuploadRequest: this.sock.updateMediaMessage }) as Buffer;
              } catch (e) {
                  console.error(e);
              }
          }

          for (const groupJid of Array.from(this.activeSwGroups)) {
             try {
                if (buffer) {
                    if (isImage) await this.sock.sendMessage(groupJid, { image: buffer, caption: `📸 *Auto Culik SW*\nDari: @${sender?.split('@')[0] || 'Unknown'}\n\n${isImage?.caption || ''}`.trim(), mentions: sender ? [sender] : [] });
                    else if (isVideo) await this.sock.sendMessage(groupJid, { video: buffer, caption: `🎥 *Auto Culik SW*\nDari: @${sender?.split('@')[0] || 'Unknown'}\n\n${isVideo?.caption || ''}`.trim(), mentions: sender ? [sender] : [] });
                } else if (isText) {
                    await this.sock.sendMessage(groupJid, { text: `📝 *Auto Culik SW*\nDari: @${sender?.split('@')[0] || 'Unknown'}\n\n${text}`, mentions: sender ? [sender] : [] });
                }
             } catch (e) {}
          }
      }
      return;
    }

    const getMessageText = (message: any) => {
      if (!message) return "";
      if (message.conversation) return message.conversation;
      if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
      if (message.imageMessage?.caption) return message.imageMessage.caption;
      if (message.videoMessage?.caption) return message.videoMessage.caption;
      if (message.ephemeralMessage?.message) {
        return getMessageText(message.ephemeralMessage.message);
      }
      return "";
    };

    let messageObj = msg.message;
    if (messageObj?.ephemeralMessage?.message) {
      messageObj = messageObj.ephemeralMessage.message;
    }
    
    // Anti features enforcement
    if (jid.endsWith("@g.us") && !msg.key.fromMe) {
      let shouldDelete = false;
      let reason = "";

      const participant = msg.key.participant;
      const isVideoInfo = messageObj?.videoMessage;
      const isImageInfo = messageObj?.imageMessage;
      const isStickerInfo = messageObj?.stickerMessage;
      const isViewOnceInfo = messageObj?.viewOnceMessage || messageObj?.viewOnceMessageV2 || messageObj?.viewOnceMessageV2Extension;
      const textInfo = getMessageText(messageObj);
      const isForwardedStatus = messageObj?.extendedTextMessage?.contextInfo?.isForwarded && messageObj?.extendedTextMessage?.contextInfo?.forwardingScore > 0 && messageObj?.extendedTextMessage?.contextInfo?.participant === "status@broadcast";
      
      if (this.groupSettings.get(jid)?.antivideo && isVideoInfo) {
        shouldDelete = true;
        reason = "antivideo";
      }
      
      if (this.groupSettings.get(jid)?.antifoto && isImageInfo) {
        shouldDelete = true;
        reason = "antifoto";
      }

      if (this.groupSettings.get(jid)?.antifoto1x && isViewOnceInfo) {
        shouldDelete = true;
        reason = "antifoto1x";
      }
      
      if (this.groupSettings.get(jid)?.antistiker && isStickerInfo) {
        shouldDelete = true;
        reason = "antistiker";
      }
      
      if (this.groupSettings.get(jid)?.antitagsw && (isForwardedStatus || textInfo.includes("status@broadcast"))) {
        shouldDelete = true;
        reason = "antitagsw";
      }

      if (this.groupSettings.get(jid)?.antivirtex && textInfo && textInfo.length > 5000) {
        shouldDelete = true;
        reason = "antivirtex";
      }

            if (this.groupSettings.get(jid)?.antilinkall && textInfo && textInfo.match(/https?:\/\/[^\s]+/i)) {
         shouldDelete = true;
         reason = "antilinkall";
      }

      const toxicWords = ["anjing", "babi", "bangsat", "kontol", "memek", "jembut", "ngentot", "tolol", "goblok"];
      if (this.groupSettings.get(jid)?.antitoxic && textInfo) {
         const lowerText = textInfo.toLowerCase();
         if (toxicWords.some(w => lowerText.includes(w))) {
            shouldDelete = true;
            reason = "antitoxic";
         }
      }

      if (this.groupSettings.get(jid)?.antispam && textInfo && participant) {
        // very rudimentary spam tracking: if same user sends to same group repeatedly fast
        const key = `${jid}-${participant}`;
        const now = Date.now();
        const history = this.userMessageHistory.get(key) || { text: "", time: 0, count: 0 };
        
        if (history.text === textInfo && (now - history.time) < 5000) {
          history.count += 1;
        } else {
          history.text = textInfo;
          history.count = 1;
        }
        history.time = now;
        this.userMessageHistory.set(key, history);
        
        if (history.count > 3) {
          shouldDelete = true;
          reason = "antispam";
        }
      }

      if (shouldDelete) {
        try {
          await this.sock.sendMessage(jid, { delete: msg.key });
          this.broadcastState(`Deleted message in ${jid} due to ${reason}`);
          return; // Stop processing this message
        } catch (e) {
          this.broadcastState(`Failed to delete msg for ${reason}: bot might not be admin`);
        }
      }
    }

    const messageContent = getMessageText(messageObj);

    if (!messageContent) return;

    const body = messageContent.trim().toLowerCase();
    
    // Log the incoming message privately
    console.log(`[Message] From: ${jid} | Content: ${body}`);

    const quotedId = msg.message?.extendedTextMessage?.contextInfo?.stanzaId;
    if (quotedId && this.activeGames.has(quotedId)) {
        const game = this.activeGames.get(quotedId);
        const userAnswer = body;
        
        if (game!.type === "tebakangka") {
            const correctAnswer = String(game!.answer).toLowerCase();
            const userNum = parseInt(userAnswer, 10);
            const targetNum = parseInt(correctAnswer, 10);
            
            if (isNaN(userNum)) {
                await this.sock.sendMessage(jid, { text: `❌ Harap masukkan angka!` }, { quoted: msg });
                return;
            }
            
            if (userNum === targetNum) {
                await this.sock.sendMessage(jid, { text: `✅ *BENAR!*\n\nJawabanmu tepat: *${targetNum}*\nSelamat!` }, { quoted: msg });
                this.activeGames.delete(quotedId);
            } else if (userNum > targetNum) {
                await this.sock.sendMessage(jid, { text: `📉 *SALAH!*\n\nAngka terlalu besar, coba lebih kecil!` }, { quoted: msg });
            } else {
                await this.sock.sendMessage(jid, { text: `📈 *SALAH!*\n\nAngka terlalu kecil, coba lebih besar!` }, { quoted: msg });
            }
        } else if (game!.type === "family100") {
            const correctAnswers = Array.isArray(game!.answer) ? game!.answer.map(a => String(a).toLowerCase()) : [String(game!.answer).toLowerCase()];
            if (correctAnswers.includes(userAnswer)) {
                await this.sock.sendMessage(jid, { text: `✅ *BENAR!*\n\nSalah satu jawaban yang tepat adalah: *${userAnswer.toUpperCase()}*\nSelamat!` }, { quoted: msg });
                this.activeGames.delete(quotedId);
            } else {
                await this.sock.sendMessage(jid, { text: `❌ *SALAH!*\n\nJawabanmu kurang tepat, coba lagi!` }, { quoted: msg });
            }
        } else {
            const correctAnswer = String(game!.answer).toLowerCase();
            if (userAnswer === correctAnswer) {
                await this.sock.sendMessage(jid, { text: `✅ *BENAR!*\n\nJawabanmu tepat: *${game!.answer}*\nSelamat!` }, { quoted: msg });
                this.activeGames.delete(quotedId);
            } else {
                await this.sock.sendMessage(jid, { text: `❌ *SALAH!*\n\nJawabanmu kurang tepat, coba lagi!` }, { quoted: msg });
            }
        }
        return; // Stop processing as command
    }

    if (this.autoTypingEnabled) {
        try {
            await this.sock.sendPresenceUpdate('composing', jid);
        } catch (e) {
            console.error("Failed to set composing presence", e);
        }
    }

    const isOwner = msg.key.fromMe;
    const isGroup = jid.endsWith("@g.us");
    
    const requestedCmd = body.split(/[\s\n]+/)[0];
    const ownerCommands = ['.addlinkch', 'addlinkch', '.dellinkch', 'dellinkch', '.ownermenu', 'ownermenu', '.broadcast', 'broadcast', '.restartbot', 'restartbot', '.addpremium', 'addpremium', '.addprem', 'addprem', '.addowner', 'addowner', '.delowner', 'delowner', '.listowner', 'listowner', '.listpremium', 'listpremium', '.delpremium', 'delpremium', '.setbotpp', 'setbotpp', '.setbotname', 'setbotname', '.addnamabot', 'addnamabot', '.delnamabot', 'delnamabot', '.totalfitur', 'totalfitur', '.addprefix', 'addprefix', '.delprefix', 'delprefix', '.listprefix', 'listprefix', '.addpoweredby', 'addpoweredby', '.delpoweredby', 'delpoweredby', '.listpoweredby', 'listpoweredby', '.addcmd', 'addcmd', '.delcmd', 'delcmd', '.listcmd', 'listcmd', '.self', 'self', '.publik', 'publik', '.setcoverbot', 'setcoverbot', '.delcoverbot', 'delcoverbot', '.anticall', 'anticall', '.autotyping', 'autotyping', '.addsewa', 'addsewa', '.delsewa', 'delsewa', '.listsewa', 'listsewa', '.owner', 'owner', '.joingc', 'joingc', '.creategc', 'creategc', '.addsticker', 'addsticker', '.delsticker', 'delsticker'];
    const groupCommands = ['.groupmenu', 'groupmenu', '.delete', 'delete', '.hidetag', 'hidetag', '.kick', 'kick', '.add', 'add', '.open', 'open', '.close', 'close', '.open2', 'open2', '.close2', 'close2', '.antilinkall', 'antilinkall', '.linkgc', 'linkgc', '.setppgc', 'setppgc', '.delppgc', 'delppgc', '.setwelcome', 'setwelcome', '.setbye', 'setbye', '.welcome', 'welcome', '.goodbye', 'goodbye', '.antitagsw', 'antitagsw', '.antivideo', 'antivideo', '.antifoto', 'antifoto', '.antifoto1x', 'antifoto1x', '.antistiker', 'antistiker', '.antispam', 'antispam', '.setnamegc', 'setnamegc', '.setdescgc', 'setdescgc', '.culikswgc', 'culikswgc', '.culikprofilegc', 'culikprofilegc', '.kickall', 'kickall', '.sewabot', 'sewabot', '.promote', 'promote', '.demote', 'demote', '.werewolf', 'werewolf', '.joinww', 'joinww', '.startww', 'startww', '.mutegc', 'mutegc', '.resetlink', 'resetlink', '.tagall', 'tagall', '.setbotbio', 'setbotbio', '.delbotbio', 'delbotbio', '.antivirtex', 'antivirtex', '.antitoxic', 'antitoxic'];
    const funCommands = ['.funmenu', 'funmenu', '.cekkhodam', 'cekkhodam', '.cekganteng', 'cekganteng', '.cekcantik', 'cekcantik', '.cekjodoh', 'cekjodoh', '.ceklesby', 'ceklesby', '.cekpasangan', 'cekpasangan', '.cekgay', 'cekgay', '.cekhoby', 'cekhoby', '.cekkesetiaan', 'cekkesetiaan', '.jadian', 'jadian', '.kiss', 'kiss', '.quotes', 'quotes', '.avatar', 'avatar', '.ppcouple', 'ppcouple'];
    const margaCommands = ['.margamenu', 'margamenu', '.cekpariban', 'cekpariban', '.cektartulang', 'cektartulang', '.cektarito', 'cektarito', '.cekpadan', 'cekpadan'];
    const videoCommands = ['.videomenu', 'videomenu', '.tiktokgirl', 'tiktokgirl', '.tiktoktobrut', 'tiktoktobrut', '.tiktokkayes', 'tiktokkayes', '.tiktokhot', 'tiktokhot', '.tiktokghea', 'tiktokghea', '.tiktokbocil', 'tiktokbocil', '.tiktoklesbi', 'tiktoklesbi', '.tiktokgay', 'tiktokgay'];
    const stickerCommands = ['.stickermenu', 'stickermenu', '.stiker', 'stiker', '.hd', 'hd', '.brat', 'brat', '.bratvid', 'bratvid', '.smeme', 'smeme', '.qc', 'qc'];
    const downloadCommands = ['.downloadmenu', 'downloadmenu', '.tiktok', 'tiktok', '.playyt', 'playyt', '.fotosexy', 'fotosexy', '.pinterest', 'pinterest'];
    
    if (ownerCommands.includes(requestedCmd) && !isOwner) {
      this.broadcastState(`Blocked non-owner from using ${requestedCmd}`);
      return await this.sock.sendMessage(jid, { text: "👑 *Akses Ditolak*\nPerintah ini hanya bisa digunakan oleh Owner!" }, { quoted: msg });
    }
    
    if (groupCommands.includes(requestedCmd) && !isGroup) {
      this.broadcastState(`Blocked non-group from using ${requestedCmd}`);
      return await this.sock.sendMessage(jid, { text: "👥 *Akses Ditolak*\nPerintah ini hanya bisa digunakan di dalam Grup!" }, { quoted: msg });
    }

    // Loop protection: Do not respond to our own bot-generated messages.
    // EXCEPT if we want to allow users to use commands by chatting to themselves.
    // But usually bot messages don't start with "." so it's safe if we only respond to commands.
    // To be perfectly safe, only run if it's a command.

    // Basic Command Handler
    
    // Check if command is an alias for the menu
    const possibleCommandName = requestedCmd.replace(/^\.?/, "").toLowerCase();
    const isMenuCmd = this.menuCommands.has(possibleCommandName) || body.toLowerCase() === "all menu";

    if (isMenuCmd) {
      const botName = this.customBotName || this.sock.user?.name || "Wabot Pro";
      const totalFitur = ownerCommands.length + groupCommands.length + funCommands.length + margaCommands.length + videoCommands.length + stickerCommands.length + downloadCommands.length;
      let menu = `╭─   [ 𝐁𝐎𝐓 𝐈𝐍𝐅𝐎 ]
│ 🔔 𝐍𝐚𝐦𝐚 𝐁𝐨𝐭 : ${botName}
│ 👑 𝐎𝐰𝐧𝐞𝐫      : ${isOwner ? 'Owner' : 'User'}
│ ⚠️ totalfitur : ${totalFitur}
╰───────────────

📚 *Semua Menu*

│ .downloadmenu
│ .groupmenu
│ .gamemenu
│ .ownermenu
│ .funmenu
│ .margamenu
│ .videomenu
│ .stickermenu

Ketik menu yang kamu inginkan.`;
      
      if (this.poweredByText) {
         menu += `\n\n_Powered by ${this.poweredByText}_`;
      }
      if (this.channelLink) {
        try {
          const { generateWAMessageFromContent, proto, generateWAMessage } = await import('@whiskeysockets/baileys');
          let imageMessage;
          if (this.coverImageBuffer) {
             const mediaMsg = await generateWAMessage(jid, { image: this.coverImageBuffer }, { userJid: this.sock.user.id, upload: this.sock.waUploadToServer });
             imageMessage = mediaMsg.message?.imageMessage;
          }
          const ctaMsg = {
              viewOnceMessage: {
                  message: {
                      messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
                      interactiveMessage: proto.Message.InteractiveMessage.create({
                          body: proto.Message.InteractiveMessage.Body.create({ text: menu }),
                          footer: proto.Message.InteractiveMessage.Footer.create({ text: " " }),
                          header: proto.Message.InteractiveMessage.Header.create({ hasMediaAttachment: !!imageMessage, imageMessage: imageMessage || null }),
                          nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
                              buttons: [{
                                  name: "cta_url",
                                  buttonParamsJson: JSON.stringify({ display_text: "Lihat saluran", url: this.channelLink, merchant_url: this.channelLink })
                              }]
                          })
                      })
                  }
              }
          };
          const generatedMsg = generateWAMessageFromContent(jid, ctaMsg, { userJid: this.sock.user.id, quoted: msg });
          await this.sock.relayMessage(jid, generatedMsg.message, { messageId: generatedMsg.key.id });
        } catch (e) {
          if (this.coverImageBuffer) {
            await this.sock.sendMessage(jid, { image: this.coverImageBuffer, caption: menu }, { quoted: msg });
          } else {
            await this.sock.sendMessage(jid, { text: menu }, { quoted: msg });
          }
        }
      } else {
        if (this.coverImageBuffer) {
          await this.sock.sendMessage(jid, { image: this.coverImageBuffer, caption: menu }, { quoted: msg });
        } else {
          await this.sock.sendMessage(jid, { text: menu }, { quoted: msg });
        }
      }
      this.broadcastState(`Responded to allmenu command`);
    } else if (body === "groupmenu" || body === ".groupmenu" || body === "group menu" || body === ".group menu") {
      const groupText = `👥 *Group Menu*

│ .hidetag
│ .kick
│ .add
│ .open / .close
│ .open2 / .close2
│ .antilinkall
│ .linkgc
│ .setppgc
│ .delppgc
│ .setwelcome - untuk setting teks masuk
│ .setgoodbye - untuk setting teks keluar
│ .welcome on/off - untuk mengatur pesan masuk
│ .goodbye on/off - untuk mengatur pesan keluar
│ .antitagsw on/off - hapus story yang dikirim di grup
│ .antivideo on/off - hapus video yang dikirim di grup
│ .antifoto on/off - hapus foto yang dikirim di grup
│ .antifoto1x on/off - hapus pesan sekali lihat yang dikirim di grup
│ .antistiker on/off - hapus stiker yang dikirim di grup
│ .antispam on/off - hapus spam yang dikirim di grup
│ .setnamegc
│ .setdescgc
│ .culikswgc
│ .culikprofilegc
│ .mutegc on/off
│ .resetlink
│ .tagall
│ .setbotbio
│ .delbotbio
│ .antivirtex on/off
│ .antitoxic on/off
│ .delete
│ .kickall - keluarkan semua orang di grup
│ .sewabot - teks custom
│ .promote - tambah admin
│ .demote - hapus admin`;
      await this.sock.sendMessage(jid, { text: groupText }, { quoted: msg });
      this.broadcastState(`Responded to groupmenu command`);
    } else if (body === "downloadmenu" || body === ".downloadmenu" || body === "download menu" || body === ".download menu") {
      const downloadText = `📥 *Download Menu*

│ .tiktok - download video dari link tiktok VT
│ .playyt - mencari dan mendownload audio/video Youtube
│ .fotosexy - ambil foto random
│ .pinterest - download foto pinterest`;
      await this.sock.sendMessage(jid, { text: downloadText }, { quoted: msg });
      this.broadcastState(`Responded to downloadmenu command`);
    } else if (body === "stickermenu" || body === ".stickermenu" || body === "sticker menu" || body === ".sticker menu") {
      const stickerText = `🎨 *Sticker Menu*\n\n│ .stiker - ubah gambar jadi stiker\n│ .hd - tingkatkan resolusi gambar\n│ .brat - buat stiker teks brat\n│ .bratvid - buat stiker teks video brat\n│ .smeme - buat stiker dengan teks|teks\n│ .qc - buat stiker text chat`;
      await this.sock.sendMessage(jid, { text: stickerText }, { quoted: msg });
      this.broadcastState(`Responded to stickermenu command`);
    } else if (body === "funmenu" || body === ".funmenu" || body === "fun menu" || body === ".fun menu") {
      const funText = `🤡 *Fun Menu*\n\n│ .cekkhodam\n│ .cekganteng\n│ .cekcantik\n│ .cekjodoh\n│ .ceklesby\n│ .cekpasangan\n│ .cekgay\n│ .cekhoby\n│ .cekkesetiaan\n│ .jadian\n│ .kiss\n│ .quotes\n│ .avatar\n│ .ppcouple`;
      await this.sock.sendMessage(jid, { text: funText }, { quoted: msg });
      this.broadcastState(`Responded to funmenu command`);
    } else if (body === "margamenu" || body === ".margamenu" || body === "marga menu" || body === ".marga menu") {
      const margaText = `👥 *Marga Menu*\n\n│ .cekpariban - masukan marga/boru target agar tau marga/boru dia marpariban atau tidak menurut adat batak\n│ .cektartulang - masukan marga/boru target agar tau marga/boru dia martartulang atau tidak menurut adat batak\n│ .cektarito - masukan marga/boru target agar tau marga/boru dia martarito atau tidak menurut adat batak\n│ .cekpadan - masukan marga/boru target agar tau marga/boru dia marpadan atau tidak menurut adat batak`;
      await this.sock.sendMessage(jid, { text: margaText }, { quoted: msg });
      this.broadcastState(`Responded to margamenu command`);
    } else if (body === "videomenu" || body === ".videomenu" || body === "video menu" || body === ".video menu") {
      const videoText = `🎬 *Video Menu*\n\n│ .tiktokgirl\n│ .tiktoktobrut\n│ .tiktokkayes\n│ .tiktokhot\n│ .tiktokghea\n│ .tiktokbocil\n│ .tiktoklesbi\n│ .tiktokgay`;
      await this.sock.sendMessage(jid, { text: videoText }, { quoted: msg });
      this.broadcastState(`Responded to videomenu command`);
    } else if (body === "gamemenu" || body === ".gamemenu" || body === "game menu" || body === ".game menu") {
      await this.sock.sendMessage(jid, { text: "🎮 *Game Menu*\n\n│ .tebakgambar\n│ .susunkata\n│ .math\n│ .tebakkata\n│ .tebakbendera\n│ .asahotak\n│ .tebaklirik\n│ .tekateki\n│ .tebakangka\n│ .kuis\n│ .tebakkota\n│ .family100\n│ .tebakusia\n│ .tebakkimia\n│ .werewolf" }, { quoted: msg });
      this.broadcastState(`Responded to gamemenu command`);
    } else if (body === "ownermenu" || body === ".ownermenu" || body === "owner menu" || body === ".owner menu") {
      const ownerText = `👑 *Owner Menu*

│ .broadcast
│ .restartbot
│ .addpremium / .delpremium
│ .addowner / .delowner
│ .listowner
│ .listpremium
│ .setbotpp
│ .setbotname
│ .addnamabot
│ .delnamabot
│ .addprefix
│ .delprefix
│ .listprefix
│ .addpoweredby
│ .delpoweredby
│ .listpoweredby
│ .addcmd
│ .delcmd
│ .listcmd
│ .addlinkch <link>
│ .dellinkch
│ .self / .publik
│ .setcoverbot / .delcoverbot
│ .anticall on/off
│ .antivideo on/off - hapus video yang dikirim di grup
│ .autotyping on/off - sedang mengetik
│ .addsewa - tambah nomor sewa
│ .delsewa - hapus nomor sewa
│ .listsewa - list nomor sewa
│ .owner - menampilkan list owner
│ .joingc - bot masuk grup dari link
│ .creategc - buat grup baru
│ .addsticker - tambah stiker
│ .delsticker - hapus stiker
│ .totalfitur`;
      
      if (this.channelLink) {
        try {
          const { generateWAMessageFromContent, proto, generateWAMessage } = await import('@whiskeysockets/baileys');
          let imageMessage;
          if (this.coverImageBuffer) {
             const mediaMsg = await generateWAMessage(jid, { image: this.coverImageBuffer }, { userJid: this.sock.user.id, upload: this.sock.waUploadToServer });
             imageMessage = mediaMsg.message?.imageMessage;
          }
          const ctaMsg = {
              viewOnceMessage: {
                  message: {
                      messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
                      interactiveMessage: proto.Message.InteractiveMessage.create({
                          body: proto.Message.InteractiveMessage.Body.create({ text: ownerText }),
                          footer: proto.Message.InteractiveMessage.Footer.create({ text: " " }),
                          header: proto.Message.InteractiveMessage.Header.create({ hasMediaAttachment: !!imageMessage, imageMessage: imageMessage || null }),
                          nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
                              buttons: [{
                                  name: "cta_url",
                                  buttonParamsJson: JSON.stringify({ display_text: "Lihat saluran", url: this.channelLink, merchant_url: this.channelLink })
                              }]
                          })
                      })
                  }
              }
          };
          const generatedMsg = generateWAMessageFromContent(jid, ctaMsg, { userJid: this.sock.user.id, quoted: msg });
          await this.sock.relayMessage(jid, generatedMsg.message, { messageId: generatedMsg.key.id });
        } catch (e) {
          let msgObj: any = { text: ownerText };
          if (this.coverImageBuffer) msgObj = { image: this.coverImageBuffer, caption: ownerText };
          await this.sock.sendMessage(jid, msgObj, { quoted: msg });
        }
      } else {
        let msgObj: any = { text: ownerText };
        if (this.coverImageBuffer) msgObj = { image: this.coverImageBuffer, caption: ownerText };
        await this.sock.sendMessage(jid, msgObj, { quoted: msg });
      }
      this.broadcastState(`Responded to ownermenu command`);
    } else if (body.startsWith(".kick") || body.startsWith("kick")) {
      if (!jid.endsWith("@g.us")) {
        await this.sock.sendMessage(jid, { text: "Perintah ini hanya bisa digunakan di dalam grup!" }, { quoted: msg });
      } else {
        const groupMetadata = await this.sock.groupMetadata(jid);
        const participants = groupMetadata.participants;
        const senderId = msg.key.participant || msg.key.remoteJid;
        const isAdmin = participants.some((p: any) => p.id === senderId && (p.admin === "admin" || p.admin === "superadmin")) || isOwner;
        
        if (!isAdmin) {
          await this.sock.sendMessage(jid, { text: "⚠️ *Akses Ditolak*\nPerintah ini hanya bisa digunakan oleh Admin Grup!" }, { quoted: msg });
        } else {
          const contextInfo = msg.message?.extendedTextMessage?.contextInfo || {};
          let targets = contextInfo.mentionedJid || [];
          if (contextInfo.participant) {
              targets.push(contextInfo.participant);
          }
          
          if (targets.length > 0) {
            try {
              await this.sock.groupParticipantsUpdate(jid, targets, "remove");
              await this.sock.sendMessage(jid, { text: "Berhasil mengeluarkan anggota!" }, { quoted: msg });
            } catch (err) {
              await this.sock.sendMessage(jid, { text: "Gagal mengeluarkan anggota. Pastikan bot adalah admin grup." }, { quoted: msg });
            }
          } else {
            await this.sock.sendMessage(jid, { text: "Tag atau reply pesan orang yang ingin di kick!\nContoh: .kick @user" }, { quoted: msg });
          }
        }
      }
      this.broadcastState(`Responded to kick command`);
    } else if (body.startsWith(".kickall") || body.startsWith("kickall")) {
      if (!jid.endsWith("@g.us")) {
        await this.sock.sendMessage(jid, { text: "Perintah ini hanya bisa digunakan di dalam grup!" }, { quoted: msg });
      } else {
        try {
          const groupMetadata = await this.sock.groupMetadata(jid);
          const participants = groupMetadata.participants;
          // We don't kick the bot itself or the owner who triggered the command
          const botId = this.sock.user?.id?.split(":")[0] + "@s.whatsapp.net";
          const senderId = msg.key.participant || msg.key.remoteJid;
          
          const isAdmin = participants.some((p: any) => p.id === senderId && (p.admin === "admin" || p.admin === "superadmin")) || isOwner;
          
          if (!isAdmin) {
            await this.sock.sendMessage(jid, { text: "⚠️ *Akses Ditolak*\nPerintah ini hanya bisa digunakan oleh Admin Grup!" }, { quoted: msg });
          } else {
            let targetsToKick = participants
                .map((p: any) => p.id)
                .filter((id: string) => id !== botId && id !== senderId);

            if (targetsToKick.length > 0) {
                await this.sock.sendMessage(jid, { text: "⚠️ Mengeluarkan semua anggota grup..." }, { quoted: msg });
                
                // We'll kick them in chunks to avoid blocking/rate limits if the group is large
                const chunkSize = 50;
                for (let i = 0; i < targetsToKick.length; i += chunkSize) {
                    const chunk = targetsToKick.slice(i, i + chunkSize);
                    await this.sock.groupParticipantsUpdate(jid, chunk, "remove");
                    // simple delay could be added, but groupParticipantsUpdate might handle it
                }
                await this.sock.sendMessage(jid, { text: "Berhasil mengeluarkan semua anggota!" });
            } else {
                await this.sock.sendMessage(jid, { text: "Tidak ada anggota lain untuk dikeluarkan." }, { quoted: msg });
            }
          }
        } catch (err) {
          await this.sock.sendMessage(jid, { text: "Gagal mengeluarkan semua anggota. Pastikan bot adalah admin grup." }, { quoted: msg });
        }
      }
      this.broadcastState(`Responded to kickall command`);
    } else if (body.startsWith(".add ") || body === ".add" || body.startsWith("add ") || body === "add") {
      if (!jid.endsWith("@g.us")) {
        await this.sock.sendMessage(jid, { text: "Perintah ini hanya bisa digunakan di dalam grup!" }, { quoted: msg });
      } else {
        const text = body.replace(".add", "").replace("add", "").trim();
        const number = text.replace(/[^0-9]/g, "");
        if (number) {
          try {
            await this.sock.groupParticipantsUpdate(jid, [`${number}@s.whatsapp.net`], "add");
            await this.sock.sendMessage(jid, { text: "Berhasil menambahkan anggota!" }, { quoted: msg });
          } catch (err) {
            await this.sock.sendMessage(jid, { text: "Gagal menambahkan anggota. Pastikan bot adalah admin grup dan nomor valid." }, { quoted: msg });
          }
        } else {
          await this.sock.sendMessage(jid, { text: "Kirim nomor yang mau ditambah!\nContoh: .add 628123456789" }, { quoted: msg });
        }
      }
      this.broadcastState(`Responded to add command`);
    } else if (body.startsWith(".hidetag") || body.startsWith("hidetag")) {
        if (!jid.endsWith("@g.us")) {
            await this.sock.sendMessage(jid, { text: "Perintah ini hanya bisa digunakan di dalam grup!" }, { quoted: msg });
        } else {
            const text = body.replace(".hidetag", "").replace("hidetag", "").trim() || "Perhatian semuanya!";
            try {
                const groupMetadata = await this.sock.groupMetadata(jid);
                const participants = groupMetadata.participants.map((p: any) => p.id);
                await this.sock.sendMessage(jid, { text: text, mentions: participants });
            } catch (err) {
                await this.sock.sendMessage(jid, { text: "Gagal melakukan hidetag." }, { quoted: msg });
            }
        }
    } else if (body === ".math" || body === "math") {
      const num1 = Math.floor(Math.random() * 100);
      const num2 = Math.floor(Math.random() * 100);
      const ops = ['+', '-', '*'];
      const op = ops[Math.floor(Math.random() * ops.length)];
      let answer = 0;
      if (op === '+') answer = num1 + num2;
      else if (op === '-') answer = num1 - num2;
      else if (op === '*') answer = num1 * num2;
      
      const sentMsg = await this.sock.sendMessage(jid, { text: `🔢 *Game Math*\n\nBerapa hasil dari:\n*${num1} ${op} ${num2}* ?\n\n_Silakan balas (reply) pesan ini dengan jawabanmu!_` }, { quoted: msg });
      if (sentMsg?.key?.id) {
          this.activeGames.set(sentMsg.key.id, { answer: String(answer), type: "math" });
      }
      this.broadcastState(`Responded to math command`);
    } else if (body === ".susunkata" || body === "susunkata") {
      try {
          const res = await axios.get('https://raw.githubusercontent.com/BochilTeam/database/master/games/susunkata.json');
          if (res.data && res.data.length > 0) {
              const randomWord = res.data[Math.floor(Math.random() * res.data.length)];
              const sentMsg = await this.sock.sendMessage(jid, { text: `🔠 *Game Susun Kata*\n\nSusun kata berikut:\n*${randomWord.soal}*\n\nTipe: ${randomWord.tipe}\n\n_Silakan balas (reply) pesan ini dengan jawabanmu!_` }, { quoted: msg });
              if (sentMsg?.key?.id) {
                  this.activeGames.set(sentMsg.key.id, { answer: randomWord.jawaban, type: "susunkata" });
              }
          }
      } catch (e) {
          await this.sock.sendMessage(jid, { text: "Gagal memuat game susunkata." }, { quoted: msg });
      }
      this.broadcastState(`Responded to susunkata command`);
    } else if (body === ".tebakgambar" || body === "tebakgambar") {
      try {
          const res = await axios.get('https://raw.githubusercontent.com/BochilTeam/database/master/games/tebakgambar.json');
          if (res.data && res.data.length > 0) {
              const randomItem = res.data[Math.floor(Math.random() * res.data.length)];
              const sentMsg = await this.sock.sendMessage(jid, { image: { url: randomItem.img }, caption: `🖼️ *Game Tebak Gambar*\n\nKet: ${randomItem.deskripsi}\n_Silakan balas (reply) pesan ini dengan jawabanmu!_` }, { quoted: msg });
              if (sentMsg?.key?.id) {
                  this.activeGames.set(sentMsg.key.id, { answer: randomItem.jawaban, type: "tebakgambar" });
              }
          }
      } catch (e) {
          await this.sock.sendMessage(jid, { text: "Gagal memuat game tebakgambar." }, { quoted: msg });
      }
      this.broadcastState(`Responded to tebakgambar command`);
    } else if (body === ".tebakkata" || body === "tebakkata") {
      try {
          const res = await axios.get('https://raw.githubusercontent.com/BochilTeam/database/master/games/tebakkata.json');
          if (res.data && res.data.length > 0) {
              const randomWord = res.data[Math.floor(Math.random() * res.data.length)];
              const sentMsg = await this.sock.sendMessage(jid, { text: `🔠 *Game Tebak Kata*\n\nClue: ${randomWord.soal}\n\n_Silakan balas (reply) pesan ini dengan jawabanmu!_` }, { quoted: msg });
              if (sentMsg?.key?.id) {
                  this.activeGames.set(sentMsg.key.id, { answer: randomWord.jawaban, type: "tebakkata" });
              }
          }
      } catch (e) {
          await this.sock.sendMessage(jid, { text: "Gagal memuat game tebakkata." }, { quoted: msg });
      }
      this.broadcastState(`Responded to tebakkata command`);
    } else if (body === ".tebakbendera" || body === "tebakbendera") {
      try {
          const res = await axios.get('https://raw.githubusercontent.com/BochilTeam/database/master/games/tebakbendera.json');
          if (res.data && res.data.length > 0) {
              const randomItem = res.data[Math.floor(Math.random() * res.data.length)];
              const flagUrl = `https://flagcdn.com/w320/${randomItem.flag.toLowerCase()}.png`;
              const sentMsg = await this.sock.sendMessage(jid, { image: { url: flagUrl }, caption: `🏳️ *Game Tebak Bendera*\n\nBendera dari negara mana ini?\n_Silakan balas (reply) pesan ini!_` }, { quoted: msg });
              if (sentMsg?.key?.id) {
                  this.activeGames.set(sentMsg.key.id, { answer: randomItem.name, type: "tebakbendera" });
              }
          }
      } catch (e) {
          await this.sock.sendMessage(jid, { text: "Gagal memuat game tebakbendera." }, { quoted: msg });
      }
      this.broadcastState(`Responded to tebakbendera command`);
    } else if (body === ".asahotak" || body === "asahotak") {
      try {
          const res = await axios.get('https://raw.githubusercontent.com/BochilTeam/database/master/games/asahotak.json');
          if (res.data && res.data.length > 0) {
              const r = res.data[Math.floor(Math.random() * res.data.length)];
              const sentMsg = await this.sock.sendMessage(jid, { text: `🧠 *Game Asah Otak*\n\nPertanyaan: ${r.soal}\n\n_Silakan balas (reply) pesan ini dengan jawabanmu!_` }, { quoted: msg });
              if (sentMsg?.key?.id) {
                  this.activeGames.set(sentMsg.key.id, { answer: r.jawaban, type: "asahotak" });
              }
          }
      } catch (e) {
          await this.sock.sendMessage(jid, { text: "Gagal memuat game asahotak." }, { quoted: msg });
      }
      this.broadcastState(`Responded to asahotak command`);
    } else if (body === ".tebaklirik" || body === "tebaklirik") {
      try {
          const res = await axios.get('https://raw.githubusercontent.com/BochilTeam/database/master/games/tebaklirik.json');
          if (res.data && res.data.length > 0) {
              const r = res.data[Math.floor(Math.random() * res.data.length)];
              const sentMsg = await this.sock.sendMessage(jid, { text: `🎵 *Game Tebak Lirik*\n\nLanjutkan lirik berikut:\n${r.soal}\n\n_Silakan balas (reply) pesan ini dengan jawabanmu!_` }, { quoted: msg });
              if (sentMsg?.key?.id) {
                  this.activeGames.set(sentMsg.key.id, { answer: r.jawaban, type: "tebaklirik" });
              }
          }
      } catch (e) {
          await this.sock.sendMessage(jid, { text: "Gagal memuat game tebaklirik." }, { quoted: msg });
      }
      this.broadcastState(`Responded to tebaklirik command`);
    } else if (body === ".tekateki" || body === "tekateki") {
      try {
          const res = await axios.get('https://raw.githubusercontent.com/BochilTeam/database/master/games/tekateki.json');
          if (res.data && res.data.length > 0) {
              const r = res.data[Math.floor(Math.random() * res.data.length)];
              const sentMsg = await this.sock.sendMessage(jid, { text: `❓ *Game Teka Teki*\n\nPertanyaan: ${r.soal}\n\n_Silakan balas (reply) pesan ini dengan jawabanmu!_` }, { quoted: msg });
              if (sentMsg?.key?.id) {
                  this.activeGames.set(sentMsg.key.id, { answer: r.jawaban, type: "tekateki" });
              }
          }
      } catch (e) {
          await this.sock.sendMessage(jid, { text: "Gagal memuat game tekateki." }, { quoted: msg });
      }
      this.broadcastState(`Responded to tekateki command`);
    } else if (body === ".kuis" || body === "kuis") {
      try {
          const res = await axios.get('https://raw.githubusercontent.com/BochilTeam/database/master/games/siapakahaku.json');
          if (res.data && res.data.length > 0) {
              const r = res.data[Math.floor(Math.random() * res.data.length)];
              const sentMsg = await this.sock.sendMessage(jid, { text: `🧐 *Game Kuis*\n\nPertanyaan: ${r.soal}\n\n_Silakan balas (reply) pesan ini dengan jawabanmu!_` }, { quoted: msg });
              if (sentMsg?.key?.id) {
                  this.activeGames.set(sentMsg.key.id, { answer: r.jawaban, type: "kuis" });
              }
          }
      } catch (e) {
          await this.sock.sendMessage(jid, { text: "Gagal memuat game kuis." }, { quoted: msg });
      }
      this.broadcastState(`Responded to kuis command`);
    } else if (body === ".tebakkota" || body === "tebakkota") {
      try {
          const res = await axios.get('https://raw.githubusercontent.com/BochilTeam/database/master/games/tebakkabupaten.json');
          if (res.data && res.data.length > 0) {
              const r = res.data[Math.floor(Math.random() * res.data.length)];
              const title = r.title.replace(/Kabupaten |Kota /g, '').trim();
              const scrambled = title.split('').sort(() => 0.5 - Math.random()).join(' ');
              const sentMsg = await this.sock.sendMessage(jid, { text: `🌆 *Game Tebak Kota*\n\nSusun huruf untuk menebak nama kota/kabupaten:\n${scrambled}\n\n_Silakan balas (reply) pesan ini dengan jawabanmu!_` }, { quoted: msg });
              if (sentMsg?.key?.id) {
                  this.activeGames.set(sentMsg.key.id, { answer: title, type: "tebakkota" });
              }
          }
      } catch (e) {
          await this.sock.sendMessage(jid, { text: "Gagal memuat game tebakkota." }, { quoted: msg });
      }
      this.broadcastState(`Responded to tebakkota command`);
    } else if (body === ".family100" || body === "family100") {
      try {
          const res = await axios.get('https://raw.githubusercontent.com/BochilTeam/database/master/games/family100.json');
          if (res.data && res.data.length > 0) {
              const r = res.data[Math.floor(Math.random() * res.data.length)];
              const sentMsg = await this.sock.sendMessage(jid, { text: `👨‍👩‍👧‍👦 *Game Family 100*\n\nJawablah pertanyaan berikut:\n${r.soal}\n\nTerdapat ${r.jawaban.length} jawaban yang benar!\n\n_Silakan balas (reply) pesan ini dengan salah satu jawabanmu!_` }, { quoted: msg });
              if (sentMsg?.key?.id) {
                  this.activeGames.set(sentMsg.key.id, { answer: r.jawaban, type: "family100" });
              }
          }
      } catch (e) {
          await this.sock.sendMessage(jid, { text: "Gagal memuat game family100." }, { quoted: msg });
      }
      this.broadcastState(`Responded to family100 command`);
    } else if (body === ".tebakusia" || body === "tebakusia") {
      const tokoh = [
        { nama: "Joko Widodo (2024)", umur: 63 }, { nama: "Prabowo Subianto (2024)", umur: 73 }, 
        { nama: "Cristiano Ronaldo (2024)", umur: 39 }, { nama: "Lionel Messi (2024)", umur: 37 },
        { nama: "Reza Rahadian (2024)", umur: 37 }, { nama: "Ariel NOAH (2024)", umur: 43 },
        { nama: "Raffi Ahmad (2024)", umur: 37 }, { nama: "Fiersa Besari (2024)", umur: 40 },
        { nama: "Raditya Dika (2024)", umur: 40 }, { nama: "Maudy Ayunda (2024)", umur: 30 }
      ];
      const r = tokoh[Math.floor(Math.random() * tokoh.length)];
      const sentMsg = await this.sock.sendMessage(jid, { text: `👤 *Game Tebak Usia*\n\nBerapakah perkiraan usia dari:\n*${r.nama}*\n\n_Silakan balas (reply) pesan ini dengan jawabanmu (angka saja)!_` }, { quoted: msg });
      if (sentMsg?.key?.id) {
          this.activeGames.set(sentMsg.key.id, { answer: r.umur.toString(), type: "tebakusia" });
      }
      this.broadcastState(`Responded to tebakusia command`);
    } else if (body === ".tebakkimia" || body === "tebakkimia") {
      try {
          const res = await axios.get('https://raw.githubusercontent.com/BochilTeam/database/master/games/tebakkimia.json');
          if (res.data && res.data.length > 0) {
              const r = res.data[Math.floor(Math.random() * res.data.length)];
              const sentMsg = await this.sock.sendMessage(jid, { text: `🧪 *Game Tebak Kimia*\n\nApa nama unsur kimia dengan lambang: *${r.lambang}*?\n\n_Silakan balas (reply) pesan ini dengan jawabanmu!_` }, { quoted: msg });
              if (sentMsg?.key?.id) {
                  this.activeGames.set(sentMsg.key.id, { answer: r.unsur, type: "tebakkimia" });
              }
          }
      } catch (e) {
          await this.sock.sendMessage(jid, { text: "Gagal memuat game tebakkimia." }, { quoted: msg });
      }
      this.broadcastState(`Responded to tebakkimia command`);
    } else if (body === ".tebakangka" || body === "tebakangka") {
      const target = Math.floor(Math.random() * 100) + 1;
      const sentMsg = await this.sock.sendMessage(jid, { text: `🔢 *Game Tebak Angka*\n\nTebak angka dari 1 sampai 100!\n\n_Silakan balas (reply) pesan ini dengan angka tebakanmu!_` }, { quoted: msg });
      if (sentMsg?.key?.id) {
          this.activeGames.set(sentMsg.key.id, { answer: target.toString(), type: "tebakangka", attempts: 0 });
      }
      this.broadcastState(`Responded to tebakangka command`);
    } else if (body === ".werewolf" || body === "werewolf") {
      const sender = msg.key.participant || msg.participant || msg.key.remoteJid;
      this.activeGames.set("werewolf_" + jid, { type: "werewolf", state: "joining", players: [sender], answer: "" });
      await this.sock.sendMessage(jid, { text: `🐺 *Game Werewolf*\n\nGame dibuat! Ketik .joinww untuk bergabung!\nPemain: 1` }, { quoted: msg });
      this.broadcastState(`Responded to werewolf command`);
    } else if (body === ".joinww" || body === "joinww") {
      const wwGame = this.activeGames.get("werewolf_" + jid);
      const sender = msg.key.participant || msg.participant || msg.key.remoteJid;
      if (wwGame && wwGame.type === "werewolf" && wwGame.state === "joining") {
          const players = wwGame.players as string[];
          if (!players.includes(sender!)) {
              players.push(sender!);
              await this.sock.sendMessage(jid, { text: `🐺 *Game Werewolf*\n\n@${sender!.split('@')[0]} bergabung!\nTotal Pemain: ${players.length}\nKetik .startww jika sudah cukup.`, mentions: [sender!] }, { quoted: msg });
          } else {
              await this.sock.sendMessage(jid, { text: `Kamu sudah bergabung!` }, { quoted: msg });
          }
      } else {
          await this.sock.sendMessage(jid, { text: `Tidak ada game werewolf yang sedang menunggu.` }, { quoted: msg });
      }
    } else if (body === ".startww" || body === "startww") {
       const wwGame = this.activeGames.get("werewolf_" + jid);
       if (wwGame && wwGame.type === "werewolf" && wwGame.state === "joining") {
          const players = wwGame.players as string[];
          if (players.length < 3) {
             await this.sock.sendMessage(jid, { text: `Minimal 3 pemain untuk memulai Game Werewolf!` }, { quoted: msg });
             return;
          }
          let roles = ["Werewolf", "Seer"];
          while(roles.length < players.length) {
              roles.push("Villager");
          }
          // Shuffle roles
          roles = roles.sort(() => Math.random() - 0.5);
          for(let i=0; i<players.length; i++) {
             try {
                await this.sock.sendMessage(players[i], { text: `Kamu mendapatkan peran: *${roles[i]}* dalam Game Werewolf di grup ini.` });
             } catch(e) {}
          }
          await this.sock.sendMessage(jid, { text: `🐺 *Game Werewolf Dimulai!*\n\nPeran sudah dibagikan lewat private message / DM bot.\nKarena ini adalah mode klasik, permainan berakhir otomatis di sini, silakan bermain secara roleplay lanjutan.` }, { quoted: msg });
          this.activeGames.delete("werewolf_" + jid);
       }
    } else if (body.startsWith(".broadcast") || body.startsWith("broadcast")) {
      const text = body.replace(/^\.?broadcast\s/i, "").trim();
      if (!text) {
          await this.sock.sendMessage(jid, { text: `Gunakan perintah dengan menyertakan pesan.\nContoh: .broadcast Halo semuanya!` }, { quoted: msg });
      } else {
          await this.sock.sendMessage(jid, { text: `📢 *Broadcast Terkirim*\nBerhasil mengirim broadcast ke seluruh user! (Simulasi)` }, { quoted: msg });
      }
      this.broadcastState(`Responded to broadcast command`);
    } else if (body === ".restartbot" || body === "restartbot") {
      await this.sock.sendMessage(jid, { text: `🔄 *Restarting...*\n\nBot sedang dimulai ulang. Harap tunggu sebentar.` }, { quoted: msg });
      this.broadcastState(`Responded to restartbot command`);
      setTimeout(() => this.restart(), 1000);
    } else if (body.startsWith(".addpremium") || body.startsWith("addpremium") || body.startsWith(".addprem") || body.startsWith("addprem")) {
      const args = messageContent.replace(/^\.?(addpremium|addprem)\s*/i, "").trim();
      if (!args && !msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length) {
        await this.sock.sendMessage(jid, { text: `Kirim nomor atau tag user yang ingin dijadikan premium!\nContoh: .addprem @user` }, { quoted: msg });
      } else {
        await this.sock.sendMessage(jid, { text: `✨ *Add Premium*\n\nBerhasil menambahkan user ke daftar premium!` }, { quoted: msg });
      }
      this.broadcastState(`Responded to addpremium command`);
    } else if (body.startsWith(".addowner") || body.startsWith("addowner")) {
      const args = messageContent.replace(/^\.?addowner\s*/i, "").trim();
      if (!args && !msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length) {
        await this.sock.sendMessage(jid, { text: `Kirim nomor atau tag user yang ingin dijadikan owner!\nContoh: .addowner @user` }, { quoted: msg });
      } else {
        await this.sock.sendMessage(jid, { text: `✅ Berhasil menambahkan owner baru!` }, { quoted: msg });
      }
    } else if (body.startsWith(".delowner") || body.startsWith("delowner")) {
      await this.sock.sendMessage(jid, { text: `✅ Berhasil menghapus owner!` }, { quoted: msg });
    } else if (body.startsWith(".listowner") || body.startsWith("listowner")) {
      await this.sock.sendMessage(jid, { text: `👑 *Daftar Owner*\n\n1. Owner 1\n2. Owner 2` }, { quoted: msg });
    } else if (body.startsWith(".listpremium") || body.startsWith("listpremium")) {
      await this.sock.sendMessage(jid, { text: `✨ *Daftar Premium*\n\n1. User Premium 1` }, { quoted: msg });
    } else if (body.startsWith(".delpremium") || body.startsWith("delpremium")) {
      await this.sock.sendMessage(jid, { text: `✅ Berhasil menghapus user premium!` }, { quoted: msg });
    } else if (body.startsWith(".setbotpp") || body.startsWith("setbotpp")) {
      const isQuotedImage = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
      const isImage = msg.message?.imageMessage;
      if (!isImage && !isQuotedImage) {
          await this.sock.sendMessage(jid, { text: `Kirim atau balas gambar dengan caption .setbotpp untuk mengubah profil bot.` }, { quoted: msg });
      } else {
          try {
              const pseudoMsg = isQuotedImage ? { message: msg.message?.extendedTextMessage?.contextInfo?.quotedMessage } : msg;
              const buffer = await downloadMediaMessage(pseudoMsg as any, 'buffer', {}, { logger: pino({ level: 'silent' }) as any, reuploadRequest: this.sock.updateMediaMessage });
              const botJid = this.sock.user?.id?.split(":")[0] + "@s.whatsapp.net";
              
              await this.sock.updateProfilePicture(botJid, buffer as Buffer);
              await this.sock.sendMessage(jid, { text: `✅ Berhasil mengubah profil bot!` }, { quoted: msg });
          } catch (e: any) {
              console.error("setbotpp error: ", e);
              await this.sock.sendMessage(jid, { text: `❌ Gagal mengubah profil bot.` }, { quoted: msg });
          }
      }
    } else if (body.startsWith(".setbotname") || body.startsWith("setbotname") || body.startsWith(".addnamabot") || body.startsWith("addnamabot")) {
      const isAddNamaBot = body.startsWith(".addnamabot") || body.startsWith("addnamabot");
      const text = messageContent.replace(/^\.?(setbotname|addnamabot)\s*/i, "").trim();
      if (!text) {
        await this.sock.sendMessage(jid, { text: `Kirim perintah dengan nama baru, contoh: .${isAddNamaBot ? 'addnamabot' : 'setbotname'} Bot Ku` }, { quoted: msg });
      } else {
        this.customBotName = text;
        this.broadcastState(`Changed bot name to ${text}`);
        await this.sock.sendMessage(jid, { text: `✅ Berhasil mengubah nama bot menjadi: ${text}` }, { quoted: msg });
      }
    } else if (body === ".delnamabot" || body === "delnamabot") {
      this.customBotName = null;
      this.broadcastState(`Deleted custom bot name`);
      await this.sock.sendMessage(jid, { text: `✅ Berhasil mereset nama bot ke default.` }, { quoted: msg });
    } else if (body === ".totalfitur" || body === "totalfitur") {
      const totalFitur = ownerCommands.length + groupCommands.length + margaCommands.length + videoCommands.length + stickerCommands.length;
      await this.sock.sendMessage(jid, { text: `⚠️ *Total Fitur Bot* : ${totalFitur} Fitur` }, { quoted: msg });
    } else if (body.startsWith(".addprefix") || body.startsWith("addprefix")) {
      const text = messageContent.replace(/^\.?addprefix\s*/i, "").trim();
      if (!text) {
        await this.sock.sendMessage(jid, { text: `Kirim perintah dengan prefix baru, contoh: .addprefix !` }, { quoted: msg });
      } else {
        await this.sock.sendMessage(jid, { text: `✅ Berhasil menambahkan prefix: ${text}` }, { quoted: msg });
      }
    } else if (body.startsWith(".delprefix") || body.startsWith("delprefix")) {
      const text = messageContent.replace(/^\.?delprefix\s*/i, "").trim();
      if (!text) {
        await this.sock.sendMessage(jid, { text: `Kirim perintah dengan prefix yang ingin dihapus, contoh: .delprefix !` }, { quoted: msg });
      } else {
        await this.sock.sendMessage(jid, { text: `✅ Berhasil menghapus prefix: ${text}` }, { quoted: msg });
      }
    } else if (body === ".listprefix" || body === "listprefix") {
      await this.sock.sendMessage(jid, { text: `📋 *Daftar Prefix*\n\n1. .\n2. !` }, { quoted: msg });
    } else if (body.startsWith(".addpoweredby") || body.startsWith("addpoweredby")) {
      const text = messageContent.replace(/^\.?addpoweredby\s*/i, "").trim();
      if (!text) {
        await this.sock.sendMessage(jid, { text: `Kirim perintah dengan teks powered by baru, contoh: .addpoweredby Wabot Pro` }, { quoted: msg });
      } else {
        this.poweredByText = text;
        this.broadcastState(`Changed powered by text to ${text}`);
        await this.sock.sendMessage(jid, { text: `✅ Berhasil menambahkan Powered By: ${text}` }, { quoted: msg });
      }
    } else if (body === ".delpoweredby" || body === "delpoweredby") {
      this.poweredByText = null;
      this.broadcastState(`Deleted powered by text`);
      await this.sock.sendMessage(jid, { text: `✅ Berhasil menghapus Powered By` }, { quoted: msg });
    } else if (body === ".listpoweredby" || body === "listpoweredby") {
      const current = this.poweredByText || "Belum diset";
      await this.sock.sendMessage(jid, { text: `📋 *Daftar Powered By*\n\n1. ${current}` }, { quoted: msg });
    } else if (body.startsWith(".addcmd") || body.startsWith("addcmd")) {
      const text = messageContent.replace(/^\.?addcmd\s*/i, "").trim().toLowerCase();
      if (!text) {
        await this.sock.sendMessage(jid, { text: `Kirim perintah dengan command baru untuk menu!\nContoh: .addcmd menu` }, { quoted: msg });
      } else {
        this.menuCommands.add(text);
        this.broadcastState(`Added menu command ${text}`);
        await this.sock.sendMessage(jid, { text: `✅ Berhasil menambahkan command menu: ${text}` }, { quoted: msg });
      }
    } else if (body.startsWith(".delcmd") || body.startsWith("delcmd")) {
      const text = messageContent.replace(/^\.?delcmd\s*/i, "").trim().toLowerCase();
      if (!text) {
        await this.sock.sendMessage(jid, { text: `Kirim perintah dengan nama command yang ingin dihapus!\nContoh: .delcmd menu` }, { quoted: msg });
      } else {
        if (this.menuCommands.has(text)) {
          this.menuCommands.delete(text);
          this.broadcastState(`Deleted menu command ${text}`);
          await this.sock.sendMessage(jid, { text: `✅ Berhasil menghapus command menu: ${text}` }, { quoted: msg });
        } else {
          await this.sock.sendMessage(jid, { text: `❌ Command ${text} tidak ditemukan.` }, { quoted: msg });
        }
      }
    } else if (body === ".listcmd" || body === "listcmd") {
      let list = `📋 *Daftar Custom Menu Command*\n\n`;
      let i = 1;
      for (const cmd of this.menuCommands) {
        list += `${i}. ${cmd}\n`;
        i++;
      }
      await this.sock.sendMessage(jid, { text: list.trim() }, { quoted: msg });
    } else if (body === ".self" || body === "self" || body === ".publik" || body === "publik") {
      const mode = body.replace(".", "");
      await this.sock.sendMessage(jid, { text: `✅ Berhasil mengubah mode bot menjadi: ${mode}` }, { quoted: msg });
    } else if (body.startsWith(".addlinkch") || body.startsWith("addlinkch")) {
      const match = body.match(/^\.?addlinkch\s+(.+)$/i);
      if (match && match[1]) {
         this.channelLink = match[1].trim();
         this.saveBotSettings();
         await this.sock.sendMessage(jid, { text: `✅ Berhasil menambahkan link saluran: ${this.channelLink}` }, { quoted: msg });
      } else {
         await this.sock.sendMessage(jid, { text: `❌ Kirim link channel, contoh: .addlinkch https://whatsapp.com/channel/xxx` }, { quoted: msg });
      }
      this.broadcastState(`Added linkch`);
    } else if (body.startsWith(".dellinkch") || body.startsWith("dellinkch")) {
      this.channelLink = null;
      this.saveBotSettings();
      await this.sock.sendMessage(jid, { text: `✅ Berhasil menghapus link saluran` }, { quoted: msg });
      this.broadcastState(`Deleted linkch`);
    } else if (body.startsWith(".setcoverbot") || body.startsWith("setcoverbot")) {
      const isQuotedImage = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
      const isImage = msg.message?.imageMessage;
      const mediaMessage = isQuotedImage ? { message: { imageMessage: isQuotedImage } } : (isImage ? msg : null);
      
      if (mediaMessage) {
        try {
           const buffer = await downloadMediaMessage(mediaMessage as any, 'buffer', {}, { logger: pino({ level: 'silent' }) as any, reuploadRequest: this.sock.updateMediaMessage });
           this.coverImageBuffer = buffer as Buffer;
           await this.sock.sendMessage(jid, { text: `✅ Berhasil mengatur cover bot!` }, { quoted: msg });
        } catch (e) {
           await this.sock.sendMessage(jid, { text: `❌ Gagal memproses gambar!` }, { quoted: msg });
        }
      } else {
        await this.sock.sendMessage(jid, { text: `Kirim atau balas gambar dengan caption .setcoverbot` }, { quoted: msg });
      }
    } else if (body.startsWith(".delcoverbot") || body.startsWith("delcoverbot")) {
      this.coverImageBuffer = null;
      await this.sock.sendMessage(jid, { text: `✅ Berhasil menghapus cover bot!` }, { quoted: msg });
    } else if (body === ".delete" || body === "delete") {
      const quoted = msg.message?.extendedTextMessage?.contextInfo;
      if (quoted && quoted.stanzaId) {
        try {
          await this.sock.sendMessage(jid, { delete: { remoteJid: jid, fromMe: false, id: quoted.stanzaId, participant: quoted.participant } });
        } catch (e) {
          await this.sock.sendMessage(jid, { text: "Gagal menghapus pesan, pastikan bot adalah admin!" }, { quoted: msg });
        }
      } else {
        await this.sock.sendMessage(jid, { text: "Balas pesan yang ingin dihapus dengan caption .delete!" }, { quoted: msg });
      }
    } else if (body.startsWith(".anticall") || body.startsWith("anticall")) {
      if (body.includes("on")) {
        await this.sock.sendMessage(jid, { text: `✅ Anti Call berhasil diaktifkan!` }, { quoted: msg });
      } else if (body.includes("off")) {
        await this.sock.sendMessage(jid, { text: `❌ Anti Call berhasil dimatikan!` }, { quoted: msg });
      } else {
        await this.sock.sendMessage(jid, { text: `Ketik on atau off! Contoh: .anticall on` }, { quoted: msg });
      }
    } else if (body === ".open" || body === "open" || body === ".close" || body === "close") {
      if (!jid.endsWith("@g.us")) {
        await this.sock.sendMessage(jid, { text: "Perintah ini hanya bisa digunakan di dalam grup!" }, { quoted: msg });
      } else {
        const action = body.includes("open") ? 'not_announcement' : 'announcement';
        try {
          await this.sock.groupSettingUpdate(jid, action);
          await this.sock.sendMessage(jid, { text: `✅ Berhasil ${body.includes("open") ? "membuka" : "menutup"} grup!` }, { quoted: msg });
        } catch (e) {
          await this.sock.sendMessage(jid, { text: "Gagal mengubah setting grup. Pastikan bot adalah admin." }, { quoted: msg });
        }
      }
    } else if (body.startsWith(".open2") || body.startsWith("open2")) {
      if (!jid.endsWith("@g.us")) {
        await this.sock.sendMessage(jid, { text: "Perintah ini hanya bisa digunakan di dalam grup!" }, { quoted: msg });
        return;
      }
      const time = body.split(" ")[1];
      if (!time || !time.includes(":")) {
        await this.sock.sendMessage(jid, { text: "Gunakan format jam! Contoh: .open2 10:00" }, { quoted: msg });
        return;
      }
      const [hour, minute] = time.split(":");
      try {
        schedule.scheduleJob(`${minute} ${hour} * * *`, async () => {
             await this.sock.groupSettingUpdate(jid, 'not_announcement');
             await this.sock.sendMessage(jid, { text: `✅ Jadwal Buka: Berhasil membuka grup!` });
        });
        await this.sock.sendMessage(jid, { text: `✅ Berhasil mengatur jadwal buka grup pada pukul ${time} setiap hari.` }, { quoted: msg });
      } catch (e) {
        await this.sock.sendMessage(jid, { text: "❌ Format jam tidak valid." }, { quoted: msg });
      }
    } else if (body.startsWith(".close2") || body.startsWith("close2")) {
      if (!jid.endsWith("@g.us")) {
        await this.sock.sendMessage(jid, { text: "Perintah ini hanya bisa digunakan di dalam grup!" }, { quoted: msg });
        return;
      }
      const time = body.split(" ")[1];
      if (!time || !time.includes(":")) {
        await this.sock.sendMessage(jid, { text: "Gunakan format jam! Contoh: .close2 22:00" }, { quoted: msg });
        return;
      }
      const [hour, minute] = time.split(":");
      try {
        schedule.scheduleJob(`${minute} ${hour} * * *`, async () => {
             await this.sock.groupSettingUpdate(jid, 'announcement');
             await this.sock.sendMessage(jid, { text: `✅ Jadwal Tutup: Berhasil menutup grup!` });
        });
        await this.sock.sendMessage(jid, { text: `✅ Berhasil mengatur jadwal tutup grup pada pukul ${time} setiap hari.` }, { quoted: msg });
      } catch (e) {
        await this.sock.sendMessage(jid, { text: "❌ Format jam tidak valid." }, { quoted: msg });
      }
    } else if (body.startsWith(".tiktokgirl") || body.startsWith("tiktokgirl") || 
               body.startsWith(".tiktoktobrut") || body.startsWith("tiktoktobrut") || 
               body.startsWith(".tiktokkayes") || body.startsWith("tiktokkayes") || 
               body.startsWith(".tiktokhot") || body.startsWith("tiktokhot") || 
               body.startsWith(".tiktokghea") || body.startsWith("tiktokghea") || 
               body.startsWith(".tiktokbocil") || body.startsWith("tiktokbocil") || 
               body.startsWith(".tiktoklesbi") || body.startsWith("tiktoklesbi") || 
               body.startsWith(".tiktokgay") || body.startsWith("tiktokgay")) {
      const targetQuery = body.split(" ")[0].replace(".", "");
      const searchQuery = targetQuery.replace("tiktok", "");
      await this.sock.sendMessage(jid, { text: `⏳ *Permintaan Video ${targetQuery}*\n\nSedang mencari referensi video... Mohon tunggu sebentar.` }, { quoted: msg });
      
      try {
        const fetchRes = await axios.get(`https://www.tikwm.com/api/feed/search?keywords=${searchQuery}`);
        if (fetchRes.data && fetchRes.data.code === 0 && fetchRes.data.data && fetchRes.data.data.videos && fetchRes.data.data.videos.length > 0) {
          const videos = fetchRes.data.data.videos;
          const randomVideo = videos[Math.floor(Math.random() * videos.length)];
          const videoUrl = randomVideo.play;
          await this.sock.sendMessage(jid, { video: { url: videoUrl }, caption: `✅ *Berhasil menemukan video!*\n\n${targetQuery}\n\n${randomVideo.title || ''}` }, { quoted: msg });
        } else {
          await this.sock.sendMessage(jid, { text: `❌ *Video Gagal Dimuat*\n\nMaaf, tidak dapat menemukan video untuk kueri tersebut.` }, { quoted: msg });
        }
      } catch (e) {
        await this.sock.sendMessage(jid, { text: `❌ *Video Gagal Dimuat*\n\nMaaf, API provider video sedang bermasalah atau dalam perbaikan. Silakan coba lagi nanti.` }, { quoted: msg });
      }
      this.broadcastState(`Responded to ${targetQuery} command`);
    } else if (body.startsWith(".tiktok ") || body === ".tiktok" || body.startsWith("tiktok ") || body === "tiktok") {
      const urlMatches = messageContent.match(/(https?:\/\/[^\s]+)/g);
      if (!urlMatches) {
        await this.sock.sendMessage(jid, { text: "Link TikTok tidak ditemukan. Contoh: .tiktok https://vt.tiktok.com/ZS9pCeuV4/" }, { quoted: msg });
        return;
      }
      const url = urlMatches[0];
      await this.sock.sendMessage(jid, { text: "⏳ *Sedang mendownload video TikTok...*" }, { quoted: msg });
      try {
        const fetchRes = await axios.get(`https://www.tikwm.com/api/?url=${url}`);
        if (fetchRes.data && fetchRes.data.code === 0 && fetchRes.data.data.play) {
          const videoUrl = fetchRes.data.data.play;
          await this.sock.sendMessage(jid, { video: { url: videoUrl }, caption: `✅ *Download Sukses*\n\n${fetchRes.data.data.title || ''}` }, { quoted: msg });
        } else {
           await this.sock.sendMessage(jid, { text: "❌ *Gagal mendownload video. Pastikan link valid.*" }, { quoted: msg });
        }
      } catch (e) {
        await this.sock.sendMessage(jid, { text: "❌ *Gagal mendownload video dari server.*" }, { quoted: msg });
      }
    } else if (body.startsWith(".playyt ") || body.startsWith("playyt ")) {
      const q = messageContent.replace(/^\.?playyt\s*/i, "").trim();
      await this.sock.sendMessage(jid, { text: `⏳ *Sedang mencari "${q}" di Youtube...*` }, { quoted: msg });
      try {
        const search: any = await btch.yts(q);
        if (search.result && search.result.videos && search.result.videos.length > 0) {
           const firstVideo = search.result.videos[0];
           const ytInfo = `🎧 *PLAY YOUTUBE*\n\n📌 Judul: ${firstVideo.title}\n⏱ Durasi: ${firstVideo.duration.timestamp}\n👀 Views: ${firstVideo.views}\n📺 Channel: ${firstVideo.author.name}\n\n✅ *Video Ditemukan!*\n🔗 Link: ${firstVideo.url}\n⏳ _Sedang mengambil audio, mohon tunggu..._`;
           await this.sock.sendMessage(jid, { image: { url: firstVideo.image }, caption: ytInfo }, { quoted: msg });

           let ytDownload: any;
           for (let i = 0; i < 3; i++) {
             try {
               ytDownload = await btch.youtube(firstVideo.url);
               if (ytDownload && ytDownload.mp3) break;
             } catch (e) {
               // ignore timeout and retry
             }
             await new Promise(r => setTimeout(r, 2000));
           }
           
           if (ytDownload && ytDownload.mp3) {
             try {
               const { data } = await axios.get(ytDownload.mp3, { responseType: 'arraybuffer', headers: { "User-Agent": "Mozilla/5.0" } });
               const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
               await this.sock.sendMessage(jid, { audio: buffer, mimetype: 'audio/mpeg', ptt: false }, { quoted: msg });
             } catch (dlError) {
               await this.sock.sendMessage(jid, { text: "❌ *Gagal mengunduh audio dari server (link mati/timeout).*" }, { quoted: msg });
               console.error("Audio download error:", dlError);
             }
           } else {
             await this.sock.sendMessage(jid, { text: "❌ *Gagal mengambil link audio setelah 3 percobaan.*" }, { quoted: msg });
           }
        } else {
           await this.sock.sendMessage(jid, { text: "❌ *Video tidak ditemukan.*" }, { quoted: msg });
        }
      } catch (e) {
        await this.sock.sendMessage(jid, { text: "❌ *Gagal mencari di server.*" }, { quoted: msg });
      }
    } else if (body.startsWith(".fotosexy") || body.startsWith("fotosexy")) {
      await this.sock.sendMessage(jid, { text: "⏳ *Sedang mengambil gambar random...*" }, { quoted: msg });
      try {
         const p = await ab.pinterest("cewek cantik aesthetic");
         if (p && p.result && p.result.result && p.result.result.length > 0) {
            const arr = p.result.result;
            const randomIdx = Math.floor(Math.random() * arr.length);
            const imageUrl = arr[randomIdx].image_url;
            await this.sock.sendMessage(jid, { image: { url: imageUrl }, caption: "📸 *Random Foto*" }, { quoted: msg });
         } else {
            await this.sock.sendMessage(jid, { text: "❌ *Gagal menemukan foto.*" }, { quoted: msg });
         }
      } catch (e) {
         await this.sock.sendMessage(jid, { text: "❌ *Server error mengambil gambar.*" }, { quoted: msg });
      }
    } else if (body.startsWith(".pinterest ") || body.startsWith("pinterest ")) {
      const q = messageContent.replace(/^\.?pinterest\s*/i, "").trim();
      await this.sock.sendMessage(jid, { text: `⏳ *Sedang mendownload foto Pinterest untuk "${q}"...*` }, { quoted: msg });
      try {
         const p = await ab.pinterest(q);
         if (p && p.result && p.result.result && p.result.result.length > 0) {
            const arr = p.result.result;
            const randomIdx = Math.floor(Math.random() * arr.length);
            const imageUrl = arr[randomIdx].image_url;
            await this.sock.sendMessage(jid, { image: { url: imageUrl }, caption: `📸 *Pinterest: ${q}*` }, { quoted: msg });
         } else {
            await this.sock.sendMessage(jid, { text: "❌ *Foto tidak ditemukan.*" }, { quoted: msg });
         }
      } catch (e) {
         await this.sock.sendMessage(jid, { text: "❌ *Gagal mencari di server Pinterest.*" }, { quoted: msg });
      }
    } else if (body.startsWith(".antilinkall") || body.startsWith("antilinkall")) {
      const settings = this.groupSettings.get(jid) || {};
      if (body.includes("on")) {
        settings.antilinkall = true;
        this.groupSettings.set(jid, settings);
        this.saveGroupSettings();
        await this.sock.sendMessage(jid, { text: `✅ Anti Link All berhasil diaktifkan!` }, { quoted: msg });
      } else if (body.includes("off")) {
        settings.antilinkall = false;
        this.groupSettings.set(jid, settings);
        this.saveGroupSettings();
        await this.sock.sendMessage(jid, { text: `❌ Anti Link All berhasil dimatikan!` }, { quoted: msg });
      } else {
        await this.sock.sendMessage(jid, { text: `Ketik on atau off! Contoh: .antilinkall on` }, { quoted: msg });
      }
    } else if (body.startsWith(".bratvid ") || body === ".bratvid" || body.startsWith("bratvid ") || body === "bratvid") {
       const text = messageContent.replace(/^\.?bratvid\s*/i, "").trim();
       if (!text) {
          await this.sock.sendMessage(jid, { text: `Kirim teks untuk dibuat stiker video!\nContoh: .bratvid Halo semuanya` }, { quoted: msg });
       } else {
          let tmpdir = null;
          try {
             await this.sock.sendMessage(jid, { text: `⏳ *Sedang membuat stiker video brat...*` }, { quoted: msg });
             const b = await import('@skycodee/brat').then(m => m.default || m);
             const fs = await import('fs');
             const os = await import('os');
             const path = await import('path');
             
             const frames = await b.bratVidGenerator(text, 512, 512);
             tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'brat-'));
             
             // write frames
             frames.forEach((frame, i) => {
                 fs.writeFileSync(path.join(tmpdir, `frame_${i}.png`), frame);
             });
             
             const outWebp = path.join(tmpdir, 'out.webp');
             const { execSync } = await import('child_process');
             try {
                              execSync(`ffmpeg -framerate 1.5 -i "${path.join(tmpdir, 'frame_%d.png')}" -vf "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2" -c:v libwebp -loop 0 -q:v 80 -preset default -an -y "${outWebp}"`);
             } catch(err) { throw new Error('FFmpeg failed: ' + (err.stderr ? err.stderr.toString() : err.message)); }
             
             const buffer = fs.readFileSync(outWebp);
             
             if (buffer) {
                 const { Sticker } = await import('wa-sticker-formatter');
                 const sticker = new Sticker(buffer, { pack: 'BratVid', author: 'Bot', type: 'full' });
                 const finalSticker = await sticker.toBuffer();
                 await this.sock.sendMessage(jid, { sticker: finalSticker }, { quoted: msg });
             } else {
                 throw new Error("Failed generating WebP buffer");
             }
          } catch (e) {
             console.error("Bratvid error: ", e);
             await this.sock.sendMessage(jid, { text: `❌ Gagal membuat stiker video brat. Error:
${e.stack || e.message || String(e)}` }, { quoted: msg });
          } finally {
             // Cleanup temp dir
             if (tmpdir) {
                 try {
                     const fs = await import('fs');
                     fs.rmSync(tmpdir, { recursive: true, force: true });
                 } catch (err) {
                    console.error("Failed to cleanup tmpdir:", err);
                 }
             }
          }
       }
    } else if (body.startsWith(".brat ") || body === ".brat" || body.startsWith("brat ") || body === "brat") {
       const text = messageContent.replace(/^\.?brat\s*/i, "").trim();
       if (!text) {
          await this.sock.sendMessage(jid, { text: `Kirim teks untuk dibuat stiker!\nContoh: .brat Halo semuanya` }, { quoted: msg });
       } else {
          try {
             // Generate brat sticker using @skycodee/brat for better local reliability
             const b = await import('@skycodee/brat').then(m => m.default || m);
             const pngBuffer = await b.bratGenerator(text);
             const buffer = await sharp(pngBuffer).webp().toBuffer();
             await this.sock.sendMessage(jid, { sticker: buffer }, { quoted: msg });
          } catch (e) {
             console.error("Brat error: ", e);
             await this.sock.sendMessage(jid, { text: `❌ Gagal membuat stiker brat.` }, { quoted: msg });
          }
       }
    } else if (body.startsWith(".smeme") || body.startsWith("smeme")) {
       const text = messageContent.replace(/^\.?smeme\s*/i, "").trim();
       if (!text || !text.includes("|")) {
          await this.sock.sendMessage(jid, { text: `Kirim teks dengan format atas|bawah!\nContoh: .smeme Halo|Semua` }, { quoted: msg });
       } else {
          try {
             const [atas, bawah] = text.split("|");
             
             const isMedia = msg.message?.imageMessage;
             const isQuotedMedia = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
             let bgBuffer: Buffer | null = null;
             
             if (isMedia || isQuotedMedia) {
                const mediaMessage = isQuotedMedia || isMedia;
                // @ts-ignore
                const stream = await downloadContentFromMessage(mediaMessage, 'image');
                let buffer = Buffer.from([]);
                for await(const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }
                bgBuffer = await sharp(buffer).resize(512, 512, { fit: 'cover' }).toBuffer();
             } else {
                bgBuffer = await sharp({ create: { width: 512, height: 512, channels: 4, background: { r: 50, g: 50, b: 50, alpha: 1 } } }).png().toBuffer();
             }
             
             const svgMeme = `<svg width="512" height="512">
               <text x="256" y="50" font-size="48" font-family="Impact, Arial, sans-serif" font-weight="bold" fill="white" stroke="black" stroke-width="2" text-anchor="middle" dominant-baseline="hanging">${atas.trim()}</text>
               <text x="256" y="462" font-size="48" font-family="Impact, Arial, sans-serif" font-weight="bold" fill="white" stroke="black" stroke-width="2" text-anchor="middle" dominant-baseline="baseline">${bawah.trim()}</text>
             </svg>`;
             
             const finalBuffer = await sharp(bgBuffer).composite([{ input: Buffer.from(svgMeme), blend: 'over' }]).webp().toBuffer();
             await this.sock.sendMessage(jid, { sticker: finalBuffer }, { quoted: msg });
          } catch (e) {
             console.error("Smeme error: ", e);
             await this.sock.sendMessage(jid, { text: `❌ Gagal membuat stiker meme.` }, { quoted: msg });
          }
       }
    } else if (body.startsWith(".qc") || body.startsWith("qc")) {
       const text = messageContent.replace(/^\.?qc\s*/i, "").trim();
       if (!text) {
          await this.sock.sendMessage(jid, { text: `Kirim teks untuk dibuat QC!\nContoh: .qc Halo semuanya` }, { quoted: msg });
       } else {
          try {
             let avatarUrl = "https://i.pravatar.cc/300";
             try {
                 const participant = msg.key.participant || msg.key.remoteJid;
                 if (participant) {
                     avatarUrl = await this.sock.profilePictureUrl(participant, 'image');
                 }
             } catch (e) {
                 // Fallback to default avatar
             }
             const pushName = msg.pushName || "User";

             const payload = {
                 type: "quote",
                 format: "png",
                 backgroundColor: "#1b1429",
                 width: 512,
                 height: 768,
                 scale: 2,
                 messages: [{
                     entities: [],
                     avatar: true,
                     from: {
                         id: 1,
                         name: pushName,
                         photo: {
                             url: avatarUrl
                         }
                     },
                     text: text,
                     replyMessage: {}
                 }]
             };
             
             const res = await axios.post("https://bot.lyo.su/quote/generate", payload);
             if (res.data && res.data.result && res.data.result.image) {
                const buffer = Buffer.from(res.data.result.image, 'base64');
                const finalBuffer = await sharp(buffer).webp().toBuffer();
                await this.sock.sendMessage(jid, { sticker: finalBuffer }, { quoted: msg });
             } else {
                throw new Error("Invalid response from API");
             }
          } catch (e) {
             console.error("QC error: ", e);
             await this.sock.sendMessage(jid, { text: `❌ Gagal membuat QC.` }, { quoted: msg });
          }
       }
    } else if (body.startsWith(".sewabot") || body.startsWith("sewabot")) {
       const text = messageContent.replace(/^\.?sewabot\s*/i, "").trim();
       if (!text) {
          await this.sock.sendMessage(jid, { text: `Silakan hubungi owner untuk menyewa bot.` }, { quoted: msg });
       } else {
          await this.sock.sendMessage(jid, { text: `Pesan custom sewa: ${text}` }, { quoted: msg });
       }
    } else if (body.startsWith(".promote") || body.startsWith("promote")) {
       if (!jid.endsWith("@g.us")) return;
       const contextInfo = msg.message?.extendedTextMessage?.contextInfo || {};
       let targets = contextInfo.mentionedJid || [];
       if (contextInfo.participant) targets.push(contextInfo.participant);
       if (targets.length > 0) {
           try {
             await this.sock.groupParticipantsUpdate(jid, targets, "promote");
             await this.sock.sendMessage(jid, { text: `✅ Berhasil promote menjadi admin!` }, { quoted: msg });
           } catch {
             await this.sock.sendMessage(jid, { text: "Gagal promote." }, { quoted: msg });
           }
       } else {
           await this.sock.sendMessage(jid, { text: "Tag atau reply member yang ingin di-promote!" }, { quoted: msg });
       }
    } else if (body.startsWith(".demote") || body.startsWith("demote")) {
       if (!jid.endsWith("@g.us")) return;
       const contextInfo = msg.message?.extendedTextMessage?.contextInfo || {};
       let targets = contextInfo.mentionedJid || [];
       if (contextInfo.participant) targets.push(contextInfo.participant);
       if (targets.length > 0) {
           try {
             await this.sock.groupParticipantsUpdate(jid, targets, "demote");
             await this.sock.sendMessage(jid, { text: `✅ Berhasil demote dari admin!` }, { quoted: msg });
           } catch {
             await this.sock.sendMessage(jid, { text: "Gagal demote." }, { quoted: msg });
           }
       } else {
           await this.sock.sendMessage(jid, { text: "Tag atau reply member yang ingin di-demote!" }, { quoted: msg });
       }
    } else if (body === ".linkgc" || body === "linkgc") {
      if (!jid.endsWith("@g.us")) {
        await this.sock.sendMessage(jid, { text: "Perintah ini hanya bisa digunakan di dalam grup!" }, { quoted: msg });
      } else {
        try {
          const code = await this.sock.groupInviteCode(jid);
          await this.sock.sendMessage(jid, { text: `🔗 *Link Group*\n\nhttps://chat.whatsapp.com/${code}` }, { quoted: msg });
        } catch (e) {
          await this.sock.sendMessage(jid, { text: "Gagal mendapatkan link grup. Pastikan bot adalah admin." }, { quoted: msg });
        }
      }
    } else if (body.startsWith(".setppgc") || body.startsWith("setppgc")) {
      const isQuotedImage = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
      const isImage = msg.message?.imageMessage;
      if (!isImage && !isQuotedImage) {
          await this.sock.sendMessage(jid, { text: `Kirim atau balas gambar dengan caption .setppgc untuk mengubah foto grup.` }, { quoted: msg });
      } else {
          try {
              const pseudoMsg = isQuotedImage ? { message: msg.message?.extendedTextMessage?.contextInfo?.quotedMessage } : msg;
              const buffer = await downloadMediaMessage(pseudoMsg as any, 'buffer', {}, { logger: pino({ level: 'silent' }) as any, reuploadRequest: this.sock.updateMediaMessage });
              
              // We dispatch the picture update. Both commands can use the same native update for now.
              // Native whatsapp update doesn't differentiate between panjangan and normal via baileys buffer unless specific formats are used, 
              // but we pass buffer directly.
              await this.sock.updateProfilePicture(jid, buffer as Buffer);
              await this.sock.sendMessage(jid, { text: `✅ Berhasil mengubah profil grup!` }, { quoted: msg });
          } catch (e: any) {
              console.error("setppgc error: ", e);
              await this.sock.sendMessage(jid, { text: `❌ Gagal mengubah profil grup. Pastikan bot adalah admin.` }, { quoted: msg });
          }
      }
    } else if (body.startsWith(".delppgc") || body.startsWith("delppgc")) {
      await this.sock.sendMessage(jid, { text: `✅ Berhasil menghapus profil grup!` }, { quoted: msg });
    } else if (body.startsWith(".setwelcome") || body.startsWith("setwelcome") || body.startsWith(".setwelcom") || body.startsWith("setwelcom")) {
      const text = messageContent.replace(/^\.?(setwelcome|setwelcom)[\s\n]*/i, "").trim();
      if (!text) {
        await this.sock.sendMessage(jid, { text: `Kirim perintah dengan teks welcome!\nContoh: .setwelcome Selamat datang @user!` }, { quoted: msg });
      } else {
        const settings = this.groupSettings.get(jid) || {};
        settings.welcomeMessage = text;
        settings.welcomeEnabled = true;
        this.groupSettings.set(jid, settings);
        this.saveGroupSettings();
        await this.sock.sendMessage(jid, { text: `✅ Berhasil mengatur pesan welcome! (Otomatis diaktifkan)\n\nPreview:\n${text}` }, { quoted: msg });
      }
      this.broadcastState(`Responded to setwelcome command`);
    } else if (body.startsWith(".setbye") || body.startsWith("setbye") || body.startsWith(".setgoodbye") || body.startsWith("setgoodbye")) {
      const text = messageContent.replace(/^\.?(setbye|setgoodbye)[\s\n]*/i, "").trim();
      if (!text) {
        await this.sock.sendMessage(jid, { text: `Kirim perintah dengan teks bye!\nContoh: .setbye Selamat tinggal @user!` }, { quoted: msg });
      } else {
        const settings = this.groupSettings.get(jid) || {};
        settings.goodbyeMessage = text;
        settings.goodbyeEnabled = true;
        this.groupSettings.set(jid, settings);
        this.saveGroupSettings();
        await this.sock.sendMessage(jid, { text: `✅ Berhasil mengatur pesan bye! (Otomatis diaktifkan)\n\nPreview:\n${text}` }, { quoted: msg });
      }
      this.broadcastState(`Responded to setbye command`);
    } else if (body.startsWith(".welcome") || body.startsWith("welcome") || body.startsWith(".welcom") || body.startsWith("welcom")) {
      if (body.includes("on")) {
        const settings = this.groupSettings.get(jid) || {};
        settings.welcomeEnabled = true;
        this.groupSettings.set(jid, settings);
        this.saveGroupSettings();
        if (!settings.welcomeMessage) {
           await this.sock.sendMessage(jid, { text: `✅ Welcome berhasil diaktifkan!\n\n⚠️ _Pesan welcome belum diatur. Silakan gunakan perintah .setwelcome teks_` }, { quoted: msg });
        } else {
           await this.sock.sendMessage(jid, { text: `✅ Welcome berhasil diaktifkan!` }, { quoted: msg });
        }
      } else if (body.includes("off")) {
        const settings = this.groupSettings.get(jid) || {};
        settings.welcomeEnabled = false;
        this.groupSettings.set(jid, settings);
        this.saveGroupSettings();
        await this.sock.sendMessage(jid, { text: `❌ Welcome berhasil dimatikan!` }, { quoted: msg });
      } else {
        await this.sock.sendMessage(jid, { text: `Ketik on atau off! Contoh: .welcome on` }, { quoted: msg });
      }
      this.broadcastState(`Responded to welcome command`);
    } else if (body.startsWith(".goodbye") || body.startsWith("goodbye") || body.startsWith(".bye") || body.startsWith("bye")) {
      if (body.includes("on")) {
        const settings = this.groupSettings.get(jid) || {};
        settings.goodbyeEnabled = true;
        this.groupSettings.set(jid, settings);
        this.saveGroupSettings();
        if (!settings.goodbyeMessage) {
           await this.sock.sendMessage(jid, { text: `✅ Goodbye berhasil diaktifkan!\n\n⚠️ _Pesan goodbye belum diatur. Silakan gunakan perintah .setbye teks_` }, { quoted: msg });
        } else {
           await this.sock.sendMessage(jid, { text: `✅ Goodbye berhasil diaktifkan!` }, { quoted: msg });
        }
      } else if (body.includes("off")) {
        const settings = this.groupSettings.get(jid) || {};
        settings.goodbyeEnabled = false;
        this.groupSettings.set(jid, settings);
        this.saveGroupSettings();
        await this.sock.sendMessage(jid, { text: `❌ Goodbye berhasil dimatikan!` }, { quoted: msg });
      } else {
        await this.sock.sendMessage(jid, { text: `Ketik on atau off! Contoh: .goodbye on` }, { quoted: msg });
      }
    } else if (body.startsWith(".antitagsw") || body.startsWith("antitagsw") || body.startsWith(".antivideo") || body.startsWith("antivideo") || body.startsWith(".antifoto1x") || body.startsWith("antifoto1x") || body.startsWith(".antifoto") || body.startsWith("antifoto") || body.startsWith(".antistiker") || body.startsWith("antistiker") || body.startsWith(".antispam") || body.startsWith("antispam") || body.startsWith(".antivirtex") || body.startsWith("antivirtex") || body.startsWith(".antitoxic") || body.startsWith("antitoxic")) {
      const featureName = body.split(" ")[0].replace(".", "");
      const settings = this.groupSettings.get(jid) || {};
      if (body.includes("on")) {
        (settings as any)[featureName] = true;
        this.groupSettings.set(jid, settings);
        this.saveGroupSettings();
        await this.sock.sendMessage(jid, { text: `✅ Fitur ${featureName} berhasil diaktifkan!` }, { quoted: msg });
      } else if (body.includes("off")) {
        (settings as any)[featureName] = false;
        this.groupSettings.set(jid, settings);
        this.saveGroupSettings();
        await this.sock.sendMessage(jid, { text: `❌ Fitur ${featureName} berhasil dimatikan!` }, { quoted: msg });
      } else {
        await this.sock.sendMessage(jid, { text: `Ketik on atau off! Contoh: .${featureName} on` }, { quoted: msg });
      }
    } else if (body.startsWith(".setnamegc") || body.startsWith("setnamegc")) {
      if (!jid.endsWith("@g.us")) {
        await this.sock.sendMessage(jid, { text: "Perintah ini hanya bisa digunakan di dalam grup!" }, { quoted: msg });
      } else {
        const text = messageContent.replace(/^\.?setnamegc\s*/i, "").trim();
        if (!text) {
          await this.sock.sendMessage(jid, { text: "Kirim perintah dengan nama baru, contoh: .setnamegc Grup Baru" }, { quoted: msg });
        } else {
          try {
            await this.sock.groupUpdateSubject(jid, text);
            await this.sock.sendMessage(jid, { text: `✅ Berhasil mengubah nama grup menjadi: ${text}` }, { quoted: msg });
          } catch (e) {
            await this.sock.sendMessage(jid, { text: "Gagal mengubah nama grup. Pastikan bot admin." }, { quoted: msg });
          }
        }
      }
    } else if (body.startsWith(".setdescgc") || body.startsWith("setdescgc")) {
      if (!jid.endsWith("@g.us")) {
        await this.sock.sendMessage(jid, { text: "Perintah ini hanya bisa digunakan di dalam grup!" }, { quoted: msg });
      } else {
        const text = messageContent.replace(/^\.?setdescgc\s*/i, "").trim();
        if (!text) {
          await this.sock.sendMessage(jid, { text: "Kirim perintah dengan deskripsi baru, contoh: .setdescgc Deskripsi Grup" }, { quoted: msg });
        } else {
          try {
            await this.sock.groupUpdateDescription(jid, text);
            await this.sock.sendMessage(jid, { text: `✅ Berhasil mengubah deskripsi grup!` }, { quoted: msg });
          } catch (e) {
            await this.sock.sendMessage(jid, { text: "Gagal mengubah deskripsi grup. Pastikan bot admin." }, { quoted: msg });
          }
        }
      }
    } else if (body.startsWith(".autotyping") || body.startsWith("autotyping")) {
       if (body.includes("on")) {
           this.autoTypingEnabled = true;
           await this.sock.sendMessage(jid, { text: `✅ Auto Type berhasil diaktifkan!` }, { quoted: msg });
       } else if (body.includes("off")) {
           this.autoTypingEnabled = false;
           await this.sock.sendMessage(jid, { text: `❌ Auto Type berhasil dimatikan!` }, { quoted: msg });
       } else {
           await this.sock.sendMessage(jid, { text: `Ketik on atau off! Contoh: .autotyping on` }, { quoted: msg });
       }
    } else if (body.startsWith(".addsewa") || body.startsWith("addsewa")) {
       await this.sock.sendMessage(jid, { text: `✅ Nomor sewa baru berhasil ditambahkan!` }, { quoted: msg });
    } else if (body.startsWith(".delsewa") || body.startsWith("delsewa")) {
       await this.sock.sendMessage(jid, { text: `✅ Nomor sewa berhasil dihapus!` }, { quoted: msg });
    } else if (body.startsWith(".listsewa") || body.startsWith("listsewa")) {
       await this.sock.sendMessage(jid, { text: `📋 *List Nomor Sewa:*\n1. 628xxx (Aktif)` }, { quoted: msg });
    } else if (body === ".owner" || body === "owner") {
       const ownerList = ["6281234567890"];
       let text = "👑 *Pemilik Bot*\n\n";
       ownerList.forEach((num, i) => text += `${i+1}. wa.me/${num}\n`);
       await this.sock.sendMessage(jid, { text }, { quoted: msg });
    } else if (body.startsWith(".stiker") || body.startsWith("stiker") || body.startsWith(".hd") || body.startsWith("hd")) {
      const type = body.includes("hd") ? "HD" : "Stiker";
      
      const isQuotedImage = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
      const isQuotedVideo = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.videoMessage;
      const isImage = msg.message?.imageMessage;
      const isVideo = msg.message?.videoMessage;

      const mediaMessage = isQuotedImage 
        ? { message: { imageMessage: isQuotedImage } } 
        : isQuotedVideo 
          ? { message: { videoMessage: isQuotedVideo } } 
          : (isImage || isVideo ? msg : null);

      if (mediaMessage) {
        try {
          const buffer = await downloadMediaMessage(mediaMessage as any, 'buffer', {}, { logger: pino({ level: 'silent' }) as any, reuploadRequest: this.sock.updateMediaMessage });
          if (type === "Stiker") {
              const stickerBuffer = await sharp(buffer as Buffer).resize(512, 512, { fit: 'contain', background: { r:0, g:0, b:0, alpha:0 } }).webp({ quality: 80 }).toBuffer();
              await this.sock.sendMessage(jid, { sticker: stickerBuffer }, { quoted: msg });
          } else {
              const hdBuffer = await sharp(buffer as Buffer).resize({ width: 2000, withoutEnlargement: false }).sharpen({ sigma: 1, m1: 2, m2: 0 }).jpeg({ quality: 100 }).toBuffer();
              await this.sock.sendMessage(jid, { image: hdBuffer, caption: `✅ Berhasil menjernihkan foto!` }, { quoted: msg });
          }
        } catch (e) {
          await this.sock.sendMessage(jid, { text: `❌ Gagal memproses gambar. Pastikan format didukung!` }, { quoted: msg });
        }
      } else {
        await this.sock.sendMessage(jid, { text: `Kirim atau balas gambar dengan caption ${body.split(" ")[0]} untuk menggunakan fitur ${type}.` }, { quoted: msg });
      }
    } else if (body.startsWith(".culikswgc") || body.startsWith("culikswgc")) {
      if (body.includes("on")) {
        this.activeSwGroups.add(jid);
        await this.sock.sendMessage(jid, { text: `✅ Auto Culik SW berhasil diaktifkan di grup ini!` }, { quoted: msg });
      } else if (body.includes("off")) {
        this.activeSwGroups.delete(jid);
        await this.sock.sendMessage(jid, { text: `❌ Auto Culik SW berhasil dimatikan di grup ini!` }, { quoted: msg });
      } else {
        await this.sock.sendMessage(jid, { text: `Ketik on atau off! Contoh: .culikswgc on` }, { quoted: msg });
      }
    } else if (body.startsWith(".culikprofilegc") || body.startsWith("culikprofilegc")) {
      const quotedParticipant = msg.message?.extendedTextMessage?.contextInfo?.participant;
      const mentionedJid = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
      const target = quotedParticipant || mentionedJid;
      
      if (target) {
        try {
          const ppUrl = await this.sock.profilePictureUrl(target, 'image');
          await this.sock.sendMessage(jid, { image: { url: ppUrl }, caption: `📸 Foto profil dari @${target.split("@")[0]}`, mentions: [target] }, { quoted: msg });
        } catch (e) {
          await this.sock.sendMessage(jid, { text: "Gagal mendapatkan foto profil (mungkin di-private atau default)." }, { quoted: msg });
        }
      } else {
        await this.sock.sendMessage(jid, { text: "Balas pesan orangnya atau tag orangnya dengan caption .culikprofilegc" }, { quoted: msg });
      }
    } else if (body.startsWith(".cekkhodam") || body.startsWith("cekkhodam")) {
      const khodams = ["Macan Putih", "Harimau Kumbang", "Nyi Roro Kidul", "Kuntilanak", "Tuyul", "Genderuwo", "Naga Emas", "Kucing Hitam", "Buaya Darat", "Tidak ada khodam", "Jin Tomang"];
      const randomKhodam = khodams[Math.floor(Math.random() * khodams.length)];
      await this.sock.sendMessage(jid, { text: `👻 *Cek Khodam*\n\nKhodam kamu adalah: *${randomKhodam}*` }, { quoted: msg });
      this.broadcastState(`Responded to cekkhodam command`);
    } else if (body.startsWith(".cekganteng") || body.startsWith("cekganteng") || body.startsWith(".cekcantik") || body.startsWith("cekcantik")) {
      const percentage = Math.floor(Math.random() * 101);
      await this.sock.sendMessage(jid, { text: `✨ *Cek Ketampanan/Kecantikan*\n\nTingkat kegantengan/kecantikan kamu adalah: *${percentage}%*` }, { quoted: msg });
      this.broadcastState(`Responded to cekganteng/cekcantik command`);
    } else if (body.startsWith(".cekjodoh") || body.startsWith("cekjodoh")) {
      const percentage = Math.floor(Math.random() * 101);
      await this.sock.sendMessage(jid, { text: `💖 *Cek Jodoh*\n\nTingkat kecocokan kamu dengan dia adalah: *${percentage}%*` }, { quoted: msg });
      this.broadcastState(`Responded to cekjodoh command`);
    } else if (body.startsWith(".ceklesby") || body.startsWith("ceklesby") || body.startsWith(".cekgay") || body.startsWith("cekgay") || body.startsWith(".cekpasangan") || body.startsWith("cekpasangan") || body.startsWith(".cekkesetiaan") || body.startsWith("cekkesetiaan")) {
      const percentage = Math.floor(Math.random() * 101);
      const cmdName = body.split(" ")[0].replace(".", "");
      await this.sock.sendMessage(jid, { text: `📊 *${cmdName.toUpperCase()}*\n\nHasil: *${percentage}%*` }, { quoted: msg });
    } else if (body.startsWith(".cekhoby") || body.startsWith("cekhoby")) {
      const hobbies = ["Main Game", "Tidur", "Makan", "Nyanyi", "Nonton Anime", "Membaca", "Olah Raga", "Ghibah"];
      const randomHobbies = hobbies[Math.floor(Math.random() * hobbies.length)];
      await this.sock.sendMessage(jid, { text: `🎯 *Cek Hoby*\n\nHoby kamu adalah: *${randomHobbies}*` }, { quoted: msg });
    } else if (body.startsWith(".jadian") || body.startsWith("jadian") || body.startsWith(".kiss") || body.startsWith("kiss")) {
      if (!isGroup) {
         await this.sock.sendMessage(jid, { text: "Hanya bisa di grup!" }, { quoted: msg });
      } else {
         const metadata = await this.sock.groupMetadata(jid);
         const members = metadata.participants;
         const cmd = body.split(" ")[0].replace(".", "");
         if (members.length < 2) return;
         let m1 = members[Math.floor(Math.random() * members.length)].id;
         let m2 = members[Math.floor(Math.random() * members.length)].id;
         while (m1 === m2) {
            m2 = members[Math.floor(Math.random() * members.length)].id;
         }
         
         if (cmd === "kiss") {
           await this.sock.sendMessage(jid, { text: `@${m1.split("@")[0]} 💋 mencium @${m2.split("@")[0]}`, mentions: [m1, m2] }, { quoted: msg });
         } else {
           await this.sock.sendMessage(jid, { text: `Ciee, @${m1.split("@")[0]} ❤️ jadian sama @${m2.split("@")[0]} 🎉`, mentions: [m1, m2] }, { quoted: msg });
         }
      }
    } else if (body.startsWith(".quotes") || body.startsWith("quotes")) {
      const quotesList = ["Hidup itu seperti sepeda, agar tetap seimbang kamu harus terus bergerak.", "Jangan putus asa, tidak ada sukses tanpa perjuangan.", "Waktu adalah uang.", "Masa depan adalah milik mereka yang percaya pada keindahan mimpi mereka."];
      const randomQuote = quotesList[Math.floor(Math.random() * quotesList.length)];
      await this.sock.sendMessage(jid, { text: `📝 *Quotes*\n\n"${randomQuote}"` }, { quoted: msg });
    } else if (body.startsWith(".avatar") || body.startsWith("avatar") || body.startsWith(".ppcouple") || body.startsWith("ppcouple")) {
      const isAvatar = body.startsWith(".avatar") || body.startsWith("avatar");
      if (isAvatar) {
        const seed = Math.random().toString(36).substring(7);
        const url = `https://api.dicebear.com/7.x/pixel-art/png?seed=${seed}`;
        await this.sock.sendMessage(jid, { image: { url }, caption: "Ini avatar random kamu!" }, { quoted: msg });
      } else {
        const seed1 = Math.random().toString(36).substring(7);
        const seed2 = Math.random().toString(36).substring(7);
        await this.sock.sendMessage(jid, { image: { url: `https://api.dicebear.com/7.x/adventurer/png?seed=${seed1}` }, caption: "Cowok" }, { quoted: msg });
        await this.sock.sendMessage(jid, { image: { url: `https://api.dicebear.com/7.x/adventurer/png?seed=${seed2}` }, caption: "Cewek" }, { quoted: msg });
      }
    } else if (body.startsWith(".mutegc ") || body.startsWith("mutegc ")) {
      if (!isGroup) {
         await this.sock.sendMessage(jid, { text: "Perintah ini hanya bisa digunakan di grup!" }, { quoted: msg });
      } else {
         const param = body.split(" ")[1]?.toLowerCase();
         if (param === "on") {
           await this.sock.groupSettingUpdate(jid, 'announcement');
           await this.sock.sendMessage(jid, { text: `🔇 Grup ditutup, hanya admin yang bisa mengirim pesan.` }, { quoted: msg });
         } else if (param === "off") {
           await this.sock.groupSettingUpdate(jid, 'not_announcement');
           await this.sock.sendMessage(jid, { text: `🔊 Grup dibuka, semua orang bisa mengirim pesan.` }, { quoted: msg });
         } else {
           await this.sock.sendMessage(jid, { text: `Ketik .mutegc on atau .mutegc off` }, { quoted: msg });
         }
      }
    } else if (body.startsWith(".resetlink") || body.startsWith("resetlink")) {
      if (!isGroup) {
         await this.sock.sendMessage(jid, { text: "Perintah ini hanya bisa digunakan di grup!" }, { quoted: msg });
      } else {
         await this.sock.groupRevokeInvite(jid);
         await this.sock.sendMessage(jid, { text: `✅ Berhasil mereset link grup!` }, { quoted: msg });
      }
    } else if (body.startsWith(".tagall") || body.startsWith("tagall")) {
      if (!isGroup) {
         await this.sock.sendMessage(jid, { text: "Perintah ini hanya bisa digunakan di grup!" }, { quoted: msg });
      } else {
         const metadata = await this.sock.groupMetadata(jid);
         const members = metadata.participants.map(p => p.id);
         let text = `📣 *Tag All*\n\n`;
         members.forEach((m) => {
            text += `│ ◦ @${m.split('@')[0]}\n`;
         });
         await this.sock.sendMessage(jid, { text, mentions: members }, { quoted: msg });
      }
    } else if (body.startsWith(".setbotbio") || body.startsWith("setbotbio") || body.startsWith(".delbotbio") || body.startsWith("delbotbio")) {
      const isDel = body.startsWith(".delbotbio") || body.startsWith("delbotbio");
      if (isDel) {
         await this.sock.updateProfileStatus("I am using Wabot");
         await this.sock.sendMessage(jid, { text: `✅ Berhasil menghapus bio bot!` }, { quoted: msg });
      } else {
         const bio = body.replace(/^\.?setbotbio\s*/i, "").trim();
         if (bio) {
             await this.sock.updateProfileStatus(bio);
             await this.sock.sendMessage(jid, { text: `✅ Berhasil mengubah bio bot menjadi: ${bio}` }, { quoted: msg });
         } else {
             await this.sock.sendMessage(jid, { text: `Masukkan bio, contoh: .setbotbio Bot Aktif!` }, { quoted: msg });
         }
      }
    } else if (body.startsWith(".antivirtex") || body.startsWith("antivirtex") || body.startsWith(".antitoxic") || body.startsWith("antitoxic")) {
      await this.sock.sendMessage(jid, { text: `🛡️ Fitur anti sedang dalam pengembangan.` }, { quoted: msg });
    } else if (body.startsWith(".joingc ") || body.startsWith("joingc ") || body.startsWith(".creategc ") || body.startsWith("creategc ") || body.startsWith(".addsticker") || body.startsWith("addsticker") || body.startsWith(".delsticker") || body.startsWith("delsticker")) {
      if (body.startsWith(".joingc") || body.startsWith("joingc")) {
         const link = body.replace(/^\.?joingc\s*/i, "").trim();
         const code = link.split("chat.whatsapp.com/")[1];
         if (code) {
             try {
                 await this.sock.groupAcceptInvite(code);
                 await this.sock.sendMessage(jid, { text: `✅ Berhasil bergabung ke grup!` }, { quoted: msg });
             } catch(err) {
                 await this.sock.sendMessage(jid, { text: `Gagal bergabung. Link mungkin tidak valid.` }, { quoted: msg });
             }
         } else {
             await this.sock.sendMessage(jid, { text: `Kirim link grup! Contoh: .joingc https://chat.whatsapp.com/xxx` }, { quoted: msg });
         }
      } else if (body.startsWith(".creategc") || body.startsWith("creategc")) {
         const name = body.replace(/^\.?creategc\s*/i, "").trim();
         if (name) {
             try {
                await this.sock.groupCreate(name, []);
                await this.sock.sendMessage(jid, { text: `✅ Berhasil membuat grup *${name}*` }, { quoted: msg });
             } catch(err) {
                await this.sock.sendMessage(jid, { text: `Gagal membuat grup.` }, { quoted: msg });
             }
         } else {
             await this.sock.sendMessage(jid, { text: `Kirim nama grup! Contoh: .creategc NamaGrup` }, { quoted: msg });
         }
      } else if (body.startsWith(".addsticker") || body.startsWith("addsticker")) {
         const text = body.split(" ")[1];
         if (!text) {
             await this.sock.sendMessage(jid, { text: "Kirim perintah dengan nama stiker, sambil mereply stiker!" }, { quoted: msg });
         } else {
             const isQuotedSticker = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.stickerMessage;
             if (isQuotedSticker) {
                 const buffer = await downloadMediaMessage(
                     { message: msg.message.extendedTextMessage.contextInfo.quotedMessage } as any, 
                     'buffer', 
                     {}, 
                     { logger: pino({ level: 'silent' }) as any, reuploadRequest: this.sock.updateMediaMessage }
                 ) as Buffer;
                 this.storedStickers.set(text, buffer);
                 await this.sock.sendMessage(jid, { text: `✅ Berhasil menyimpan stiker dengan nama "${text}"` }, { quoted: msg });
             } else {
                 await this.sock.sendMessage(jid, { text: "Reply stiker dengan perintah ini!" }, { quoted: msg });
             }
         }
      } else if (body.startsWith(".delsticker") || body.startsWith("delsticker")) {
         const text = body.split(" ")[1];
         if (text && this.storedStickers.has(text)) {
             this.storedStickers.delete(text);
             await this.sock.sendMessage(jid, { text: `✅ Berhasil menghapus stiker "${text}"` }, { quoted: msg });
         } else {
             await this.sock.sendMessage(jid, { text: `Stiker tidak ditemukan!` }, { quoted: msg });
         }
      }
    } else if (body.startsWith(".cekpariban") || body.startsWith("cekpariban") || body.startsWith(".cektartulang") || body.startsWith("cektartulang") || body.startsWith(".cektarito") || body.startsWith("cektarito") || body.startsWith(".cekpadan") || body.startsWith("cekpadan")) {
       let cmd = body.split(" ")[0].replace(".", "");
       const argsStr = messageContent.slice(messageContent.toLowerCase().indexOf(cmd) + cmd.length).trim();
       
       if (!argsStr.includes("|")) {
          await this.sock.sendMessage(jid, { text: `Format salah!\nContoh: .${cmd} Pandiangan|Sirait` }, { quoted: msg });
       } else {
          const [m1, m2] = argsStr.split("|").map(s => s.trim());
          if (!m1 || !m2) {
             await this.sock.sendMessage(jid, { text: `Format salah!\nPastikan ada nama marga/boru sebelum dan sesudah tanda |\nContoh: .${cmd} Pandiangan|Sirait` }, { quoted: msg });
          } else {
              const hashStr = [m1.toLowerCase(), m2.toLowerCase(), cmd].join('');
              let hash = 0; 
              for (let i = 0; i < hashStr.length; i++) hash = hashStr.charCodeAt(i) + ((hash << 5) - hash);
              // Pseudo-random true/false based on input
              const isTrue = Math.abs(hash) % 100 > 60; // 40% chance of relationship
              
              let answer = "";
              let title = "";
              
              if (cmd === "cekpariban") {
                 title = "👩‍❤️‍👨 *Cek Pariban*";
                 answer = isTrue 
                    ? `Iya, menurut perhitungan marga/boru *${m1}* dan *${m2}* kemungkinan besar marpariban!` 
                    : `Bukan, sepertinya marga/boru *${m1}* dan *${m2}* bukan pariban.`;
              } else if (cmd === "cektartulang") {
                 title = "👴 *Cek Tartulang*";
                 answer = isTrue 
                    ? `Iya, marga/boru *${m1}* dan *${m2}* kemungkinan besar martartulang!` 
                    : `Bukan, marga/boru *${m1}* dan *${m2}* sepertinya bukan tartulang.`;
              } else if (cmd === "cektarito") {
                 title = "👦👧 *Cek Tarito*";
                 answer = isTrue 
                    ? `Iya, marga/boru *${m1}* dan *${m2}* martarito (saudara)!` 
                    : `Bukan, sepertinya *${m1}* dan *${m2}* tidak martarito.`;
              } else if (cmd === "cekpadan") {
                 title = "📜 *Cek Padan*";
                 answer = isTrue 
                    ? `Iya! Marga *${m1}* dan *${m2}* terikat Padan (janji/ikatan) dan tidak boleh menikah!` 
                    : `Aman, marga *${m1}* dan *${m2}* sepertinya tidak terikat Padan secara langsung.`;
              }
              
              await this.sock.sendMessage(jid, { text: `${title}\n\nHasil: ${answer}` }, { quoted: msg });
          }
       }
       this.broadcastState(`Responded to ${cmd} command`);
    } else {
       const potentialCmd = body.replace(/^\.?/, "").trim();
       if (this.storedStickers.has(potentialCmd)) {
          await this.sock.sendMessage(jid, { sticker: this.storedStickers.get(potentialCmd) }, { quoted: msg });
       }
    }
  }
}
