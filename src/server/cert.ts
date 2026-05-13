import { promises as fs } from "node:fs";
import path from "node:path";
import selfsigned from "selfsigned";
import { certDir, certKeyPath, certPath } from "./paths.js";

export async function ensureCertificate(hosts: string[]): Promise<{ cert: Buffer; key: Buffer }> {
  await fs.mkdir(certDir, { recursive: true });
  const uniqueHosts = Array.from(new Set(["localhost", "127.0.0.1", ...hosts]));
  const hostsPath = path.join(certDir, "hosts.json");

  try {
    const [cert, key, savedHostsRaw] = await Promise.all([
      fs.readFile(certPath),
      fs.readFile(certKeyPath),
      fs.readFile(hostsPath, "utf8")
    ]);
    const savedHosts = JSON.parse(savedHostsRaw) as string[];
    if (uniqueHosts.every((host) => savedHosts.includes(host))) {
      return { cert, key };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const pems = selfsigned.generate(
    [{ name: "commonName", value: "Idea Collector Local" }],
    {
      days: 365,
      keySize: 2048,
      extensions: [
        { name: "basicConstraints", cA: true },
        {
          name: "subjectAltName",
          altNames: uniqueHosts.map((host) =>
            /^\d+\.\d+\.\d+\.\d+$/.test(host)
              ? { type: 7, ip: host }
              : { type: 2, value: host }
          )
        }
      ]
    }
  );

  await Promise.all([
    fs.writeFile(certPath, pems.cert, "utf8"),
    fs.writeFile(certKeyPath, pems.private, "utf8"),
    fs.writeFile(hostsPath, JSON.stringify(uniqueHosts, null, 2), "utf8")
  ]);

  return { cert: Buffer.from(pems.cert), key: Buffer.from(pems.private) };
}
