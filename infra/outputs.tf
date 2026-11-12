# Shared root outputs that every member's scripts and smoke tests read.
output "api_endpoint" {
  description = "Base URL of the HTTP API (changes after every destroy and apply)."
  value       = module.core.api_endpoint
}

output "page_url" {
  description = "The Paste and Scan page. Plan B: gk-results serves it at GET /."
  value       = "${module.core.api_endpoint}/"
}

output "jobs_table_name" {
  value = module.core.jobs_table_name
}

output "jobs_queue_url" {
  description = "Contains the AWS account ID, so Terraform hides it in plan and apply logs (terraform output -raw still shows it)."
  value       = module.core.jobs_queue_url
  sensitive   = true
}

output "jobs_dlq_name" {
  value = module.core.jobs_dlq_name
}

output "data_bucket_name" {
  description = "Contains the AWS account ID, so Terraform hides it in plan and apply logs (terraform output -raw still shows it)."
  value       = module.core.data_bucket_name
  sensitive   = true
}
