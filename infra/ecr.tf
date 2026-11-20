resource "aws_ecr_repository" "webhook" {
  name                 = "gatekeeper/webhook"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = true
}

output "webhook_repository_url" {
  description = "ECR repository URL for the Part A webhook image."
  value       = aws_ecr_repository.webhook.repository_url
}
