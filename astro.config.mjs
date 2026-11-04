import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  output: 'server',
  // We use no images and no server-side sessions, so skip the Cloudflare Images and KV bindings
  // the adapter would otherwise add (they need extra setup and are not free-tier friendly).
  adapter: cloudflare({ imageService: 'passthrough' }),
  session: false,
  integrations: [react()],
  markdown: { syntaxHighlight: false }, // no code blocks here; Shiki's inline styles conflict with CSP
  // The dev toolbar floats over the bottom of the screen and covers sheet footers on small viewports.
  devToolbar: { enabled: false },
  security: {
    // Astro hashes its own inline scripts and styles, so we do not need 'unsafe-inline' for scripts.
    csp: {
      scriptDirective: { resources: ["'self'", 'https://challenges.cloudflare.com'] },
      directives: [
        "default-src 'self'",
        "connect-src 'self' https://challenges.cloudflare.com",
        "frame-src https://challenges.cloudflare.com",
        "img-src 'self' data:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ],
    },
  },
  vite: { plugins: [tailwindcss()] },
});
