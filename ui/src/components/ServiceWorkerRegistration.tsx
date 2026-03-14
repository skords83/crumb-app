"use client";

import { useEffect } from "react";

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then(reg => console.log("✅ SW registriert:", reg.scope))
        .catch(err => console.error("❌ SW Fehler:", err));
    }
  }, []);

  return null;
}
