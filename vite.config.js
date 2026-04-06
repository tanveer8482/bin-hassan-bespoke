const { defineConfig } = require("vite");
const react = require("@vitejs/plugin-react");
const { VitePWA } = require("vite-plugin-pwa");

module.exports = defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "Bin Hassan Bespoke",
        short_name: "BHB",
        description: "Tailor workshop management system",
        theme_color: "#1c2128",
        background_color: "#12161c",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "/icon.svg",
            sizes: "any",
            type: "image/svg+xml"
          }
        ]
      }
    })
  ]
});
