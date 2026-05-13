import path from "node:path";

export const rootDir = process.cwd();
export const certDir = path.join(rootDir, "certs");
export const dataDir = path.join(rootDir, "data");
export const exportDir = path.join(rootDir, "exports");
export const secretsDir = path.join(rootDir, ".secrets");
export const audioOriginalDir = path.join(dataDir, "audio", "original");
export const audioNormalizedDir = path.join(dataDir, "audio", "normalized");
export const configPath = path.join(rootDir, "config.local.json");
export const apiKeyPath = path.join(secretsDir, "openai-api-key.txt");
export const certPath = path.join(certDir, "localhost-cert.pem");
export const certKeyPath = path.join(certDir, "localhost-key.pem");
