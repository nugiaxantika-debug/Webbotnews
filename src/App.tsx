import { useEffect, useState, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { QRCodeSVG } from "qrcode.react";
import { Activity, Power, RefreshCw, Trash2, Smartphone, ShieldCheck, FileText, Users, Gamepad2, Settings, Clock } from "lucide-react";

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

import { BrowserRouter, Routes, Route } from "react-router-dom";
import Landing from "./pages/Landing";
import Dashboard from "./pages/Dashboard";
import ProtectedRoute from "./components/ProtectedRoute";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route 
          path="/dashboard" 
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          } 
        />
      </Routes>
    </BrowserRouter>
  );
}
