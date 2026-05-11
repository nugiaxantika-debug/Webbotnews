import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Moon, Sun, Smartphone, Zap, Shield, MessageCircle, ArrowRight, CheckCircle2, Mail, Phone } from "lucide-react";

export default function Landing() {
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('theme');
    return saved ? saved === 'dark' : true;
  });

  useEffect(() => {
    localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

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
    footerDesc: "Platform bot WhatsApp profesional. Layanan cepat, stabil, dan aman.",
    loginTitle: "Selamat Datang",
    loginSubtitle: "Masuk ke dasbor WabotPro Anda",
    loginEmailParam: "Email",
    loginEmailPlaceholder: "nama@email.com",
    loginPasswordParam: "Password",
    loginPasswordPlaceholder: "••••••••",
    loginButtonText: "Masuk",
    loginRegisterText: "Belum punya akun? Daftar"
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

  useEffect(() => {
    if (webConfig.favicon) {
      let link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = webConfig.favicon;
    }
    document.title = `${webConfig.title}${webConfig.highlight}`;
  }, [webConfig]);

  useEffect(() => {
    const userEmail = localStorage.getItem("mock_user_email");
    if (userEmail) {
      navigate("/dashboard");
    }
  }, [navigate]);

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    
    try {
      const endpoint = isRegisterMode ? "/api/auth/register" : "/api/auth/login";
      const apiBaseURL = import.meta.env.VITE_APP_URL || window.location.origin;
      const res = await fetch(`${apiBaseURL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Terjadi kesalahan.");
        return;
      }
      localStorage.setItem("mock_user_email", email);
      navigate("/dashboard");
    } catch (err: any) {
      setError(err.message || "Terjadi kesalahan koneksi.");
    }
  };

  return (
    <div className={`min-h-screen font-sans ${isDarkMode ? "dark" : ""}`}>
      <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-800 dark:text-neutral-200 transition-colors">
      {/* Navbar */}
      <nav className="fixed top-0 w-full z-40 bg-white/80 dark:bg-neutral-950/80 backdrop-blur-md border-b border-black/5 dark:border-white/5">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {webConfig.logo ? (
              <img src={webConfig.logo} alt="Logo" className="w-10 h-10 object-contain rounded-xl" />
            ) : (
              <div className="bg-emerald-500/20 p-2 rounded-xl">
                <Smartphone className="w-6 h-6 text-emerald-400" />
              </div>
            )}
            <span className="text-xl font-bold text-neutral-900 dark:text-white tracking-tight">{webConfig.title}<span className="text-emerald-400">{webConfig.highlight}</span></span>
          </div>
          
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsDarkMode(!isDarkMode)}
              className="p-2 rounded-xl bg-neutral-200 dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors"
              aria-label="Toggle Dark Mode"
            >
              {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            <button 
              onClick={() => setIsLoginModalOpen(true)}
              className="hidden sm:block bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 px-5 py-2 rounded-xl font-bold text-sm hover:opacity-90 transition-opacity"
            >
              Masuk
            </button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-40 pb-20 px-6 max-w-7xl mx-auto text-center">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm font-medium mb-8">
          <Zap className="w-4 h-4" />
          <span>V2.0 Tersedia Sekarang</span>
        </div>
        <h1 className="text-5xl md:text-7xl font-bold text-neutral-900 dark:text-white tracking-tight mb-8 leading-tight max-w-4xl mx-auto">
          {webConfig.heroTitle}
        </h1>
        <p className="text-lg md:text-xl text-neutral-600 dark:text-neutral-400 mb-12 max-w-2xl mx-auto leading-relaxed">
          {webConfig.heroDesc}
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <button 
            onClick={() => setIsLoginModalOpen(true)}
            className="bg-emerald-500 hover:bg-emerald-600 text-neutral-900 dark:text-white px-8 py-4 rounded-full font-bold text-lg transition-colors flex items-center gap-2 w-full sm:w-auto justify-center"
          >
            Mulai Sekarang <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      </section>

      {/* Features */}
      <section className="py-24 bg-neutral-100/50 dark:bg-neutral-900/50 border-y border-black/5 dark:border-white/5 relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-6">
          <h2 className="text-3xl font-bold text-center text-neutral-900 dark:text-white mb-16">Fitur Unggulan</h2>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-neutral-50 dark:bg-neutral-950 border border-neutral-300 dark:border-neutral-800 p-8 rounded-3xl hover:border-emerald-500/30 transition-colors">
              <div className="bg-blue-500/10 w-14 h-14 rounded-2xl flex items-center justify-center mb-6">
                <MessageCircle className="w-7 h-7 text-blue-400" />
              </div>
              <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-3">{webConfig.feature1Title}</h3>
              <p className="text-neutral-600 dark:text-neutral-400 leading-relaxed">{webConfig.feature1Desc}</p>
            </div>
            <div className="bg-neutral-50 dark:bg-neutral-950 border border-neutral-300 dark:border-neutral-800 p-8 rounded-3xl hover:border-emerald-500/30 transition-colors">
              <div className="bg-fuchsia-500/10 w-14 h-14 rounded-2xl flex items-center justify-center mb-6">
                <Zap className="w-7 h-7 text-fuchsia-400" />
              </div>
              <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-3">{webConfig.feature2Title}</h3>
              <p className="text-neutral-600 dark:text-neutral-400 leading-relaxed">{webConfig.feature2Desc}</p>
            </div>
            <div className="bg-neutral-50 dark:bg-neutral-950 border border-neutral-300 dark:border-neutral-800 p-8 rounded-3xl hover:border-emerald-500/30 transition-colors">
              <div className="bg-amber-500/10 w-14 h-14 rounded-2xl flex items-center justify-center mb-6">
                <Shield className="w-7 h-7 text-amber-400" />
              </div>
              <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-3">{webConfig.feature3Title}</h3>
              <p className="text-neutral-600 dark:text-neutral-400 leading-relaxed">{webConfig.feature3Desc}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing / CTA */}
      <section className="py-24 max-w-7xl mx-auto px-6 text-center">
        <h2 className="text-3xl font-bold text-neutral-900 dark:text-white mb-6">{webConfig.pricingTitle}</h2>
        <p className="text-neutral-600 dark:text-neutral-400 mb-12 max-w-xl mx-auto">{webConfig.pricingDesc}</p>
        
        <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto text-left">
          {/* Free Tier */}
          <div className="bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-800 p-8 rounded-3xl">
            <div className="flex justify-between items-end mb-8">
              <div>
                <h3 className="text-2xl font-bold text-neutral-900 dark:text-white">{webConfig.plan1Name}</h3>
                <p className="text-neutral-600 dark:text-neutral-400 mt-1">{webConfig.plan1Duration}</p>
              </div>
              <div className="text-right">
                <span className="text-3xl font-bold text-emerald-400">{webConfig.plan1Price}</span>
              </div>
            </div>
            <ul className="space-y-4 mb-8">
              {(webConfig.plan1Features || "").split('\n').filter(Boolean).map(item => (
                <li key={item} className="flex items-center gap-3 text-neutral-700 dark:text-neutral-300">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <button 
              onClick={() => setIsLoginModalOpen(true)}
              className="w-full bg-neutral-200 dark:bg-neutral-800 text-neutral-900 dark:text-white py-4 rounded-xl font-bold hover:bg-neutral-700 transition-colors"
            >
              {webConfig.plan1ButtonText}
            </button>
          </div>

          {/* VIP Tier */}
          <div className="bg-gradient-to-b from-neutral-900 to-neutral-950 border border-amber-500/30 p-8 rounded-3xl relative overflow-hidden">
            <div className="absolute top-0 right-0 bg-amber-500 text-neutral-950 text-xs font-bold px-3 py-1 rounded-bl-lg">POPULER</div>
            <div className="flex justify-between items-end mb-8">
              <div>
                <h3 className="text-2xl font-bold text-neutral-900 dark:text-white flex items-center gap-2">{webConfig.plan2Name}</h3>
                <p className="text-neutral-600 dark:text-neutral-400 mt-1">{webConfig.plan2Duration}</p>
              </div>
              <div className="text-right">
                <span className="text-3xl font-bold text-amber-400">{webConfig.plan2Price}</span>
              </div>
            </div>
            <ul className="space-y-4 mb-8">
              {(webConfig.plan2Features || "").split('\n').filter(Boolean).map(item => (
                <li key={item} className="flex items-center gap-3 text-neutral-700 dark:text-neutral-300">
                  <CheckCircle2 className="w-5 h-5 text-amber-500 flex-shrink-0" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <a 
              href={`https://wa.me/${webConfig.contactPhone.replace(/\D/g, '')}?text=Halo%20Admin,%20saya%20ingin%20berlangganan%20${encodeURIComponent(webConfig.plan2Name)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full text-center block bg-amber-500 text-neutral-950 py-4 rounded-xl font-bold hover:bg-amber-600 transition-colors"
            >
              {webConfig.plan2ButtonText}
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-neutral-300 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-950/50 py-12 mt-12">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex flex-col items-center md:items-start gap-2">
            <div className="flex items-center gap-3">
              {webConfig.logo ? (
                <img src={webConfig.logo} alt="Logo" className="w-8 h-8 object-contain rounded-lg" />
              ) : (
                <div className="bg-emerald-500/20 p-2 rounded-xl">
                  <Smartphone className="w-5 h-5 text-emerald-400" />
                </div>
              )}
              <span className="text-lg font-bold text-neutral-900 dark:text-white tracking-tight">{webConfig.title}<span className="text-emerald-400">{webConfig.highlight}</span></span>
            </div>
            <p className="text-xs text-neutral-500 max-w-xs text-center md:text-left">{webConfig.footerDesc}</p>
          </div>
          <div className="flex flex-col md:flex-row items-center gap-6 text-sm text-neutral-600 dark:text-neutral-400">
            <a href={`mailto:${webConfig.contactEmail}`} className="hover:text-neutral-900 dark:text-white transition-colors flex items-center gap-2">
              <Mail className="w-4 h-4" /> {webConfig.contactEmail}
            </a>
            <a href={`https://wa.me/${webConfig.contactPhone.replace(/\D/g, '')}`} className="hover:text-neutral-900 dark:text-white transition-colors flex items-center gap-2">
              <Phone className="w-4 h-4" /> {webConfig.contactPhone}
            </a>
          </div>
          <div className="text-sm text-neutral-500 text-center md:text-right flex flex-col">
            <span>&copy; {new Date().getFullYear()} {webConfig.title}{webConfig.highlight}.</span>
            <span>All rights reserved.</span>
          </div>
        </div>
      </footer>

      {/* Auth Modal */}
      {isLoginModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-500/80 dark:bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-800 rounded-3xl p-8 max-w-md w-full shadow-2xl animate-in zoom-in-95 duration-200 relative">
            <button 
              onClick={() => setIsLoginModalOpen(false)}
              className="absolute top-4 right-4 text-neutral-500 hover:text-neutral-900 dark:text-white"
            >
              ✕
            </button>
            <h2 className="text-2xl font-bold text-neutral-900 dark:text-white mb-2 text-center">
              {isRegisterMode ? "Buat Akun Baru" : webConfig.loginTitle || "Selamat Datang"}
            </h2>
            <p className="text-neutral-600 dark:text-neutral-400 text-center mb-8 text-sm">
              {isRegisterMode ? "Daftar untuk mengakses dasbor WabotPro" : webConfig.loginSubtitle || "Masuk ke dasbor WabotPro Anda"}
            </p>

            {error && (
              <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 p-3 rounded-xl text-sm mb-6 flex flex-col gap-2">
                <p>{error}</p>
              </div>
            )}

            <form onSubmit={handleEmailAuth} className="space-y-4">
              <div>
                <label className="text-sm font-medium text-neutral-600 dark:text-neutral-400 mb-1.5 block">{webConfig.loginEmailParam || "Email"}</label>
                <input 
                  type="email" 
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full bg-neutral-50 dark:bg-neutral-950 border border-neutral-300 dark:border-neutral-800 rounded-xl px-4 py-3 text-neutral-900 dark:text-white focus:outline-none focus:border-emerald-500 transition-colors"
                  placeholder={webConfig.loginEmailPlaceholder || "nama@email.com"}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-neutral-600 dark:text-neutral-400 mb-1.5 block">{webConfig.loginPasswordParam || "Password"}</label>
                <input 
                  type="password" 
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full bg-neutral-50 dark:bg-neutral-950 border border-neutral-300 dark:border-neutral-800 rounded-xl px-4 py-3 text-neutral-900 dark:text-white focus:outline-none focus:border-emerald-500 transition-colors"
                  placeholder={webConfig.loginPasswordPlaceholder || "••••••••"}
                />
              </div>
              <button 
                type="submit"
                className="w-full bg-emerald-500 hover:bg-emerald-600 text-neutral-950 font-bold py-3 rounded-xl transition-colors mt-2"
              >
                {isRegisterMode ? "Daftar" : webConfig.loginButtonText || "Masuk"}
              </button>
            </form>

            <p className="text-center text-sm text-neutral-500 mt-6">
              {isRegisterMode ? "Sudah punya akun? " : webConfig.loginRegisterText || "Belum punya akun? Daftar"}
              {isRegisterMode && (
                <button 
                  onClick={() => setIsRegisterMode(!isRegisterMode)}
                  className="text-emerald-400 hover:text-emerald-300 font-medium ml-1"
                >
                  Masuk
                </button>
              )}
              {!isRegisterMode && (!webConfig.loginRegisterText || webConfig.loginRegisterText.toLowerCase() === "belum punya akun? daftar") && (
                <button 
                  onClick={() => setIsRegisterMode(!isRegisterMode)}
                  className="text-emerald-400 hover:text-emerald-300 font-medium ml-1"
                >
                  Daftar
                </button>
              )}
            </p>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
