import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Settings for Vite, the tool that runs the dev server and builds the app.
// The react plugin is required for .tsx files to be understood. Documentation:
// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
})
