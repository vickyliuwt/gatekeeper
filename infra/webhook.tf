variable "enable_intake" {
  description = "Part A switch. true (default) builds ECR gatekeeper/webhook, gk-webhook and its route. Members B and C turn it off in their own accounts through scripts/gk/deploy.mjs."
  type        = bool
  default     = true
}

variable "allowed_repo" {
  type        = string
  description = "GitHub owner/repo accepted by the PR webhook. Required when enable_intake is true."
  default     = null

  validation {
    condition     = var.allowed_repo == null || can(regex("^[^/[:space:]]+/[^/[:space:]]+$", var.allowed_repo))
    error_message = "Use a GitHub repository name in owner/repo format."
  }
}

variable "webhook_image_digest" {
  type        = string
  description = "Digest of the webhook image already pushed to ECR. Required when enable_intake is true."
  default     = null

  validation {
    condition     = var.webhook_image_digest == null || can(regex("^sha256:[0-9a-f]{64}$", var.webhook_image_digest))
    error_message = "Use the full sha256 digest returned by ECR."
  }
}

data "aws_caller_identity" "current" {}

resource "aws_lambda_function" "webhook" {
  count = var.enable_intake ? 1 : 0

  function_name = "gk-webhook"
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.webhook[0].repository_url}@${coalesce(var.webhook_image_digest, "sha256:none")}"
  role          = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/LabRole"
  architectures = ["x86_64"]
  memory_size   = 256
  timeout       = 10

  environment {
    variables = {
      ALLOWED_REPO         = coalesce(var.allowed_repo, "none/none")
      JOBS_TABLE_NAME      = module.core.jobs_table_name
      JOBS_QUEUE_URL       = module.core.jobs_queue_url
      WEBHOOK_SECRET_PARAM = "/gatekeeper/webhook-secret"
    }
  }

  lifecycle {
    precondition {
      condition     = var.allowed_repo != null && var.webhook_image_digest != null
      error_message = "enable_intake is true, so also pass allowed_repo and webhook_image_digest (scripts/deploy.sh does). Members B and C: deploy with node scripts/gk/deploy.mjs (--core, --part web or --part worker); it writes enable_intake = false into infra/gk.auto.tfvars.json."
    }
  }
}

# enable_intake added count. Keep Part A's existing function instead of replacing it.
moved {
  from = aws_lambda_function.webhook
  to   = aws_lambda_function.webhook[0]
}
