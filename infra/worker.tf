variable "worker_image_digest" {
  type        = string
  description = "Digest of the worker image already pushed to ECR."

  validation {
    condition     = can(regex("^sha256:[0-9a-f]{64}$", var.worker_image_digest))
    error_message = "Use the full sha256 digest returned by ECR."
  }
}

resource "aws_lambda_function" "worker" {
  function_name = "gk-worker"
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.worker.repository_url}@${var.worker_image_digest}"
  role          = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/LabRole"

  architectures = ["x86_64"]
  memory_size   = 512
  timeout       = 60

  environment {
    variables = {
      JOBS_TABLE         = module.core.jobs_table_name
      REPORTS_BUCKET     = local.reports_bucket_name
      GITHUB_TOKEN_PARAM = "/gatekeeper/github-token"
    }
  }

  depends_on = [
    aws_s3_bucket_public_access_block.reports,
    aws_s3_bucket_server_side_encryption_configuration.reports,
  ]
}

output "worker_function_name" {
  value = aws_lambda_function.worker.function_name
}
