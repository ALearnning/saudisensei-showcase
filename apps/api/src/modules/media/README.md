# Media security pilot

Isolated, unmounted backend contracts and policy checks for approved Phase 1C.
There is no production provider, HTTP endpoint, upload, conversion worker or schema
migration in this pilot milestone. Do not interpret the test signer as a provider.

## Boundaries

- Existing identity/role/MFA guards remain mandatory when binding new controllers.
- `readFresh` is an authoritative server repository contract, never a client DTO.
- Each issuance/renewal rereads current identity/account/enrollment/ancestry facts.
- Delivery is restricted to current clean/ready private revisions and allowed modes.
- Preview/download TTL is at most 120 seconds; playback is at most 300 seconds,
  shortened when the existing identity token or enrollment expires sooner.
- Private Office previews require verified isolated processing with macros disabled.
  Boolean gate tests do not prove a real converter is isolated or malware scanning works.
- No original URL is issued as a view-only preview; no video download capability.
- No committed-media destruction operation is exposed by the object-store port.
- Provider failures yield a static error, not raw diagnostics or a public fallback.
- Course-first consistent reads/locks must be used in the future repository.
  Media edits need their own revision rather than `LmsStore.mutate`, which increments
  the existing curriculum edit revision.

## Provider validation still required

Implement real adapters only after account/setup confirmation. Prove private
origins, signed-only video creation, actual expiry, renewal on Safari/mobile/desktop,
quarantine/scanning, macro-disabled conversion and Saudi network performance.
Neither fixture signatures nor provider documentation substitute for these checks.
