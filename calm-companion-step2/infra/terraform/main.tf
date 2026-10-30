data "aws_caller_identity" "current" {}

# Nøgle til envelope encryption af patientdata (nøgle pr. patient udledes/wrappes herunder).
resource "aws_kms_key" "app" {
  description             = "calm-companion ${var.environment}: data-nøgle"
  enable_key_rotation     = true
  deletion_window_in_days = 30
}

resource "aws_kms_alias" "app" {
  name          = "alias/cc-${var.environment}-app"
  target_key_id = aws_kms_key.app.key_id
}

# Auditlog: WORM-lagring. Applikationen må kun tilføje (policy tilføjes i trin 4).
# Anbefaling: placér i separat AWS-konto, så en kompromitteret app-konto ikke kan slette spor.
resource "aws_s3_bucket" "audit" {
  bucket              = "cc-${var.environment}-audit-${data.aws_caller_identity.current.account_id}"
  object_lock_enabled = true
}

resource "aws_s3_bucket_versioning" "audit" {
  bucket = aws_s3_bucket.audit.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_object_lock_configuration" "audit" {
  bucket = aws_s3_bucket.audit.id
  rule {
    default_retention {
      mode = "COMPLIANCE"
      days = var.audit_retention_days
    }
  }
  depends_on = [aws_s3_bucket_versioning.audit]
}

resource "aws_s3_bucket_server_side_encryption_configuration" "audit" {
  bucket = aws_s3_bucket.audit.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.app.arn
    }
  }
}

resource "aws_s3_bucket_public_access_block" "audit" {
  bucket                  = aws_s3_bucket.audit.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# OIDC client secrets (trin 2): MitID-broker (patient) og klinikernes SSO (staff).
# Secrets: kun containere. Værdier sættes uden for kode (aldrig i state eller repo).
resource "aws_secretsmanager_secret" "app" {
  for_each   = toset(["database-url", "llm-api-key", "webhook-hmac-key", "oidc-patient-client-secret", "oidc-staff-client-secret"])
  name       = "cc/${var.environment}/${each.key}"
  kms_key_id = aws_kms_key.app.arn
}

# TODO (næste trin): VPC, privat PostgreSQL (kryptering, backup, ingen offentlig adgang),
# kø/worker, applikationsroller med mindst mulig adgang, overvågning/alarmer.
