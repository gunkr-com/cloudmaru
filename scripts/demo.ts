import { launchDemo } from '../src/services/demo-launch';

// Never load dotenv here: launchDemo seeds a new temporary DB and blanks dotenv names for the server.
try {
  const { exit } = await launchDemo(process.argv.slice(2), { cwd: process.cwd(), log: line => console.log(line) });
  process.exitCode = (await exit) ?? 0;
} catch (error) {
  const code = error instanceof Error && /^demo-[a-z-]+$/.test(error.message) ? error.message : 'demo-failed';
  console.error(code === 'demo-seed-existing-environment' ? 'demo-existing-environment' : code);
  process.exitCode = 1;
}
