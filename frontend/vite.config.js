import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
        proxy: {
            "/tasks": {
                target: "http://localhost:3000",
                changeOrigin: true,
            },
            "/telegram": {
                target: "http://localhost:3000",
                changeOrigin: true,
            },
        },
    },
});
