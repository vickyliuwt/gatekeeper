resource "aws_ecr_repository" "webhook" {
  count = var.enable_intake ? 1 : 0

  name                 = "gatekeeper/webhook"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = true
}

output "webhook_repository_url" {
  description = "ECR repository URL for the Part A webhook image (null when enable_intake is false)."
  value       = one(aws_ecr_repository.webhook[*].repository_url)
}

# enable_intake added count. Keep Part A's existing repository instead of replacing it.
moved {
  from = aws_ecr_repository.webhook
  to   = aws_ecr_repository.webhook[0]
}
