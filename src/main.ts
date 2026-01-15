import * as core from "@actions/core";

async function run(): Promise<void> {
  // Placeholder action logic.
  // Replace with real implementation after defining inputs/outputs.
  const name = core.getInput("example-input") || "world";
  core.info(`hello: ${name}`);
  core.setOutput("example-output", `hello-${name}`);
}

run().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  core.setFailed(msg);
});
