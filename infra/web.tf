# Part C Paste and Scan web
# switch and ECR repo and roles and the web module and outputs
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

# lab safety switch for the 2 web lambdas
# the lab limits tool can turn it on in a tfvars file that git ignores
variable "cap_web_lambdas" {
  description = "true gives gk-submit and gk-results a hard cap. Only when lab-limits.mjs says the account allows it."
  type        = bool
  default     = false
}

# account ID comes from AWS at plan time and is never typed in the code
data "aws_caller_identity" "web" {}

# web is on when the switch is on and an image digest exists
locals {
  web_on         = var.enable_web && var.web_image_digest != null
  web_make_roles = local.web_on && !var.use_lab_role
  web_lab_role   = "arn:aws:iam::${data.aws_caller_identity.web.account_id}:role/LabRole"
}

# ECR repo for the web image
# tags can not change so one tag is one exact image
resource "aws_ecr_repository" "web" {
  count = var.enable_web ? 1 : 0

  name                 = "gatekeeper/web"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = true
}

# trust policy
# only the lambda service can use these roles
data "aws_iam_policy_document" "web_lambda_trust" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

# own roles only in a real account when the lab role switch is off
# Learner Lab blocks creating roles so there both functions run as LabRole
resource "aws_iam_role" "web" {
  for_each = local.web_make_roles ? toset(["gk-submit", "gk-results"]) : toset([])

  name               = "${each.key}-role"
  assume_role_policy = data.aws_iam_policy_document.web_lambda_trust.json
}

# least privilege from the policy files in docs iam
resource "aws_iam_role_policy" "web" {
  for_each = aws_iam_role.web

  name   = "${each.key}-least-privilege"
  role   = each.value.id
  policy = templatefile("${path.module}/../docs/iam/${each.key}.json", { account_id = data.aws_caller_identity.web.account_id })
}

# the 2 lambdas and 5 routes and logs and alarm and dashboard
# all in the web module
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

  # lab safety switch from the lab limits tool
  cap_lambdas = var.cap_web_lambdas
}

# my route limits
# the core file adds them to the API stage
locals {
  web_route_throttles = flatten([for m in module.web : m.route_throttles])
}

# outputs that the deploy and smoke scripts read
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
