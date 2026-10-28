// Optional local Q7A review launcher. No application server or API is started.
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
process.env.PORT = "4177";
process.env.BASE_PATH = "/";
const server = await createServer({
  root,
  configFile: path.join(root, "vite.config.ts"),
  configLoader: "runner",
  envFile: false,
  envDir: false,
  cacheDir: "/tmp/saudisensei-q7-vite-cache",
  server: { host: "127.0.0.1", port: 4177, strictPort: true },
});
await server.listen();
console.log(
  "Q7A isolated preview: http://127.0.0.1:4177/preview/saudisensei-admin-authoring/Overview",
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await server.close();
    process.exit(0);
  });
