terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }
  # Aktivér remote state (krypteret, versioneret) før første apply:
  # backend "s3" {
  #   bucket         = "cc-tfstate-<konto>"
  #   key            = "calm-companion/terraform.tfstate"
  #   region         = "eu-north-1"
  #   encrypt        = true
  #   dynamodb_table = "cc-tfstate-lock"
  # }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = { project = "calm-companion", environment = var.environment, managed_by = "terraform" }
  }
}
