import { PrismaClient, Role } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "../src/lib/password";
import { encrypt } from "../src/lib/encryption";

const connectionString = process.env["DATABASE_URL"];
if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is not set");
}
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Seeding database...");

  // Create demo organization
  const org = await prisma.organization.upsert({
    where: { slug: "kubri-demo" },
    update: {
      makeApiToken: encrypt("fake-make-api-token-for-demo"),
    },
    create: {
      name: "Kubri Demo",
      slug: "kubri-demo",
      makeDatastoreId: "ds_demo_123456",
      makeApiToken: encrypt("fake-make-api-token-for-demo"),
      settings: {
        features: { export: true, stats: true },
      },
    },
  });

  console.log(`Organization created: ${org.name} (${org.id})`);

  // Create users
  const users = [
    {
      email: "admin@kubri.it",
      name: "Admin Kubri",
      password: "password123",
      role: Role.ADMIN_KUBRI,
    },
    {
      email: "manager@kubri.it",
      name: "Manager Demo",
      password: "password123",
      role: Role.ORG_ADMIN,
    },
    {
      email: "operator@kubri.it",
      name: "Operatore Demo",
      password: "password123",
      role: Role.ORG_MEMBER,
    },
  ];

  for (const userData of users) {
    const passwordHash = await hashPassword(userData.password);
    const user = await prisma.user.upsert({
      where: { email: userData.email },
      update: {},
      create: {
        email: userData.email,
        name: userData.name,
        passwordHash,
        role: userData.role,
        organizationId: org.id,
      },
    });
    console.log(`User created: ${user.email} (${user.role})`);
  }

  console.log("Seeding complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
