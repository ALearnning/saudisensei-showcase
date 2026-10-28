# Audit

Identity provisioning/profile updates and restricted development elevation currently write AuditLog entries atomically with their mutations. Shared administrative audit querying and later curriculum/enrollment events are deferred.
