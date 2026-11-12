variable "api_id" {
  description = "HTTP API id (module.core output)."
  type        = string
}

variable "api_execution_arn" {
  description = "HTTP API execution ARN (module.core output). Limits which routes may invoke each Lambda."
  type        = string
}

variable "submit_role_arn" {
  description = "Execution role of gk-submit. Learner Lab: the existing LabRole. Real account: gk-submit-role (docs/iam/gk-submit.json)."
  type        = string
}

variable "results_role_arn" {
  description = "Execution role of gk-results. Learner Lab: the existing LabRole. Real account: gk-results-role (docs/iam/gk-results.json, read only)."
  type        = string
}

variable "image_uri" {
  description = "The web image pinned by digest: REPOSITORY_URL@sha256:..."
  type        = string
}

variable "jobs_table_name" {
  description = "DynamoDB table gk-jobs."
  type        = string
}

variable "jobs_queue_url" {
  description = "SQS queue URL for scan jobs (only gk-submit sends)."
  type        = string
}

variable "data_bucket_name" {
  description = "Data bucket gk-data-ACCOUNT (pasted/ and reports/)."
  type        = string
}

variable "demo_code_param" {
  description = "Name of the SSM SecureString with the access code (never the value)."
  type        = string
}

variable "list_repo" {
  description = "owner/repo listed by GET /scans (passed to gk-results as ALLOWED_REPO)."
  type        = string
}

variable "alarm_topic_arn" {
  description = "SNS topic for the gk-web-errors alarm."
  type        = string
  default     = null
}

variable "enable_alarm" {
  description = "Create the gk-web-errors alarm."
  type        = bool
  default     = true
}

variable "log_retention_days" {
  description = "How long CloudWatch keeps the two functions' logs."
  type        = number
  default     = 7
}

variable "region" {
  description = "Region shown in the dashboard widgets."
  type        = string
  default     = "us-east-1"
}

variable "api_access_log_group" {
  description = "API Gateway access log group from module.core (the dashboard's per-route table)."
  type        = string
  default     = "/gatekeeper/api/access"
}
