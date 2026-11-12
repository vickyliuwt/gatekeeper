
variable "enable_web" {
  description = "Part C switch. true creates ECR gatekeeper/web; with web_image_digest also the two Lambdas and five routes."
  type        = bool
  default     = false
}

variable "web_image_digest" {
  description = "sha256 digest of the gatekeeper/web image in ECR (scripts/gk/deploy.mjs passes it). Leave null on the first apply."
  type        = string
  default     = null

  validation {
    condition     = var.web_image_digest == null || can(regex("^sha256:[0-9a-f]{64}$", var.web_image_digest))
    error_message = "Use the full sha256 digest returned by ECR."
  }
}

variable "web_list_repo" {
  description = "owner/repo whose PR scans GET /scans lists when Part A is off. With Part A on, var.allowed_repo wins."
  type        = string
  default     = "vickyliuwt/gatekeeper-demo"
}

variable "web_demo_code_param" {
  description = "Name of the SSM SecureString that holds the Paste and Scan access code. Terraform stores only this name."
  type        = string
  default     = "/gatekeeper/demo-code"
}

data "aws_caller_identity" "web" {}

locals {
  web_on         = var.enable_web && var.web_image_digest != null
  web_make_roles = local.web_on && !var.use_lab_role
  web_lab_role   = "arn:aws:iam::${data.aws_caller_identity.web.account_id}:role/LabRole"
}

resource "aws_ecr_repository" "web" {
  count = var.enable_web ? 1 : 0

  name                 = "gatekeeper/web"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = true
}

data "aws_iam_policy_document" "web_lambda_trust" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "web" {
  for_each = local.web_make_roles ? toset(["gk-submit", "gk-results"]) : toset([])

  name               = "${each.key}-role"
  assume_role_policy = data.aws_iam_policy_document.web_lambda_trust.json
}

resource "aws_iam_role_policy" "web" {
  for_each = aws_iam_role.web

  name   = "${each.key}-least-privilege"
  role   = each.value.id
  policy = templatefile("${path.module}/../docs/iam/${each.key}.json", { account_id = data.aws_caller_identity.web.account_id })
}

module "web" {
  source = "./modules/web"
  count  = local.web_on ? 1 : 0

  api_id            = module.core.api_id
  api_execution_arn = module.core.api_execution_arn
  submit_role_arn   = try(aws_iam_role.web["gk-submit"].arn, local.web_lab_role)
  results_role_arn  = try(aws_iam_role.web["gk-results"].arn, local.web_lab_role)
  image_uri         = "${try(aws_ecr_repository.web[0].repository_url, "none")}@${coalesce(var.web_image_digest, "sha256:none")}"
  jobs_table_name   = module.core.jobs_table_name
  jobs_queue_url    = module.core.jobs_queue_url
  data_bucket_name  = module.core.data_bucket_name
  demo_code_param   = var.web_demo_code_param
  list_repo         = var.allowed_repo != null ? var.allowed_repo : var.web_list_repo
  alarm_topic_arn   = aws_sns_topic.alerts.arn

  api_access_log_group = module.core.api_access_log_group_name

  depends_on = [aws_iam_role_policy.web]
}

locals {
  web_route_throttles = flatten([for m in module.web : m.route_throttles])
}

output "web_repository_url" {
  description = "ECR repository for the Part C image (null when enable_web is false). Contains the account ID, so it is hidden in logs."
  value       = one(aws_ecr_repository.web[*].repository_url)
  sensitive   = true
}

output "web_page_url" {
  description = "Open this in a browser: the Paste and Scan page (GET /)."
  value       = length(module.web) > 0 ? "${module.core.api_endpoint}/" : null
}

output "web_dashboard_url" {
  description = "CloudWatch dashboard for Part C (null when Part C is off)."
  value       = length(module.web) > 0 ? "https://us-east-1.console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards/dashboard/${one(module.web[*].dashboard_name)}" : null
}
