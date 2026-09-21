import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Inställningar för Vite, verktyget som kör utvecklingsservern och bygger appen.
// react-pluginet krävs för att .tsx-filer ska förstås. Dokumentation:
// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
})
