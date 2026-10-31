import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: process.env.ERP_BROWSER_DEV === "1" ? false : undefined,
  output: "standalone",
  outputFileTracingIncludes: {
    "/assets/contract-editor-worker": ["./node_modules/pdfjs-dist/build/pdf.worker.min.mjs"],
  },
  distDir: process.env.ERP_NEXT_DIST_DIR || ".next",
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  async redirects() {
    return [
      { source: "/criar-conta", destination: "/api/auth/login?intent=signup", permanent: false },
      { source: "/dashboard", destination: "/", permanent: false },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
