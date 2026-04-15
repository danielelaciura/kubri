import "dotenv/config";
import { decrypt } from "../src/lib/encryption";
import { MakeApiClient } from "../src/lib/make/client";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

async function main() {
  const connectionString = process.env["DATABASE_URL"];
  if (!connectionString) {
    console.error("❌ DATABASE_URL not set");
    process.exit(1);
  }

  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  // 1. Fetch org from DB
  const org = await prisma.organization.findFirst();
  if (!org) {
    console.error("❌ No organization found in database");
    process.exit(1);
  }

  console.log(`✅ Organization: ${org.name}`);
  console.log(`   Data Store ID: ${org.makeDatastoreId}`);

  // 2. Decrypt token
  let apiToken: string;
  try {
    apiToken = decrypt(org.makeApiToken);
    console.log(`✅ Token decrypted (${apiToken.length} chars)`);
  } catch (e) {
    console.error(`❌ Failed to decrypt token:`, e);
    process.exit(1);
  }

  // 3. Test Make.com API
  const baseUrl = process.env["MAKE_API_BASE_URL"] ?? "https://eu2.make.com/api/v2";
  console.log(`\n🔗 Testing connection to: ${baseUrl}`);
  console.log(`   Endpoint: ${baseUrl}/data-stores/${org.makeDatastoreId}/data?pg[limit]=1`);

  const client = new MakeApiClient(org.makeDatastoreId, apiToken);

  try {
    const result = await client.listRecords({ limit: 1 });
    console.log(`\n✅ Connection successful!`);
    console.log(`   Records returned: ${result.records?.length ?? 0}`);
    if (result.count !== undefined) {
      console.log(`   Total count: ${result.count}`);
    }
    if (result.records?.length && result.records[0]) {
      console.log(`\n📄 Sample record keys:`, Object.keys(result.records[0]));
    }
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    console.error(`\n❌ Make.com API error:`);
    console.error(`   Status: ${err.status ?? "unknown"}`);
    console.error(`   Message: ${err.message}`);
  }

  await prisma.$disconnect();
}

main();
