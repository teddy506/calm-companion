variable "region" {
  type        = string
  default     = "eu-north-1" # EU-region (antagelse: AWS). Skift udbyder/region efter kundens krav.
  description = "EU-region for dataresidens"
}

variable "environment" {
  type        = string
  description = "dev, test eller prod"
  validation {
    condition     = contains(["dev", "test", "prod"], var.environment)
    error_message = "environment skal være dev, test eller prod."
  }
}

variable "audit_retention_days" {
  type        = number
  default     = 365
  description = "Uforanderlig opbevaring af auditlog (object lock)"
}
