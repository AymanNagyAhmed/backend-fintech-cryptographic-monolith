# Fintech cryptographic web app challenges (October 2026)

One file per problem. Each file opens with a diagram of the impact and the recommended solution, then explains the problem, the impact, and the control to build. The Code section opens with a diagram of the path this backend takes, then quotes that code. Where the control is not in this repository, the section says so and quotes the closest check that is.

Short catalog: [common_challenges_in_fintech_cryptographic_web_apps_in_Oct_2026.md](../../../../common_challenges_in_fintech_cryptographic_web_apps_in_Oct_2026.md).

Solutions follow the controls already chosen for this modular monolith: non-exportable keys in OpenBao Transit (dev) or AWS KMS / CloudHSM (prod), decimal money, idempotency keys in the same database transaction as the movement, a signed append-only audit log with WORM copies, crypto-shredding, four-eyes withdrawals, and hybrid TLS.

## Cryptography and key management

- [001. Private key storage](001_private_key_storage.md)
- [002. Key lifecycle management](002_key_lifecycle_management.md)
- [003. Misuse of cryptographic primitives](003_misuse_of_cryptographic_primitives.md)
- [004. Weak random number generation](004_weak_random_number_generation.md)
- [005. Signature and nonce mismatches](005_signature_and_nonce_mismatches.md)
- [006. Low-level cryptographic implementation failures](006_low_level_cryptographic_implementation_failures.md)
- [007. Operational key compromise and approval integrity](007_operational_key_compromise_and_approval_integrity.md)
- [008. Post-quantum readiness and cryptographic agility](008_post_quantum_readiness_and_cryptographic_agility.md)
- [009. Trusted time and clock skew](009_trusted_time_and_clock_skew.md)

## Cybersecurity

- [010. Client-side attacks (XSS and CSRF)](010_client_side_attacks_xss_csrf.md)
- [011. Man-in-the-middle and transport-layer risks](011_mitm_and_transport_layer_risks.md)
- [012. Flawed session and identity management](012_flawed_session_and_identity_management.md)
- [013. Phishing and UI spoofing](013_phishing_and_ui_spoofing.md)
- [014. Multi-factor authentication bypass](014_mfa_bypass.md)
- [015. Smart contract vulnerabilities](015_smart_contract_vulnerabilities.md)
- [016. Broken access control](016_broken_access_control.md)
- [017. Security misconfiguration and leaked secrets](017_security_misconfiguration_and_leaked_secrets.md)
- [018. Software supply-chain compromise](018_software_supply_chain_compromise.md)
- [019. Bots, credential stuffing, and rate limits](019_bots_credential_stuffing_and_rate_limits.md)
- [020. Security logging and alerting failures](020_security_logging_and_alerting_failures.md)
- [021. AI-assisted fraud and synthetic identity](021_ai_assisted_fraud_and_synthetic_identity.md)

## Regulatory compliance

- [022. KYC and AML integration](022_kyc_aml_integration.md)
- [023. Data privacy versus immutability](023_data_privacy_vs_immutability.md)
- [024. PCI-DSS compliance](024_pci_dss_compliance.md)
- [025. Cross-border legal restrictions](025_cross_border_legal_restrictions.md)
- [026. Operational resilience and third-party ICT risk](026_operational_resilience_and_third_party_ict_risk.md)
- [027. Travel Rule, MiCA, and crypto-asset conduct](027_travel_rule_mica_and_crypto_asset_conduct.md)

## Architecture, performance, and concurrency

- [028. Race conditions and double-spending](028_race_conditions_and_double_spending.md)
- [029. Money representation and ledger invariants](029_money_representation_and_ledger_invariants.md)
- [030. Idempotency of money movement](030_idempotency_of_money_movement.md)
- [031. Network latency and transaction finality](031_network_latency_and_transaction_finality.md)
- [032. Scalability under market volatility](032_scalability_under_market_volatility.md)
- [033. Client-server state synchronization](033_client_server_state_synchronization.md)
- [034. Price and oracle manipulation](034_price_and_oracle_manipulation.md)

## User experience and external integrations

- [035. Wallet and third-party integration flakes](035_wallet_and_third_party_integration_flakes.md)
- [036. Irreversible user errors](036_irreversible_user_errors.md)
- [037. Cross-browser and cross-device compatibility](037_cross_browser_and_cross_device_compatibility.md)
- [038. Webhook and callback authenticity](038_webhook_and_callback_authenticity.md)
