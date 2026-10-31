variable "allowed_repo" {
  type        = string
  description = "GitHub owner/repo accepted by the PR webhook."

  validation {
    condition     = can(regex("^[^/[:space:]]+/[^/[:space:]]+$", var.allowed_repo))
    error_message = "Use a GitHub repository name in owner/repo format."
  }
}

variable "webhook_image_digest" {
  type        = string
  description = "Digest of the webhook image already pushed to ECR."

  validation {
    condition     = can(regex("^sha256:[0-9a-f]{64}$", var.webhook_image_digest))
    error_message = "Use the full sha256 digest returned by ECR."
  }
}

data "aws_caller_identity" "current" {}

resource "aws_lambda_function" "webhook" {
  function_name = "gk-webhook"
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.webhook.repository_url}@${var.webhook_image_digest}"
  role          = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/LabRole"
  architectures = ["x86_64"]
  memory_size   = 256
  timeout       = 10

  environment {
    variables = {
      ALLOWED_REPO         = var.allowed_repo
      JOBS_TABLE_NAME      = module.core.jobs_table_name
      JOBS_QUEUE_URL       = module.core.jobs_queue_url
      WEBHOOK_SECRET_PARAM = "/gatekeeper/webhook-secret"
    }
  }
}
