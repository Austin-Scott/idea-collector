import os from "node:os";

export function getLanAddresses(): string[] {
  const addresses: string[] = [];
  const interfaces = os.networkInterfaces();

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) {
        addresses.push(entry.address);
      }
    }
  }

  return sortUsableAddresses(addresses);
}

export function getPrimaryLanAddress(): string {
  return getLanAddresses()[0] ?? "127.0.0.1";
}

function sortUsableAddresses(addresses: string[]): string[] {
  return [...addresses].sort((a, b) => addressScore(a) - addressScore(b));
}

function addressScore(address: string): number {
  if (address.startsWith("192.168.") || address.startsWith("10.")) {
    return 0;
  }

  const secondOctet = Number(address.split(".")[1]);
  if (address.startsWith("172.") && secondOctet >= 16 && secondOctet <= 31) {
    return 0;
  }

  if (address.startsWith("169.254.")) {
    return 2;
  }

  return 1;
}
