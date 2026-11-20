# the scan worker
# Lingsong built it on the scanner and paste worker from Yuyao
# one switch turns the worker on and off like the intake switch
# moved blocks keep the live worker in an account that already has it
variable "enable_worker" {
  description = "Turn on the scan worker: gk-worker, its ECR repository, its queue trigger and its 3 alarms."
  type        = bool
  default     = true
}

variable "worker_image_digest" {
  type        = string
  description = "Digest of the worker image already pushed to ECR. Required when enable_worker is true."
  default     = null

  validation {
    condition     = var.worker_image_digest == null || can(regex("^sha256:[0-9a-f]{64}$", var.worker_image_digest))
    error_message = "Use the full sha256 digest returned by ECR."
  }
}

# Learner Lab safety line
# AWS lets an SQS trigger go down to 2 and no lower
# so 2 is the only safe number in our lab accounts
variable "worker_max_concurrency" {
  description = "Most workers running at once. Learner Lab safety line: keep 2."
  type        = number
  default     = 2

  validation {
    condition     = var.worker_max_concurrency == 2
    error_message = "Keep worker_max_concurrency at 2 in Learner Lab (our safety line, and the AWS minimum)."
  }
}

variable "lock_reports_to_worker" {
  description = "Test switch: deny writes to reports/ unless the caller is gk-worker."
  type        = bool
  default     = false
}

resource "aws_lambda_function" "worker" {
  count = var.enable_worker ? 1 : 0

  function_name = "gk-worker"
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.worker[0].repository_url}@${coalesce(var.worker_image_digest, "sha256:none")}"
  role          = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/LabRole"

  architectures = ["x86_64"]
  memory_size   = 512
  timeout       = 60

  # one shared data bucket
  # my submit lambda writes pasted code and my results lambda reads reports
  # so the worker reads and writes the same bucket
  environment {
    variables = {
      JOBS_TABLE         = module.core.jobs_table_name
      REPORTS_BUCKET     = module.core.data_bucket_name
      GITHUB_TOKEN_PARAM = "/gatekeeper/github-token"
    }
  }

  lifecycle {
    precondition {
      condition     = var.worker_image_digest != null
      error_message = "enable_worker is true, so also pass worker_image_digest (scripts/deploy.sh and scripts/gk/deploy.mjs do)."
    }
  }
}

output "worker_function_name" {
  value = one(aws_lambda_function.worker[*].function_name)
}

# 3 worker alarms to the same email topic
# dead letter queue not empty and oldest job over 2 min and worker errors
resource "aws_cloudwatch_metric_alarm" "dlq_not_empty" {
  count = var.enable_worker ? 1 : 0

  alarm_name          = "gk-dlq-not-empty"
  alarm_description   = "A GateKeeper job failed 5 times and is in the dead letter queue."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = module.core.jobs_dlq_name }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "queue_age" {
  count = var.enable_worker ? 1 : 0

  alarm_name          = "gk-queue-age"
  alarm_description   = "The oldest GateKeeper job has waited more than 2 minutes."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateAgeOfOldestMessage"
  dimensions          = { QueueName = element(split(":", module.core.jobs_queue_arn), 5) }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 120
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "worker_errors" {
  count = var.enable_worker ? 1 : 0

  alarm_name          = "gk-worker-errors"
  alarm_description   = "gk-worker returned an error."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.worker[0].function_name }
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

moved {
  from = aws_lambda_function.worker
  to   = aws_lambda_function.worker[0]
}

# the old reports bucket settings from part a
# the bucket is not used any more
# Terraform forgets these 3 and does not delete them
removed {
  from = aws_s3_bucket_public_access_block.reports
  lifecycle {
    destroy = false
  }
}

removed {
  from = aws_s3_bucket_server_side_encryption_configuration.reports
  lifecycle {
    destroy = false
  }
}

removed {
  from = aws_s3_bucket_lifecycle_configuration.reports
  lifecycle {
    destroy = false
  }
}
