import { env } from '@/env';
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: "postgresql",
  out: './drizzle',
  schema: './src/db/schema.ts',
  dbCredentials: {
    url: env.DATABASE_URL || "",
    ssl: {
      rejectUnauthorized: false,
    },
  },
})