import importlib.util
import itertools
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("pr_gate", Path(__file__).with_name("pr-gate.py"))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class ScopeTests(unittest.TestCase):
    def test_private_signature_service_has_mandatory_project_scope(self):
        for path in ('apps/contract-signature-service/src/contract_signature_service/worker.py',
                     'deploy/contracts-validator/compose.yml', 'scripts/contracts/verify-signature-service.py'):
            self.assertFalse(any(gate.plan([path]).values()), path)
            self.assertTrue(gate.signature_check_required([path]), path)
        self.assertTrue(all(gate.plan(['deploy/contracts-validator-unrelated/compose.yml']).values()))

    def test_signature_core_uses_project_validation_without_rebuilding_native_domains(self):
        for path in ("apps/contract-signature-validator/uv.lock", "scripts/contracts/verify-signature-validator.py"):
            self.assertFalse(any(gate.plan([path]).values()), path)
            self.assertTrue(gate.signature_check_required([path]))

    def test_signature_scope_is_required_for_full_and_unknown_infrastructure_only(self):
        for paths in ([], ["docs/guide.md"], ["apps/web/src/page.tsx"], ["apps/api/src/main.rs"]):
            self.assertFalse(gate.signature_check_required(paths), paths)
            self.assertTrue(gate.signature_check_required(paths, full=True), paths)
        for path in (".github/workflows/_validate-project.yml", "scripts/ci/pr-gate.py", "new-service/main.py"):
            self.assertTrue(gate.signature_check_required([path]), path)
        self.assertTrue(all(gate.plan(['scripts/contracts/verify-signature-validator.py-unrelated']).values()))

    def test_frontend_does_not_rebuild_api(self):
        self.assertEqual(gate.plan(["apps/web/src/page.tsx"]), {"web": True, "api": False, "fiscal": False})

    def test_migrations_and_rust_select_api(self):
        for path in ("migrations/123.sql", "apps/api/src/main.rs", "Cargo.lock", "queries/users.sql"):
            with self.subTest(path=path):
                self.assertEqual(gate.plan([path]), {"web": False, "api": True, "fiscal": False})

    def test_fiscal_and_shared_packages(self):
        self.assertEqual(gate.plan(["apps/fiscal-engine/src/main.ts", "packages/shared/test.ts"]),
                         {"web": True, "api": False, "fiscal": True})

    def test_unknown_and_ci_paths_require_all(self):
        for path in (".github/workflows/ci.yml", "scripts/ci/pr-gate.py", "new-service/main.py", "pnpm-lock.yaml"):
            self.assertTrue(all(gate.plan([path]).values()), path)

    def test_documentation_only_and_empty_diff(self):
        self.assertFalse(any(gate.plan(["docs/design.json", "README.md"]).values()))
        self.assertFalse(any(gate.plan([]).values()))

    def test_runtime_markdown_selects_own_domain(self):
        for path, selected in (("apps/web/prompts/runtime.md", "web"), ("apps/api/prompts/runtime.md", "api")):
            self.assertEqual(gate.plan([path]), {domain: domain == selected for domain in gate.DOMAINS})

    def test_python_mcp_selects_fiscal(self):
        self.assertEqual(gate.plan(["apps/fiscal-mcp/src/server.py"]), {"web": False, "api": False, "fiscal": True})


class GateTests(unittest.TestCase):
    def jobs(self):
        return {"changes": {"result": "success", "outputs": {"web": "true", "api": "false", "fiscal": "false"}},
                "web": {"result": "success"}, "api": {"result": "skipped"}, "fiscal": {"result": "skipped"}}

    def test_explicit_unselected_skips_pass(self):
        self.assertTrue(gate.verdict(self.jobs())[0])

    def test_all_scope_and_outcome_combinations(self):
        # Every failure/cancellation must fail, including nonselected jobs.
        for selected in itertools.product((False, True), repeat=3):
            for statuses in itertools.product(("success", "failure", "cancelled", "skipped"), repeat=4):
                jobs = {"changes": {"result": statuses[0], "outputs": dict(zip(
                    gate.DOMAINS, (str(value).lower() for value in selected)))}}
                jobs.update({name: {"result": result} for name, result in zip(gate.DOMAINS, statuses[1:])})
                expected = statuses[0] == "success" and all(
                    result == ("success" if required else "skipped")
                    for required, result in zip(selected, statuses[1:]))
                self.assertEqual(gate.verdict(jobs)[0], expected, (selected, statuses))

    def test_every_selected_failure_cancellation_or_skip_fails(self):
        for job in ("changes", "web"):
            for result in ("failure", "cancelled", "skipped"):
                jobs = self.jobs()
                jobs[job]["result"] = result
                self.assertFalse(gate.verdict(jobs)[0], (job, result))

    def test_unselected_failures_cannot_be_hidden(self):
        for result in ("success", "failure", "cancelled"):
            jobs = self.jobs()
            jobs["api"]["result"] = result
            self.assertFalse(gate.verdict(jobs)[0], result)

    def test_missing_extra_or_invalid_scope_fails_closed(self):
        for mutation in (
            lambda jobs: jobs.pop("web"),
            lambda jobs: jobs.update(extra={"result": "success"}),
            lambda jobs: jobs["changes"].update(outputs={}),
            lambda jobs: jobs["changes"]["outputs"].update(api="maybe"),
        ):
            jobs = self.jobs()
            mutation(jobs)
            with self.assertRaises(ValueError):
                gate.verdict(jobs)

    def test_attestation_keeps_skipped_evidence_and_commit_identity(self):
        env = {"SOURCE_HEAD_SHA": "a" * 40, "GITHUB_SHA": "b" * 40,
               "GITHUB_REPOSITORY": "avilaops/erp-next", "GITHUB_WORKFLOW": "CI",
               "GITHUB_EVENT_NAME": "pull_request", "GITHUB_RUN_ID": "10", "GITHUB_RUN_ATTEMPT": "2"}
        evidence = gate.attest(self.jobs(), env)
        self.assertEqual(evidence["ciGate"], "passed")
        self.assertEqual(evidence["validationJobs"]["api"], "skipped")
        self.assertFalse(evidence["validationScope"]["api"])
        self.assertEqual(evidence["sourceSha"], "a" * 40)
        self.assertEqual(evidence["testedSha"], "b" * 40)
        jobs = self.jobs()
        jobs["web"]["result"] = "failure"
        self.assertEqual(gate.attest(jobs, env)["ciGate"], "failed")


if __name__ == "__main__":
    unittest.main()
