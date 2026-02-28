// In app/layout.tsx – folgendes in den <head> bzw. als Next.js metadata einfügen:

export const metadata = {
  // ... deine bestehenden Felder ...
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Crumb',
  },
  icons: {
    icon: '/icons/favicon-32.png',
    apple: '/icons/apple-touch-icon.png',
  },
  themeColor: '#8B7355',
};

// ODER falls du ein <head>-Tag direkt nutzt, diese Tags hinzufügen:
/*
<link rel="manifest" href="/manifest.json" />
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
<link rel="icon" type="image/png" href="/icons/favicon-32.png" />
<meta name="theme-color" content="#8B7355" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="default" />
<meta name="apple-mobile-web-app-title" content="Crumb" />
*/
