import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Фронтенд ходить у API напряму (VITE_API_URL, типово http://localhost:8080), проксі не потрібен.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
});
