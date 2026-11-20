module "core" {
  source = "./modules/core"

  # each part adds its own route limits from its own file
  # Part A limits come from the webhook route file
  # Part C limits come from the web file
  route_throttles = concat(local.intake_route_throttles, local.web_route_throttles)

  # Part B test switch
  # only the worker may write reports
  # see the worker file
  lock_reports_to_worker = var.lock_reports_to_worker
}
