# The shared data bucket.
# Part B writes reports/ and reads pasted/. Part C writes pasted/ and reads reports/.
variable "lock_reports_to_worker" {
  description = "Week-1 test (Part B): deny writes to reports/ unless the caller is gk-worker."
  type        = bool
  default     = false
}

data "aws_caller_identity" "core" {}

locals {
  data_bucket_name = "gk-data-${data.aws_caller_identity.core.account_id}"
  data_bucket_arn  = "arn:aws:s3:::${local.data_bucket_name}"
}

resource "terraform_data" "data_bucket" {
  input = local.data_bucket_name

  provisioner "local-exec" {
    command = "aws s3api head-bucket --bucket ${self.input} --region us-east-1 || aws s3api create-bucket --bucket ${self.input} --region us-east-1"
  }

  provisioner "local-exec" {
    when    = destroy
    command = "aws s3 rb s3://${self.input} --force --region us-east-1"
  }
}

resource "aws_s3_bucket_public_access_block" "data" {
  bucket                  = terraform_data.data_bucket.output
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "data" {
  bucket = terraform_data.data_bucket.output

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "data" {
  bucket = terraform_data.data_bucket.output

  rule {
    id     = "reports-30-days"
    status = "Enabled"

    filter {
      prefix = "reports/"
    }

    expiration {
      days = 30
    }
  }

  rule {
    id     = "pasted-1-day"
    status = "Enabled"

    filter {
      prefix = "pasted/"
    }

    expiration {
      days = 1
    }
  }
}

data "aws_iam_policy_document" "data" {
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [local.data_bucket_arn, "${local.data_bucket_arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }

  dynamic "statement" {
    for_each = var.lock_reports_to_worker ? [1] : []

    content {
      sid       = "OnlyWorkerWritesReports"
      effect    = "Deny"
      actions   = ["s3:PutObject"]
      resources = ["${local.data_bucket_arn}/reports/*"]

      principals {
        type        = "*"
        identifiers = ["*"]
      }

      condition {
        test     = "StringNotLike"
        variable = "aws:userid"
        values   = ["*:gk-worker"]
      }
    }
  }
}

resource "aws_s3_bucket_policy" "data" {
  bucket     = terraform_data.data_bucket.output
  policy     = data.aws_iam_policy_document.data.json
  depends_on = [aws_s3_bucket_public_access_block.data]
}

output "data_bucket_name" {
  value = terraform_data.data_bucket.output
}

output "data_bucket_arn" {
  value = local.data_bucket_arn
}

output "jobs_table_arn" {
  value = aws_dynamodb_table.jobs.arn
}

output "api_access_log_group_name" {
  description = "API Gateway access log group (Part C's dashboard reads it per route)."
  value       = aws_cloudwatch_log_group.api_access.name
}
