# web dashboard
# lambda calls and errors and p95 time and API 4xx and 5xx and queue age
# plus 2 log tables
# one per route and one per error
# queue name is the last part of the queue URL
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
          markdown = "## GateKeeper Part C: Paste and Scan web\nToo many scans at once show up as API 4xx (429 from the POST /scans limit) while gk-results keeps answering. Queue age grows only while no worker is running. The two tables come from logs: Lambda metrics are split only by function, so the API access log shows each route. The last graph is the whole account: Learner Lab switches an account off near 10 Lambdas at once, so every test sends one request at a time."
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
      },
      {
        type   = "metric"
        x      = 0
        y      = 20
        width  = 24
        height = 6
        properties = {
          title   = "Whole account: Lambdas running at once (Learner Lab line is about 10, stay at 5 or less)"
          view    = "timeSeries"
          region  = var.region
          stat    = "Maximum"
          period  = 60
          stacked = false
          metrics = [
            ["AWS/Lambda", "ConcurrentExecutions", { label = "running at once" }]
          ]
          annotations = {
            horizontal = [
              { label = "stop tests", value = 5 },
              { label = "Learner Lab line", value = 10 }
            ]
          }
        }
      }
    ]
  })
}
