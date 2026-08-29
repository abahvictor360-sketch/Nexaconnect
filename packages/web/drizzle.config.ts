import { defineConfig } from "drizzle-kit";
import { databaseUrl, databaseAuthToken } from "./src/api/database/credentials";

export default defineConfig({
  dialect: "turso",
  schema: "./src/api/database/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: databaseUrl!,
    authToken: databaseAuthToken,
  },
});
