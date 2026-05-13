import { ensureCertificate } from "../src/server/cert.js";
import { getLanAddresses } from "../src/server/network.js";
import { certPath } from "../src/server/paths.js";

await ensureCertificate(getLanAddresses());
console.log(`Certificate is ready: ${certPath}`);
