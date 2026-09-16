/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      // Spectora exports are small (tens of KB) but we allow headroom for
      // larger multi-sheet templates without hitting the default 1MB cap.
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
