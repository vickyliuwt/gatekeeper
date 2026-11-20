resource "aws_ecr_repository" "worker" {
  count = var.enable_worker ? 1 : 0

  name                 = "gatekeeper/worker"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = true
}

output "worker_repository_url" {
  value = one(aws_ecr_repository.worker[*].repository_url)
}

# count added for the worker switch
# moved keeps the live repo with no replace
moved {
  from = aws_ecr_repository.worker
  to   = aws_ecr_repository.worker[0]
}
