# dashboard gk-web: Lambda calls, errors, p95, API 4xx/5xx, queue age
# + 2 log tables (per route, per error)
# queue name = last part of the queue URL
locals {
  jobs_queue_name = regex("[^/]+$", var.jobs_queue_url)
}

resource "aws_cloudwatch_dashboard" "web" {
  dashboard_name = "gk-web"

  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "text"
        x      = 0
        y      = 0
        width  = 24
        height = 2
        properties = {
          markdown = "## GateKeeper Part C: Paste and Scan web\nA paste flood shows up as API 4xx (429 from the POST /scans limit) while gk-results keeps answering. Queue age grows only while no worker is running. The two tables come from logs: Lambda metrics are split only by function, so the API access log shows each route."
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 2
        width  = 12
        height = 6
        properties = {
          title   = "gk-submit and gk-results: calls and errors per minute"
          region  = var.region
          view    = "timeSeries"
          stacked = false
          stat    = "Sum"
          period  = 60
          metrics = [
            ["AWS/Lambda", "Invocations", "FunctionName", aws_lambda_function.submit.function_name, { label = "submit calls" }],
            ["AWS/Lambda", "Invocations", "FunctionName", aws_lambda_function.results.function_name, { label = "results calls" }],
            ["AWS/Lambda", "Errors", "FunctionName", aws_lambda_function.submit.function_name, { label = "submit errors" }],
            ["AWS/Lambda", "Errors", "FunctionName", aws_lambda_function.results.function_name, { label = "results errors" }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 2
        width  = 12
        height = 6
        properties = {
          title   = "gk-submit and gk-results: p95 duration (ms)"
          region  = var.region
          view    = "timeSeries"
          stacked = false
          stat    = "p95"
          period  = 60
          metrics = [
            ["AWS/Lambda", "Duration", "FunctionName", aws_lambda_function.submit.function_name, { label = "submit p95" }],
            ["AWS/Lambda", "Duration", "FunctionName", aws_lambda_function.results.function_name, { label = "results p95" }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 8
        width  = 12
        height = 6
        properties = {
          title   = "gk-api: requests, 4xx (429 = rate limit) and 5xx per minute"
          region  = var.region
          view    = "timeSeries"
          stacked = false
          stat    = "Sum"
          period  = 60
          metrics = [
            ["AWS/ApiGateway", "Count", "ApiId", var.api_id, { label = "requests" }],
            ["AWS/ApiGateway", "4xx", "ApiId", var.api_id, { label = "4xx" }],
            ["AWS/ApiGateway", "5xx", "ApiId", var.api_id, { label = "5xx" }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 8
        width  = 12
        height = 6
        properties = {
          title   = "gk-jobs queue: jobs waiting and oldest job age (s)"
          region  = var.region
          view    = "timeSeries"
          stacked = false
          stat    = "Maximum"
          period  = 60
          metrics = [
            ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", local.jobs_queue_name, { label = "jobs waiting" }],
            ["AWS/SQS", "ApproximateAgeOfOldestMessage", "QueueName", local.jobs_queue_name, { label = "oldest job age", yAxis = "right" }]
          ]
        }
      },
      {
        type   = "log"
        x      = 0
        y      = 14
        width  = 12
        height = 6
        properties = {
          title  = "gk-api per route (access log): requests by route and status"
          region = var.region
          view   = "table"
          query  = "SOURCE '${var.api_access_log_group}' | stats count(*) as requests by routeKey, status | sort requests desc | limit 20"
        }
      },
      {
        type   = "log"
        x      = 12
        y      = 14
        width  = 12
        height = 6
        properties = {
          title  = "gk-submit and gk-results: error lines by message (JSON logs)"
          region = var.region
          view   = "table"
          query  = "SOURCE '${aws_cloudwatch_log_group.submit.name}' | SOURCE '${aws_cloudwatch_log_group.results.name}' | filter level = \"error\" | stats count(*) as errors by svc, msg | sort errors desc | limit 20"
        }
      }
    ]
  })
}
