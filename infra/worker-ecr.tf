resource "aws_ecr_repository" "worker" {
  name                 = "gatekeeper/worker"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = true
}

output "worker_repository_url" {
  value = aws_ecr_repository.worker.repository_url
}
