/** @type {import('next').NextConfig} */
const nextConfig = {
  // A static site: everything runs in the browser, there is no server code.
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  // Set BANDIT_CODES_BASE_PATH (for example /qr) at build time to serve from a subpath.
  basePath: process.env.BANDIT_CODES_BASE_PATH || "",
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
