import type { NextConfig } from "next";

// Two builds come out of this repo.
//
// The site — what Vercel builds — is an ordinary server app: route handlers in
// app/api read the incoming Request, and admin pages render per request.
//
// The desktop till is a static export. It has to open on a restaurant's PC with
// the network unplugged, so its HTML and JS live on the machine rather than on
// possiblle.com. output:'export' is app-wide and cannot support those route
// handlers, so scripts/build-desktop.mjs runs the export against a copy of the
// repo holding only the till's routes, with POS_DESKTOP set.
const desktop = process.env.POS_DESKTOP === "1";

const nextConfig: NextConfig = desktop
  ? {
      output: "export",
      // Kept out of .next/ so a desktop build never invalidates the site build
      // sitting next to it.
      distDir: "out-desktop",
      // Emits /seller/index.html rather than /seller.html, so the app:// handler
      // in electron/main.ts can resolve a path to a file by appending, with no
      // rewrite rules to keep in step.
      trailingSlash: true,
      // The optimizer is a server. Nothing in the till uses next/image today;
      // this keeps the export from failing if something ever does.
      images: { unoptimized: true },
    }
  : {};

export default nextConfig;
