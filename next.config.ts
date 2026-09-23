import type { NextConfig } from "next";

/**
 * Headers applied to every response.
 *
 * Chosen against what this app actually does rather than off a checklist:
 *
 * - Referrer-Policy matters most here. Order codes and guest view tokens both
 *   travel in the URL, so any referrer leaks them to whatever third party a
 *   page happens to load.
 * - X-Frame-Options matters because checkout, top-up and withdraw are each a
 *   single click on an authenticated page.
 * - nosniff matters because /uploads/* is served straight off disk.
 * - HSTS matters because the session cookie's Secure flag is only worth
 *   something if the browser refuses to downgrade. Left without
 *   includeSubDomains and without preload: both are hard to walk back, and
 *   whether every subdomain is on HTTPS is not something this file knows.
 *
 * Content-Security-Policy is deliberately absent. It needs a nonce for Next's
 * inline scripts and a report-only shakedown against the rich-text editor and
 * charts before it can be enforced, so it lands on its own.
 */
const SECURITY_HEADERS = [
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
];

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.vcgamers.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "i.ibb.co.com",
        pathname: "/**",
      },
    ],
  },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
