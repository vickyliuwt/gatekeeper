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

# count added for the intake switch
# moved keeps the live Part A repo with no replace
moved {
  from = aws_ecr_repository.webhook
  to   = aws_ecr_repository.webhook[0]
}
