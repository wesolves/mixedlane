import "reflect-metadata";
import { networkInterfaces } from "node:os";
import { Logger } from "@nestjs/common";
import { createApp } from "./bootstrap";
import { config } from "./core/config";

const app = await createApp();
const { PORT, HOST } = config();
await app.listen(PORT, HOST);

const log = new Logger("Flowboard");
log.log(`API on http://localhost:${PORT}/api`);
// When listening on every interface, show the LAN addresses other devices can use.
if (HOST === "0.0.0.0" || HOST === "::") {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) if (a.family === "IPv4" && !a.internal) log.log(`  on your network: http://${a.address}:${PORT}/api`);
  }
}
