import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Фронтенд ходить у API напряму (VITE_API_URL, типово http://localhost:8080), проксі не потрібен.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  // Excalidraw (сторінка "Схема проєкту") вантажиться окремим chunk-ом через React.lazy і сам по собі більший за 500 kB.
  build: { chunkSizeWarningLimit: 2000 },
});
