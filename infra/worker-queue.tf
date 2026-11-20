resource "aws_lambda_event_source_mapping" "worker_jobs" {
  event_source_arn = module.core.jobs_queue_arn
  function_name    = aws_lambda_function.worker.arn

  batch_size                         = 1
  maximum_batching_window_in_seconds = 0
  enabled                            = true

  scaling_config {
    maximum_concurrency = 2
  }
}
