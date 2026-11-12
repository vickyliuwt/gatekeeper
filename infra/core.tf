module "core" {
  source = "./modules/core"

  # Seam: each part plugs its own per-route limits in from its own file.
  #   local.intake_route_throttles  Part A, infra/webhook-route.tf
  #   local.web_route_throttles     Part C, infra/web.tf
  route_throttles = concat(local.intake_route_throttles, local.web_route_throttles)

  # Part B's week-1 test (infra/worker.tf): deny writes to reports/ unless the caller is gk-worker.
  lock_reports_to_worker = var.lock_reports_to_worker
}
