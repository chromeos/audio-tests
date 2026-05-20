import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // Enable relative asset paths for subfolder deployment on github.io
  server: {
    // Allow any host to respond to proxy requests (e.g. from cloud workspace / corporate proxy)
    allowedHosts: true,
    
    // Listen on all local IP addresses (0.0.0.0) so the proxy can forward requests to Vite
    host: true,
  },
  preview: {
    // Also configure preview server (used for production build testing)
    allowedHosts: true,
    host: true,
  }
});
