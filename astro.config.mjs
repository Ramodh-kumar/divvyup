import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  output: 'server',
  adapter: cloudflare(),
  integrations: [react()],
  // The dev toolbar floats over the bottom of the screen and covers sheet footers on small viewports.
  devToolbar: { enabled: false },
  vite: { plugins: [tailwindcss()] },
});
