import { seedDemo } from '../src/services/demo-seed';

// Never load dotenv here: seedDemo exclusively allocates its own temporary DB.
try {
  console.log(JSON.stringify(await seedDemo(process.argv.slice(2)), null, 2));
} catch (error) {
  console.error(error instanceof Error && /^demo-seed-(?:new-only|existing-environment)$/.test(error.message)
    ? error.message : 'demo-seed-failed');
  process.exitCode = 1;
}
