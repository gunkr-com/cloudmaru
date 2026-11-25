import {seedCompletionAcceptanceV1} from '../../src/services/completion-acceptance-seed.test-data';
// This CLI has no target/overwrite option and deliberately does not load dotenv.
try {
  console.log(JSON.stringify(await seedCompletionAcceptanceV1(process.argv.slice(2)),null,2));
} catch(error) {
  console.error(error instanceof Error && /^acceptance-seed-/.test(error.message)
    ? error.message : 'acceptance-seed-failed');
  process.exitCode=1;
}
