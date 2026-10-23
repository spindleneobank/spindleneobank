# Attestation fixtures

- `dcap-qvl-tdx_quote.bin` and `dcap-qvl-tdx_quote_collateral.json`: REAL, public sample TDX quote and Intel
  collateral recorded from https://github.com/Phala-Network/dcap-qvl (`sample/tdx_quote`,
  `sample/tdx_quote_collateral.json`, Apache-2.0). The collateral is valid around 2025-06-19..2025-07-19, so tests
  verify "as of" 2025-06-25. This quote does NOT come from a Spindle node: its report_data is not bound to a Spindle
  HPKE key, so the binding tests use a synthetic report injected through the verifier seam.
- Everything else (event logs, NRAS tokens, bundles) is SYNTHETIC and generated in the tests (marked as such).
