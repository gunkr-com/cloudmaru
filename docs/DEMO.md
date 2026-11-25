# Offline synthetic demo

Explore saved Build, Assess, Extend and network examples without Azure credentials,
a Claude API key or a Bicep compiler. All resources and requirements are synthetic.
The seed runs entirely on your machine and never contacts Azure or Claude.

## Start the demo in one command

Install dependencies with `npm ci`, then run:

```sh
npm run demo
```

Each run:

- creates a new synthetic data folder with the seed below (it never reuses or
  opens an existing data folder, and refuses to start if `CLOUDSIGHT_DATA_DIR`
  is already set in your shell);
- builds the app once if no production build exists;
- starts the server on `127.0.0.1` with `-p 0`, so the operating system picks a
  free port at bind time, and prints `Open: http://127.0.0.1:<port>/overview`
  only after that server itself reports its address and readiness;
- passes only basic shell variables (such as `PATH`, `HOME`, `LANG`) to the
  server, asks the installed Next.js env loader which variable names `.env`,
  `.env.local` and the other production dotenv files define (names only) and
  sets each to an empty value so none of their values load, keeps workspace
  secrets inside the demo folder and disables Next.js telemetry;
- marks the server as a demo, so Overview and the assessment summary identify synthetic data and unavailable billing,
  and saved Build and Extend results label the prices as synthetic.

The demo always runs the production server: the development server reloads
dotenv files when they change, which could bring in values the demo did not
blank. No development-server, host, port or data-folder option is accepted.
Press Ctrl+C to stop the server; the demo folder stays until you delete it (see
below).

## Create a fresh demo without starting a server

```sh
npm run demo:seed
```

The command prints a JSON manifest and writes the same document to
`manifest.json` inside a newly allocated OS temporary directory. `dataDirectory`
is the demo database; `urls` contains the saved example routes. Each invocation
allocates a different directory. `npm run demo:seed -- --new` is also accepted.

The seed deliberately rejects a nonempty inherited `CLOUDSIGHT_DATA_DIR`. If your
shell already configures a real database, run the seed in a separate terminal or
remove that variable for this one command:

```sh
env -u CLOUDSIGHT_DATA_DIR npm run demo:seed
```

There is no target, overwrite, reset or reuse option. The seed neither loads nor
edits `.env`, `.env.local` or other dotenv files. It never opens your configured
company database and does not store API keys or connection settings. Errors print
fixed codes, without echoing inherited paths or credentials.

## Open the saved examples

Build once with `npm run build`. To start a separate local server, copy the exact
`dataDirectory` value printed by the seed into this command:

```sh
CLOUDSIGHT_DEMO=1 CLOUDSIGHT_DATA_DIR='/exact/new/demo/directory/data' npm run start -- --port 3160
```

Use an unused port and open `http://127.0.0.1:3160/workspaces`. Select **Synthetic
offline demo**, then use the routes listed in `manifest.json`. Switching between
English and Korean reopens the same saved data. For development, the same
environment prefix works with `npm run dev -- --port 3160`.

Stop the demo server before starting another server on the same demo database.
Keep your existing company server on its own port and data directory. If you change
the data directory of an already running server, restart that server because its
database connection was opened at startup.

## Suggested walkthrough

Start at **Overview → Start here**. *Browse a saved environment* opens the saved
assessment's **Current Azure setup** first, then its source scan; a newer,
different scan is labeled separately. In the setup view, *Resources by role*
and *Find a resource* reach every resource, including ones with no recorded
connection. The panel reads in order: what it does → recorded connections →
what needs attention, with Azure IDs and rule evidence under *Technical
details*. App Service plan links are drawn only when a web app's saved
`serverFarmId` names an App Service plan in the same scan.


| Example | What to explore | How it is produced |
| --- | --- | --- |
| Build | Three configuration tiers, estimated costs, assumptions, architecture sources and diagrams | Fixed synthetic requirements and catalog tier items, validated through the real analysis builder; costs come from a synthetic price fixture |
| Assess | Pass, violation and unknown findings; previous/current scan changes; catalog remediation roadmap | Imported synthetic resources evaluated by the real rule engine, diff engine and roadmap validator |
| Assessment report | Saved findings, source evidence, timestamps and bilingual print/download views | The existing report service reads the same saved assessment and catalog evidence |
| Extend | Reuse candidates, three proposals, incremental estimates, CIDR and capacity checks | Fixed synthetic proposal validated by the real Extend engine and DB wrapper |
| Network | Allowed, blocked and unknown saved paths | Three synthetic inventories evaluated by the real static network engine |

Scan source is **import**, with unverified import scope. There was no live Azure
collection. Advisor and actual billing are unavailable for imported data; the demo
does not invent billing totals or represent missing bills as zero. An allowed
static path is not a live connectivity test. Capacity remains unverified where the
engine cannot establish it.

The roadmap is a deterministic synthetic example composed from catalog actions;
Claude did not choose its ordering. Build and Extend prose is also fixed example
content, not a recorded model response. There are no LLM call or usage records.

## Compiler and generation boundaries

The public demo has **no compiler dependency**. It creates no Build or Extend
artifact rows, no compiled template and no compilation/deployment evidence. Saved
results, diagrams and the assessment report can be explored without generating
anything. Artifact generation, live scans and new model requests require normal
configuration and are outside the offline walkthrough.

The existing operator-only completion acceptance seed remains separate. It requires
the pinned Bicep compiler and validates actual compilation; it is not the public
demo command. A successful public demo seed is not evidence that Bicep compiled or
that any configuration can be deployed.

## Keep or discard a demo

The temporary directory contains only synthetic data and the manifest. OS cleanup
may eventually remove it. To keep it, stop its server and move the entire demo
directory to your own location, then launch the server with its new data path. To
discard it, stop the server and delete only that demo directory in your file
manager. Running the seed again creates a separate demo and leaves the old one
untouched.

The command seeds examples; it does not reconfigure an existing installation into
a demo, alter company data, or grant access to any external service.
