import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "export",
  basePath: "/listapedidos",
  trailingSlash: true,
  images: { unoptimized: true }
};

export default nextConfig;
