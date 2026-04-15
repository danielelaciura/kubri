import "dotenv/config";
import { encrypt } from "../src/lib/encryption";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env["DATABASE_URL"];
if (!connectionString) {
  console.error("❌ DATABASE_URL not set");
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  const org = await prisma.organization.findFirst();
  if (!org) {
    console.error("❌ No organization found");
    process.exit(1);
  }

  console.log(`Encrypting token for org: ${org.name}`);
  const encrypted = encrypt(org.makeApiToken);

  await prisma.organization.update({
    where: { id: org.id },
    data: { makeApiToken: encrypted },
  });

  console.log("✅ Token encrypted and saved");
  await prisma.$disconnect();
}

main();
