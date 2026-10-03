import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  async redirects() {
    return [
      {
        source: "/rooms",
        destination: "/",
        permanent: false,
      },
      {
        source: "/room/:id",
        destination: "/c/:id",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
