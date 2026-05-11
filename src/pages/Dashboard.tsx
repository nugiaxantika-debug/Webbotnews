import React, { useEffect, useState, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { QRCodeSVG } from "qrcode.react";
import { Activity, Power, RefreshCw, Trash2, Smartphone, ShieldCheck, FileText, Users, Gamepad2, Settings, Clock, LogOut, MoreVertical, X } from "lucide-react";
import { useNavigate } from "react-router-dom";

type BotStatus = "disconnected" | "connecting" | "connected";

interface StatusPayload {
  status: BotStatus;
  qr: string | null;
  uptime?: number | null;
}

interface LogEntry {
  time: string;
  message: string;
}

export default function Dashboard() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [status, setStatus] = useState<BotStatus>("disconnected");
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [massAddGroupId, setMassAddGroupId] = useState("");
  const [massAddNumbers, setMassAddNumbers] = useState("");
  const [groups, setGroups] = useState<{id: string, name: string}[]>([]);
  const [isLoadingGroups, setIsLoadingGroups] = useState(false);
  const [uptime, setUptime] = useState<number | null>(null);
  const [disconnectNotice, setDisconnectNotice] = useState<string | null>(null);
  const navigate = useNavigate();

  const currentUserEmail = localStorage.getItem("mock_user_email");
  const isAdmin = currentUserEmail === "nugiaxantika@gmail.com";

  const [totalUsers, setTotalUsers] = useState<number>(0);

  useEffect(() => {
    if (isAdmin) {
      const apiBaseURL = import.meta.env.VITE_APP_URL || window.location.origin;
      fetch(`${apiBaseURL}/api/users/count`)
        .then(res => res.json())
        .then(data => setTotalUsers(data.count || 0))
        .catch(err => console.error(err));
    }
  }, [isAdmin]);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [webConfig, setWebConfig] = useState({
    title: "Wabot",
    highlight: "Pro",
    heroTitle: "Otomatisasi WhatsApp Tanpa Batas.",
    heroDesc: "Platform bot WhatsApp profesional. Kelola grup, buat stiker otomatis, mainkan mini games, hingga manfaatkan fitur AI langsung dari satu dashboard.",
    contactEmail: "support@wabotpro.com",
    contactPhone: "+62 812-3456-7890",
    favicon: "",
    logo: "",
    feature1Title: "Manajemen Grup",
    feature1Desc: "Atur pesan welcome, keluarkan anggota, anti-link, hingga anti-spam secara otomatis dan aman.",
    feature2Title: "AI & Media",
    feature2Desc: "Ubah teks jadi stiker (brat), download video TikTok, hingga tanya jawab menggunakan chat AI (gemini).",
    feature3Title: "Keamanan Ekstra",
    feature3Desc: "Proteksi nomor dari ban dengan delay otomatis, pairing code tanpa QR, dan privasi penuh.",
    pricingTitle: "Pilih Paket Sesuai Kebutuhan Anda",
    pricingDesc: "Mulai dari uji coba gratis hingga akses VIP tanpa batas.",
    plan1Name: "Pro Plan",
    plan1Price: "Gratis",
    plan1Duration: "Coba gratis selama 3 hari",
    plan1Features: "1 Nomor Bot WhatsApp\nUnintrusive Dashboard\nUnlimited Command\nSupport QR & Pairing Code",
    plan1ButtonText: "Mulai Uji Coba Gratis",
    plan1AutoDisconnect: true,
    plan1Days: 3,
    plan2Name: "Pro VIP",
    plan2Price: "Rp 50.000",
    plan2Duration: "Akses penuh bulanan",
    plan2Features: "Semua fitur Pro Plan\nServer Uptime 24/7 (Prioritas)\nAuto Delete Session\nAkses Fitur AI Lanjutan\nSupport Prioritas Khusus VIP",
    plan2ButtonText: "Berlangganan VIP",
    plan2AutoDisconnect: false,
    plan2Days: 30,
    dashTitle: "WhatsApp Bot Dashboard",
    dashSubtitle: "Kelola bot WhatsApp Anda secara realtime, aman, dan 24 jam.",
    footerDesc: "Platform bot WhatsApp profesional. Layanan cepat, stabil, dan aman."
  });

  useEffect(() => {
    const apiBaseURL = import.meta.env.VITE_APP_URL || window.location.origin;
    fetch(`${apiBaseURL}/api/config`)
      .then(res => res.json())
      .then(data => {
        if (data.config && Object.keys(data.config).length > 0) {
          setWebConfig(prev => ({ ...prev, ...data.config }));
        }
      })
      .catch(console.error);
  }, []);

  // Simulate auto-disconnect logic
  useEffect(() => {
    if (status === "connected") {
      const connTime = localStorage.getItem("bot_connection_time");
      if (!connTime) {
        localStorage.setItem("bot_connection_time", Date.now().toString());
      } else {
        // Assume user is on Plan 1 for mock purposes unless admin
        const autoDisc = webConfig.plan1AutoDisconnect;
        const days = webConfig.plan1Days;
        
        if (autoDisc && days > 0) {
          const expiresAt = parseInt(connTime) + (days * 24 * 60 * 60 * 1000);
          if (Date.now() > expiresAt) {
            apiCall("stop");
            setDisconnectNotice(`Koneksi otomatis diputus dari sistem: Masa aktif paket Anda (${days} hari) telah habis.`);
            localStorage.removeItem("bot_connection_time");
            setLogs(prev => [...prev, { time: new Date().toISOString(), message: `[Sistem] Koneksi otomatis diputus karena masa aktif telah habis.`}]);
          }
        }
      }
    }
  }, [status, webConfig]);

  useEffect(() => {
    if (status === "connected") {
      fetchGroups();
    }
  }, [status]);

  const fetchGroups = async () => {
    setIsLoadingGroups(true);
    try {
      const apiBaseURL = import.meta.env.VITE_APP_URL || window.location.origin;
      const res = await fetch(`${apiBaseURL}/api/whatsapp/groups`, {
        headers: { "x-user-email": currentUserEmail || "default" }
      });
      const data = await res.json();
      if (data.success) {
        setGroups(data.groups || []);
        if (data.groups && data.groups.length > 0 && !massAddGroupId) {
          setMassAddGroupId(data.groups[0].id);
        }
      }
    } catch (e) {
      console.error("Failed to fetch groups", e);
    } finally {
      setIsLoadingGroups(false);
    }
  };

  useEffect(() => {
    let tickInterval = setInterval(() => {
      setUptime(prev => prev !== null ? prev + 1000 : null);
    }, 1000);
    return () => clearInterval(tickInterval);
  }, []);

  useEffect(() => {
    const socketUrl = import.meta.env.VITE_APP_URL || window.location.origin;
    const newSocket = io(socketUrl, { 
      path: "/socket.io",
      query: { userEmail: currentUserEmail || "default" }
    });

    newSocket.on("connect", () => {
      console.log("Connected to WebSocket Server");
    });

    newSocket.on("status", (data: StatusPayload) => {
      setStatus(data.status);
      setQrCode(data.qr);
      if (data.status === "connected") {
        setPairingCode(null);
      }
      setUptime(data.uptime ?? null);
    });

    newSocket.on("qr", (qr: string) => {
      setQrCode(qr);
      setPairingCode(null);
    });

    newSocket.on("pairing_code", (code: string) => {
      setPairingCode(code);
      setQrCode(null);
    });

    newSocket.on("log", (log: LogEntry) => {
      setLogs((prev) => [...prev, log].slice(-100)); // Keep last 100 logs
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const apiCall = async (endpoint: string, body?: any) => {
    try {
      const res = await fetch(`/api/whatsapp/${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-email": currentUserEmail || "default"
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return await res.json();
    } catch (err) {
      console.error(`Error calling ${endpoint}:`, err);
    }
  };

  const handleStart = () => {
    setLogs((prev) => [...prev, { time: new Date().toISOString(), message: "Initiating Start..." }]);
    apiCall("start", { phoneNumber: phoneNumber.replace(/\D/g, '') || undefined });
  };

  const handleStop = () => apiCall("stop");
  const handleRestart = () => apiCall("restart");
  const handleDeleteSession = () => {
    if (!isConfirmingDelete) {
      setIsConfirmingDelete(true);
      setTimeout(() => setIsConfirmingDelete(false), 5000);
      return;
    }
    setIsConfirmingDelete(false);
    apiCall("delete-session");
  };

  const handleMassAdd = () => {
    let gid = massAddGroupId.trim();
    if (gid.includes("chat.whatsapp.com/")) {
      alert("Note: Menambahkan anggota massal via link invite belum disupport langsung. Masukkan Group ID yang valid (berakhiran @g.us).");
      return;
    }
    const numbersList = massAddNumbers.split(/[\n,]+/).map(n => n.trim()).filter(n => n);
    if (!gid || numbersList.length === 0) return;
    
    setLogs((prev) => [...prev, { time: new Date().toISOString(), message: `Initiating mass add tags to ${gid}...` }]);
    apiCall("mass-add-members", { groupId: gid, numbers: numbersList }).then(res => {
       if (res?.error) {
           setLogs((prev) => [...prev, { time: new Date().toISOString(), message: `Error: ${res.error}` }]);
       } else {
           setLogs((prev) => [...prev, { time: new Date().toISOString(), message: `Success: ${res.message}` }]);
           setMassAddNumbers(""); 
       }
    });
  };

  const formatUptime = (ms: number | null) => {
    if (ms === null) return "0s";
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    const parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0 || hours > 0) parts.push(`${minutes}m`);
    parts.push(`${seconds}s`);
    
    return parts.join(' ');
  };

  const handleSaveSettings = async () => {
    try {
      const apiBaseURL = import.meta.env.VITE_APP_URL || window.location.origin;
      const res = await fetch(`${apiBaseURL}/api/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: webConfig })
      });
      if (!res.ok) {
        throw new Error('Gagal menyimpan pengaturan');
      }
      setIsSettingsOpen(false);
      alert('Pengaturan berhasil disimpan!');
    } catch (err) {
      console.error(err);
      alert('Gagal menyimpan pengaturan. Silakan coba lagi.');
    }
  };
  
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, key: string) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setWebConfig(prev => ({ ...prev, [key]: ev.target?.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-200 font-sans p-4 md:p-8">
      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl max-w-2xl w-full flex flex-col max-h-[90vh] animate-in fade-in zoom-in duration-300 relative">
            <div className="p-6 border-b border-neutral-800 flex justify-between items-center bg-neutral-900 rounded-t-2xl z-10">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <Settings className="w-5 h-5 text-indigo-400" /> Pengaturan Website
              </h2>
              <button 
                onClick={() => setIsSettingsOpen(false)}
                className="text-neutral-500 hover:text-white"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="p-6 space-y-8 overflow-y-auto custom-scrollbar">
              {/* Media & Brand */}
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-indigo-400 uppercase tracking-wider">Identitas Brand</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-neutral-400 mb-1.5 block">Judul Dashboard</label>
                    <input 
                      type="text" 
                      value={webConfig.dashTitle}
                      onChange={(e) => setWebConfig({...webConfig, dashTitle: e.target.value})}
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-indigo-500 mb-2"
                      placeholder="WhatsApp Bot Dashboard"
                    />
                    <input 
                      type="text" 
                      value={webConfig.dashSubtitle}
                      onChange={(e) => setWebConfig({...webConfig, dashSubtitle: e.target.value})}
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-indigo-500"
                      placeholder="Deskripsi dashboard"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-neutral-400 mb-1.5 block">Judul Profil (Wabot)</label>
                    <input 
                      type="text" 
                      value={webConfig.title}
                      onChange={(e) => setWebConfig({...webConfig, title: e.target.value})}
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-neutral-400 mb-1.5 block">Highlight Profil (Pro)</label>
                    <input 
                      type="text" 
                      value={webConfig.highlight}
                      onChange={(e) => setWebConfig({...webConfig, highlight: e.target.value})}
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-neutral-400 mb-1.5 block">Upload Favicon (.ico/.png)</label>
                    <input 
                      type="file" 
                      accept="image/*"
                      onChange={(e) => handleImageUpload(e, "favicon")}
                      className="w-full text-sm text-neutral-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-500/20 file:text-indigo-400 hover:file:bg-indigo-500/30"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-neutral-400 mb-1.5 block">Upload Logo (.png/.jpg)</label>
                    <input 
                      type="file" 
                      accept="image/*"
                      onChange={(e) => handleImageUpload(e, "logo")}
                      className="w-full text-sm text-neutral-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-emerald-500/20 file:text-emerald-400 hover:file:bg-emerald-500/30"
                    />
                  </div>
                </div>
              </div>

              {/* Beranda (Hero) */}
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-indigo-400 uppercase tracking-wider">Bagian Beranda (Hero)</h3>
                <div>
                  <label className="text-sm font-medium text-neutral-400 mb-1.5 block">Judul Utama</label>
                  <input 
                    type="text" 
                    value={webConfig.heroTitle}
                    onChange={(e) => setWebConfig({...webConfig, heroTitle: e.target.value})}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-neutral-400 mb-1.5 block">Deskripsi Beranda</label>
                  <textarea 
                    rows={3}
                    value={webConfig.heroDesc}
                    onChange={(e) => setWebConfig({...webConfig, heroDesc: e.target.value})}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-indigo-500 resize-none"
                  />
                </div>
              </div>

              {/* Fitur 1 */}
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-indigo-400 uppercase tracking-wider">Fitur 1</h3>
                <div>
                  <label className="text-sm font-medium text-neutral-400 mb-1.5 block">Judul Fitur 1</label>
                  <input type="text" value={webConfig.feature1Title} onChange={(e) => setWebConfig({...webConfig, feature1Title: e.target.value})} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-indigo-500" />
                </div>
                <div>
                  <label className="text-sm font-medium text-neutral-400 mb-1.5 block">Deskripsi Fitur 1</label>
                  <textarea rows={2} value={webConfig.feature1Desc} onChange={(e) => setWebConfig({...webConfig, feature1Desc: e.target.value})} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-indigo-500 resize-none" />
                </div>
              </div>

              {/* Fitur 2 */}
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-indigo-400 uppercase tracking-wider">Fitur 2</h3>
                <div>
                  <label className="text-sm font-medium text-neutral-400 mb-1.5 block">Judul Fitur 2</label>
                  <input type="text" value={webConfig.feature2Title} onChange={(e) => setWebConfig({...webConfig, feature2Title: e.target.value})} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-indigo-500" />
                </div>
                <div>
                  <label className="text-sm font-medium text-neutral-400 mb-1.5 block">Deskripsi Fitur 2</label>
                  <textarea rows={2} value={webConfig.feature2Desc} onChange={(e) => setWebConfig({...webConfig, feature2Desc: e.target.value})} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-indigo-500 resize-none" />
                </div>
              </div>

              {/* Fitur 3 */}
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-indigo-400 uppercase tracking-wider">Fitur 3</h3>
                <div>
                  <label className="text-sm font-medium text-neutral-400 mb-1.5 block">Judul Fitur 3</label>
                  <input type="text" value={webConfig.feature3Title} onChange={(e) => setWebConfig({...webConfig, feature3Title: e.target.value})} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-indigo-500" />
                </div>
                <div>
                  <label className="text-sm font-medium text-neutral-400 mb-1.5 block">Deskripsi Fitur 3</label>
                  <textarea rows={2} value={webConfig.feature3Desc} onChange={(e) => setWebConfig({...webConfig, feature3Desc: e.target.value})} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-indigo-500 resize-none" />
                </div>
              </div>

              {/* Pricing */}
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-indigo-400 uppercase tracking-wider">Bagian Harga & Paket</h3>
                <div>
                  <label className="text-sm font-medium text-neutral-400 mb-1.5 block">Judul Bagian Harga</label>
                  <input type="text" value={webConfig.pricingTitle} onChange={(e) => setWebConfig({...webConfig, pricingTitle: e.target.value})} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-indigo-500" />
                </div>
                <div>
                  <label className="text-sm font-medium text-neutral-400 mb-1.5 block">Deskripsi Harga</label>
                  <input type="text" value={webConfig.pricingDesc} onChange={(e) => setWebConfig({...webConfig, pricingDesc: e.target.value})} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-indigo-500" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-neutral-400 mb-1.5 block">Paket 1 (Free)</label>
                    <input type="text" value={webConfig.plan1Name} onChange={(e) => setWebConfig({...webConfig, plan1Name: e.target.value})} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-indigo-500 mb-2" placeholder="Nama Paket" />
                    <input type="text" value={webConfig.plan1Price} onChange={(e) => setWebConfig({...webConfig, plan1Price: e.target.value})} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-indigo-500 mb-2" placeholder="Harga" />
                    <input type="text" value={webConfig.plan1Duration} onChange={(e) => setWebConfig({...webConfig, plan1Duration: e.target.value})} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-indigo-500 mb-2" placeholder="Durasi/Keterangan" />
                    <textarea rows={3} value={webConfig.plan1Features} onChange={(e) => setWebConfig({...webConfig, plan1Features: e.target.value})} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-indigo-500 mb-2 resize-none" placeholder="Fitur Poin per baris" />
                    <input type="text" value={webConfig.plan1ButtonText} onChange={(e) => setWebConfig({...webConfig, plan1ButtonText: e.target.value})} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-indigo-500 mb-2" placeholder="Teks Tombol CTA" />
                    <div className="flex items-center gap-2 mb-2">
                       <input type="checkbox" checked={webConfig.plan1AutoDisconnect} onChange={(e) => setWebConfig({...webConfig, plan1AutoDisconnect: e.target.checked})} className="w-4 h-4 text-indigo-500 bg-neutral-950 border-neutral-800 focus:ring-indigo-500" />
                       <span className="text-sm text-neutral-400">Otomatis Disconnect Bot</span>
                    </div>
                    {webConfig.plan1AutoDisconnect && (
                       <input type="number" value={webConfig.plan1Days} onChange={(e) => setWebConfig({...webConfig, plan1Days: parseInt(e.target.value) || 0})} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-indigo-500" placeholder="Jumlah Hari Aktif" />
                    )}
                  </div>
                  <div>
                    <label className="text-sm font-medium text-neutral-400 mb-1.5 block">Paket 2 (VIP)</label>
                    <input type="text" value={webConfig.plan2Name} onChange={(e) => setWebConfig({...webConfig, plan2Name: e.target.value})} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-indigo-500 mb-2" placeholder="Nama Paket" />
                    <input type="text" value={webConfig.plan2Price} onChange={(e) => setWebConfig({...webConfig, plan2Price: e.target.value})} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-indigo-500 mb-2" placeholder="Harga" />
                    <input type="text" value={webConfig.plan2Duration} onChange={(e) => setWebConfig({...webConfig, plan2Duration: e.target.value})} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-indigo-500 mb-2" placeholder="Durasi/Keterangan" />
                    <textarea rows={3} value={webConfig.plan2Features} onChange={(e) => setWebConfig({...webConfig, plan2Features: e.target.value})} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-indigo-500 mb-2 resize-none" placeholder="Fitur Poin per baris" />
                    <input type="text" value={webConfig.plan2ButtonText} onChange={(e) => setWebConfig({...webConfig, plan2ButtonText: e.target.value})} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-indigo-500 mb-2" placeholder="Teks Tombol CTA" />
                    <div className="flex items-center gap-2 mb-2">
                       <input type="checkbox" checked={webConfig.plan2AutoDisconnect} onChange={(e) => setWebConfig({...webConfig, plan2AutoDisconnect: e.target.checked})} className="w-4 h-4 text-indigo-500 bg-neutral-950 border-neutral-800 focus:ring-indigo-500" />
                       <span className="text-sm text-neutral-400">Otomatis Disconnect Bot</span>
                    </div>
                    {webConfig.plan2AutoDisconnect && (
                       <input type="number" value={webConfig.plan2Days} onChange={(e) => setWebConfig({...webConfig, plan2Days: parseInt(e.target.value) || 0})} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-indigo-500" placeholder="Jumlah Hari Aktif" />
                    )}
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-indigo-400 uppercase tracking-wider">Bagian Footer</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-neutral-400 mb-1.5 block">Email Kontak</label>
                    <input 
                      type="email" 
                      value={webConfig.contactEmail}
                      onChange={(e) => setWebConfig({...webConfig, contactEmail: e.target.value})}
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-neutral-400 mb-1.5 block">Nomor Support</label>
                    <input 
                      type="text" 
                      value={webConfig.contactPhone}
                      onChange={(e) => setWebConfig({...webConfig, contactPhone: e.target.value})}
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-neutral-400 mb-1.5 block">Deskripsi Footer</label>
                  <textarea rows={2} value={webConfig.footerDesc} onChange={(e) => setWebConfig({...webConfig, footerDesc: e.target.value})} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-indigo-500 resize-none" />
                </div>
              </div>

            </div>
            
            <div className="p-6 border-t border-neutral-800 bg-neutral-900 rounded-b-2xl">
              <button 
                onClick={handleSaveSettings}
                className="w-full bg-indigo-500 hover:bg-indigo-600 text-white font-bold py-3 rounded-xl transition-colors"
                >
                Simpan Semua Pengaturan
              </button>
            </div>
          </div>
        </div>
      )}

      {pairingCode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-neutral-900 border border-indigo-500/30 rounded-2xl p-8 shadow-2xl max-w-md w-full animate-in fade-in zoom-in duration-300">
            <div className="text-center">
              <div className="bg-indigo-500/20 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <Smartphone className="w-8 h-8 text-indigo-400" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Kode Tautan WhatsApp Anda</h2>
              <p className="text-sm text-neutral-400 mb-6">Masukkan kode ini di aplikasi WhatsApp Anda untuk menautkan perangkat.</p>
              
              <div className="bg-neutral-950 border border-neutral-800 p-6 rounded-xl mb-6">
                <h3 className="text-4xl font-mono tracking-[0.2em] font-bold text-indigo-400 select-all cursor-text">{pairingCode}</h3>
              </div>
              
              <ol className="text-left text-sm text-neutral-400 space-y-3 mb-6 px-4">
                <li className="flex gap-2"><span className="text-indigo-400 font-bold">1.</span> Buka WhatsApp di HP Anda</li>
                <li className="flex gap-2"><span className="text-indigo-400 font-bold">2.</span> Ketuk ikon titik tiga (⋮) atau Pengaturan</li>
                <li className="flex gap-2"><span className="text-indigo-400 font-bold">3.</span> Pilih <b>Perangkat Tertaut</b></li>
                <li className="flex gap-2"><span className="text-indigo-400 font-bold">4.</span> Ketuk <b>Tautkan dengan nomor telepon saja</b> di bawah qr code</li>
                <li className="flex gap-2"><span className="text-indigo-400 font-bold">5.</span> Masukkan kode di atas</li>
              </ol>

              <button 
                onClick={() => setPairingCode(null)}
                className="w-full bg-neutral-800 hover:bg-neutral-700 text-white font-medium py-3 rounded-xl transition-colors"
              >
                Tutup Peringatan
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="max-w-6xl mx-auto space-y-6">
        
        {disconnectNotice && (
          <div className="bg-rose-500/10 border border-rose-500/30 p-4 rounded-xl flex items-center justify-between">
            <p className="text-rose-400 font-medium text-sm">{disconnectNotice}</p>
            <button onClick={() => setDisconnectNotice(null)} className="text-rose-400 hover:text-white">
              <X className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* Header */}
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center bg-neutral-900 p-6 rounded-2xl border border-neutral-800 shadow-xl">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
              <span className="bg-emerald-500/20 p-2 rounded-lg"><Smartphone className="w-8 h-8 text-emerald-400" /></span>
              {webConfig.dashTitle}
            </h1>
            <p className="text-neutral-400 mt-2">{webConfig.dashSubtitle}</p>
          </div>
          
          <div className="mt-4 md:mt-0 flex gap-4 items-center relative">
            <div className="flex items-center gap-3 bg-neutral-950 px-4 py-2 rounded-full border border-neutral-800">
              <div className={`w-3 h-3 rounded-full animate-pulse ${status === 'connected' ? 'bg-emerald-500' : status === 'connecting' ? 'bg-amber-500' : 'bg-rose-500'}`} />
              <span className="font-semibold text-sm uppercase tracking-wider">
                {status === 'connected' ? 'Aktif' : status === 'connecting' ? 'Menyambungkan' : 'Terputus'}
              </span>
            </div>
            <button 
              onClick={() => { localStorage.removeItem("mock_user_email"); navigate("/"); }}
              className="flex items-center gap-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 px-4 py-2 rounded-full border border-rose-500/30 transition-colors"
            >
              <LogOut className="w-4 h-4" /> Keluar
            </button>
            {isAdmin && (
              <div className="relative z-50">
                <button 
                  onClick={() => setShowDropdown(!showDropdown)}
                  className="p-2 bg-neutral-950 border border-neutral-800 hover:bg-neutral-800 rounded-full transition-colors text-neutral-400 hover:text-white"
                >
                  <MoreVertical className="w-5 h-5" />
                </button>
                {showDropdown && (
                  <div className="absolute right-0 mt-2 w-56 bg-neutral-900 border border-neutral-800 rounded-xl shadow-2xl overflow-hidden">
                    <button 
                      onClick={() => { setIsSettingsOpen(true); setShowDropdown(false); }}
                      className="w-full text-left px-4 py-3 text-sm text-neutral-300 hover:bg-neutral-800 hover:text-white transition-colors flex items-center gap-3"
                    >
                      <Settings className="w-4 h-4" /> Edit Landing Page
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Main Controls & Connection */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Connection Card */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-lg">
              <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
                <Activity className="w-5 h-5 text-indigo-400" /> Status Koneksi
              </h2>
              
              <div className="flex flex-col md:flex-row gap-8 items-center bg-neutral-950/50 p-6 rounded-xl border border-neutral-800/50">
                {/* QR Section */}
                <div className="flex-shrink-0 flex flex-col items-center justify-center bg-white p-4 rounded-xl shadow-inner min-w-[200px] min-h-[200px]">
                  {status === "connected" ? (
                    <div className="text-emerald-600 flex flex-col items-center justify-center p-4">
                      <ShieldCheck className="w-16 h-16 mb-2" />
                      <span className="font-bold text-center">Terhubung Aman</span>
                      <span className="text-xs mt-2 font-semibold text-emerald-700 bg-emerald-100/50 px-2 py-1 rounded w-full flex items-center justify-center gap-1">
                        <Clock className="w-3 h-3" /> Uptime: {formatUptime(uptime)}
                      </span>
                      <span className="text-[10px] mt-1 text-emerald-600/70 whitespace-nowrap">Anti-ban Protection: Aktif</span>
                    </div>
                  ) : qrCode ? (
                    <div className="text-center">
                      <QRCodeSVG value={qrCode} size={200} />
                      <p className="text-xs text-neutral-500 mt-2 font-medium">Scan QR Code ini</p>
                    </div>
                  ) : status === "connecting" ? (
                    <div className="text-amber-500 flex flex-col items-center justify-center">
                      <RefreshCw className="w-12 h-12 mb-2 animate-spin" />
                      <span className="font-medium text-sm text-center">Memuat Kode...</span>
                    </div>
                  ) : (
                    <div className="text-neutral-500 flex flex-col items-center justify-center">
                      <Power className="w-12 h-12 mb-2 opacity-50" />
                      <span className="font-medium text-sm text-center">Bot Offline</span>
                    </div>
                  )}
                </div>

                {/* Pairing Code Section */}
                <div className="flex-grow space-y-4 w-full">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-neutral-400">Atau gunakan Nomor WhatsApp</label>
                    <div className="flex gap-2">
                      <input 
                        type="text" 
                        placeholder="Contoh: 628123456789" 
                        className="flex-grow bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value)}
                        disabled={status !== 'disconnected'}
                      />
                    </div>
                    <p className="text-xs text-neutral-500">Isi nomor dan klik Start untuk mendapatkan Pairing Code (menautkan dengan nomor saja).</p>
                  </div>

                  {/* Removed inline pairing code, moved to modal */}
                </div>
              </div>
            </div>

            {/* Actions Card */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-lg">

              <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
                <Settings className="w-5 h-5 text-rose-400" /> Kontrol Panel
              </h2>
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <button 
                  onClick={handleStart}
                  disabled={status !== "disconnected"}
                  className="flex flex-col items-center justify-center p-4 bg-neutral-950 border border-emerald-500/20 hover:border-emerald-500/50 hover:bg-emerald-500/10 text-emerald-400 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
                >
                  <Power className="w-6 h-6 mb-2 group-hover:scale-110 transition-transform" />
                  <span className="font-medium text-sm">Start / On</span>
                </button>
                
                <button 
                  onClick={handleStop}
                  disabled={status === "disconnected"}
                  className="flex flex-col items-center justify-center p-4 bg-neutral-950 border border-amber-500/20 hover:border-amber-500/50 hover:bg-amber-500/10 text-amber-400 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
                >
                  <Power className="w-6 h-6 mb-2 group-hover:scale-110 transition-transform" />
                  <span className="font-medium text-sm">Stop / Off</span>
                </button>

                <button 
                  onClick={handleRestart}
                  className="flex flex-col items-center justify-center p-4 bg-neutral-950 border border-sky-500/20 hover:border-sky-500/50 hover:bg-sky-500/10 text-sky-400 rounded-xl transition-all group"
                >
                  <RefreshCw className="w-6 h-6 mb-2 group-hover:rotate-180 transition-transform duration-500" />
                  <span className="font-medium text-sm">Restart Bot</span>
                </button>

                <button 
                  onClick={handleDeleteSession}
                  className={`flex flex-col items-center justify-center p-4 rounded-xl transition-all group ${
                    isConfirmingDelete 
                      ? "bg-rose-500/20 border-rose-500 text-rose-400 border animate-pulse" 
                      : "bg-neutral-950 border border-rose-500/20 hover:border-rose-500/50 hover:bg-rose-500/10 text-rose-400"
                  }`}
                >
                  <Trash2 className={`w-6 h-6 mb-2 transition-transform ${isConfirmingDelete ? "scale-110" : "group-hover:-translate-y-1"}`} />
                  <span className="font-medium text-sm text-center">{isConfirmingDelete ? "Klik Lagi (Yakin?)" : "Hapus Sesi"}</span>
                </button>
              </div>
            </div>

            {/* Mass Add Members */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-lg">
              <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
                <Users className="w-5 h-5 text-emerald-400" /> Mass Add Anggota Grup
              </h2>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-sm font-medium text-neutral-400">Pilih Grup (Diperlukan Bot didalam Grup)</label>
                    <button 
                      onClick={fetchGroups} 
                      disabled={isLoadingGroups} 
                      className="text-emerald-400 text-xs flex items-center gap-1 hover:text-emerald-300 transition-colors"
                    >
                      <RefreshCw className={`w-3 h-3 ${isLoadingGroups ? "animate-spin" : ""}`} /> Refresh List
                    </button>
                  </div>
                  {groups.length > 0 ? (
                    <select 
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all appearance-none"
                      value={massAddGroupId}
                      onChange={(e) => setMassAddGroupId(e.target.value)}
                    >
                      {groups.map(group => (
                        <option key={group.id} value={group.id}>{group.name || group.id}</option>
                      ))}
                    </select>
                  ) : (
                    <div className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-2 text-neutral-500 text-sm">
                      {status === "connected" ? "Tidak ada grup ditemukan. Pastikan bot sudah dimasukkan ke grup." : "Bot belum terhubung."}
                    </div>
                  )}
                </div>
                <div>
                  <label className="text-sm font-medium text-neutral-400">Daftar Nomor Target (Pisahkan dengan koma atau baris baru)</label>
                  <textarea 
                    rows={4}
                    placeholder="Contoh: 628123456789, 628987654321..."
                    className="w-full mt-1 bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
                    value={massAddNumbers}
                    onChange={(e) => setMassAddNumbers(e.target.value)}
                  />
                </div>
                <button
                  onClick={handleMassAdd}
                  disabled={status !== "connected" || !massAddGroupId || !massAddNumbers}
                  className="w-full py-3 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/50 text-emerald-400 font-medium rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed mt-2"
                >
                  Eksekusi Mass Add
                </button>
              </div>
            </div>

            {/* Menu Preview */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-lg">
              <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
                <FileText className="w-5 h-5 text-fuchsia-400" /> Fitur Menu Bot (Tes Fitur)
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-neutral-950 border border-neutral-800 p-4 rounded-xl flex items-start gap-4">
                  <div className="bg-emerald-500/20 p-2 rounded-lg text-emerald-400 mt-1"><FileText className="w-5 h-5" /></div>
                  <div>
                    <h3 className="font-semibold text-white text-sm">.allmenu</h3>
                    <p className="text-xs text-neutral-400 mt-1">Kirim perintah ini untuk melihat semua menu yang tersedia.</p>
                  </div>
                </div>
                <div className="bg-neutral-950 border border-neutral-800 p-4 rounded-xl flex items-start gap-4">
                  <div className="bg-blue-500/20 p-2 rounded-lg text-blue-400 mt-1"><Users className="w-5 h-5" /></div>
                  <div>
                    <h3 className="font-semibold text-white text-sm">.groupmenu</h3>
                    <p className="text-xs text-neutral-400 mt-1">Fitur admin grup seperti hidetag, kick, dan add anggota.</p>
                  </div>
                </div>
                <div className="bg-neutral-950 border border-neutral-800 p-4 rounded-xl flex items-start gap-4">
                  <div className="bg-purple-500/20 p-2 rounded-lg text-purple-400 mt-1"><Gamepad2 className="w-5 h-5" /></div>
                  <div>
                    <h3 className="font-semibold text-white text-sm">.gamemenu</h3>
                    <p className="text-xs text-neutral-400 mt-1">Menampilkan menu game seperti tebak gambar, dll.</p>
                  </div>
                </div>
                <div className="bg-neutral-950 border border-neutral-800 p-4 rounded-xl flex items-start gap-4">
                  <div className="bg-amber-500/20 p-2 rounded-lg text-amber-400 mt-1"><Settings className="w-5 h-5" /></div>
                  <div>
                    <h3 className="font-semibold text-white text-sm">.ownermenu</h3>
                    <p className="text-xs text-neutral-400 mt-1">Menu khusus: .addnamabot, .delnamabot, broadcast & manajemen.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Admin Web Control */}
            {isAdmin && (
              <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-lg">
                <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-indigo-400" /> Admin Control Web (Preview)
                </h2>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                  <div className="bg-neutral-950 border border-neutral-800 p-4 rounded-xl flex items-center gap-4">
                    <div className="bg-blue-500/20 p-3 rounded-xl text-blue-400"><Users className="w-6 h-6" /></div>
                    <div>
                      <h3 className="text-2xl font-bold text-white">{totalUsers}</h3>
                      <p className="text-xs text-neutral-400 mt-1">Total Pengguna Terdaftar</p>
                    </div>
                  </div>
                  <div className="bg-neutral-950 border border-neutral-800 p-4 rounded-xl flex items-center gap-4">
                    <div className="bg-emerald-500/20 p-3 rounded-xl text-emerald-400"><Smartphone className="w-6 h-6" /></div>
                    <div>
                      <h3 className="text-2xl font-bold text-white">{status === 'connected' ? '1' : '0'}</h3>
                      <p className="text-xs text-neutral-400 mt-1">Nomor Aktif Terhubung</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-sm font-medium text-neutral-400">Manajemen Nomor Aktif</h3>
                  {status === 'connected' ? (
                    <div className="bg-neutral-950 border border-neutral-800 p-4 rounded-xl flex items-center justify-between">
                      <div className="flex items-center gap-3">
                         <span className="relative flex h-3 w-3">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                        </span>
                        <div>
                          <p className="text-sm font-medium text-white">Bot Sesi Utama</p>
                          <p className="text-xs text-neutral-500">Uptime: {formatUptime(uptime)}</p>
                        </div>
                      </div>
                      <button 
                        onClick={handleDeleteSession}
                        className="text-xs bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 px-3 py-1.5 rounded-lg transition-colors border border-rose-500/30"
                      >
                        Putuskan Sesi
                      </button>
                    </div>
                  ) : (
                    <div className="bg-neutral-950 border border-neutral-800 p-4 rounded-xl text-center text-sm text-neutral-500">
                      Tidak ada nomor bot yang sedang terhubung.
                    </div>
                  )}
                </div>
              </div>
            )}

          </div>

          {/* Terminal / Logs */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl shadow-lg flex flex-col h-[600px] lg:h-auto overflow-hidden">
            <div className="bg-neutral-950/80 border-b border-neutral-800 p-4 flex items-center justify-between z-10">
              <h2 className="text-sm font-semibold text-neutral-300 font-mono flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                System Logs
              </h2>
            </div>
            <div className="flex-grow p-4 overflow-y-auto space-y-2 font-mono text-xs text-neutral-400 bg-neutral-950/50">
              {logs.length === 0 ? (
                <div className="text-neutral-600 italic">No logs yet...</div>
              ) : (
                logs.map((log, i) => (
                  <div key={i} className="animate-in fade-in slide-in-from-bottom-1 border-b border-neutral-800/50 pb-2 last:border-0">
                    <span className="text-indigo-400/70 mr-2">[{new Date(log.time).toLocaleTimeString()}]</span>
                    <span className={log.message.includes('Error') || log.message.includes('Failed') ? 'text-rose-400' : log.message.includes('success') ? 'text-emerald-400' : 'text-neutral-300'}>
                      {log.message}
                    </span>
                  </div>
                ))
              )}
              <div ref={logsEndRef} />
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
