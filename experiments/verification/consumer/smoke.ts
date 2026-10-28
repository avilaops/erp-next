import { exactMatch, numberRange, numericTolerance, pathFidelity, runExperiment, type AgentTrace, type Experiment } from "@avilaops/experiments";

const experiment: Experiment<number, number> = {
  id: "typed-consumer",
  version: "1",
  hypothesis: "Public declarations describe a typed executor and evaluator.",
  dataset: {
    id: "numbers", version: "1", split: "evaluation",
    cases: [{ id: "one", input: 1, expected: 2 }],
  },
  variant: { id: "double", version: "1", codeVersion: "typed-consumer-v1" },
  evaluators: [
    exactMatch<number, number>(),
    numericTolerance<number, number>({ absoluteTolerance: 0.001 }),
    numberRange<number, number>({ minimum: 0, maximum: 10 }),
  ],
};

const report = await runExperiment(experiment, (input) => ({ output: input * 2 }));
const successRate: number = report.summary.passRate;
console.log(successRate);

const trace: AgentTrace = { complete: true, steps: [{ node: "fiscal", status: "succeeded" }] };
const pathExperiment: Experiment<null, { value: number; trace: AgentTrace }> = {
  ...experiment,
  dataset: { id: "trace", version: "1", split: "development", cases: [{ id: "trace", input: null }] },
  evaluators: [pathFidelity<null, { value: number; trace: AgentTrace }>({ requiredNodes: ["fiscal"] })],
};
await runExperiment(pathExperiment, () => ({ output: { value: 12, trace } }));
numberRange({ minimum: 0, maximum: 10, includeMaximum: false });
