import { defineConfig } from 'vite';

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    allowedHosts: [
      // Standardmäßig erlaubt Vite 'localhost'
      'localhost',

      // Dein dynamischer Replit-Host (einfach Platzhalter mit Wildcard)
      '*.replit.dev',
      '*.repl.co'
    ],
    port: 5173, // Standardport, kann bei Bedarf angepasst werden
  },
});
