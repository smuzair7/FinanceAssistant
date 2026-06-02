import { seedUser } from "../src/lib/demoData";
import { DEV_USER_ID } from "../src/lib/auth";

// Seeds the local dev/demo user with ~18 months of synthetic history so the app
// is useful the moment it boots. In Clerk mode, each real user instead seeds
// their own data via the "Load demo data" button on the import page.

async function main() {
  const count = await seedUser(DEV_USER_ID);
  console.log(`Seeded ${count} transactions for user "${DEV_USER_ID}".`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
