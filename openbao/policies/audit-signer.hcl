# Checkpoint signer only (A-B8.8 / interview prep 2.6).
# Private keys never leave Transit; this token may sign and read public key
# material for local verify. It must not create, rotate, export, or delete keys.
# Ops (rotate / publish) use BAO_ADMIN_TOKEN (dev root), not this policy.

path "transit/sign/audit-signing" {
  capabilities = ["update"]
}

path "transit/keys/audit-signing" {
  capabilities = ["read"]
}
