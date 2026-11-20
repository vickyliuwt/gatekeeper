resource "aws_lambda_event_source_mapping" "worker_jobs" {
  count = var.enable_worker ? 1 : 0

  event_source_arn = module.core.jobs_queue_arn
  function_name    = aws_lambda_function.worker[0].arn

  batch_size                         = 1
  maximum_batching_window_in_seconds = 0
  enabled                            = true

  scaling_config {
    maximum_concurrency = var.worker_max_concurrency
  }
}

# count added for the worker switch
# moved keeps the live trigger with no replace
moved {
  from = aws_lambda_event_source_mapping.worker_jobs
  to   = aws_lambda_event_source_mapping.worker_jobs[0]
}
