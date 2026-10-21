import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  auth: true,
  buckets: {
    uploads: { access: "private" },
    "star-africa-logistics-documents": { access: "private" },
  },
});
