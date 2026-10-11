import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["pdfjs-dist"],
  outputFileTracingIncludes: {
    "/api/ingest/pdf": [
      "./node_modules/pdfjs-dist/standard_fonts/**/*",
      "./node_modules/pdfjs-dist/cmaps/**/*",
    ],
  },
};

export default nextConfig;
