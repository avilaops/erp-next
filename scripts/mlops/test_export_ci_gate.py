import unittest
from export_ci_gate import attest

class AttestationTests(unittest.TestCase):
    def setUp(self):
        self.kw = dict(
            source_sha="a" * 40, repository="avilaops/ERP-Next",
            run_id="123456", attempt="1", workflow="CI", event="pull_request",
        )
    def test_all_green_still_no_human_approval(self):
        result=attest({"rust":{"result":"success"}, "contracts":{"result":"success"}}, **self.kw)
        self.assertEqual(result["ciGate"],"passed")
        self.assertIsNone(result["humanApproval"])
        self.assertIsNone(result["deployment"])
        self.assertIsNone(result["postDeployHealth"])
        self.assertIsNone(result["testCounts"])
        self.assertEqual(len(result["evidenceSha256"]),64)
    def test_failed_or_skipped_ci_cannot_pass(self):
        for status in ["failure","skipped","cancelled"]:
            with self.subTest(status=status):
                result=attest({"rust":{"result":"success"}, "contracts":{"result":status}}, **self.kw)
                self.assertEqual(result["ciGate"],"failed")
    def test_invalid_source_rejected(self):
        with self.assertRaises(ValueError):
            attest({"rust":{"result":"success"}}, **{**self.kw,"source_sha":"abc"})

if __name__ == "__main__":
    unittest.main()
