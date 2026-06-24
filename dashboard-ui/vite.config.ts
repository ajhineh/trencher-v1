import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from the parent .env file
dotenv.config({ path: path.resolve(__dirname, '../.env') });

export default defineConfig({
    base: '/',
    plugins: [react()],
    server: {
        host: true,
        port: Number(process.env.DASHBOARD_UI_PORT) || 3001,
        strictPort: true,
        proxy: {
            '/api': {
                target: `http://localhost:${process.env.DASHBOARD_PORT || 3000}`,
                changeOrigin: true,
                secure: false,
            },
            '/ws': {
                target: `ws://localhost:${process.env.DASHBOARD_PORT || 3000}`,
                ws: true,
                changeOrigin: true,
                secure: false,
            },
        },
    },
});

